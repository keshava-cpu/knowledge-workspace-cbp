import { useMemo } from 'react'
import { ArrowLeft, ArrowUpRight, BookOpenText, FileText, Library } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import { useDocuments } from '../hooks/use-documents'
import { PdfDocumentViewer } from './pdf-document-viewer'

export function ReaderPage() {
  const { documentId: paramDocumentId } = useParams<{ documentId?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { documents, isLoading, error } = useDocuments()

  const completedDocuments = useMemo(
    () => documents.filter((doc) => doc.status === 'completed'),
    [documents],
  )

  // Document resolution:
  // 1. URL path param :documentId
  // 2. URL search param ?documentId=...
  // 3. Fallback to the first completed parsed document
  const queryDocumentId = searchParams.get('documentId') ?? undefined
  const targetId = paramDocumentId || queryDocumentId

  const activeDocument = useMemo(() => {
    if (targetId) {
      return completedDocuments.find((doc) => doc.id === targetId) ?? null
    }
    return completedDocuments[0] ?? null
  }, [completedDocuments, targetId])

  const initialQuery = searchParams.get('q') ?? ''
  const pageParam = searchParams.get('page')
  const initialPage = pageParam ? parseInt(pageParam, 10) : undefined

  // Loading state when documents haven't loaded yet
  if (isLoading && !activeDocument) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-[65vh] w-full rounded-lg" />
      </div>
    )
  }

  // Error loading documents
  if (error && completedDocuments.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild>
            <Link to="/">
              <Library className="mr-2 size-4" />
              Go to Library
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  // Empty state: no completed parsed documents
  if (!isLoading && completedDocuments.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
          <BookOpenText className="size-6" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">No parsed documents</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload a PDF document in your library to read, navigate, and search it in the full PDF
          viewer.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild>
            <Link to="/">
              <Library className="mr-2 size-4" />
              Go to Library
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  // Target document specified but not found among completed documents
  if (targetId && !activeDocument && !isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p role="alert" className="text-sm text-destructive">
          The requested document was not found or is still processing.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" asChild>
            <Link to="/reader">View available documents</Link>
          </Button>
          <Button asChild>
            <Link to="/">
              <ArrowLeft className="mr-2 size-4" />
              Back to Library
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2 sm:px-6 sm:py-3">
      {/* Top toolbar: Back to library, document selector, link to parsed text view */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/70 px-3 py-1.5 backdrop-blur-sm sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Return to library"
          >
            <ArrowLeft className="size-3.5" />
            <span className="hidden xs:inline">Library</span>
          </Link>
          <span className="text-border" aria-hidden="true">
            /
          </span>

          {completedDocuments.length > 1 ? (
            <div className="flex min-w-0 items-center gap-2">
              <label htmlFor="reader-document-select" className="sr-only">
                Select document to read
              </label>
              <select
                id="reader-document-select"
                value={activeDocument?.id ?? ''}
                onChange={(e) => {
                  const newDocId = e.target.value
                  navigate(`/reader/${encodeURIComponent(newDocId)}`)
                }}
                className="h-7 max-w-[200px] truncate rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring sm:max-w-md md:max-w-lg"
              >
                {completedDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title || doc.filename} ({doc.page_count ?? '?'} pages)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {activeDocument?.title || activeDocument?.filename}
              </span>
              {activeDocument?.page_count && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {activeDocument.page_count} pages
                </span>
              )}
            </div>
          )}
        </div>

        {activeDocument && (
          <div className="flex items-center gap-2">
            <Link
              to={`/documents/${encodeURIComponent(activeDocument.id)}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="View extracted markdown and structured blocks for this document"
            >
              <FileText className="size-3.5" />
              <span className="hidden sm:inline">Parsed text</span>
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
        )}
      </div>

      {/* Full-view PDF Viewer */}
      {activeDocument && (
        <div className="w-full">
          <PdfDocumentViewer
            key={activeDocument.id}
            documentId={activeDocument.id}
            initialQuery={initialQuery}
            initialPage={initialPage}
          />
        </div>
      )}
    </div>
  )
}
