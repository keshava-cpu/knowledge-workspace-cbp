# Architecture

## Frontend

- React + TypeScript + Vite
- Tailwind CSS with shadcn-style primitives and the current project tokens
- React Router for application navigation
- Lucide icons for product UI
- Typed document API client uses same-origin `/api` requests; Vite proxies these to FastAPI during local development.

## Ingestion service

- FastAPI lives in `backend/` and owns upload validation, temporary disk staging, Docling Serve credentials, async polling and result normalization.
- The service calls the official Docling Serve v1 HTTP API: `/v1/convert/file/async`, `/v1/status/poll/{task_id}` and `/v1/result/{task_id}`.
- `DOCLING_SERVE_URL` and optional `DOCLING_SERVE_API_KEY` are backend-only configuration.
- `DocumentRecord` stores metadata/results separately from `JobRecord` processing state. Both are currently process-local memory only.
- The versioned Supabase migration defines durable `documents`, `processing_jobs` and `document_extractions` records plus a private user-scoped PDF bucket. When `SUPABASE_PERSISTENCE_ENABLED=true`, FastAPI accesses them through PostgREST and Storage with the verified user's bearer token.
- Uploaded PDF bytes are streamed in bounded chunks to a temporary file and removed after Docling accepts the async conversion task.
- Extracted content returns Markdown, the source structured JSON when available, and normalized ordered blocks with headings/text and page provenance.

## App structure

- Shared shell with collapsible sidebar and top bar
- Feature-level screens under the main app routes
- Sample data isolated from the UI for easier future API replacement

## Future backend work

The ingestion service is an initial local integration, not production persistence. Future services can plug into the same user flows:

- Supabase Auth for identity
- Supabase Postgres for metadata and saved notes
- Storage bucket for uploaded PDFs and book assets
- Durable metadata and job storage for the current FastAPI service
- Object storage for uploaded PDFs and large conversion artifacts
- Docling Serve remains the extraction provider
- PostgreSQL pgvector plus full-text search for retrieval

## Data flow

1. User uploads a PDF through the Library to FastAPI.
2. FastAPI validates and temporarily stages the PDF, then submits it to Docling Serve's async file conversion endpoint.
3. FastAPI polls Docling Serve, fetches the completed result and exposes text, structure and source-page references.
4. The current in-memory API records feed the Library and extracted-text reader until the FastAPI process exits.
5. Future durable storage and indexing can consume the normalized blocks without coupling React to Docling's response internals.

## Technical decisions

- Authentication and optional durable document storage are implemented through Supabase Auth, PostgREST, Storage, and RLS.
- The Docling Serve adapter is isolated from React and can be replaced behind the FastAPI API contract.
- Retrieval is intentionally separated from the UI by using structured sample results and future API contracts.
