from dataclasses import dataclass
from datetime import datetime, timezone
from math import sqrt
from typing import Any, Literal
from uuid import uuid4

import httpx

from app.models import ExtractedContent, SearchResult

JobStatus = Literal["queued", "processing", "completed", "failed", "cancelled"]


@dataclass
class DocumentRecord:
    id: str
    job_id: str
    owner_id: str
    filename: str
    title: str
    content_type: str
    size_bytes: int
    created_at: datetime
    content: ExtractedContent | None = None
    page_count: int | None = None
    indexing_status: Literal["pending", "processing", "completed", "failed"] = "pending"
    indexed_chunks: int = 0
    indexing_error: str | None = None


@dataclass
class JobRecord:
    id: str
    document_id: str
    owner_id: str
    docling_task_id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None
    access_token: str | None = None


class InMemoryStore:
    """Separate ephemeral conversion jobs from document metadata and results."""

    def __init__(self) -> None:
        self.documents: dict[str, DocumentRecord] = {}
        self.jobs: dict[str, JobRecord] = {}
        self.indexed_chunks: dict[str, list[dict[str, Any]]] = {}
        self.pdf_paths: dict[str, Any] = {}

    def update_indexing_state(
        self,
        document: DocumentRecord,
        status: Literal["pending", "processing", "completed", "failed"],
        indexed_chunks: int,
        error: str | None = None,
    ) -> None:
        document.indexing_status = status
        document.indexed_chunks = indexed_chunks
        document.indexing_error = error

    def upsert_chunks(
        self, document: DocumentRecord, chunks: list[dict[str, Any]]
    ) -> None:
        existing = {
            chunk["chunk_index"]: chunk
            for chunk in self.indexed_chunks.get(document.id, [])
        }
        for chunk in chunks:
            chunk_index = chunk["chunk_index"]
            existing[chunk_index] = {
                **chunk,
                "id": existing.get(chunk_index, {}).get("id", str(uuid4())),
            }
        self.indexed_chunks[document.id] = [existing[index] for index in sorted(existing)]

    def finish_chunk_index(self, document: DocumentRecord, chunk_count: int) -> None:
        self.indexed_chunks[document.id] = [
            chunk
            for chunk in self.indexed_chunks.get(document.id, [])
            if chunk["chunk_index"] < chunk_count
        ]

    def get_indexed_chunks(self, document_id: str) -> dict[int, dict[str, Any]]:
        return {
            int(chunk["chunk_index"]): chunk
            for chunk in self.indexed_chunks.get(document_id, [])
        }

    def hybrid_search(
        self,
        owner_id: str,
        query: str,
        embedding: list[float],
        embedding_model: str,
        document_id: str | None,
        limit: int,
        candidate_limit: int,
    ) -> list[SearchResult]:
        documents = {
            document.id: document
            for document in self.documents.values()
            if document.owner_id == owner_id
            and document.indexing_status == "completed"
            and (document_id is None or document.id == document_id)
        }
        entries = [
            (document, chunk)
            for document in documents.values()
            for chunk in self.indexed_chunks.get(document.id, [])
            if chunk["embedding_model"] == embedding_model
        ]
        semantic = sorted(
            entries,
            key=lambda item: self._cosine_similarity(
                item[1]["embedding"], embedding
            ),
            reverse=True,
        )[:candidate_limit]
        query_terms = set(query.casefold().split())
        lexical = sorted(
            (
                item
                for item in entries
                if query.casefold() in item[1]["content"].casefold()
                or query_terms.intersection(item[1]["content"].casefold().split())
            ),
            key=lambda item: (
                query.casefold() in item[1]["content"].casefold(),
                len(query_terms.intersection(item[1]["content"].casefold().split())),
            ),
            reverse=True,
        )[:candidate_limit]

        fused: dict[str, dict[str, Any]] = {}
        for method, ranked in (("semantic", semantic), ("lexical", lexical)):
            for rank, (document, chunk) in enumerate(ranked, start=1):
                item = fused.setdefault(
                    chunk["id"],
                    {"document": document, "chunk": chunk, "score": 0.0, "methods": []},
                )
                item["score"] += 1.0 / (60 + rank)
                item["methods"].append(method)
                item[f"{method}_rank"] = rank

        ordered = sorted(fused.values(), key=lambda item: item["score"], reverse=True)
        return [
            SearchResult(
                chunk_id=item["chunk"]["id"],
                document_id=item["document"].id,
                title=item["document"].title,
                filename=item["document"].filename,
                excerpt=item["chunk"]["content"],
                page_numbers=item["chunk"]["page_numbers"],
                location_metadata=item["chunk"]["location_metadata"],
                score=item["score"],
                semantic_rank=item.get("semantic_rank"),
                lexical_rank=item.get("lexical_rank"),
                retrieval_methods=item["methods"],
            )
            for item in ordered[:limit]
        ]

    @staticmethod
    def _cosine_similarity(left: list[float], right: list[float]) -> float:
        numerator = sum(a * b for a, b in zip(left, right))
        left_norm = sqrt(sum(value * value for value in left))
        right_norm = sqrt(sum(value * value for value in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return numerator / (left_norm * right_norm)


class SupabaseStoreError(Exception):
    pass


class SupabaseStore(InMemoryStore):
    """Persist records through Supabase APIs using the verified user's JWT."""

    bucket_name = "knowledge-workspace-documents"

    def __init__(
        self,
        url: str,
        publishable_key: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__()
        self.url = url.rstrip("/")
        self.publishable_key = publishable_key
        self.transport = transport

    def _headers(self, access_token: str, *, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.publishable_key,
            "Authorization": f"Bearer {access_token}",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def _request(
        self,
        method: str,
        url: str,
        access_token: str,
        **kwargs: object,
    ) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        headers.update(self._headers(access_token))
        try:
            async with httpx.AsyncClient(timeout=20, transport=self.transport) as client:
                response = await client.request(method, url, headers=headers, **kwargs)
        except httpx.RequestError as exc:
            raise SupabaseStoreError("Supabase persistence is unavailable.") from exc
        if not response.is_success:
            detail = response.text[:500]
            raise SupabaseStoreError(
                f"Supabase persistence request failed ({response.status_code}): {detail}"
            )
        return response

    async def create_records(
        self,
        document: DocumentRecord,
        job: JobRecord,
        pdf_path: object,
        access_token: str,
    ) -> None:
        storage_path = f"{document.owner_id}/{document.id}.pdf"
        with open(pdf_path, "rb") as pdf_file:
            pdf_bytes = pdf_file.read()
        upload_url = f"{self.url}/storage/v1/object/{self.bucket_name}/{storage_path}"
        await self._request(
            "POST",
            upload_url,
            access_token,
            headers={"Content-Type": "application/pdf", "x-upsert": "false"},
            content=pdf_bytes,
        )
        document_url = f"{self.url}/rest/v1/documents"
        job_url = f"{self.url}/rest/v1/processing_jobs"
        try:
            await self._request(
                "POST",
                document_url,
                access_token,
                headers={"Prefer": "return=minimal"},
                json={
                    "id": document.id,
                    "owner_id": document.owner_id,
                    "filename": document.filename,
                    "title": document.title,
                    "content_type": document.content_type,
                    "size_bytes": document.size_bytes,
                    "storage_path": storage_path,
                    "page_count": document.page_count,
                    "created_at": document.created_at.isoformat(),
                },
            )
            await self._request(
                "POST",
                job_url,
                access_token,
                headers={"Prefer": "return=minimal"},
                json={
                    "id": job.id,
                    "document_id": job.document_id,
                    "owner_id": job.owner_id,
                    "docling_task_id": job.docling_task_id,
                    "status": job.status,
                    "created_at": job.created_at.isoformat(),
                    "updated_at": job.updated_at.isoformat(),
                },
            )
        except Exception:
            try:
                await self._request(
                    "DELETE",
                    f"{document_url}?id=eq.{document.id}",
                    access_token,
                    headers={"Prefer": "return=minimal"},
                )
                await self._request(
                    "DELETE",
                    upload_url,
                    access_token,
                    headers={"Prefer": "return=minimal"},
                )
            except SupabaseStoreError:
                pass
            raise

    async def update_job(self, job: JobRecord, access_token: str) -> None:
        await self._request(
            "PATCH",
            f"{self.url}/rest/v1/processing_jobs?id=eq.{job.id}",
            access_token,
            headers={"Prefer": "return=minimal"},
            json={
                "status": job.status,
                "error_message": job.error_message,
                "updated_at": job.updated_at.isoformat(),
            },
        )

    async def delete_records(
        self, document: DocumentRecord, access_token: str
    ) -> None:
        storage_path = f"{document.owner_id}/{document.id}.pdf"
        await self._request(
            "DELETE",
            f"{self.url}/storage/v1/object/{self.bucket_name}/{storage_path}",
            access_token,
        )
        await self._request(
            "DELETE",
            f"{self.url}/rest/v1/documents?id=eq.{document.id}",
            access_token,
            headers={"Prefer": "return=minimal"},
        )

    async def save_extraction(
        self,
        document: DocumentRecord,
        job: JobRecord,
        access_token: str,
    ) -> None:
        if document.content is None:
            return
        await self._request(
            "POST",
            f"{self.url}/rest/v1/document_extractions",
            access_token,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json={
                "document_id": document.id,
                "job_id": job.id,
                "owner_id": document.owner_id,
                "markdown": document.content.markdown,
                "structured_content": document.content.structured_json,
                "blocks": [block.model_dump() for block in document.content.blocks],
                "updated_at": job.updated_at.isoformat(),
            },
        )
        await self._request(
            "PATCH",
            f"{self.url}/rest/v1/documents?id=eq.{document.id}",
            access_token,
            headers={"Prefer": "return=minimal"},
            json={"page_count": document.page_count},
        )

    async def update_indexing_state(
        self,
        document: DocumentRecord,
        status: Literal["pending", "processing", "completed", "failed"],
        indexed_chunks: int,
        access_token: str,
        error: str | None = None,
    ) -> None:
        document.indexing_status = status
        document.indexed_chunks = indexed_chunks
        document.indexing_error = error
        await self._request(
            "PATCH",
            f"{self.url}/rest/v1/documents?id=eq.{document.id}&owner_id=eq.{document.owner_id}",
            access_token,
            headers={"Prefer": "return=minimal"},
            json={
                "indexing_status": status,
                "indexed_chunks": indexed_chunks,
                "indexing_error": error,
                "indexed_at": datetime.now().astimezone().isoformat()
                if status == "completed"
                else None,
            },
        )
    async def list_backfill_candidates(
        self, access_token: str, owner_id: str, limit: int
    ) -> list[DocumentRecord]:
        response = await self._request(
            "GET",
            f"{self.url}/rest/v1/documents",
            access_token,
            params={
                "owner_id": f"eq.{owner_id}",
                "indexing_status": "in.(pending,processing,failed)",
                "select": "*",
                "order": "created_at.asc",
                "limit": str(limit),
            },
        )
        return self._records_from_rows(response.json())

    async def get_indexed_chunks(
        self, document: DocumentRecord, access_token: str
    ) -> dict[int, dict[str, Any]]:
        response = await self._request(
            "GET",
            f"{self.url}/rest/v1/document_chunks",
            access_token,
            params={
                "document_id": f"eq.{document.id}",
                "owner_id": f"eq.{document.owner_id}",
                "select": "chunk_index,content,page_numbers,location_metadata,embedding_model",
                "order": "chunk_index.asc",
            },
        )
        return {int(row["chunk_index"]): row for row in response.json()}

    async def upsert_chunks(
        self,
        document: DocumentRecord,
        chunks: list[dict[str, Any]],
        access_token: str,
    ) -> None:
        rows = [
            {
                **chunk,
                "document_id": document.id,
                "owner_id": document.owner_id,
                "embedding": "[" + ",".join(f"{value:.8f}" for value in chunk["embedding"]) + "]",
            }
            for chunk in chunks
        ]
        await self._request(
            "POST",
            f"{self.url}/rest/v1/document_chunks?on_conflict=document_id,chunk_index",
            access_token,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows,
        )

    async def finish_chunk_index(
        self, document: DocumentRecord, chunk_count: int, access_token: str
    ) -> None:
        await self._request(
            "DELETE",
            f"{self.url}/rest/v1/document_chunks?document_id=eq.{document.id}&owner_id=eq.{document.owner_id}&chunk_index=gte.{chunk_count}",
            access_token,
            headers={"Prefer": "return=minimal"},
        )

    async def get_extractions(
        self, access_token: str, owner_id: str, document_ids: list[str]
    ) -> dict[str, ExtractedContent]:
        if not document_ids:
            return {}
        response = await self._request(
            "GET",
            f"{self.url}/rest/v1/document_extractions",
            access_token,
            params={
                "owner_id": f"eq.{owner_id}",
                "document_id": f"in.({','.join(document_ids)})",
                "select": "document_id,markdown,structured_content,blocks",
            },
        )
        return {
            str(row["document_id"]): ExtractedContent.model_validate(
                {
                    "markdown": row["markdown"],
                    "structured_json": row.get("structured_content"),
                    "blocks": row.get("blocks", []),
                }
            )
            for row in response.json()
        }

    async def hybrid_search(
        self,
        owner_id: str,
        query: str,
        embedding: list[float],
        embedding_model: str,
        document_id: str | None,
        limit: int,
        candidate_limit: int,
        access_token: str,
    ) -> list[SearchResult]:
        response = await self._request(
            "POST",
            f"{self.url}/rest/v1/rpc/search_document_chunks",
            access_token,
            json={
                "p_query_text": query,
                "p_query_embedding": embedding,
                "p_embedding_model": embedding_model,
                "p_document_id": document_id,
                "p_result_limit": limit,
                "p_candidate_limit": candidate_limit,
            },
        )
        return [SearchResult.model_validate(row) for row in response.json()]

    async def get_pdf(
        self, owner_id: str, document_id: str, access_token: str
    ) -> bytes:
        response = await self._request(
            "GET",
            f"{self.url}/storage/v1/object/authenticated/{self.bucket_name}/{owner_id}/{document_id}.pdf",
            access_token,
        )
        return response.content

    @staticmethod
    def _parse_datetime(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    def _records_from_rows(self, rows: list[dict[str, object]]) -> list[DocumentRecord]:
        documents: list[DocumentRecord] = []
        for row in rows:
            documents.append(
                DocumentRecord(
                    id=str(row["id"]),
                    job_id=str(row.get("job_id") or ""),
                    owner_id=str(row["owner_id"]),
                    filename=str(row["filename"]),
                    title=str(row["title"]),
                    content_type=str(row["content_type"]),
                    size_bytes=int(row["size_bytes"]),
                    created_at=self._parse_datetime(str(row["created_at"])),
                    page_count=int(row["page_count"]) if row.get("page_count") else None,
                    indexing_status=row.get("indexing_status", "pending"),
                    indexed_chunks=int(row.get("indexed_chunks") or 0),
                    indexing_error=str(row["indexing_error"])
                    if row.get("indexing_error") is not None
                    else None,
                )
            )
        return documents

    @staticmethod
    def _job_from_row(row: dict[str, object]) -> JobRecord:
        return JobRecord(
            id=str(row["id"]),
            document_id=str(row["document_id"]),
            owner_id=str(row["owner_id"]),
            docling_task_id=str(row.get("docling_task_id") or ""),
            status=row["status"],
            created_at=SupabaseStore._parse_datetime(str(row["created_at"])),
            updated_at=SupabaseStore._parse_datetime(str(row["updated_at"])),
            error_message=str(row["error_message"])
            if row.get("error_message") is not None
            else None,
        )

    async def _get_jobs(self, access_token: str, owner_id: str) -> list[JobRecord]:
        response = await self._request(
            "GET",
            f"{self.url}/rest/v1/processing_jobs",
            access_token,
            params={"owner_id": f"eq.{owner_id}", "select": "*"},
        )
        return [self._job_from_row(row) for row in response.json()]

    async def list_records(
        self, access_token: str, owner_id: str
    ) -> tuple[list[DocumentRecord], list[JobRecord]]:
        documents_response = await self._request(
            "GET",
            f"{self.url}/rest/v1/documents",
            access_token,
            params={
                "owner_id": f"eq.{owner_id}",
                "select": "*",
                "order": "created_at.desc",
            },
        )
        documents = self._records_from_rows(documents_response.json())
        jobs = await self._get_jobs(access_token, owner_id)
        jobs_by_document = {job.document_id: job for job in jobs}
        for document in documents:
            job = jobs_by_document.get(document.id)
            if job:
                document.job_id = job.id
        return documents, jobs

    async def get_record(
        self, access_token: str, owner_id: str, document_id: str
    ) -> tuple[DocumentRecord, JobRecord] | None:
        response = await self._request(
            "GET",
            f"{self.url}/rest/v1/documents",
            access_token,
            params={
                "id": f"eq.{document_id}",
                "owner_id": f"eq.{owner_id}",
                "select": "*",
            },
        )
        rows = response.json()
        if not rows:
            return None
        jobs = await self._get_jobs(access_token, owner_id)
        document = self._records_from_rows(rows)[0]
        job = next((item for item in jobs if item.document_id == document.id), None)
        if not job:
            return None
        extraction_response = await self._request(
            "GET",
            f"{self.url}/rest/v1/document_extractions",
            access_token,
            params={"document_id": f"eq.{document.id}", "select": "*"},
        )
        extraction_rows = extraction_response.json()
        if extraction_rows:
            extraction = extraction_rows[0]
            document.content = ExtractedContent.model_validate(
                {
                    "markdown": extraction["markdown"],
                    "structured_json": extraction.get("structured_content"),
                    "blocks": extraction.get("blocks", []),
                }
            )
        return document, job

    async def get_job(
        self, access_token: str, owner_id: str, job_id: str
    ) -> JobRecord | None:
        response = await self._request(
            "GET",
            f"{self.url}/rest/v1/processing_jobs",
            access_token,
            params={
                "id": f"eq.{job_id}",
                "owner_id": f"eq.{owner_id}",
                "select": "*",
            },
        )
        rows = response.json()
        return self._job_from_row(rows[0]) if rows else None