# Product specification

## Vision

Knowledge Workspace is a research-focused reading and retrieval environment for students and researchers. The product helps users work with books, lecture notes, scans and article PDFs in a single workspace without forcing them to rely on a generic document organizer.

## Goals for the first milestone

- Build a premium reading experience with strong information density and calm dark-theme composition.
- Add library, reader, search, notes, login and settings screens using sample data only.
- Keep the product clearly labelled as a demo so future AI features are not misrepresented as already working.
- Prepare the UI for future Supabase integration, document ingestion, embeddings, and document-grounded question answering.

## Current ingestion scope

- Upload PDFs from the Library and convert them through the Docling Serve HTTP API via FastAPI.
- Show actual queued, processing, completed and failed job states and expose returned Markdown and structured content.
- Preserve headings and source-page provenance when Docling provides it.
- Keep job and document records in process memory for this local milestone; no durable storage is promised.

## Core user flows

1. Open the library to browse documents and upload a new file.
2. Read content in a structured document viewer with a table of contents and contextual assistant panel.
3. Search across sample materials using natural-language queries and filter by document type.
4. Capture notes in the BlockNote rich-text editor.
5. Sign in or register in a layout prepared for future auth integration.
6. Adjust workspace preferences without leaving the core reading flow.

## Current non-goals

- Durable document storage or cross-session persistence.
- Real semantic search or vector retrieval.
- Real auth, database storage or file hosting.
- Real assistant chat or document-grounded model inference.
- A separate handwritten-OCR pipeline.

Screens other than the Library ingestion flow still use demonstration data and clearly labelled placeholders.
