import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.store import DocumentRecord, JobRecord, SupabaseStore


def test_supabase_store_uploads_with_user_token_and_publishable_key(tmp_path: Path) -> None:
    pdf_path = tmp_path / "paper.pdf"
    pdf_path.write_bytes(b"%PDF-1.7 test")
    requests: list[httpx.Request] = []

    def handle_request(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer user-token"
        assert request.headers["apikey"] == "publishable-key"
        if request.url.path.startswith("/storage/v1/object/"):
            assert request.method == "POST"
            assert request.read() == b"%PDF-1.7 test"
        elif request.url.path == "/rest/v1/documents":
            assert request.method == "POST"
        elif request.url.path == "/rest/v1/processing_jobs":
            assert request.method == "POST"
        else:
            raise AssertionError(f"Unexpected request: {request.method} {request.url}")
        return httpx.Response(201)

    created_at = datetime.now(timezone.utc)
    document = DocumentRecord(
        id="document-id",
        job_id="job-id",
        owner_id="user-id",
        filename="paper.pdf",
        title="paper",
        content_type="application/pdf",
        size_bytes=13,
        created_at=created_at,
    )
    job = JobRecord(
        id="job-id",
        document_id="document-id",
        owner_id="user-id",
        docling_task_id="docling-task",
        status="queued",
        created_at=created_at,
        updated_at=created_at,
    )
    store = SupabaseStore(
        "https://supabase.test",
        "publishable-key",
        transport=httpx.MockTransport(handle_request),
    )

    asyncio.run(store.create_records(document, job, pdf_path, "user-token"))

    assert [request.method for request in requests] == ["POST", "POST", "POST"]
    assert requests[0].url.path.endswith("/user-id/document-id.pdf")


def test_supabase_hybrid_search_uses_one_authenticated_bounded_rpc() -> None:
    requests: list[httpx.Request] = []

    def handle_request(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "POST"
        assert request.url.path == "/rest/v1/rpc/search_document_chunks"
        assert request.headers["authorization"] == "Bearer verified-user-token"
        assert request.headers["apikey"] == "publishable-key"
        payload = json.loads(request.content)
        assert payload["p_query_text"] == "retrieval context"
        assert payload["p_embedding_model"] == "sentence-transformers/all-MiniLM-L6-v2"
        assert payload["p_document_id"] == "document-id"
        assert payload["p_result_limit"] == 80
        assert len(payload["p_query_embedding"]) == 384
        return httpx.Response(
            200,
            json=[
                {
                    "chunk_id": "chunk-id",
                    "document_id": "document-id",
                    "title": "paper",
                    "filename": "paper.pdf",
                    "excerpt": "Source passage",
                    "page_numbers": [3],
                    "location_metadata": [{"page_no": 3}],
                    "score": 0.03,
                    "semantic_similarity": 0.72,
                    "semantic_rank": 1,
                    "lexical_rank": 2,
                    "retrieval_methods": ["semantic", "exact"],
                }
            ],
        )

    store = SupabaseStore(
        "https://supabase.test",
        "publishable-key",
        transport=httpx.MockTransport(handle_request),
    )
    results = asyncio.run(
        store.hybrid_search(
            "owner-id",
            "retrieval context",
            [0.1] * 384,
            "sentence-transformers/all-MiniLM-L6-v2",
            "document-id",
            7,
            80,
            "verified-user-token",
        )
    )

    assert len(requests) == 1
    assert results[0].page_numbers == [3]
    assert results[0].location_metadata == [{"page_no": 3}]
    assert results[0].semantic_similarity == 0.72
    assert results[0].retrieval_methods == ["semantic", "exact"]