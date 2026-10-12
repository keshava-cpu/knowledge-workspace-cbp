"""Measure the current hybrid-search baseline on synthetic public-safe data.

Run from the repository root with:
    python backend/tests/retrieval_evaluation.py

The script uses the existing FastEmbed model and in-memory hybrid-search path.
It prints aggregate metrics and synthetic passage IDs, never passage text.
"""

import asyncio
import json
import math
import statistics
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.embeddings import EmbeddingService, chunk_blocks, normalize_embedding_text
from app.models import ExtractedBlock, ExtractedContent
from app.search import SearchService
from app.store import DocumentRecord, InMemoryStore

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "search_evaluation.json"
RESULT_LIMIT = 10
CANDIDATE_LIMIT = 40


def load_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def passage_index(
    fixture: dict[str, Any],
) -> dict[str, tuple[dict[str, Any], dict[str, Any]]]:
    return {
        passage["id"]: (document, passage)
        for document in fixture["documents"]
        for passage in document["passages"]
    }


def relevant_ids(
    query_case: dict[str, Any],
    passages: dict[str, tuple[dict[str, Any], dict[str, Any]]],
) -> set[str]:
    expected_ids = {item["passage_id"] for item in query_case["expected"]}
    duplicates = {
        passage_id
        for passage_id, (_, passage) in passages.items()
        if passage.get("duplicate_of") in expected_ids
    }
    return expected_ids | duplicates


def build_store(
    fixture: dict[str, Any], embeddings: EmbeddingService
) -> tuple[InMemoryStore, dict[str, tuple[dict[str, Any], dict[str, Any]]]]:
    store = InMemoryStore()
    indexed_at = datetime.now(timezone.utc)

    for document_data in fixture["documents"]:
        passages = document_data["passages"]
        blocks = [
            ExtractedBlock(
                kind="text",
                text=passage["text"],
                page_numbers=passage["page_numbers"],
                location_metadata=[{"page_no": page} for page in passage["page_numbers"]],
            )
            for passage in passages
        ]
        chunks = chunk_blocks(blocks, embeddings.count_tokens, embeddings.max_tokens)
        if len(chunks) != len(passages):
            raise ValueError(f"Fixture passage unexpectedly split: {document_data['id']}")
        vectors = embeddings.embed_documents([chunk.content for chunk in chunks])
        if any(len(vector) != fixture["embedding_dimensions"] for vector in vectors):
            raise ValueError("Embedding dimensions do not match the evaluation fixture.")

        document = DocumentRecord(
            id=document_data["id"],
            job_id=f"job-{document_data['id']}",
            owner_id="synthetic-evaluation-owner",
            filename=document_data["filename"],
            title=document_data["title"],
            content_type="application/pdf",
            size_bytes=0,
            created_at=indexed_at,
            content=ExtractedContent(
                markdown="\n\n".join(passage["text"] for passage in passages),
                blocks=blocks,
            ),
            page_count=max(page for passage in passages for page in passage["page_numbers"]),
            indexing_status="completed",
            indexed_chunks=len(chunks),
        )
        store.documents[document.id] = document
        store.indexed_chunks[document.id] = [
            {
                "id": passage["id"],
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "page_numbers": chunk.page_numbers,
                "location_metadata": chunk.location_metadata,
                "embedding_model": embeddings.model_name,
                "embedding": vector,
            }
            for passage, chunk, vector in zip(passages, chunks, vectors, strict=True)
        ]

    return store, passage_index(fixture)


def duplicate_prefix_count(results: list[Any]) -> int:
    fingerprints = Counter(
        normalize_embedding_text(result.excerpt)[:120].casefold() for result in results
    )
    return sum(count - 1 for count in fingerprints.values() if count > 1)


def exact_duplicate_count(results: list[Any]) -> int:
    fingerprints = Counter(
        normalize_embedding_text(result.excerpt).casefold() for result in results
    )
    return sum(count - 1 for count in fingerprints.values() if count > 1)


def rank_range(results: list[Any], attribute: str) -> dict[str, int | None]:
    ranks = [getattr(result, attribute) for result in results]
    ranks = [rank for rank in ranks if rank is not None]
    return {"min": min(ranks) if ranks else None, "max": max(ranks) if ranks else None}


