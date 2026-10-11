from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

JobStatus = Literal["queued", "processing", "completed", "failed", "cancelled"]


class ExtractedBlock(BaseModel):
    kind: str
    text: str
    page_numbers: list[int]


class ExtractedContent(BaseModel):
    markdown: str
    structured_json: Any | None = None
    blocks: list[ExtractedBlock]


class DocumentSummary(BaseModel):
    id: str
    job_id: str
    filename: str
    title: str
    content_type: str
    size_bytes: int
    created_at: datetime
    status: JobStatus
    error_message: str | None = None
    page_count: int | None = None
    processing_seconds: float | None = None


class DocumentDetail(DocumentSummary):
    content: ExtractedContent | None = None


class JobSummary(BaseModel):
    id: str
    document_id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None