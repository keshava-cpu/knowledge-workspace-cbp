"""Evaluate the installed local Supabase search RPC using synthetic fixture data.

Run after `npx supabase start` and `npx supabase migration up --local`:
    python backend/tests/local_rpc_evaluation.py

The script uses the current FastEmbed model, seeds and removes only random local
evaluation owners, runs as the authenticated Postgres role with an auth.uid()
claim, and prints passage IDs/aggregate metrics only.
"""

import asyncio
import json
import math
import re
import statistics
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4, uuid5

BACKEND_DIR = Path(__file__).resolve().parents[1]
TESTS_DIR = Path(__file__).resolve().parent
for directory in (BACKEND_DIR, TESTS_DIR):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from app.embeddings import EmbeddingService, normalize_embedding_text
from app.models import SearchResult
from app.search import SearchService
from app.store import InMemoryStore, SupabaseStore
from retrieval_evaluation import (
    CANDIDATE_LIMIT,
    RESULT_LIMIT,
    build_store,
    load_fixture,
    relevant_ids,
)

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
LOCAL_DB_CONTAINER = "supabase_db_knowledge-workspace-cbp"
UUID_NAMESPACE = UUID("1980c8bd-cb8a-44c6-8f50-bd4452834ac9")
TERM_PATTERN = re.compile(r"[a-z0-9]+(?:[.+#_-][a-z0-9]+)*", re.IGNORECASE)
QUERY_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "does", "do",
    "for", "from", "how", "in", "into", "is", "it", "of", "on", "or", "that",
    "the", "their", "then", "this", "to", "use", "what", "when", "which", "why",
    "with",
}
HOLDOUT_QUERY_IDS = frozenset(
    {
        "mesi-paraphrase",
        "protocol-timeouts-broad",
        "dijkstra-negative-edges",
        "bloom-membership-paraphrase",
        "tls-finished-paraphrase",
        "tls-multi-passage",
        "quicksort-randomized-paraphrase",
        "indexes-broad",
        "mesi-exclusive-state",
        "photosynthesis-unrelated",
        "directory-coherence-not-covered",
        "dijkstra-bellman-ford",
        "tls-static-rsa",
        "rna-splicing-unrelated",
        "volcano-unrelated",
    }
)


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def stable_id(owner_id: UUID, kind: str, identifier: str) -> UUID:
    return uuid5(owner_id, f"{kind}:{identifier}")


def run_psql(sql: str) -> str:
    completed = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            LOCAL_DB_CONTAINER,
            "psql",
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-d",
            "postgres",
        ],
        input=sql,
        capture_output=True,
        check=True,
        text=True,
    )
    return completed.stdout


def embedding_literal(vector: list[float]) -> str:
    if len(vector) != 384:
        raise ValueError("Evaluation vector does not have the preserved 384 dimensions.")
    values = ",".join(f"{value:.8f}" for value in vector)
    return sql_literal(f"[{values}]") + "::extensions.vector(384)"


def build_seed_sql(
    fixture: dict[str, Any],
    store: InMemoryStore,
    owner_id: UUID,
    foreign_owner_id: UUID,
) -> tuple[str, dict[str, UUID], dict[str, UUID], UUID]:
    document_ids = {
        document["id"]: stable_id(owner_id, "document", document["id"])
        for document in fixture["documents"]
    }
    passage_ids = {
        passage["id"]: stable_id(owner_id, "chunk", passage["id"])
        for document in fixture["documents"]
        for passage in document["passages"]
    }
    foreign_document_id = stable_id(foreign_owner_id, "document", "foreign-sentinel")
    foreign_chunk_id = stable_id(foreign_owner_id, "chunk", "foreign-sentinel")
    statements = ["BEGIN;", f"DELETE FROM auth.users WHERE id IN ('{owner_id}', '{foreign_owner_id}');"]

    for user_id, email in (
        (owner_id, f"eval-{owner_id}@example.invalid"),
        (foreign_owner_id, f"eval-{foreign_owner_id}@example.invalid"),
    ):
        statements.append(
            "INSERT INTO auth.users "
            "(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, "
            "is_sso_user, is_anonymous, email_confirmed_at, created_at, updated_at) "
            f"VALUES ('{user_id}', 'authenticated', 'authenticated', {sql_literal(email)}, "
            "'{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, "
            "'{}'::jsonb, false, false, now(), now(), now());"
        )

    for document in fixture["documents"]:
        document_id = document_ids[document["id"]]
        pages = [page for passage in document["passages"] for page in passage["page_numbers"]]
        filename = document["filename"]
        title = document["title"]
        statements.append(
            "INSERT INTO public.documents "
            "(id, owner_id, filename, title, content_type, size_bytes, storage_path, "
            "page_count, indexing_status, indexed_chunks) VALUES "
            f"('{document_id}', '{owner_id}', {sql_literal(filename)}, {sql_literal(title)}, "
            f"'application/pdf', 1, {sql_literal(f'{owner_id}/{document_id}.pdf')}, "
            f"{max(pages)}, 'completed', {len(document['passages'])});"
        )

        indexed_rows = store.indexed_chunks[document["id"]]
        for passage, chunk in zip(document["passages"], indexed_rows, strict=True):
            chunk_id = passage_ids[passage["id"]]
            page_numbers = "ARRAY[" + ",".join(str(page) for page in chunk["page_numbers"]) + "]::integer[]"
            locations = sql_literal(json.dumps(chunk["location_metadata"])) + "::jsonb"
            statements.append(
                "INSERT INTO public.document_chunks "
                "(id, document_id, owner_id, chunk_index, content, page_numbers, "
                "location_metadata, embedding_model, embedding) VALUES "
                f"('{chunk_id}', '{document_id}', '{owner_id}', {chunk['chunk_index']}, "
                f"{sql_literal(chunk['content'])}, {page_numbers}, {locations}, "
                f"{sql_literal(MODEL_NAME)}, {embedding_literal(chunk['embedding'])});"
            )

    sentinel_document = fixture["documents"][0]
    sentinel_passage = sentinel_document["passages"][0]
    source_chunk = store.indexed_chunks[sentinel_document["id"]][0]
    statements.extend(
        [
            "INSERT INTO public.documents "
            "(id, owner_id, filename, title, content_type, size_bytes, storage_path, "
            "page_count, indexing_status, indexed_chunks) VALUES "
            f"('{foreign_document_id}', '{foreign_owner_id}', 'foreign-sentinel.pdf', "
            "'Foreign Sentinel', 'application/pdf', 1, "
            f"{sql_literal(f'{foreign_owner_id}/{foreign_document_id}.pdf')}, 1, 'completed', 1);",
            "INSERT INTO public.document_chunks "
            "(id, document_id, owner_id, chunk_index, content, page_numbers, "
            "location_metadata, embedding_model, embedding) VALUES "
            f"('{foreign_chunk_id}', '{foreign_document_id}', '{foreign_owner_id}', 0, "
            f"{sql_literal(sentinel_passage['text'])}, ARRAY[999]::integer[], "
            "'[{\"page_no\":999}]'::jsonb, "
            f"{sql_literal(MODEL_NAME)}, {embedding_literal(source_chunk['embedding'])});",
            "COMMIT;",
        ]
    )
    return "\n".join(statements), document_ids, passage_ids, foreign_document_id