async def run_evaluation() -> dict[str, Any]:
    fixture = load_fixture()
    embeddings = EmbeddingService(
        model_name=fixture["model"], max_tokens=256, batch_size=32
    )
    embeddings.warmup()
    store, passages = build_store(fixture, embeddings)
    search = SearchService(embeddings, candidate_limit=CANDIDATE_LIMIT)

    positive_cases = [case for case in fixture["queries"] if case["expected"]]
    negative_cases = [case for case in fixture["queries"] if not case["expected"]]
    precisions: list[float] = []
    reciprocal_ranks: list[float] = []
    multi_passage_coverage: list[float] = []
    per_query: list[dict[str, Any]] = []
    false_positive_query_ids: list[str] = []
    false_positive_result_count = 0
    missing_expected_ids: list[str] = []
    duplicate_candidates = 0
    duplicates_suppressed = 0
    scores: list[float] = []
    metadata_mismatches: list[str] = []

    for case in fixture["queries"]:
        query_embedding = embeddings.embed_query(case["query"])
        raw = store.hybrid_search(
            "synthetic-evaluation-owner",
            normalize_embedding_text(case["query"]),
            query_embedding,
            embeddings.model_name,
            None,
            RESULT_LIMIT,
            CANDIDATE_LIMIT,
        )
        final = await search.search(
            store,
            "synthetic-evaluation-owner",
            case["query"],
            None,
            RESULT_LIMIT,
            None,
        )
        duplicate_candidates += duplicate_prefix_count(raw)
        duplicates_suppressed += max(
            0, exact_duplicate_count(raw) - exact_duplicate_count(final)
        )
        scores.extend(result.score for result in raw)

        expected = relevant_ids(case, passages)
        final_ids = [result.chunk_id for result in final]
        if case["expected"]:
            precisions.append(sum(item in expected for item in final_ids[:5]) / 5)
            first_rank = next(
                (rank for rank, item in enumerate(final_ids, start=1) if item in expected),
                None,
            )
            reciprocal_ranks.append(1 / first_rank if first_rank else 0.0)
            for item in case["expected"]:
                if item["passage_id"] not in final_ids:
                    missing_expected_ids.append(f"{case['id']}:{item['passage_id']}")
            if case["kind"] == "multi_passage_question":
                expected_passage_ids = {item["passage_id"] for item in case["expected"]}
                multi_passage_coverage.append(
                    len(expected_passage_ids.intersection(final_ids))
                    / len(expected_passage_ids)
                )
            for result in final:
                if result.chunk_id in {item["passage_id"] for item in case["expected"]}:
                    expected_document, expected_passage = passages[result.chunk_id]
                    if (
                        result.document_id != expected_document["id"]
                        or result.page_numbers != expected_passage["page_numbers"]
                    ):
                        metadata_mismatches.append(f"{case['id']}:{result.chunk_id}")
        else:
            if final:
                false_positive_query_ids.append(case["id"])
                false_positive_result_count += len(final)

        per_query.append(
            {
                "id": case["id"],
                "kind": case["kind"],
                "expected_passages": [item["passage_id"] for item in case["expected"]],
                "expected_document_pages": [
                    {
                        "document_id": passages[item["passage_id"]][0]["id"],
                        "page_numbers": passages[item["passage_id"]][1]["page_numbers"],
                    }
                    for item in case["expected"]
                ],
                "raw_result_count": len(raw),
                "returned_result_count": len(final),
                "raw_top_passage_ids": [result.chunk_id for result in raw[:5]],
                "returned_top_passage_ids": final_ids[:5],
                "raw_score_min": min((result.score for result in raw), default=None),
                "raw_score_max": max((result.score for result in raw), default=None),
                "semantic_rank_range": rank_range(raw, "semantic_rank"),
                "lexical_rank_range": rank_range(raw, "lexical_rank"),
                "duplicate_prefix_count": duplicate_prefix_count(raw),
            }
        )

    ordered_scores = sorted(scores)
    score_distribution = {
        "count": len(ordered_scores),
        "min": ordered_scores[0] if ordered_scores else None,
        "median": statistics.median(ordered_scores) if ordered_scores else None,
        "p90": ordered_scores[math.ceil(0.9 * len(ordered_scores)) - 1]
        if ordered_scores
        else None,
        "max": ordered_scores[-1] if ordered_scores else None,
    }
    return {
        "evaluation": "synthetic_fixture_in_memory_hybrid_search",
        "model": embeddings.model_name,
        "embedding_dimensions": fixture["embedding_dimensions"],
        "database_rpc_evaluated": False,
        "result_limit": RESULT_LIMIT,
        "candidate_limit": CANDIDATE_LIMIT,
        "rrf_k": 60,
        "metrics": {
            "positive_queries": len(positive_cases),
            "negative_queries": len(negative_cases),
            "precision_at_5_mean_positive": statistics.mean(precisions),
            "mrr_positive": statistics.mean(reciprocal_ranks),
            "multi_passage_expected_evidence_coverage": statistics.mean(
                multi_passage_coverage
            ),
            "missing_expected_passage_count": len(missing_expected_ids),
            "missing_expected_passage_ids": missing_expected_ids,
            "negative_queries_with_results": len(false_positive_query_ids),
            "negative_false_positive_query_rate": len(false_positive_query_ids)
            / len(negative_cases),
            "negative_false_positive_query_ids": false_positive_query_ids,
            "negative_false_positive_result_count": false_positive_result_count,
            "raw_duplicate_prefix_candidates": duplicate_candidates,
            "duplicates_suppressed_before_final_limit": duplicates_suppressed,
            "score_distribution_before_deduplication": score_distribution,
            "metadata_mismatch_count": len(metadata_mismatches),
            "metadata_mismatch_ids": metadata_mismatches,
        },
        "queries": per_query,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_evaluation()), indent=2))