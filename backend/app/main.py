import asyncio
import logging
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from uuid import UUID

from app.auth import (
    AuthenticatedUser,
    InvalidAccessToken,
    SupabaseAuthUnavailable,
    SupabaseAuthVerifier,
)
from app.config import Settings
from app.docling_client import (
    DoclingServeClient,
    DoclingServeError,
    parse_conversion_result,
)
from app.embeddings import EmbeddingService, chunk_blocks
from app.models import (
    DocumentDetail,
    DocumentSummary,
    ExtractedBlock,
    JobStatus,
    JobSummary,
    SearchResult,
)
from app.search import SearchService
from app.store import DocumentRecord, InMemoryStore, JobRecord, SupabaseStore, SupabaseStoreError

logger = logging.getLogger(__name__)
PDF_SIGNATURE = b"%PDF-"
CHUNK_SIZE = 1024 * 1024
MAX_MULTIPART_OVERHEAD = 1024 * 1024


class Runtime:
    def __init__(
        self,
        settings: Settings,
        docling_client: Any | None = None,
        auth_verifier: Any | None = None,
        embedding_service: EmbeddingService | None = None,
    ) -> None:
        self.settings = settings
        self.docling = docling_client or DoclingServeClient(settings)
        self.auth_verifier = auth_verifier or SupabaseAuthVerifier(settings)
        self.store = (
            SupabaseStore(settings.supabase_url, settings.supabase_publishable_key)
            if settings.supabase_persistence_enabled
            and settings.supabase_url
            and settings.supabase_publishable_key
            else InMemoryStore()
        )
        self.tasks: set[asyncio.Task[None]] = set()
        self.job_tasks: dict[str, asyncio.Task[None]] = {}
        self.indexing_document_ids: set[str] = set()
        self.embeddings = embedding_service or EmbeddingService(
            settings.embedding_model, settings.embedding_max_tokens, settings.embedding_batch_size
        )
        self.search = SearchService(self.embeddings)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    document_id: UUID | None = None
    limit: int = Field(default=10, ge=1, le=20)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _job_summary(job: JobRecord) -> JobSummary:
    return JobSummary(
        id=job.id,
        document_id=job.document_id,
        status=job.status,
        created_at=job.created_at,
        updated_at=job.updated_at,
        error_message=job.error_message,
    )


def _document_summary(document: DocumentRecord, job: JobRecord) -> DocumentSummary:
    return DocumentSummary(
        id=document.id,
        job_id=job.id,
        filename=document.filename,
        title=document.title,
        content_type=document.content_type,
        size_bytes=document.size_bytes,
        created_at=document.created_at,
        status=job.status,
        error_message=job.error_message,
        page_count=document.page_count,
        indexing_status=document.indexing_status,
        indexed_chunks=document.indexed_chunks,
        indexing_error=document.indexing_error,
        processing_seconds=(
            round((job.updated_at - job.created_at).total_seconds(), 1)
            if job.status in {"completed", "failed", "cancelled"}
            else None
        ),
    )


def _document_detail(document: DocumentRecord, job: JobRecord) -> DocumentDetail:
    return DocumentDetail(
        **_document_summary(document, job).model_dump(),
        content=document.content,
    )


def _set_job_status(
    job: JobRecord, status: JobStatus, error_message: str | None = None
) -> None:
    job.status = status
    job.updated_at = _now()
    job.error_message = error_message


async def _persist_job_status(runtime: Runtime, job: JobRecord, user_token: str | None) -> None:
    if isinstance(runtime.store, SupabaseStore):
        if not user_token:
            raise SupabaseStoreError("Verified Supabase access token is unavailable.")
        await runtime.store.update_job(job, user_token)


async def _set_indexing_state(
    runtime: Runtime,
    document: DocumentRecord,
    status: str,
    indexed_chunks: int,
    access_token: str | None,
    error: str | None = None,
) -> None:
    if isinstance(runtime.store, SupabaseStore):
        if not access_token:
            raise SupabaseStoreError("Verified Supabase access token is unavailable.")
        await runtime.store.update_indexing_state(
            document, status, indexed_chunks, access_token, error
        )
    else:
        runtime.store.update_indexing_state(document, status, indexed_chunks, error)


