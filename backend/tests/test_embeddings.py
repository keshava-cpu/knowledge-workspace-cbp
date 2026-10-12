from app.embeddings import EmbeddingService, chunk_blocks, normalize_embedding_text
from app.models import ExtractedBlock


class FakeEmbeddingModel:
    embedding_size = 384

    def token_count(self, text: str) -> int:
        return len(text.split())

    def embed(self, texts: list[str], batch_size: int = 32):
        return [[0.0] * self.embedding_size for _ in texts]


def test_chunk_blocks_preserves_pages_and_enforces_token_limit() -> None:
    block = ExtractedBlock(
        kind="text",
        text=" ".join(f"word{index}" for index in range(510)),
        page_numbers=[4, 3, 4],
    )

    chunks = chunk_blocks([block], lambda text: len(text.split()), max_tokens=256)

    assert len(chunks) == 3
    assert [chunk.chunk_index for chunk in chunks] == [0, 1, 2]
    assert all(len(chunk.content.split()) <= 220 for chunk in chunks)
    assert all(chunk.page_numbers == [3, 4] for chunk in chunks)
    assert " ".join(chunk.content for chunk in chunks) == block.text


def test_unbroken_text_is_split_without_silent_truncation() -> None:
    text = "x" * 900
    chunks = chunk_blocks(
        [ExtractedBlock(kind="text", text=text, page_numbers=[1])],
        lambda value: len(value),
        max_tokens=180,
    )

    assert len(chunks) == 5
    assert "".join(chunk.content for chunk in chunks) == text
    assert all(len(chunk.content) <= 180 for chunk in chunks)


def test_embedding_service_uses_one_model_and_caches_queries() -> None:
    model = FakeEmbeddingModel()
    loaded: list[str] = []
    service = EmbeddingService(
        "test/model",
        max_tokens=32,
        batch_size=4,
        model_factory=lambda name: loaded.append(name) or model,
    )

    first = service.embed_query("  retrieve   a passage ")
    second = service.embed_query("retrieve a passage")

    assert loaded == ["test/model"]
    assert first is second
    assert normalize_embedding_text("  retrieve\n a passage ") == "retrieve a passage"