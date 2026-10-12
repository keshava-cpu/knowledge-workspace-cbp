import asyncio
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient

from app.auth import (
    AuthenticatedUser,
    InvalidAccessToken,
    SupabaseAuthUnavailable,
    SupabaseAuthVerifier,
)
from app.config import Settings
from app.embeddings import EmbeddingService
from app.docling_client import (
    DoclingServeClient,
    DoclingServeError,
    parse_conversion_result,
)
from app.main import _index_document, create_app


class FakeDoclingClient:
    def __init__(self, statuses: list[str] | None = None) -> None:
        self.statuses = statuses or ["success"]
        self.poll_count = 0
        self.fail_submit = False
        self.result = {
            "status": "success",
            "document": {
                "md_content": "# Extracted title\n\nActual extracted text.",
                "json_content": {
                    "body": {
                        "children": [
                            {"$ref": "#/texts/0"},
                            {"$ref": "#/texts/1"},
                        ]
                    },
                    "texts": [
                        {
                            "self_ref": "#/texts/0",
                            "label": "section_header",
                            "text": "Extracted title",
                            "prov": [{"page_no": 1}],
                        },
                        {
                            "self_ref": "#/texts/1",
                            "label": "text",
                            "text": "Actual extracted text.",
                            "prov": [{"page_no": 2}],
                        },
                    ],
                    "pages": {"1": {}, "2": {}},
                },
            },
        }

    async def submit_file(self, path: Path, filename: str) -> dict[str, Any]:
        assert path.exists()
        assert filename.lower().endswith(".pdf")
        if self.fail_submit:
            raise DoclingServeError("Docling Serve is unavailable.")
        return {"task_id": "remote-task-1", "task_status": "pending"}

    async def get_status(self, task_id: str) -> dict[str, str]:
        assert task_id == "remote-task-1"
        status = self.statuses[min(self.poll_count, len(self.statuses) - 1)]
        self.poll_count += 1
        return {"task_status": status}

    async def get_result(self, task_id: str) -> dict[str, Any]:
        assert task_id == "remote-task-1"
        return self.result


class FakeEmbeddingModel:
    embedding_size = 384

    def __init__(self) -> None:
        self.embed_calls = 0

    def token_count(self, text: str) -> int:
        return len(text.split())

    def embed(self, texts: list[str], batch_size: int = 32):
        self.embed_calls += 1
        vectors = []
        for text in texts:
            vector = [0.0] * self.embedding_size
            for word in text.casefold().split():
                vector[sum(ord(character) for character in word) % self.embedding_size] += 1.0
            vectors.append(vector)
        return vectors


class FakeAuthVerifier:
    async def verify_access_token(self, access_token: str) -> AuthenticatedUser:
        users = {
            "alice-token": AuthenticatedUser(id="user-alice", email="alice@example.test"),
            "bob-token": AuthenticatedUser(id="user-bob", email="bob@example.test"),
        }
        if access_token == "auth-service-down":
            raise SupabaseAuthUnavailable("Could not reach Supabase Auth.")
        if access_token not in users:
            raise InvalidAccessToken("Your session is invalid or has expired.")
        return users[access_token]


def build_test_app(
    client: FakeDoclingClient,
    max_upload_bytes: int = 1024,
) -> TestClient:
    settings = Settings(
        docling_serve_url="http://docling.invalid",
        docling_api_key=None,
        max_upload_bytes=max_upload_bytes,
        poll_interval_seconds=0.001,
        job_timeout_seconds=1,
        supabase_url="https://supabase.test",
        supabase_publishable_key="test-publishable-key",
    )
    embedding_service = EmbeddingService(
        "sentence-transformers/all-MiniLM-L6-v2",
        max_tokens=256,
        batch_size=8,
        model_factory=lambda _: FakeEmbeddingModel(),
    )
    test_client = TestClient(
        create_app(settings, client, FakeAuthVerifier(), embedding_service)
    )
    test_client.headers["Authorization"] = "Bearer alice-token"
    return test_client


def test_rejects_non_pdf_filename() -> None:
    fake = FakeDoclingClient()
    with build_test_app(fake) as test_client:
        response = test_client.post(
            "/api/documents",
            files={"file": ("notes.txt", b"%PDF-1.7 content", "application/pdf")},
        )
    assert response.status_code == 415
    assert "PDF" in response.json()["detail"]
    assert fake.poll_count == 0


def test_rejects_file_without_pdf_signature() -> None:
    with build_test_app(FakeDoclingClient()) as test_client:
        response = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"not a PDF", "application/pdf")},
        )
    assert response.status_code == 415
    assert "signature" in response.json()["detail"]


