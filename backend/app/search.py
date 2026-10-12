import asyncio
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass

from app.embeddings import EmbeddingService, normalize_embedding_text
from app.models import SearchResult
from app.store import InMemoryStore, SupabaseStore

logger = logging.getLogger(__name__)


@dataclass
class SearchCacheEntry:
    expires_at: float
    results: list[SearchResult]


class SearchService:
    def __init__(
        self,
        embeddings: EmbeddingService,
        ttl_seconds: float = 30,
        cache_size: int = 256,
        candidate_limit: int = 80,
    ) -> None:
        self.embeddings = embeddings
        self.ttl_seconds = ttl_seconds
        self.cache_size = cache_size
        self.candidate_limit = candidate_limit
        self._cache: OrderedDict[tuple[str, str, str | None, int], SearchCacheEntry] = (
            OrderedDict()
        )

    async def search(
        self,
        store: InMemoryStore | SupabaseStore,
        owner_id: str,
        query: str,
        document_id: str | None,
        limit: int,
        access_token: str | None,
    ) -> list[SearchResult]:
        normalized_query = normalize_embedding_text(query)
        cache_key = (owner_id, normalized_query.casefold(), document_id, limit)
        now = time.monotonic()
        cached = self._cache.get(cache_key)
        if cached and cached.expires_at > now:
            self._cache.move_to_end(cache_key)
            logger.info("search_result_cache hit owner=%s", owner_id)
            return cached.results
        if cached:
            del self._cache[cache_key]

        started = time.perf_counter()
        query_embedding = await asyncio.to_thread(self.embeddings.embed_query, normalized_query)
        if isinstance(store, SupabaseStore):
            if not access_token:
                raise ValueError("Verified Supabase access token is unavailable.")
            results = await store.hybrid_search(
                owner_id,
                normalized_query,
                query_embedding,
                self.embeddings.model_name,
                document_id,
                limit,
                self.candidate_limit,
                access_token,
            )
        else:
            results = store.hybrid_search(
                owner_id,
                normalized_query,
                query_embedding,
                self.embeddings.model_name,
                document_id,
                limit,
                self.candidate_limit,
            )

        if self.cache_size:
            self._cache[cache_key] = SearchCacheEntry(
                expires_at=now + self.ttl_seconds,
                results=results,
            )
            self._cache.move_to_end(cache_key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)

        logger.info(
            "hybrid_search complete mode=%s limit=%d result_count=%d api_seconds=%.3f",
            "document" if document_id else "user",
            limit,
            len(results),
            time.perf_counter() - started,
        )
        return results

    def invalidate_owner(self, owner_id: str) -> None:
        for key in [key for key in self._cache if key[0] == owner_id]:
            del self._cache[key]