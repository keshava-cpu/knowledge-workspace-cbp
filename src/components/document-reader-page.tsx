import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpenText, Copy, Download, FileText, Info } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Skeleton } from '../../components/ui/skeleton'
import { getDocument, type DocumentDetail, type ExtractedBlock } from '../lib/documents-api'

function groupBlocksByPage(document: DocumentDetail) {
  const groups = new Map<string, ExtractedBlock[]>()
  for (const block of document.content?.blocks ?? []) {
    const key = block.page_numbers.length ? block.page_numbers.join(', ') : 'Unreferenced'
    groups.set(key, [...(groups.get(key) ?? []), block])
  }
  return [...groups.entries()]
}

interface LoadState {
  documentId: string | null
  document: DocumentDetail | null
  error: string | null
}

export function DocumentReaderPage() {
  const { documentId } = useParams()
  const [state, setState] = useState<LoadState>({
    documentId: null,
    document: null,
    error: null,
  })
  const [showInfo, setShowInfo] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    if (!documentId) return
    const controller = new AbortController()

    getDocument(documentId, controller.signal)
      .then((document) => setState({ documentId, document, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Could not load this document.'
        setState({ documentId, document: null, error: message })
      })

    return () => controller.abort()
  }, [documentId])

  const document = state.documentId === documentId ? state.document : null
  const error = state.documentId === documentId ? state.error : null

  if (!document && !error) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="space-y-4 border-t border-border pt-8">
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      </div>
    )
  }

  if (error || !document) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Library
        </Link>
        <p role="alert" className="mt-6 border-l-2 border-rose-400/50 pl-3 text-rose-200">
          {error ?? 'Document not found.'}
        </p>
      </div>
    )
  }

  const loadedDocument = document
  const extractedText =
    loadedDocument.content?.blocks.map((block) => block.text).join('\n\n') ||
    loadedDocument.content?.markdown ||
    ''

  async function copyExtractedText() {
    if (!extractedText) return
    await navigator.clipboard.writeText(extractedText)
    setActionMessage('Extracted text copied')
    window.setTimeout(() => setActionMessage(''), 1800)
  }

  function downloadMarkdown() {
    if (!loadedDocument.content?.markdown) return
    const blob = new Blob([loadedDocument.content.markdown], {
      type: 'text/markdown;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${loadedDocument.title || 'document'}.md`
    anchor.click()
    URL.revokeObjectURL(url)
    setActionMessage('Markdown download started')
    window.setTimeout(() => setActionMessage(''), 1800)
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Library
      </Link>

      <header className="mt-7 border-b border-white/10 pb-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-emerald-300">
          <FileText className="h-4 w-4" />
          Parsed document
        </div>
        <h2 className="mt-3 break-words text-3xl font-semibold text-white">{document.title}</h2>
        <p className="mt-2 break-all text-sm text-zinc-400">{document.filename}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Document actions"
          >
            <Button
              variant="default"
              size="sm"
              asChild
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow"
            >
              <Link to={`/reader/${encodeURIComponent(loadedDocument.id)}`}>
                <BookOpenText className="mr-1.5 size-4" />
                Open in PDF Reader
              </Link>
            </Button>
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copyExtractedText()}
                disabled={!extractedText}
              >
                <Copy />
                Copy text
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadMarkdown}
                disabled={!document.content?.markdown}
              >
                <Download />
                Download Markdown
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowInfo(true)}
                aria-label="Show document information"
                title="Document information"
              >
                <Info />
              </Button>
            </div>
          </div>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {actionMessage}
          </span>
        </div>
      </header>

      <Dialog open={showInfo} onOpenChange={setShowInfo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Document information</DialogTitle>
            <DialogDescription>Metadata recorded for this extracted document.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Filename</dt>
            <dd className="break-all text-right">{document.filename}</dd>
            <dt className="text-muted-foreground">File size</dt>
            <dd className="text-right">{document.size_bytes.toLocaleString()} bytes</dd>
            <dt className="text-muted-foreground">Pages</dt>
            <dd className="text-right">{document.page_count ?? 'Not available'}</dd>
            <dt className="text-muted-foreground">Parse time</dt>
            <dd className="text-right">
              {document.processing_seconds === null
                ? 'Not available'
                : `${document.processing_seconds.toFixed(1)} seconds`}
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-right capitalize">{document.status}</dd>
            <dt className="text-muted-foreground">Indexed chunks</dt>
            <dd className="text-right">{document.indexed_chunks}</dd>
          </dl>
        </DialogContent>
      </Dialog>

      {/* Structured text extracted by Docling — available for export and copy.
          The PDF viewer has been moved to the dedicated Reader page for full view. */}
      {document.content?.blocks.length ? (
        <article className="mx-auto max-w-4xl py-8" aria-label="Extracted text">
          <h3 className="mb-6 text-xs font-medium uppercase tracking-[0.18em] text-indigo-300">
            Extracted text (by page)
          </h3>
          <div className="space-y-8">
            {groupBlocksByPage(document).map(([page, blocks]) => (
              <section key={page} className="border-l-2 border-indigo-400/40 pl-5">
                <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-indigo-300">
                  {page === 'Unreferenced'
                    ? page
                    : `Source page${page.includes(',') ? 's' : ''} ${page}`}
                </p>
                <div className="space-y-5">
                  {blocks.map((block, index) =>
                    block.kind === 'heading' ? (
                      <h4 key={`${page}-${index}`} className="text-xl font-semibold text-zinc-100">
                        {block.text}
                      </h4>
                    ) : (
                      <p
                        key={`${page}-${index}`}
                        className="whitespace-pre-wrap text-[15px] leading-7 text-zinc-300"
                      >
                        {block.text}
                      </p>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </article>
      ) : document.content?.markdown ? (
        <article className="mx-auto max-w-3xl py-8">
          <div className="border border-white/10 bg-white/[0.02] p-6">
            <pre className="whitespace-pre-wrap text-sm text-zinc-300">
              {document.content.markdown}
            </pre>
          </div>
        </article>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          This document does not contain extracted blocks or text yet.
        </p>
      )}
    </main>
  )
}
