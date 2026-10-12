import logging
import re
import threading
import time
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from app.models import ExtractedBlock

logger = logging.getLogger(__name__)
EMBEDDING_DIMENSIONS = 384
CHUNK_TARGET_TOKENS = 220


@dataclass(frozen=True)
class SearchChunk:
    chunk_index: int
    content: str
    page_numbers: list[int]
    location_metadata: list[dict[str, Any]]


def normalize_embedding_text(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def _token_bounded_parts(
    text: str,
    token_count: Callable[[str], int],
    max_tokens: int,
) -> list[str]:
    remaining = text
    parts: list[str] = []
    while remaining:
        if token_count(remaining) <= max_tokens:
            parts.append(remaining)
            break

        words = remaining.split()
        low, high = 1, len(words)
        best_word_count = 0
        if len(words) > 1:
            while low <= high:
                middle = (low + high) // 2
                candidate = " ".join(words[:middle])
                if token_count(candidate) <= max_tokens:
                    best_word_count = middle
                    low = middle + 1
                else:
                    high = middle - 1

        if best_word_count:
            part = " ".join(words[:best_word_count])
            remaining = " ".join(words[best_word_count:])
        else:
            low, high = 1, len(remaining)
            best_length = 0
            while low <= high:
                middle = (low + high) // 2
                if token_count(remaining[:middle]) <= max_tokens:
                    best_length = middle
                    low = middle + 1
                else:
                    high = middle - 1
            if not best_length:
                raise ValueError("A single text fragment exceeds the model token limit.")
            part = remaining[:best_length].strip()
            remaining = remaining[best_length:].strip()

        if not part:
            raise ValueError("Could not split text within the model token limit.")
        parts.append(part)

    return parts


def chunk_blocks(
    blocks: Iterable[ExtractedBlock],
    token_count: Callable[[str], int],
    max_tokens: int,
) -> list[SearchChunk]:
    if max_tokens < 1:
        raise ValueError("max_tokens must be positive.")

    chunks: list[SearchChunk] = []
    for block in blocks:
        text = normalize_embedding_text(block.text)
        if not text:
            continue
        parts = _token_bounded_parts(text, token_count, min(max_tokens, CHUNK_TARGET_TOKENS))
        for part in parts:
            if token_count(part) > max_tokens:
                raise ValueError("Generated chunk exceeds the model token limit.")
            chunks.append(
                SearchChunk(
                    chunk_index=len(chunks),
                    content=part,
                    page_numbers=sorted(set(block.page_numbers)),
                    location_metadata=block.location_metadata,
                )
            )
    return chunks


class EmbeddingService:
    """One process-local ONNX model instance with bounded query-embedding cache."""

    def __init__(
        self,
        model_name: str,
        max_tokens: int,
        batch_size: int,
        model_factory: Callable[[str], Any] | None = None,
        cache_size: int = 256,
    ) -> None:
        if not model_name.strip():
            raise ValueError("The embedding model name cannot be empty.")
        if not 1 <= max_tokens <= 256:
            raise ValueError("All-MiniLM-L6-v2 accepts at most 256 input tokens.")
        if batch_size < 1:
            raise ValueError("Embedding batch size must be positive.")
        self.model_name = model_name
        self.max_tokens = max_tokens
        self.batch_size = batch_size
        self.cache_size = cache_size
        self._model_factory = model_factory or self._create_model
        self._model: Any | None = None
        self._model_lock = threading.Lock()
        self._cache_lock = threading.Lock()
        self._query_cache: OrderedDict[str, list[float]] = OrderedDict()

    @staticmethod
    def _create_model(model_name: str) -> Any:
        from fastembed import TextEmbedding

        return TextEmbedding(model_name=model_name)

    def _get_model(self) -> Any:
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    started = time.perf_counter()
                    model = self._model_factory(self.model_name)
                    dimensions = getattr(model, "embedding_size", EMBEDDING_DIMENSIONS)
                    if dimensions != EMBEDDING_DIMENSIONS:
                        raise ValueError(
                            f"Configured model returns {dimensions} dimensions; "
                            f"the database requires {EMBEDDING_DIMENSIONS}."
                        )
                    self._model = model
                    logger.info(
                        "Embedding model loaded model=%s dimensions=%d load_seconds=%.3f",
                        self.model_name,
                        dimensions,
                        time.perf_counter() - started,
                    )
        return self._model

    def warmup(self) -> None:
        self._get_model()

    def count_tokens(self, text: str) -> int:
        return int(self._get_model().token_count(normalize_embedding_text(text)))

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        normalized = [normalize_embedding_text(text) for text in texts]
        if any(not text for text in normalized):
            raise ValueError("Embedding input cannot be empty.")
        if any(self.count_tokens(text) > self.max_tokens for text in normalized):
            raise ValueError("Document chunk exceeds the configured model token limit.")
        vectors = self._get_model().embed(normalized, batch_size=self.batch_size)
        return self._validated_vectors(vectors, len(normalized))

    def embed_query(self, query: str) -> list[float]:
        started = time.perf_counter()
        normalized = normalize_embedding_text(query)
        if not normalized:
            raise ValueError("Search query cannot be empty.")
        if self.count_tokens(normalized) > self.max_tokens:
            raise ValueError("Search query exceeds the configured model token limit.")
        with self._cache_lock:
            cached = self._query_cache.get(normalized)
            if cached is not None:
                self._query_cache.move_to_end(normalized)
        if cached is not None:
            logger.info(
                "query_embedding cache=hit model=%s warm_query_seconds=%.3f",
                self.model_name,
                time.perf_counter() - started,
            )
            return cached

        vector = self._validated_vectors(
            self._get_model().embed([normalized], batch_size=1), 1
        )[0]
        if self.cache_size:
            with self._cache_lock:
                self._query_cache[normalized] = vector
                self._query_cache.move_to_end(normalized)
                while len(self._query_cache) > self.cache_size:
                    self._query_cache.popitem(last=False)
        logger.info(
            "query_embedding cache=miss model=%s warm_query_seconds=%.3f",
            self.model_name,
            time.perf_counter() - started,
        )
        return vector

    @staticmethod
    def _validated_vectors(vectors: Iterable[Any], expected_count: int) -> list[list[float]]:
        result = [[float(value) for value in vector] for vector in vectors]
        if len(result) != expected_count or any(
            len(vector) != EMBEDDING_DIMENSIONS for vector in result
        ):
            raise ValueError("Embedding model returned an unexpected vector shape.")
        return result