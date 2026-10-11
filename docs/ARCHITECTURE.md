# Architecture

## Frontend
- React + TypeScript + Vite
- Tailwind CSS with shadcn-style primitives and the current project tokens
- React Router for application navigation
- Lucide icons for product UI

## App structure
- Shared shell with collapsible sidebar and top bar
- Feature-level screens under the main app routes
- Sample data isolated from the UI for easier future API replacement

## Future backend
The first milestone intentionally keeps the UI independent from backend services. The architecture is designed so future services can plug into the same user flows:

- Supabase Auth for identity
- Supabase Postgres for metadata and saved notes
- Storage bucket for uploaded PDFs and book assets
- Python + FastAPI service for document processing and ingestion
- Docling or Docling Serve for parsing and extraction
- PostgreSQL pgvector plus full-text search for retrieval

## Data flow
1. User uploads a book or PDF in the library.
2. A backend worker stores the file and extracts text and metadata.
3. Search and reader screens query indexes and enriched content.
4. Notes remain in the application layer until persistence is added.
5. Future AI features consume retrieved passages instead of the raw document store directly.

## Technical decisions
- Authentication and storage remain external to the frontend.
- Document processing remains replaceable and provider-agnostic.
- Retrieval is intentionally separated from the UI by using structured sample results and future API contracts.