def test_rejects_upload_over_configured_size() -> None:
    with build_test_app(FakeDoclingClient(), max_upload_bytes=8) as test_client:
        response = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
    assert response.status_code == 413


def test_reports_docling_unavailable() -> None:
    fake = FakeDoclingClient()
    fake.fail_submit = True
    with build_test_app(fake) as test_client:
        response = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
    assert response.status_code == 502
    assert response.json()["detail"] == "Docling Serve is unavailable."


def test_status_progresses_and_extracted_content_is_exposed() -> None:
    fake = FakeDoclingClient(["pending", "started", "success"])
    with build_test_app(fake) as test_client:
        submitted = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
        assert submitted.status_code == 202
        initial = submitted.json()
        assert initial["status"] == "queued"

        for _ in range(100):
            job = test_client.get(f"/api/jobs/{initial['job_id']}").json()
            if job["status"] == "completed":
                break
            if job["status"] == "failed":
                raise AssertionError(job["error_message"])
            time.sleep(0.01)

        assert job["status"] == "completed"
        detail = test_client.get(f"/api/documents/{initial['id']}").json()
        assert detail["content"]["markdown"].startswith("# Extracted title")
        assert detail["content"]["blocks"][0] == {
            "kind": "heading",
            "text": "Extracted title",
            "page_numbers": [1],
            "location_metadata": [{"page_no": 1}],
        }
        assert detail["content"]["blocks"][1]["page_numbers"] == [2]
        assert detail["page_count"] == 2


def test_search_indexes_extraction_and_keeps_results_user_scoped() -> None:
    with build_test_app(FakeDoclingClient()) as test_client:
        submitted = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
        document_id = submitted.json()["id"]

        for _ in range(100):
            detail = test_client.get(f"/api/documents/{document_id}").json()
            if detail["indexing_status"] in {"completed", "failed"}:
                break
            time.sleep(0.01)

        assert detail["indexing_status"] == "completed"
        response = test_client.post(
            "/api/search",
            json={"query": "actual extracted text", "document_id": document_id},
        )
        bob_response = test_client.post(
            "/api/search",
            headers={"Authorization": "Bearer bob-token"},
            json={"query": "actual extracted text"},
        )
        runtime = test_client.app.state.runtime
        model = runtime.embeddings._model
        embed_calls_before_retry = model.embed_calls
        asyncio.run(
            _index_document(
                runtime,
                runtime.store.documents[document_id],
                "alice-token",
            )
        )
        assert model.embed_calls == embed_calls_before_retry

    assert response.status_code == 200
    assert response.json()[0]["document_id"] == document_id
    assert response.json()[0]["page_numbers"] == [2]
    assert response.json()[0]["location_metadata"] == [{"page_no": 2}]
    assert "lexical" in response.json()[0]["retrieval_methods"]
    assert bob_response.status_code == 200
    assert bob_response.json() == []


def test_handles_docling_failure_status() -> None:
    fake = FakeDoclingClient(["failure"])
    with build_test_app(fake) as test_client:
        submitted = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
        job_id = submitted.json()["job_id"]
        for _ in range(100):
            job = test_client.get(f"/api/jobs/{job_id}").json()
            if job["status"] == "failed":
                break
            time.sleep(0.01)
    assert job["status"] == "failed"
    assert "could not convert" in job["error_message"]


def test_result_parser_accepts_structured_json_as_text() -> None:
    content, page_count = parse_conversion_result(
        {
            "document": {
                "md_content": "Text only",
                "json_content": '{"pages": {"1": {}}}',
            }
        }
    )
    assert content.markdown == "Text only"
    assert content.structured_json == {"pages": {"1": {}}}
    assert page_count == 1


def test_protected_endpoints_require_a_valid_supabase_token() -> None:
    with build_test_app(FakeDoclingClient()) as test_client:
        missing = test_client.get("/api/documents", headers={"Authorization": ""})
        invalid = test_client.get(
            "/api/documents", headers={"Authorization": "Bearer invalid-token"}
        )
        unavailable = test_client.get(
            "/api/documents", headers={"Authorization": "Bearer auth-service-down"}
        )

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert unavailable.status_code == 503


