import json
from pathlib import Path

from app.embeddings import EMBEDDING_DIMENSIONS

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "search_evaluation.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def passages_by_id(fixture: dict) -> dict[str, tuple[dict, dict]]:
    return {
        passage["id"]: (document, passage)
        for document in fixture["documents"]
        for passage in document["passages"]
    }


def test_fixture_has_evidence_backed_positive_labels() -> None:
    fixture = load_fixture()
    passages = passages_by_id(fixture)

    for query in fixture["queries"]:
        for expected in query["expected"]:
            document, passage = passages[expected["passage_id"]]
            assert document["id"]
            assert passage["page_numbers"]
            assert expected["evidence"].casefold() in passage["text"].casefold()


def test_negative_queries_name_terms_absent_from_entire_fixture() -> None:
    fixture = load_fixture()
    corpus_text = " ".join(
        passage["text"]
        for document in fixture["documents"]
        for passage in document["passages"]
    ).casefold()
    negatives = [query for query in fixture["queries"] if not query["expected"]]

    assert negatives
    for query in negatives:
        assert query["must_be_absent"]
        for absent_term in query["must_be_absent"]:
            assert absent_term.casefold() not in corpus_text


def test_fixture_covers_search_query_shapes_and_preserves_model_identity() -> None:
    fixture = load_fixture()
    kinds = {query["kind"] for query in fixture["queries"]}
    covered_documents = {
        passages_by_id(fixture)[expected["passage_id"]][0]["id"]
        for query in fixture["queries"]
        for expected in query["expected"]
    }

    assert fixture["model"] == "sentence-transformers/all-MiniLM-L6-v2"
    assert fixture["embedding_dimensions"] == EMBEDDING_DIMENSIONS == 384
    assert {
        "exact_terms",
        "exact_algorithm_term",
        "paraphrase",
        "paraphrase_question",
        "multi_passage_question",
        "broad_underspecified",
        "related_not_covered",
        "unrelated_negative",
    } <= kinds
    assert len(covered_documents) >= 4


def test_duplicate_passage_is_explicitly_identified() -> None:
    fixture = load_fixture()
    passages = passages_by_id(fixture)
    duplicate = passages["mesi-invalidation-copy"][1]

    assert duplicate["duplicate_of"] == "mesi-invalidation"
    assert duplicate["text"] == passages["mesi-invalidation"][1]["text"]