def build_rpc_sql(
    fixture: dict[str, Any], embeddings: EmbeddingService, owner_id: UUID
) -> str:
    statements = [
        "BEGIN;",
        "SET LOCAL ROLE authenticated;",
        f"SET LOCAL request.jwt.claim.sub = '{owner_id}';",
    ]
    for query in fixture["queries"]:
        normalized_query = normalize_embedding_text(query["query"])
        vector = embeddings.embed_query(normalized_query)
        statements.append(
            "SELECT jsonb_build_object("
            f"'query_id', {sql_literal(query['id'])}, "
            "'results', coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.score DESC, r.document_id, r.chunk_id), '[]'::jsonb)"
            ")::text "
            "FROM public.search_document_chunks("
            f"{sql_literal(normalized_query)}, {embedding_literal(vector)}, "
            f"{sql_literal(MODEL_NAME)}, NULL::uuid, {CANDIDATE_LIMIT}, {CANDIDATE_LIMIT}"
            ") AS r;"
        )
    statements.append("ROLLBACK;")
    return "\n".join(statements)


class LocalRpcStore(SupabaseStore):
    def __init__(self, results_by_query: dict[str, list[SearchResult]]) -> None:
        super().__init__("http://local-rpc.invalid", "local-evaluation-key")
        self.results_by_query = results_by_query
        self.delivered_by_query: dict[str, list[SearchResult]] = {}

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
        del owner_id, embedding, embedding_model, document_id, limit, access_token
        delivered = self.results_by_query[query][:candidate_limit]
        self.delivered_by_query[query] = delivered
        return delivered


def exact_duplicate_count(results: list[SearchResult]) -> int:
    contents = Counter(normalize_embedding_text(result.excerpt).casefold() for result in results)
    return sum(count - 1 for count in contents.values() if count > 1)


def legacy_prefix_deduplicate(results: list[SearchResult]) -> list[SearchResult]:
    seen: set[str] = set()
    unique: list[SearchResult] = []
    for result in results:
        prefix = normalize_embedding_text(result.excerpt)[:120].casefold()
        if prefix in seen:
            continue
        seen.add(prefix)
        unique.append(result)
    return unique


def prefix_collision_count(results: list[SearchResult]) -> int:
    groups: dict[str, set[str]] = {}
    for result in results:
        normalized = normalize_embedding_text(result.excerpt).casefold()
        groups.setdefault(normalized[:120], set()).add(normalized)
    return sum(max(0, len(contents) - 1) for contents in groups.values())


def query_term_coverage(query: str, excerpt: str) -> float:
    query_terms = {
        term.casefold()
        for term in TERM_PATTERN.findall(normalize_embedding_text(query))
        if term.casefold() not in QUERY_STOP_WORDS
    }
    if not query_terms:
        query_terms = {term.casefold() for term in TERM_PATTERN.findall(query)}
    excerpt_terms = {term.casefold() for term in TERM_PATTERN.findall(excerpt)}
    return len(query_terms & excerpt_terms) / len(query_terms) if query_terms else 0.0


def is_exact_evidence(query: str, result: SearchResult) -> bool:
    methods = set(result.retrieval_methods)
    normalized_query = normalize_embedding_text(query).casefold()
    normalized_excerpt = normalize_embedding_text(result.excerpt).casefold()
    return "exact" in methods or bool(normalized_query and normalized_query in normalized_excerpt)


