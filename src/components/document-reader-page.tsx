import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, Download, FileText, Info } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Skeleton } from '../../components/ui/skeleton'
import { PdfDocumentViewer } from './pdf-document-viewer'
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
  const [searchParams] = useSearchParams()
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
          Extracted document text
        </div>
        <h2 className="mt-3 break-words text-3xl font-semibold text-white">{document.title}</h2>
        <p className="mt-2 break-all text-sm text-zinc-400">{document.filename}</p>
        <p className="mt-4 max-w-3xl text-xs leading-5 text-zinc-500">
          This view presents text and structure extracted from the PDF. It is not a rendered PDF.
          Source-page references are shown where Docling provides them.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div
            className="flex items-center gap-1 rounded-md border border-border bg-muted p-1"
            role="group"
            aria-label="Document actions"
          >
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
          </dl>
        </DialogContent>
      </Dialog>

      <PdfDocumentViewer
        documentId={loadedDocument.id}
        initialQuery={searchParams.get('q') ?? ''}
      />

      {document.content?.blocks.length ? (
        <article className="mx-auto max-w-4xl py-8">
          <Tabs defaultValue="text">
            <TabsList className="mb-6">
              <TabsTrigger value="text">Structured text</TabsTrigger>
              <TabsTrigger value="markdown">Markdown</TabsTrigger>
              <TabsTrigger value="structure">Structure JSON</TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="space-y-8">
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
                        <h3
                          key={`${page}-${index}`}
                          className="text-xl font-semibold text-zinc-100"
                        >
                          {block.text}
                        </h3>
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
            </TabsContent>
            <TabsContent value="markdown">
              <Card>
                <CardHeader>
                  <CardTitle>Full extracted Markdown</CardTitle>
                  <CardDescription>The Markdown returned by Docling.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto whitespace-pre-wrap font-sans text-sm leading-6 text-zinc-400">
                    {document.content.markdown}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="structure">
              <Card>
                <CardHeader>
                  <CardTitle>Structured extraction</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-400">
                    {JSON.stringify(document.content.structured_json, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </article>
      ) : document.content?.markdown ? (
        <article className="mx-auto max-w-3xl py-8">
          <h3 className="mb-4 text-xs uppercase tracking-[0.18em] text-zinc-500">
            Extracted Markdown
          </h3>
          <pre className="overflow-x-auto whitespace-pre-wrap font-sans text-[15px] leading-7 text-zinc-300">
            {document.content.markdown}
          </pre>
        </article>
      ) : (
        <p className="mt-8 text-sm text-zinc-400">
          No extracted text was returned for this document.
        </p>
      )}
    </main>
  )
}
