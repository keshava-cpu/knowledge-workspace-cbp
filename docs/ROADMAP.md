# Roadmap

## Milestone 1: Working reading experience

Status: complete for UI demo

- Library, reader, search, notes, login, settings shell
- Dark premium academic interface
- Sample data and clearly marked demo features
- Navigation and responsive layout implemented

## Milestone 2: Document ingestion

Status: local implementation complete; real Docling conversion verification pending

- Library PDF upload and drag/drop with server-side size, MIME and signature validation
- FastAPI proxy to Docling Serve's asynchronous REST API
- Real job state polling and extracted Markdown/structured content reader
- Source-page references exposed when Docling returns provenance
- Job and document state are process-local; uploaded PDF bytes are temporary

## Milestone 3: Retrieval and search

Planned focus:

- Full-text search and embeddings-backed retrieval
- Better ranking and fallback hybrid search
- Result passage cards with citations and page references

## Milestone 4: Research assistant

Planned focus:

- Context-grounded answer generation with citations
- Source highlighting and passage navigation
- Notes linked to document pages

## Milestone 5: Production readiness

Planned focus:

- Authentication, persistence and storage
- Deployment and monitoring
- Quality assurance over ingestion and retrieval accuracy