async def _index_document(
    runtime: Runtime, document: DocumentRecord, access_token: str | None
) -> None:
    if document.content is None or document.id in runtime.indexing_document_ids:
        return
    runtime.indexing_document_ids.add(document.id)
    started = time.perf_counter()
    runtime.search.invalidate_owner(document.owner_id)
    try:
        await _set_indexing_state(runtime, document, "processing", 0, access_token)
        source_blocks = document.content.blocks or [
            ExtractedBlock(kind="text", text=document.content.markdown, page_numbers=[])
        ]
        chunks = await asyncio.to_thread(
            chunk_blocks,
            source_blocks,
            runtime.embeddings.count_tokens,
            runtime.embeddings.max_tokens,
        )
        if isinstance(runtime.store, SupabaseStore):
            if not access_token:
                raise SupabaseStoreError("Verified Supabase access token is unavailable.")
            indexed_chunks = await runtime.store.get_indexed_chunks(document, access_token)
        else:
            indexed_chunks = runtime.store.get_indexed_chunks(document.id)

        def is_current(chunk_index: int, chunk: Any) -> bool:
            existing = indexed_chunks.get(chunk_index)
            return bool(
                existing
                and existing.get("content") == chunk.content
                and existing.get("page_numbers") == chunk.page_numbers
                and existing.get("location_metadata") == chunk.location_metadata
                and existing.get("embedding_model") == runtime.embeddings.model_name
            )

        indexed_count = sum(is_current(chunk.chunk_index, chunk) for chunk in chunks)
        await _set_indexing_state(
            runtime, document, "processing", indexed_count, access_token
        )

        for batch_start in range(0, len(chunks), runtime.embeddings.batch_size):
            batch = chunks[batch_start : batch_start + runtime.embeddings.batch_size]
            pending_batch = [
                chunk for chunk in batch if not is_current(chunk.chunk_index, chunk)
            ]
            if not pending_batch:
                continue
            vectors = await asyncio.to_thread(
                runtime.embeddings.embed_documents,
                [chunk.content for chunk in pending_batch],
            )
            rows = [
                {
                    "chunk_index": chunk.chunk_index,
                    "content": chunk.content,
                    "page_numbers": chunk.page_numbers,
                    "location_metadata": chunk.location_metadata,
                    "embedding_model": runtime.embeddings.model_name,
                    "embedding": vector,
                }
                for chunk, vector in zip(pending_batch, vectors, strict=True)
            ]
            if isinstance(runtime.store, SupabaseStore):
                if not access_token:
                    raise SupabaseStoreError("Verified Supabase access token is unavailable.")
                await runtime.store.upsert_chunks(document, rows, access_token)
            else:
                runtime.store.upsert_chunks(document, rows)
            for row in rows:
                indexed_chunks[row["chunk_index"]] = row
            indexed_count += len(pending_batch)
            await _set_indexing_state(
                runtime,
                document,
                "processing",
                indexed_count,
                access_token,
            )

        if isinstance(runtime.store, SupabaseStore):
            if not access_token:
                raise SupabaseStoreError("Verified Supabase access token is unavailable.")
            await runtime.store.finish_chunk_index(document, len(chunks), access_token)
        else:
            runtime.store.finish_chunk_index(document, len(chunks))
        await _set_indexing_state(
            runtime, document, "completed", len(chunks), access_token
        )
        runtime.search.invalidate_owner(document.owner_id)
        logger.info(
            "document_indexing complete document=%s chunks=%d elapsed_seconds=%.3f",
            document.id,
            len(chunks),
            time.perf_counter() - started,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Search indexing failed for document %s", document.id)
        try:
            await _set_indexing_state(
                runtime,
                document,
                "failed",
                document.indexed_chunks,
                access_token,
                "Search indexing failed. Retry indexing to continue.",
            )
        except Exception:
            logger.exception("Could not persist indexing failure for %s", document.id)
    finally:
        runtime.indexing_document_ids.discard(document.id)


async def require_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> AuthenticatedUser:
    runtime: Runtime = request.app.state.runtime
    if not runtime.settings.supabase_url or not runtime.settings.supabase_publishable_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase Auth is not configured on the server.",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="A Supabase access token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="A Supabase access token is required.")
    try:
        return await runtime.auth_verifier.verify_access_token(access_token)
    except InvalidAccessToken as exc:
        raise HTTPException(
            status_code=401,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except SupabaseAuthUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


async def _monitor_job(runtime: Runtime, job: JobRecord) -> None:
    deadline = time.monotonic() + runtime.settings.job_timeout_seconds
    _set_job_status(job, "processing")
    await _persist_job_status(runtime, job, getattr(job, "access_token", None))

    while time.monotonic() < deadline:
        try:
            task = await runtime.docling.get_status(job.docling_task_id)
            upstream_status = str(task.get("task_status", "")).lower()
            if upstream_status in {"pending", "queued"}:
                _set_job_status(job, "queued")
                await _persist_job_status(runtime, job, getattr(job, "access_token", None))
            elif upstream_status in {"started", "processing"}:
                _set_job_status(job, "processing")
                await _persist_job_status(runtime, job, getattr(job, "access_token", None))
            elif upstream_status == "failure":
                _set_job_status(
                    job, "failed", "Docling Serve could not convert this PDF."
                )
                await _persist_job_status(runtime, job, getattr(job, "access_token", None))
                return
            elif upstream_status == "success":
                result = await runtime.docling.get_result(job.docling_task_id)
                conversion_status = result.get("status", "success")
                if conversion_status not in {"success", "partial_success"}:
                    _set_job_status(
                        job, "failed", "Docling Serve returned a failed conversion."
                    )
                    return
                content, page_count = parse_conversion_result(result)
                document = runtime.store.documents[job.document_id]
                document.content = content
                document.page_count = page_count
                if isinstance(runtime.store, SupabaseStore):
                    await runtime.store.save_extraction(
                        document, job, getattr(job, "access_token", None) or ""
                    )
                _set_job_status(job, "completed")
                await _persist_job_status(runtime, job, getattr(job, "access_token", None))
                await _index_document(
                    runtime, document, getattr(job, "access_token", None)
                )
                return
            else:
                _set_job_status(
                    job, "failed", "Docling Serve returned an unknown job status."
                )
                await _persist_job_status(runtime, job, getattr(job, "access_token", None))
                return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Document conversion failed for job %s", job.id)
            message = (
                str(exc) if isinstance(exc, DoclingServeError) else "Document conversion failed."
            )
            _set_job_status(job, "failed", message)
            try:
                await _persist_job_status(runtime, job, getattr(job, "access_token", None))
            except SupabaseStoreError:
                logger.exception("Could not persist failed job status for %s", job.id)
            return

        await asyncio.sleep(runtime.settings.poll_interval_seconds)

    _set_job_status(job, "failed", "Document processing timed out.")
    await _persist_job_status(runtime, job, getattr(job, "access_token", None))


def create_app(
    settings: Settings | None = None,
    docling_client: Any | None = None,
    auth_verifier: Any | None = None,
    embedding_service: EmbeddingService | None = None,
) -> FastAPI:
    runtime = Runtime(
        settings or Settings.from_env(), docling_client, auth_verifier, embedding_service
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        model_started = time.perf_counter()
        await asyncio.to_thread(runtime.embeddings.warmup)
        logger.info(
            "embedding_startup complete model=%s startup_seconds=%.3f",
            runtime.embeddings.model_name,
            time.perf_counter() - model_started,
        )
        yield
        for task in runtime.tasks:
            task.cancel()
        if runtime.tasks:
            await asyncio.gather(*runtime.tasks, return_exceptions=True)
        if not isinstance(runtime.store, SupabaseStore):
            for pdf_path in runtime.store.pdf_paths.values():
                try:
                    pdf_path.unlink(missing_ok=True)
                except OSError:
                    logger.exception("Could not remove staged PDF %s", pdf_path)

    app = FastAPI(title="Knowledge Workspace API", version="0.1.0", lifespan=lifespan)
    app.state.runtime = runtime

    @app.middleware("http")
    async def reject_oversized_request(request: Request, call_next):
        if request.method == "POST" and request.url.path == "/api/documents":
            content_length = request.headers.get("content-length")
            if content_length and content_length.isdigit():
                max_request_bytes = (
                    runtime.settings.max_upload_bytes + MAX_MULTIPART_OVERHEAD
                )
                if int(content_length) > max_request_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "PDF exceeds the configured upload limit."},
                    )
        return await call_next(request)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/documents", response_model=DocumentDetail, status_code=202)
    async def upload_document(
        file: UploadFile = File(...),
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> DocumentDetail:
        filename = PurePosixPath((file.filename or "").replace("\\", "/")).name
        filename = "".join(
            character for character in filename if character.isprintable()
        ).strip()
        if not filename.lower().endswith(".pdf"):
            await file.close()
            raise HTTPException(status_code=415, detail="Choose a PDF file (.pdf).")

        content_type = (file.content_type or "").split(";", maxsplit=1)[0].lower()
        if content_type not in {
            "",
            "application/pdf",
            "application/octet-stream",
        }:
            await file.close()
            raise HTTPException(
                status_code=415, detail="The uploaded file must be a PDF."
            )

        temp_path: Path | None = None
        total_bytes = 0
        try:
            if runtime.settings.temp_dir:
                runtime.settings.temp_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="wb",
                suffix=".pdf",
                dir=runtime.settings.temp_dir,
                delete=False,
            ) as temporary_file:
                temp_path = Path(temporary_file.name)
                first_chunk = await file.read(CHUNK_SIZE)
                if not first_chunk.startswith(PDF_SIGNATURE):
                    raise HTTPException(
                        status_code=415,
                        detail="The file does not contain a valid PDF signature.",
                    )
                total_bytes += len(first_chunk)
                if total_bytes > runtime.settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail="PDF exceeds the configured upload limit.",
                    )
                temporary_file.write(first_chunk)

                while chunk := await file.read(CHUNK_SIZE):
                    total_bytes += len(chunk)
                    if total_bytes > runtime.settings.max_upload_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail="PDF exceeds the configured upload limit.",
                        )
                    temporary_file.write(chunk)

            try:
                task = await runtime.docling.submit_file(temp_path, filename)
            except DoclingServeError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc

            docling_task_id = task.get("task_id")
            if not isinstance(docling_task_id, str) or not docling_task_id:
                raise HTTPException(
                    status_code=502,
                    detail="Docling Serve did not return a conversion job ID.",
                )

            created_at = _now()
            document_id = str(uuid4())
            job_id = str(uuid4())
            document = DocumentRecord(
                id=document_id,
                job_id=job_id,
                owner_id=user.id,
                filename=filename,
                title=Path(filename).stem,
                content_type="application/pdf",
                size_bytes=total_bytes,
                created_at=created_at,
            )
            job = JobRecord(
                id=job_id,
                document_id=document_id,
                owner_id=user.id,
                docling_task_id=docling_task_id,
                status="queued",
                created_at=created_at,
                updated_at=created_at,
                access_token=user.access_token,
            )
            if isinstance(runtime.store, SupabaseStore):
                if not user.access_token:
                    raise HTTPException(
                        status_code=503,
                        detail="Supabase persistence requires a verified access token.",
                    )
                try:
                    await runtime.store.create_records(
                        document, job, temp_path, user.access_token
                    )
                except SupabaseStoreError as exc:
                    raise HTTPException(status_code=502, detail=str(exc)) from exc
            runtime.store.documents[document_id] = document
            runtime.store.jobs[job_id] = job
            if not isinstance(runtime.store, SupabaseStore):
                runtime.store.pdf_paths[document_id] = temp_path
                temp_path = None
            runtime.search.invalidate_owner(user.id)

            background_task = asyncio.create_task(_monitor_job(runtime, job))
            runtime.tasks.add(background_task)
            runtime.job_tasks[job.id] = background_task
            background_task.add_done_callback(runtime.tasks.discard)
            return _document_detail(document, job)
        finally:
            await file.close()
            if temp_path:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    @app.post("/api/jobs/{job_id}/cancel", response_model=JobSummary)
    async def cancel_job(
        job_id: str,
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> JobSummary:
        if isinstance(runtime.store, SupabaseStore):
            if not user.access_token:
                raise HTTPException(status_code=503, detail="Supabase access token unavailable.")
            try:
                job = await runtime.store.get_job(user.access_token, user.id, job_id)
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
        else:
            job = runtime.store.jobs.get(job_id)
            if job and job.owner_id != user.id:
                job = None
        if not job:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        if job.status in {"queued", "processing"}:
            _set_job_status(job, "cancelled", "Cancelled by user.")
            try:
                await _persist_job_status(runtime, job, user.access_token)
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            task = runtime.job_tasks.get(job.id)
            if task:
                task.cancel()
        return _job_summary(job)

    @app.delete("/api/documents/{document_id}")
    async def delete_document(
        document_id: str,
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> dict[str, bool]:
        task_to_cancel: asyncio.Task[None] | None = None
        if isinstance(runtime.store, SupabaseStore):
            if not user.access_token:
                raise HTTPException(status_code=503, detail="Supabase access token unavailable.")
            try:
                record = await runtime.store.get_record(user.access_token, user.id, document_id)
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            if not record:
                raise HTTPException(status_code=404, detail="Document not found.")
            document, job = record
            task_to_cancel = runtime.job_tasks.get(job.id)
            try:
                await runtime.store.delete_records(document, user.access_token)
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
        else:
            document = runtime.store.documents.get(document_id)
            if not document or document.owner_id != user.id:
                raise HTTPException(status_code=404, detail="Document not found.")
            task_to_cancel = runtime.job_tasks.get(document.job_id)
            runtime.store.documents.pop(document_id, None)
            runtime.store.jobs.pop(document.job_id, None)
            pdf_path = runtime.store.pdf_paths.pop(document_id, None)
            if pdf_path:
                try:
                    pdf_path.unlink(missing_ok=True)
                except OSError:
                    logger.exception("Could not remove PDF for document %s", document_id)
        if task_to_cancel:
            task_to_cancel.cancel()
        runtime.search.invalidate_owner(user.id)
        return {"deleted": True}

    @app.get("/api/documents", response_model=list[DocumentSummary])
    async def list_documents(
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> list[DocumentSummary]:
        if isinstance(runtime.store, SupabaseStore):
            if not user.access_token:
                raise HTTPException(status_code=503, detail="Supabase access token unavailable.")
            try:
                documents, jobs = await runtime.store.list_records(user.access_token, user.id)
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            jobs_by_document = {job.document_id: job for job in jobs}
            return [
                _document_summary(document, jobs_by_document[document.id])
                for document in documents
                if document.id in jobs_by_document
            ]
        documents = sorted(
            (
                document
                for document in runtime.store.documents.values()
                if document.owner_id == user.id
            ),
            key=lambda document: document.created_at,
            reverse=True,
        )
        return [
            _document_summary(document, runtime.store.jobs[document.job_id])
            for document in documents
        ]

    @app.get("/api/documents/{document_id}", response_model=DocumentDetail)
    async def get_document(
        document_id: str,
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> DocumentDetail:
        if isinstance(runtime.store, SupabaseStore):
            if not user.access_token:
                raise HTTPException(status_code=503, detail="Supabase access token unavailable.")
            try:
                record = await runtime.store.get_record(user.access_token, user.id, document_id)
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            if not record:
                raise HTTPException(status_code=404, detail="Document not found.")
            document, job = record
            return _document_detail(document, job)
        document = runtime.store.documents.get(document_id)
        if not document or document.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Document not found.")
        return _document_detail(document, runtime.store.jobs[document.job_id])

    @app.get("/api/documents/{document_id}/pdf")
    async def get_document_pdf(
        document_id: UUID,
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> Response:
        document_key = str(document_id)
        if isinstance(runtime.store, SupabaseStore):
            if not user.access_token:
                raise HTTPException(status_code=503, detail="Supabase access token unavailable.")
            try:
                pdf_bytes = await runtime.store.get_pdf(
                    user.id, document_key, user.access_token
                )
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=404, detail="PDF not found.") from exc
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Cache-Control": "private, no-store"},
            )

        document = runtime.store.documents.get(document_key)
        pdf_path = runtime.store.pdf_paths.get(document_key)
        if not document or document.owner_id != user.id or not pdf_path or not pdf_path.is_file():
            raise HTTPException(status_code=404, detail="PDF not found.")
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=document.filename,
            content_disposition_type="inline",
            headers={"Cache-Control": "private, no-store"},
        )

    @app.get("/api/jobs/{job_id}", response_model=JobSummary)
    async def get_job(
        job_id: str,
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> JobSummary:
        if isinstance(runtime.store, SupabaseStore):
            if not user.access_token:
                raise HTTPException(status_code=503, detail="Supabase access token unavailable.")
            try:
                job = await runtime.store.get_job(user.access_token, user.id, job_id)
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            if not job:
                raise HTTPException(status_code=404, detail="Conversion job not found.")
            return _job_summary(job)
        job = runtime.store.jobs.get(job_id)
        if not job or job.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Conversion job not found.")
        return _job_summary(job)

    @app.post("/api/search", response_model=list[SearchResult])
    async def search_documents(
        payload: SearchRequest,
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> list[SearchResult]:
        query = payload.query.strip()
        if not query:
            raise HTTPException(status_code=422, detail="Search query cannot be empty.")
        try:
            return await runtime.search.search(
                runtime.store,
                user.id,
                query,
                str(payload.document_id) if payload.document_id else None,
                payload.limit,
                user.access_token,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except SupabaseStoreError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Search service is unavailable for user %s", user.id)
            raise HTTPException(
                status_code=503, detail="Search is temporarily unavailable."
            ) from exc

    @app.post("/api/indexing/backfill")
    async def backfill_search_index(
        limit: int = 10,
        user: AuthenticatedUser = Depends(require_current_user),
    ) -> dict[str, int]:
        if not 1 <= limit <= 20:
            raise HTTPException(status_code=422, detail="Backfill limit must be 1-20.")
        if isinstance(runtime.store, SupabaseStore):
            if not user.access_token:
                raise HTTPException(status_code=503, detail="Supabase access token unavailable.")
            try:
                documents = await runtime.store.list_backfill_candidates(
                    user.access_token, user.id, limit
                )
                extractions = await runtime.store.get_extractions(
                    user.access_token,
                    user.id,
                    [document.id for document in documents],
                )
            except SupabaseStoreError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            candidates = [
                document
                for document in documents
                if document.id not in runtime.indexing_document_ids
                and document.id in extractions
            ][:limit]
            for document in candidates:
                document.content = extractions[document.id]
        else:
            candidates = [
                document
                for document in runtime.store.documents.values()
                if document.owner_id == user.id
                and document.indexing_status in {"pending", "failed", "processing"}
                and document.id not in runtime.indexing_document_ids
                and document.content is not None
            ][:limit]

        for document in candidates:
            task = asyncio.create_task(
                _index_document(runtime, document, user.access_token)
            )
            runtime.tasks.add(task)
            task.add_done_callback(runtime.tasks.discard)
        return {"scheduled": len(candidates)}

    return app


app = create_app()