def deduplicate_full_passages(results: list[SearchResult]) -> list[SearchResult]:
    seen: set[str] = set()
    unique: list[SearchResult] = []
    for result in results:
        normalized = normalize_embedding_text(result.excerpt).casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        unique.append(result)
    return unique


def measure_eligibility_rule(
    prepared: list[dict[str, Any]],
    semantic_threshold: float,
    semantic_coverage_threshold: float,
    fulltext_coverage_threshold: float,
) -> dict[str, Any]:
    positive_precisions: list[float] = []
    reciprocal_ranks: list[float] = []
    false_positive_queries: list[str] = []
    missing_queries: list[str] = []
    missing_passages: list[str] = []
    true_positive = false_positive = false_negative = 0
    false_positive_result_count = 0
    equivalent_duplicates_suppressed = 0
    distinct_prefix_collisions = 0
    positives = [item for item in prepared if item["query"]["expected"]]
    negatives = [item for item in prepared if not item["query"]["expected"]]

    for item in prepared:
        selected_candidates = [
            candidate
            for candidate in item["candidates"]
            if candidate["exact"]
            or (
                candidate["fulltext"]
                and candidate["coverage"] >= fulltext_coverage_threshold
            )
            or (
                candidate["similarity"] is not None
                and candidate["similarity"] >= semantic_threshold
                and candidate["coverage"] >= semantic_coverage_threshold
            )
        ]
        selected = [candidate["result"] for candidate in selected_candidates]
        selected_ids = {id(candidate) for candidate in selected_candidates}
        for candidate in item["candidates"]:
            eligible = id(candidate) in selected_ids
            if eligible and candidate["relevant"]:
                true_positive += 1
            elif eligible:
                false_positive += 1
            elif candidate["relevant"]:
                false_negative += 1

        deduplicated = deduplicate_full_passages(selected)
        equivalent_duplicates_suppressed += max(0, len(selected) - len(deduplicated))
        distinct_prefix_collisions += prefix_collision_count(selected)
        final = deduplicated[:RESULT_LIMIT]
        final_ids = {str(result.chunk_id) for result in final}

        if item["query"]["expected"]:
            positive_precisions.append(
                sum(str(result.chunk_id) in item["relevant"] for result in final[:5]) / 5
            )
            first_rank = next(
                (
                    rank
                    for rank, result in enumerate(final, start=1)
                    if str(result.chunk_id) in item["relevant"]
                ),
                None,
            )
            reciprocal_ranks.append(1 / first_rank if first_rank else 0.0)
            if first_rank is None:
                missing_queries.append(item["query"]["id"])
            for expected in item["query"]["expected"]:
                expected_label = expected["passage_id"]
                equivalent_labels = {
                    label
                    for label, passage in _fixture_passages_from_prepared(prepared).items()
                    if label == expected_label or passage.get("duplicate_of") == expected_label
                }
                expected_ids = {
                    str(item["passage_ids"][label])
                    for label in equivalent_labels
                    if label in item["passage_ids"]
                }
                if not final_ids.intersection(expected_ids):
                    missing_passages.append(f"{item['query']['id']}:{expected_label}")
        elif final:
            false_positive_queries.append(item["query"]["id"])
            false_positive_result_count += len(final)

    total_expected = sum(len(item["query"]["expected"]) for item in positives)
    candidate_precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
    candidate_recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
    candidate_f1 = (
        2 * candidate_precision * candidate_recall / (candidate_precision + candidate_recall)
        if candidate_precision + candidate_recall
        else 0.0
    )
    return {
        "positive_queries": len(positives),
        "negative_queries": len(negatives),
        "positive_precision_at_5": statistics.mean(positive_precisions) if positive_precisions else None,
        "positive_mrr": statistics.mean(reciprocal_ranks) if reciprocal_ranks else None,
        "positive_missing_evidence_query_rate": len(missing_queries) / len(positives) if positives else None,
        "positive_missing_evidence_query_ids": missing_queries,
        "positive_expected_passage_missing_rate": len(missing_passages) / total_expected if total_expected else None,
        "positive_expected_passage_missing_ids": missing_passages,
        "negative_false_positive_query_rate": len(false_positive_queries) / len(negatives) if negatives else None,
        "negative_false_positive_query_ids": false_positive_queries,
        "negative_false_positive_result_count": false_positive_result_count,
        "equivalent_duplicates_suppressed": equivalent_duplicates_suppressed,
        "distinct_prefix_collisions_preserved": distinct_prefix_collisions,
        "candidate_precision": candidate_precision,
        "candidate_recall": candidate_recall,
        "candidate_f1": candidate_f1,
    }


