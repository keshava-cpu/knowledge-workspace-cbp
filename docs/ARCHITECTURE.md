# Architecture

## Frontend

- React + TypeScript + Vite
- Tailwind CSS with shadcn-style primitives and the current project tokens
- React Router for application navigation
- Lucide icons for product UI
- Typed document API client uses same-origin `/api` requests; Vite proxies these to FastAPI during local development.
- The document route lazy-loads EmbedPDF `2.15.1` (stable v2, MIT) and PDFium WASM. Its virtualized continuous scroller renders the original PDF bytes; search results live in a separate side panel and a separate minimap rail. Search never adds marks, overlays or annotations to PDF pages.
- The marker rail uses EmbedPDF virtual page offsets and page dimensions, normalized against the full document extent. This accounts for mixed page sizes and zoom. MVP markers are page-level; within-page positions are used only where Docling provenance and viewer metadata can be mapped reliably.

## Ingestion service

- FastAPI lives in `backend/` and owns upload validation, temporary disk staging, Docling Serve credentials, async polling and result normalization.
- The service calls the official Docling Serve v1 HTTP API: `/v1/convert/file/async`, `/v1/status/poll/{task_id}` and `/v1/result/{task_id}`.
- `DOCLING_SERVE_URL` and optional `DOCLING_SERVE_API_KEY` are backend-only configuration.
- The versioned Supabase migrations define durable `documents`, `processing_jobs`, `document_extractions`, `document_chunks`, and a private user-scoped PDF bucket. When `SUPABASE_PERSISTENCE_ENABLED=true`, FastAPI accesses them through PostgREST and Storage with the verified user's bearer token. The in-memory store remains for tests and local development without persistence.
- Uploaded PDF bytes are streamed in bounded chunks to a temporary file and removed after Docling accepts the async conversion task.
- The original upload is retained unchanged in private Storage (or a private temporary file in in-memory mode) and is served only through the authenticated owner-scoped PDF endpoint.
- Extracted content returns Markdown, source structured JSON when available, normalized blocks, page numbers, and the raw Docling element provenance.

## Indexing and retrieval

- After successful Docling conversion, blocks are normalized and token-counted, then split into chunks targeting 220 tokens and capped at the configurable model limit (default 256). A single FastEmbed ONNX `TextEmbedding` instance for `sentence-transformers/all-MiniLM-L6-v2` is loaded per backend process; chunks are encoded in batches on worker threads. Query encoding also runs off the FastAPI event loop.
- The configured embedding model name is stored with every vector. This database schema is intentionally fixed to 384 dimensions for All-MiniLM-L6-v2; configuring a model with another output size fails rather than storing incompatible vectors. Indexing progress, failures and completion are persisted on `documents`; upserts are keyed by `(document_id, chunk_index)`, and a retry reuses matching stored chunks instead of embedding them again.
- `document_chunks` has a pgvector HNSW cosine index and a generated English `tsvector` with a GIN index. Table RLS ties every chunk to `auth.uid()` and its matching document owner. The authenticated-only `search_document_chunks` RPC supports user-wide and document-scoped modes and bounds the response to 20 results and each candidate set to 100. It is a hardened `SECURITY DEFINER` function because PostgreSQL's RLS security barrier prevented the GIN plan in the measured query; the function takes no owner argument, scopes every candidate and final row to `auth.uid()`, matches the document owner, sets an empty search path, and revokes execution from `public` and `anon`. RLS remains enabled for direct table access.
- If HNSW yields fewer candidates than requested after owner/document filtering, the RPC fills the remainder by exact distance over only that caller's B-tree-scoped rows. This prevents a global HNSW graph from starving small tenants.
- Retrieval combines semantic nearest-neighbor ranks, exact phrase ranks (`phraseto_tsquery`) and full-text ranks (`websearch_to_tsquery`) using reciprocal-rank fusion with constant $k=60$: each candidate contributes $1/(60 + rank)$ per retrieval method. The output includes rank, fusion score, methods, excerpt, source document, page numbers, and available Docling location metadata. No generative model or answer synthesis is used.
- Query embeddings use the same model and normalized text as indexing, are cached in a bounded process-local LRU, and result lists are cached briefly per user/query/scope. Upload, delete and reindex operations invalidate that user's search-result cache.
- Authenticated `POST /api/indexing/backfill?limit=N` schedules at most 20 already-extracted documents per call. Supabase extraction rows are fetched in one batch; indexing resumes by skipping matching persisted chunks.

