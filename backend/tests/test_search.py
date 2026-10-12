import asyncio
from datetime import datetime, timezone

from app.models import SearchResult
from app.search import SearchService
from app.store import DocumentRecord, InMemoryStore


class StubEmbeddings:
    model_name = "sentence-transformers/all-MiniLM-L6-v2"

    def embed_query(self, query: str) -> list[float]:
        assert query
        return [1.0] + [0.0] * 383


class CandidateStore(InMemoryStore):
    def __init__(self, candidates: list[SearchResult]) -> None:
        super().__init__()
        self.candidates = candidates
        self.search_args: tuple[int, int] | None = None

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
        del owner_id, query, embedding, embedding_model, document_id
        self.search_args = (limit, candidate_limit)
        return self.candidates[:candidate_limit]


def make_result(
    chunk_id: str,
    excerpt: str,
    *,
    document_id: str = "document-a",
    page: int = 1,
    score: float = 0.02,
    retrieval_methods: list[str] | None = None,
) -> SearchResult:
    return SearchResult(
        chunk_id=chunk_id,
        document_id=document_id,
        title=document_id,
        filename=f"{document_id}.pdf",
        excerpt=excerpt,
        page_numbers=[page],
        location_metadata=[{"page_no": page, "chunk": chunk_id}],
        score=score,
        semantic_rank=1,
        lexical_rank=None,
        retrieval_methods=retrieval_methods or ["semantic"],
    )


def run_search(
    store: InMemoryStore, *, limit: int, candidate_limit: int = 8
) -> list[SearchResult]:
    return asyncio.run(
        SearchService(StubEmbeddings(), cache_size=0, candidate_limit=candidate_limit).search(
            store, "owner-a", "cache coherence", None, limit, None
        )
    )


def test_deduplicates_full_passages_then_refills_without_prefix_collisions() -> None:
    shared_prefix = (
        "Cache-coherence protocols use invalidation messages to keep processor caches "
        "consistent during shared writes. The protocol coordinates copies across cores. "
    )
    modified = shared_prefix + "A Modified line is dirty and must be written back to memory."
    exclusive = shared_prefix + "An Exclusive line is clean and has no other cached copies."
    assert modified[:120] == exclusive[:120]

    store = CandidateStore(
        [
            make_result(
                "same-original",
                "An identical passage shared across two chunks.",
                page=4,
                retrieval_methods=["semantic"],
            ),
            make_result(
                "same-copy",
                "An identical passage shared across two chunks.",
                page=9,
                retrieval_methods=["fulltext"],
            ),
            make_result("modified", modified, page=5),
            make_result("exclusive", exclusive, page=6),
            make_result("next-unique", "A separate unique cache passage.", page=7),
        ]
    )

    results = run_search(store, limit=4, candidate_limit=5)

    assert [result.chunk_id for result in results] == [
        "same-original",
        "modified",
        "exclusive",
        "next-unique",
    ]
    assert store.search_args == (4, 10)
    assert results[1].page_numbers == [5]
    assert results[1].location_metadata == [{"page_no": 5, "chunk": "modified"}]
    assert results[2].page_numbers == [6]


def test_returns_fewer_than_requested_only_when_unique_pool_is_exhausted() -> None:
    store = CandidateStore(
        [
            make_result("one", "First distinct passage."),
            make_result("one-copy", "First distinct passage.", page=2),
            make_result("two", "Second distinct passage.", page=3),
        ]
    )

    results = run_search(store, limit=5, candidate_limit=10)

    assert [result.chunk_id for result in results] == ["one", "two"]


def test_in_memory_retrieval_keeps_owner_scope_and_source_metadata() -> None:
    store = InMemoryStore()
    created_at = datetime.now(timezone.utc)
    documents = [
        DocumentRecord(
            id="owner-a-doc",
            job_id="job-a",
            owner_id="owner-a",
            filename="owner-a.pdf",
            title="Owner A",
            content_type="application/pdf",
            size_bytes=100,
            created_at=created_at,
            indexing_status="completed",
            indexed_chunks=1,
        ),
        DocumentRecord(
            id="owner-b-doc",
            job_id="job-b",
            owner_id="owner-b",
            filename="owner-b.pdf",
            title="Owner B",
            content_type="application/pdf",
            size_bytes=100,
            created_at=created_at,
            indexing_status="completed",
            indexed_chunks=1,
        ),
    ]
    for document, chunk_id, page in zip(documents, ("chunk-a", "chunk-b"), (8, 99), strict=True):
        store.documents[document.id] = document
        store.indexed_chunks[document.id] = [
            {
                "id": chunk_id,
                "chunk_index": 0,
                "content": "Cache coherence uses invalidation messages to keep cache copies consistent.",
                "page_numbers": [page],
                "location_metadata": [{"page_no": page, "source": "docling"}],
                "embedding_model": StubEmbeddings.model_name,
                "embedding": [1.0] + [0.0] * 383,
            }
        ]

    results = run_search(store, limit=5, candidate_limit=10)

    assert len(results) == 1
    assert results[0].document_id == "owner-a-doc"
    assert results[0].chunk_id == "chunk-a"
    assert results[0].page_numbers == [8]
    assert results[0].location_metadata == [{"page_no": 8, "source": "docling"}]