def _fixture_passages_from_prepared(prepared: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return prepared[0]["passages"] if prepared else {}


def calibrate_eligibility(
    fixture: dict[str, Any],
    rpc_results: dict[str, list[SearchResult]],
    passage_ids: dict[str, UUID],
) -> dict[str, Any]:
    passage_context = {
        passage_id: ({}, passage)
        for passage_id, passage in _fixture_passages(fixture).items()
    }
    prepared: list[dict[str, Any]] = []
    semantic_values: set[float] = set()
    coverage_values: set[float] = set()

    for query in fixture["queries"]:
        relevant = {
            str(passage_ids[label])
            for label in relevant_ids(query, passage_context)
            if label in passage_ids
        }
        candidates = []
        for result in rpc_results[query["id"]]:
            coverage = query_term_coverage(query["query"], result.excerpt)
            similarity = result.semantic_similarity
            if similarity is not None:
                semantic_values.add(similarity)
            if "fulltext" in result.retrieval_methods or similarity is not None:
                coverage_values.add(coverage)
            candidates.append(
                {
                    "result": result,
                    "relevant": str(result.chunk_id) in relevant,
                    "exact": is_exact_evidence(query["query"], result),
                    "fulltext": "fulltext" in result.retrieval_methods,
                    "coverage": coverage,
                    "similarity": similarity,
                }
            )
        prepared.append(
            {
                "query": query,
                "relevant": relevant,
                "candidates": candidates,
                "passage_ids": passage_ids,
                "passages": _fixture_passages(fixture),
            }
        )

    calibration_prepared = [
        item for item in prepared if item["query"]["id"] not in HOLDOUT_QUERY_IDS
    ]
    held_out_prepared = [
        item for item in prepared if item["query"]["id"] in HOLDOUT_QUERY_IDS
    ]
    if len(calibration_prepared) + len(held_out_prepared) != len(prepared):
        raise AssertionError("Calibration/holdout split does not cover the fixture.")
    for split in (calibration_prepared, held_out_prepared):
        if not any(item["query"]["expected"] for item in split) or all(
            item["query"]["expected"] for item in split
        ):
            raise AssertionError("Both evaluation splits must contain positive and negative queries.")

    semantic_values = {
        candidate["similarity"]
        for item in calibration_prepared
        for candidate in item["candidates"]
        if candidate["similarity"] is not None
    }
    coverage_values = {
        candidate["coverage"]
        for item in calibration_prepared
        for candidate in item["candidates"]
        if candidate["fulltext"] or candidate["similarity"] is not None
    }

    if not semantic_values:
        return {"error": "RPC returned no semantic similarities to calibrate."}

    ordered_similarities = sorted(semantic_values)
    semantic_thresholds = sorted(
        {
            ordered_similarities[round(index * (len(ordered_similarities) - 1) / 40)]
            for index in range(41)
        }
        | {ordered_similarities[-1] + 1e-9}
    )
    coverage_thresholds = sorted(coverage_values | {1.000001})
    best_objective: tuple[float, float, float, float, float, float] | None = None
    best_thresholds: tuple[float, float, float] | None = None

    def eligible_candidates(
        item: dict[str, Any], semantic_threshold: float, semantic_coverage: float, fulltext_coverage: float
    ) -> list[dict[str, Any]]:
        return [
            candidate
            for candidate in item["candidates"]
            if candidate["exact"]
            or (
                candidate["fulltext"]
                and candidate["coverage"] >= fulltext_coverage
            )
            or (
                candidate["similarity"] is not None
                and candidate["similarity"] >= semantic_threshold
                and candidate["coverage"] >= semantic_coverage
            )
        ]

    for semantic_threshold in semantic_thresholds:
        for semantic_coverage_threshold in coverage_thresholds:
            for fulltext_coverage_threshold in coverage_thresholds:
                true_positive = false_positive = false_negative = 0
                positive_query_hits = false_positive_queries = 0
                expected_evidence_count = expected_evidence_hits = 0
                query_precisions: list[float] = []
                query_reciprocal_ranks: list[float] = []
                for item in calibration_prepared:
                    selected = eligible_candidates(
                        item,
                        semantic_threshold,
                        semantic_coverage_threshold,
                        fulltext_coverage_threshold,
                    )
                    for candidate in item["candidates"]:
                        eligible = candidate in selected
                        if eligible and candidate["relevant"]:
                            true_positive += 1
                        elif eligible:
                            false_positive += 1
                        elif candidate["relevant"]:
                            false_negative += 1
                    final = deduplicate_full_passages(
                        [candidate["result"] for candidate in selected]
                    )[:RESULT_LIMIT]
                    final_ids = {str(result.chunk_id) for result in final}
                    relevant_ids_for_query = item["relevant"]
                    if item["query"]["expected"]:
                        hits_at_five = sum(
                            str(result.chunk_id) in relevant_ids_for_query
                            for result in final[:5]
                        )
                        query_precisions.append(hits_at_five / 5)
                        first_rank = next(
                            (
                                rank
                                for rank, result in enumerate(final, start=1)
                                if str(result.chunk_id) in relevant_ids_for_query
                            ),
                            None,
                        )
                        if first_rank:
                            positive_query_hits += 1
                            query_reciprocal_ranks.append(1 / first_rank)
                        for expected in item["query"]["expected"]:
                            expected_evidence_count += 1
                            expected_label = expected["passage_id"]
                            equivalent_labels = {
                                label
                                for label, passage in _fixture_passages(fixture).items()
                                if label == expected_label
                                or passage.get("duplicate_of") == expected_label
                            }
                            equivalent_ids = {
                                str(passage_ids[label])
                                for label in equivalent_labels
                                if label in passage_ids
                            }
                            if final_ids.intersection(equivalent_ids):
                                expected_evidence_hits += 1
                    elif final:
                        false_positive_queries += 1

                denominator = 2 * true_positive + false_positive + false_negative
                f1 = 2 * true_positive / denominator if denominator else 0.0
                precision = (
                    true_positive / (true_positive + false_positive)
                    if true_positive + false_positive
                    else 0.0
                )
                recall = (
                    true_positive / (true_positive + false_negative)
                    if true_positive + false_negative
                    else 0.0
                )
                positives_count = sum(
                    bool(item["query"]["expected"]) for item in calibration_prepared
                )
                negatives_count = len(calibration_prepared) - positives_count
                evidence_recall = (
                    expected_evidence_hits / expected_evidence_count
                    if expected_evidence_count
                    else 0.0
                )
                query_recall = positive_query_hits / positives_count if positives_count else 0.0
                query_precision = (
                    positive_query_hits / (positive_query_hits + false_positive_queries)
                    if positive_query_hits + false_positive_queries
                    else 0.0
                )
                query_f1 = (
                    2 * query_precision * query_recall / (query_precision + query_recall)
                    if query_precision + query_recall
                    else 0.0
                )
                mean_query_p_at_five = statistics.mean(query_precisions) if query_precisions else 0.0
                mean_query_mrr = (
                    statistics.mean(query_reciprocal_ranks)
                    if query_reciprocal_ranks
                    else 0.0
                )
                objective = (
                    evidence_recall,
                    query_recall,
                    -false_positive_queries / negatives_count if negatives_count else 0.0,
                    query_f1,
                    mean_query_p_at_five,
                    mean_query_mrr,
                )
                if best_objective is None or objective > best_objective:
                    best_objective = objective
                    best_thresholds = (
                        semantic_threshold,
                        semantic_coverage_threshold,
                        fulltext_coverage_threshold,
                    )

    if best_objective is None or best_thresholds is None:
        return {}

    semantic_threshold, semantic_coverage_threshold, fulltext_coverage_threshold = best_thresholds
    thresholds = {
        "semantic_similarity_threshold": semantic_threshold,
        "semantic_query_term_coverage_threshold": semantic_coverage_threshold,
        "fulltext_query_term_coverage_threshold": fulltext_coverage_threshold,
        "selection_objective": "maximize expected-evidence recall, then answerable-query recall, then minimize negative-query rate",
    }
    return {
        "thresholds": thresholds,
        "calibration_query_ids": [item["query"]["id"] for item in calibration_prepared],
        "held_out_query_ids": [item["query"]["id"] for item in held_out_prepared],
        "calibration": measure_eligibility_rule(
            calibration_prepared,
            semantic_threshold,
            semantic_coverage_threshold,
            fulltext_coverage_threshold,
        ),
        "held_out": measure_eligibility_rule(
            held_out_prepared,
            semantic_threshold,
            semantic_coverage_threshold,
            fulltext_coverage_threshold,
        ),
        "all_cases": measure_eligibility_rule(
            prepared,
            semantic_threshold,
            semantic_coverage_threshold,
            fulltext_coverage_threshold,
        ),
    }

    semantic_threshold, semantic_coverage_threshold, fulltext_coverage_threshold = best_thresholds
    positive_precisions: list[float] = []
    reciprocal_ranks: list[float] = []
    missing_queries: list[str] = []
    missing_passages: list[str] = []
    expected_evidence_count = expected_evidence_hits = 0
    false_positive_queries: list[str] = []
    for item in prepared:
        selected_candidates = eligible_candidates(
            item,
            semantic_threshold,
            semantic_coverage_threshold,
            fulltext_coverage_threshold,
        )
        selected = [candidate["result"] for candidate in selected_candidates]
        selected_candidate_ids = {id(candidate) for candidate in selected_candidates}
        for candidate in item["candidates"]:
            eligible = id(candidate) in selected_candidate_ids
            if eligible and candidate["relevant"]:
                true_positive += 1
            elif eligible:
                false_positive += 1
            elif candidate["relevant"]:
                false_negative += 1
        final = deduplicate_full_passages(selected)[:RESULT_LIMIT]
        final_ids = {str(result.chunk_id) for result in final}
        if item["query"]["expected"]:
            positive_precisions.append(
                sum(str(result.chunk_id) in item["relevant"] for result in final[:5]) / 5
            )
            first_rank = next(
                (
                    rank
                    for rank, result in enumerate(final, start=1)
                    if str(result.chunk_id) in item["relevant"]
                ),
                None,
            )
            reciprocal_ranks.append(1 / first_rank if first_rank else 0.0)
            if not final_ids.intersection(item["relevant"]):
                missing_queries.append(item["query"]["id"])
            for expected in item["query"]["expected"]:
                expected_evidence_count += 1
                expected_label = expected["passage_id"]
                equivalent_labels = {
                    label
                    for label, passage in _fixture_passages(fixture).items()
                    if label == expected_label or passage.get("duplicate_of") == expected_label
                }
                equivalent_ids = {
                    str(passage_ids[label]) for label in equivalent_labels if label in passage_ids
                }
                if final_ids.intersection(equivalent_ids):
                    expected_evidence_hits += 1
        elif final:
            false_positive_queries.append(item["query"]["id"])

    (
        evidence_recall,
        query_recall,
        negative_query_rate,
        query_f1,
        mean_query_p_at_five,
        mean_query_mrr,
    ) = best_objective
    candidate_precision = true_positive / (true_positive + false_positive)
    candidate_recall = true_positive / (true_positive + false_negative)
    candidate_f1 = (
        2 * candidate_precision * candidate_recall / (candidate_precision + candidate_recall)
        if candidate_precision + candidate_recall
        else 0.0
    )
    positive_count = sum(bool(item["query"]["expected"]) for item in prepared)
    negative_count = len(prepared) - positive_count
    return {
        "semantic_similarity_threshold": semantic_threshold,
        "semantic_query_term_coverage_threshold": semantic_coverage_threshold,
        "fulltext_query_term_coverage_threshold": fulltext_coverage_threshold,
        "query_level_f1": query_f1,
        "query_positive_precision_at_5": mean_query_p_at_five,
        "query_positive_mrr": mean_query_mrr,
        "candidate_precision": candidate_precision,
        "candidate_recall": candidate_recall,
        "candidate_f1": candidate_f1,
        "calibration_objective": "maximize expected-evidence recall, then answerable-query recall, then minimize negative-query rate",
        "positive_expected_evidence_recall": evidence_recall,
        "positive_expected_evidence_missing_rate": 1 - evidence_recall,
        "positive_expected_evidence_missing_count": expected_evidence_count
        - expected_evidence_hits,
        "positive_query_recall": query_recall,
        "positive_precision_at_5": statistics.mean(positive_precisions)
        if positive_precisions
        else 0.0,
        "positive_mrr": statistics.mean(reciprocal_ranks) if reciprocal_ranks else 0.0,
        "positive_missing_evidence_query_rate": len(missing_queries) / positive_count
        if positive_count
        else 0.0,
        "positive_missing_evidence_query_ids": missing_queries,
        "negative_false_positive_query_rate": negative_query_rate,
        "negative_false_positive_query_ids": false_positive_queries,
    }


def _fixture_passages(fixture: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        passage["id"]: passage
        for document in fixture["documents"]
        for passage in document["passages"]
    }


def labeled_signal_summary(
    fixture: dict[str, Any],
    rpc_results: dict[str, list[SearchResult]],
    passage_ids: dict[str, UUID],
) -> list[dict[str, Any]]:
    inverse_ids = {str(value): key for key, value in passage_ids.items()}
    summaries = []
    for query in fixture["queries"]:
        candidates = rpc_results[query["id"]]
        if query["expected"]:
            signals = []
            for item in query["expected"]:
                result = next(
                    (
                        candidate
                        for candidate in candidates
                        if str(candidate.chunk_id) == str(passage_ids[item["passage_id"]])
                    ),
                    None,
                )
                signals.append(
                    {
                        "passage_id": item["passage_id"],
                        "present_in_rpc_pool": result is not None,
                        "semantic_similarity": getattr(result, "semantic_similarity", None)
                        if result
                        else None,
                        "retrieval_methods": result.retrieval_methods if result else [],
                        "query_term_coverage": query_term_coverage(query["query"], result.excerpt)
                        if result
                        else None,
                        "score": result.score if result else None,
                    }
                )
            summaries.append({"id": query["id"], "kind": query["kind"], "expected_signals": signals})
            continue

        top_semantic = max(
            (result for result in candidates if result.semantic_similarity is not None),
            key=lambda result: result.semantic_similarity,
            default=None,
        )
        top_fulltext = max(
            (result for result in candidates if "fulltext" in result.retrieval_methods),
            key=lambda result: result.score,
            default=None,
        )
        summaries.append(
            {
                "id": query["id"],
                "kind": query["kind"],
                "top_semantic": {
                    "passage_id": inverse_ids.get(str(top_semantic.chunk_id), "unknown"),
                    "semantic_similarity": top_semantic.semantic_similarity,
                    "query_term_coverage": query_term_coverage(query["query"], top_semantic.excerpt),
                    "retrieval_methods": top_semantic.retrieval_methods,
                }
                if top_semantic
                else None,
                "top_fulltext": {
                    "passage_id": inverse_ids.get(str(top_fulltext.chunk_id), "unknown"),
                    "semantic_similarity": top_fulltext.semantic_similarity,
                    "query_term_coverage": query_term_coverage(query["query"], top_fulltext.excerpt),
                    "retrieval_methods": top_fulltext.retrieval_methods,
                }
                if top_fulltext
                else None,
            }
        )
    return summaries


async def evaluate_local_rpc() -> dict[str, Any]:
    fixture = load_fixture()
    if fixture["model"] != MODEL_NAME or fixture["embedding_dimensions"] != 384:
        raise ValueError("Fixture embedding identity differs from the required model.")
    embeddings = EmbeddingService(MODEL_NAME, max_tokens=256, batch_size=32)
    embeddings.warmup()
    indexed_store, passages = build_store(fixture, embeddings)
    owner_id = uuid4()
    foreign_owner_id = uuid4()
    foreign_document_id: UUID | None = None
    document_ids: dict[str, UUID] = {}
    passage_ids: dict[str, UUID] = {}

    try:
        seed_sql, document_ids, passage_ids, foreign_document_id = build_seed_sql(
            fixture, indexed_store, owner_id, foreign_owner_id
        )
        run_psql(seed_sql)
        rpc_rows_output = run_psql(build_rpc_sql(fixture, embeddings, owner_id))
        rows_by_id = {
            item["query_id"]: [SearchResult.model_validate(row) for row in item["results"]]
            for item in (json.loads(line) for line in rpc_rows_output.splitlines() if line.strip())
        }
        if len(rows_by_id) != len(fixture["queries"]):
            raise RuntimeError("Local RPC did not return one result set per evaluation query.")

        result_store = LocalRpcStore(
            {
                normalize_embedding_text(query["query"]): rows_by_id[query["id"]]
                for query in fixture["queries"]
            }
        )
        search = SearchService(embeddings, cache_size=0)
        positive = [query for query in fixture["queries"] if query["expected"]]
        negative = [query for query in fixture["queries"] if not query["expected"]]
        before_p_at_five: list[float] = []
        before_reciprocal_ranks: list[float] = []
        before_missing_queries: list[str] = []
        before_missing_passages: list[str] = []
        expected_passage_count = sum(len(query["expected"]) for query in positive)
        before_false_positive_queries: list[str] = []
        before_false_positive_results = 0
        before_duplicates_suppressed = 0
        before_prefix_collisions = 0
        after_prefix_collisions_preserved = 0
        p_at_five: list[float] = []
        reciprocal_ranks: list[float] = []
        missing_queries: list[str] = []
        missing_passages: list[str] = []
        false_positive_queries: list[str] = []
        false_positive_results = 0
        equivalent_suppressed = 0
        prefix_collisions = 0
        foreign_results = 0
        metadata_mismatches: list[str] = []
        per_query: list[dict[str, Any]] = []
        score_values: list[float] = []

        for query in fixture["queries"]:
            normalized_query = normalize_embedding_text(query["query"])
            final = await search.search(
                result_store,
                str(owner_id),
                query["query"],
                None,
                RESULT_LIMIT,
                "local-evaluation-token",
            )
            raw = result_store.delivered_by_query[normalized_query]
            legacy_pool = raw[:RESULT_LIMIT]
            legacy_final = legacy_prefix_deduplicate(legacy_pool)[:RESULT_LIMIT]
            returned_ids = [str(result.chunk_id) for result in final]
            legacy_ids = [str(result.chunk_id) for result in legacy_final]
            expected_labels = relevant_ids(query, passages)
            expected_database_ids = {str(passage_ids[label]) for label in expected_labels}
            inverse_passage_ids = {str(value): key for key, value in passage_ids.items()}
            inverse_document_ids = {str(value): key for key, value in document_ids.items()}
            score_values.extend(result.score for result in raw)
            equivalent_suppressed += max(0, exact_duplicate_count(raw) - exact_duplicate_count(final))
            prefix_collisions += prefix_collision_count(raw)
            after_prefix_collisions_preserved += prefix_collision_count(final)
            before_duplicates_suppressed += len(legacy_pool) - len(legacy_final)
            before_prefix_collisions += prefix_collision_count(legacy_pool)
            foreign_results += sum(str(result.document_id) == str(foreign_document_id) for result in raw)

            if query["expected"]:
                before_p_at_five.append(
                    sum(result_id in expected_database_ids for result_id in legacy_ids[:5]) / 5
                )
                before_first_rank = next(
                    (
                        rank
                        for rank, result_id in enumerate(legacy_ids, start=1)
                        if result_id in expected_database_ids
                    ),
                    None,
                )
                before_reciprocal_ranks.append(
                    1 / before_first_rank if before_first_rank else 0.0
                )
                if before_first_rank is None:
                    before_missing_queries.append(query["id"])
                for expected_item in query["expected"]:
                    if str(passage_ids[expected_item["passage_id"]]) not in legacy_ids:
                        before_missing_passages.append(
                            f"{query['id']}:{expected_item['passage_id']}"
                        )
                hits = sum(result_id in expected_database_ids for result_id in returned_ids[:5])
                p_at_five.append(hits / 5)
                first_rank = next(
                    (rank for rank, result_id in enumerate(returned_ids, start=1) if result_id in expected_database_ids),
                    None,
                )
                reciprocal_ranks.append(1 / first_rank if first_rank else 0.0)
                if first_rank is None:
                    missing_queries.append(query["id"])
                for item in query["expected"]:
                    label = item["passage_id"]
                    if str(passage_ids[label]) not in returned_ids:
                        missing_passages.append(f"{query['id']}:{label}")
                for result in final:
                    label = inverse_passage_ids.get(str(result.chunk_id))
                    if label is None:
                        continue
                    expected_document, expected_passage = passages[label]
                    if (
                        inverse_document_ids.get(str(result.document_id)) != expected_document["id"]
                        or result.page_numbers != expected_passage["page_numbers"]
                    ):
                        metadata_mismatches.append(f"{query['id']}:{label}")
            elif final:
                false_positive_queries.append(query["id"])
                false_positive_results += len(final)
            if not query["expected"] and legacy_final:
                before_false_positive_queries.append(query["id"])
                before_false_positive_results += len(legacy_final)

            per_query.append(
                {
                    "id": query["id"],
                    "kind": query["kind"],
                    "expected_passages": [item["passage_id"] for item in query["expected"]],
                    "returned_top_passages": [inverse_passage_ids.get(result_id, "unknown") for result_id in returned_ids[:5]],
                    "rpc_rows_returned": len(result_store.results_by_query[normalized_query]),
                    "raw_result_count": len(raw),
                    "final_result_count": len(final),
                    "score_min": min((result.score for result in raw), default=None),
                    "score_max": max((result.score for result in raw), default=None),
                    "semantic_similarity_range": {
                        "min": min(
                            (
                                similarity
                                for result in raw
                                if (similarity := getattr(result, "semantic_similarity", None))
                                is not None
                            ),
                            default=None,
                        ),
                        "max": max(
                            (
                                similarity
                                for result in raw
                                if (similarity := getattr(result, "semantic_similarity", None))
                                is not None
                            ),
                            default=None,
                        ),
                    },
                    "semantic_rank_max": max((result.semantic_rank for result in raw if result.semantic_rank is not None), default=None),
                    "lexical_rank_max": max((result.lexical_rank for result in raw if result.lexical_rank is not None), default=None),
                }
            )

        ordered_scores = sorted(score_values)
        results = {
            "evaluation": "local_supabase_postgres_search_document_chunks",
            "model": MODEL_NAME,
            "embedding_dimensions": 384,
            "database_rpc_evaluated": True,
            "authenticated_role": "authenticated",
            "rls_identity_claimed": True,
            "result_limit": RESULT_LIMIT,
            "rpc_candidate_pool": CANDIDATE_LIMIT,
            "legacy_rpc_result_cap": 20,
            "metrics": {
                "before_legacy_top10_prefix_dedup": {
                    "positive_precision_at_5": statistics.mean(before_p_at_five)
                    if before_p_at_five
                    else None,
                    "positive_mrr": statistics.mean(before_reciprocal_ranks)
                    if before_reciprocal_ranks
                    else None,
                    "positive_missing_evidence_query_rate": len(before_missing_queries)
                    / len(positive)
                    if positive
                    else None,
                    "positive_missing_expected_passage_count": len(before_missing_passages),
                    "positive_missing_expected_passage_rate": len(before_missing_passages)
                    / expected_passage_count
                    if expected_passage_count
                    else None,
                    "negative_false_positive_query_rate": len(before_false_positive_queries)
                    / len(negative)
                    if negative
                    else None,
                    "negative_false_positive_result_count": before_false_positive_results,
                    "duplicates_suppressed_before_limit": before_duplicates_suppressed,
                    "distinct_prefix_collisions_in_pool": before_prefix_collisions,
                },
                "after_candidate_pool_full_text_dedup": {
                    "positive_precision_at_5": statistics.mean(p_at_five) if p_at_five else None,
                    "positive_mrr": statistics.mean(reciprocal_ranks)
                    if reciprocal_ranks
                    else None,
                    "positive_missing_evidence_query_rate": len(missing_queries) / len(positive)
                    if positive
                    else None,
                    "positive_missing_expected_passage_count": len(missing_passages),
                    "positive_missing_expected_passage_rate": len(missing_passages)
                    / expected_passage_count
                    if expected_passage_count
                    else None,
                    "negative_false_positive_query_rate": len(false_positive_queries)
                    / len(negative)
                    if negative
                    else None,
                    "negative_false_positive_result_count": false_positive_results,
                    "duplicates_suppressed_from_deeper_pool": equivalent_suppressed,
                    "distinct_prefix_collisions_preserved_in_results": after_prefix_collisions_preserved,
                },
                "positive_queries": len(positive),
                "negative_queries": len(negative),
                "positive_precision_at_5": statistics.mean(p_at_five) if p_at_five else None,
                "positive_mrr": statistics.mean(reciprocal_ranks) if reciprocal_ranks else None,
                "positive_missing_evidence_query_rate": len(missing_queries) / len(positive) if positive else None,
                "positive_missing_evidence_query_ids": missing_queries,
                "positive_missing_expected_passage_count": len(missing_passages),
                "positive_missing_expected_passage_ids": missing_passages,
                "negative_false_positive_query_rate": len(false_positive_queries) / len(negative) if negative else None,
                "negative_false_positive_query_ids": false_positive_queries,
                "negative_false_positive_result_count": false_positive_results,
                "equivalent_duplicates_suppressed": equivalent_suppressed,
                "distinct_prefix_collisions_seen": prefix_collisions,
                "foreign_owner_results": foreign_results,
                "document_page_metadata_mismatches": len(metadata_mismatches),
                "document_page_metadata_mismatch_ids": metadata_mismatches,
                "score_distribution": {
                    "count": len(ordered_scores),
                    "min": ordered_scores[0] if ordered_scores else None,
                    "median": statistics.median(ordered_scores) if ordered_scores else None,
                    "p90": ordered_scores[math.ceil(0.9 * len(ordered_scores)) - 1] if ordered_scores else None,
                    "max": ordered_scores[-1] if ordered_scores else None,
                },
            },
            "queries": per_query,
        }
        if foreign_results or metadata_mismatches:
            raise AssertionError("Local RPC evaluation detected an ownership or provenance mismatch.")
        return results
    finally:
        if document_ids:
            run_psql(f"DELETE FROM auth.users WHERE id IN ('{owner_id}', '{foreign_owner_id}');")


if __name__ == "__main__":
    report = asyncio.run(evaluate_local_rpc())
    print(json.dumps(report, indent=2))