## Measurements

These are local synthetic measurements, not representative user-document results or a production benchmark:

- FastEmbed model load including the initial model download: 30.236 s.
- Cached model initialization in the backend Python 3.12 runtime: 0.228 s. Warm single-query embedding, 10-token query: median 2.020 ms (10 runs; minimum 1.750 ms).
- Batch embedding/index preparation, 5,000 synthetic passages, batch size 32: 13.362 s in the backend Python 3.12 runtime; vectors were 384-dimensional.
- FastAPI TestClient with in-memory retrieval, warm model and growing collections: cold exact/semantic requests took 15.640/13.138 ms at 64 chunks, 10.465/12.249 ms at 500 chunks, and 12.197/9.189 ms at 5,000 chunks. Repeated user/query/scope result-cache hits took 2.752/3.043 ms, 2.629/2.647 ms, and 2.985/1.920 ms respectively; each returned 10 results. “Cold” here means query/result caches cleared, not model startup or a cold process.
- PostgreSQL 17 + pgvector 0.8.7, synthetic 5,000-chunk nearest-neighbor query: HNSW index scan returned 80 candidates in 0.306 ms.
- PostgreSQL with 35,001 synthetic chunks: GIN bitmap index scan for a rare phrase took 0.090 ms. The planner used a sequential scan at only 5,001 rows, so index choice depends on table size/selectivity.
- Full hybrid SQL RPC over 35,001 synthetic chunks returned 10 results in 2.530 ms for an exact phrase and 1.732 ms for a semantic-only query (PostgreSQL `EXPLAIN ANALYZE`, warm local fixture). Fresh index counters showed both HNSW and GIN scans during these RPC calls. These are database timings, not end-to-end FastAPI/PostgREST API latency.
- EmbedPDF v2 mixed-size, four-page control PDF: first page rendered 279 ms after the original Blob was ready; marker jump at 89% zoom settled in 1.100 s. A separate two-page fixture at 612x792 and 400x900 points verified page-size scaling and manual-scroll synchronization.

The first model load includes network download; later process startup uses the cached ONNX files. FastEmbed 0.9.0/ONNX Runtime 1.31 was used for the backend Python 3.12 measurements. The FastAPI TestClient timings use the in-memory store, not Supabase. End-to-end FastAPI/PostgREST latency, real-document indexing duration, and a production Supabase query plan remain unmeasured because no connected Supabase database or representative PDF collection was available.

## App structure

- Shared shell with collapsible sidebar and top bar
- Feature-level screens under the main app routes
- Sample data isolated from the UI for easier future API replacement

## Data flow

1. User uploads a PDF through the Library to FastAPI.
2. FastAPI validates and temporarily stages the PDF, then submits it to Docling Serve's async file conversion endpoint.
3. FastAPI polls Docling Serve, persists the extraction, and queues resumable chunking/embedding work.
4. FastEmbed encodes bounded batches, persists vectors and provenance, and updates indexing progress.
5. Authenticated search makes one query embedding and one bounded hybrid-search RPC call; ranked excerpts flow to the search screen and the separate reader rail/panel.
6. The PDF reader loads the unchanged owner-scoped PDF bytes and uses EmbedPDF page navigation and virtual-layout data for marker placement.

## Technical decisions

- Authentication and optional durable document storage are implemented through Supabase Auth, PostgREST, Storage, and RLS.
- The Docling Serve adapter is isolated from React and can be replaced behind the FastAPI API contract.
- Retrieval does not generate answers; the later FreeLLMAPI integration remains a separate milestone.