def test_document_and_job_access_is_scoped_to_verified_owner() -> None:
    with build_test_app(FakeDoclingClient()) as test_client:
        submitted = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
        assert submitted.status_code == 202
        document = submitted.json()
        bob_headers = {"Authorization": "Bearer bob-token"}

        bob_documents = test_client.get("/api/documents", headers=bob_headers)
        bob_document = test_client.get(
            f"/api/documents/{document['id']}", headers=bob_headers
        )
        bob_job = test_client.get(f"/api/jobs/{document['job_id']}", headers=bob_headers)

    assert bob_documents.json() == []
    assert bob_document.status_code == 404
    assert bob_job.status_code == 404


def test_auth_configuration_missing_fails_closed() -> None:
    settings = Settings(
        docling_serve_url="http://docling.invalid",
        docling_api_key=None,
        max_upload_bytes=1024,
        poll_interval_seconds=0.001,
        job_timeout_seconds=1,
    )
    embedding_service = EmbeddingService(
        "sentence-transformers/all-MiniLM-L6-v2",
        max_tokens=256,
        batch_size=8,
        model_factory=lambda _: FakeEmbeddingModel(),
    )
    with TestClient(
        create_app(settings, FakeDoclingClient(), FakeAuthVerifier(), embedding_service)
    ) as test_client:
        response = test_client.get(
            "/api/documents", headers={"Authorization": "Bearer alice-token"}
        )
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_supabase_verifier_uses_auth_user_endpoint_and_returns_verified_id() -> None:
    def handle_request(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url == "https://supabase.test/auth/v1/user"
        assert request.headers["authorization"] == "Bearer signed-access-token"
        assert request.headers["apikey"] == "test-publishable-key"
        return httpx.Response(
            200,
            json={"id": "verified-user-id", "email": "verified@example.test"},
        )

    settings = Settings(
        docling_serve_url="http://docling.invalid",
        docling_api_key=None,
        max_upload_bytes=1024,
        poll_interval_seconds=0.01,
        job_timeout_seconds=5,
        supabase_url="https://supabase.test",
        supabase_publishable_key="test-publishable-key",
    )
    verifier = SupabaseAuthVerifier(settings, transport=httpx.MockTransport(handle_request))
    user = asyncio.run(verifier.verify_access_token("signed-access-token"))

    assert user.id == "verified-user-id"
    assert user.email == "verified@example.test"


def test_docling_upload_encodes_pdf_and_repeated_output_formats(tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.7 test")

    def handle_request(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/convert/file/async"
        body = request.read()
        assert b'name="files"; filename="sample.pdf"' in body
        assert b'name="to_formats"\r\n\r\nmd' in body
        assert b'name="to_formats"\r\n\r\njson' in body
        assert b"%PDF-1.7 test" in body
        return httpx.Response(
            200,
            json={"task_id": "task-1", "task_status": "pending"},
        )

    client = DoclingServeClient(
        Settings(
            docling_serve_url="http://docling.test",
            docling_api_key=None,
            max_upload_bytes=1024,
            poll_interval_seconds=0.01,
            job_timeout_seconds=5,
        ),
        sync_transport=httpx.MockTransport(handle_request),
    )

    response = client._submit_file_sync(pdf_path, "sample.pdf")

    assert response["task_id"] == "task-1"


def test_can_cancel_a_processing_job() -> None:
    with build_test_app(FakeDoclingClient(["pending"]), max_upload_bytes=1024) as test_client:
        submitted = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
        job_id = submitted.json()["job_id"]
        response = test_client.post(f"/api/jobs/{job_id}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_can_delete_a_document_and_its_job() -> None:
    with build_test_app(FakeDoclingClient()) as test_client:
        submitted = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", b"%PDF-1.7 content", "application/pdf")},
        )
        document_id = submitted.json()["id"]
        deleted = test_client.delete(f"/api/documents/{document_id}")
        missing = test_client.get(f"/api/documents/{document_id}")

    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert missing.status_code == 404


def test_serves_original_pdf_bytes_only_to_document_owner() -> None:
    original_pdf = b"%PDF-1.7\nunchanged source bytes\n"
    with build_test_app(FakeDoclingClient()) as test_client:
        submitted = test_client.post(
            "/api/documents",
            files={"file": ("paper.pdf", original_pdf, "application/pdf")},
        )
        document_id = submitted.json()["id"]
        owner_response = test_client.get(f"/api/documents/{document_id}/pdf")
        other_user_response = test_client.get(
            f"/api/documents/{document_id}/pdf",
            headers={"Authorization": "Bearer bob-token"},
        )

    assert owner_response.status_code == 200
    assert owner_response.content == original_pdf
    assert owner_response.headers["content-type"] == "application/pdf"
    assert other_user_response.status_code == 404