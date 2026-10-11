from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import httpx

from app.models import ExtractedContent

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