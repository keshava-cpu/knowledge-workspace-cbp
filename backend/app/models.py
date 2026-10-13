from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

JobStatus = Literal["queued", "processing", "completed", "failed", "cancelled"]
IndexingStatus = Literal["pending", "processing", "completed", "failed"]


class ExtractedBlock(BaseModel):
    kind: str
    text: str
    page_numbers: list[int]
    location_metadata: list[dict[str, Any]] = Field(default_factory=list)


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
    indexing_status: IndexingStatus = "pending"
    indexed_chunks: int = 0
    indexing_error: str | None = None


class DocumentDetail(DocumentSummary):
    content: ExtractedContent | None = None


class JobSummary(BaseModel):
    id: str
    document_id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None


class SearchResult(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    filename: str
    excerpt: str
    page_numbers: list[int]
    location_metadata: list[dict[str, Any]]
    score: float
    semantic_similarity: float | None = None
    semantic_rank: int | None = None
    lexical_rank: int | None = None
    retrieval_methods: list[str]