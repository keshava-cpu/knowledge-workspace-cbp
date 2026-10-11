import { ArrowUpRight, Clock3, FileText, Info, LoaderCircle, Trash2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Progress } from '../../components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip'
import type { DocumentSummary } from '../lib/documents-api'

const statusStyles: Record<DocumentSummary['status'], string> = {
  queued: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
  processing: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  completed: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  failed: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  cancelled: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-300',
}

const statusLabels: Record<DocumentSummary['status'], string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(date: string): string {
  const timestamp = Date.parse(date)
  if (Number.isNaN(timestamp)) return 'Recently added'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp)
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Still processing'
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

interface DocumentCardProps {
  document: DocumentSummary
  onCancel: (document: DocumentSummary) => Promise<void>
  onDelete: (document: DocumentSummary) => Promise<void>
}

export function DocumentCard({ document, onCancel, onDelete }: DocumentCardProps) {
  const isActive = document.status === 'queued' || document.status === 'processing'
  const [isBusy, setIsBusy] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!isActive) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isActive])

  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(document.created_at)) / 1000))
  const elapsed = `${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, '0')}s`

  async function runAction(action: () => Promise<void>) {
    setIsBusy(true)
    try {
      await action()
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card className="border-white/10 bg-[#10151c] py-0 transition-colors hover:border-indigo-400/35">
      <CardHeader className="p-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="border border-white/10 bg-zinc-800/70 p-2 text-indigo-300">
            <FileText className="h-4 w-4" />
          </div>
          <span
            className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${statusStyles[document.status]}`}
          >
            {isActive && <LoaderCircle className="h-3 w-3 animate-spin" />}
            {statusLabels[document.status]}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.16em] text-zinc-500">
          <span>PDF</span>
          <span>{formatSize(document.size_bytes)}</span>
          <span>
            {document.page_count !== null ? `${document.page_count} pages` : 'Pages pending'}
          </span>
        </div>

        <h3 className="break-words text-lg font-medium text-white">{document.title}</h3>
        <p className="break-all text-xs text-zinc-500">{document.filename}</p>
        <p className="text-sm text-zinc-400">Added {formatDate(document.created_at)}</p>
      </CardHeader>

      <CardContent className="px-4 pb-0">
        {document.error_message && (
          <p role="alert" className="mt-3 border-l-2 border-rose-400/50 pl-3 text-sm text-rose-200">
            {document.error_message}
          </p>
        )}

        {isActive && (
          <div className="mt-4 border border-amber-400/15 bg-amber-400/[0.04] p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-amber-100/80">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-3.5 w-3.5" />
                Parsing for {elapsed}
              </span>
              <span>Page count pending</span>
            </div>
            <Progress
              value={35}
              className="h-1 bg-white/10 [&>div]:animate-[progress_1.6s_ease-in-out_infinite] [&>div]:bg-amber-300"
              aria-label="Parsing in progress"
            />
            <p className="mt-2 text-[11px] leading-4 text-zinc-500">
              Docling reports completion only; it does not expose page-level progress.
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="mt-5 flex items-center justify-between border-t border-white/5 p-4">
        <span className="text-xs text-zinc-500">
          {document.status === 'completed'
            ? 'Extracted text available'
            : document.status === 'failed'
              ? 'Conversion did not complete'
              : document.status === 'cancelled'
                ? 'Parsing stopped; no partial checkpoint was returned'
                : 'Waiting for Docling Serve'}
        </span>
        <div className="flex items-center gap-1">
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => void runAction(() => onCancel(document))}
              aria-label="Cancel parsing"
              title="Cancel parsing"
            >
              <XCircle />
              Cancel
            </Button>
          )}
          {document.status === 'completed' && (
            <Link
              to={`/documents/${encodeURIComponent(document.id)}`}
              className="inline-flex items-center gap-2 py-1 text-sm text-indigo-300 hover:text-indigo-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-300"
            >
              View text
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowMetadata(true)}
                  aria-label="View document metadata"
                >
                  <Info />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View metadata</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isBusy}
            onClick={() => {
              setShowDeleteDialog(true)
            }}
            aria-label="Delete document"
            title="Delete document"
          >
            <Trash2 />
          </Button>
        </div>
      </CardFooter>

      <Dialog open={showMetadata} onOpenChange={setShowMetadata}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Document metadata</DialogTitle>
            <DialogDescription>
              Details recorded for this PDF and its extraction job.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-zinc-400">
            <dt>Filename</dt>
            <dd className="break-all text-right text-zinc-200">{document.filename}</dd>
            <dt>Size</dt>
            <dd className="text-right text-zinc-200">{formatSize(document.size_bytes)}</dd>
            <dt>Pages</dt>
            <dd className="text-right text-zinc-200">
              {document.page_count ?? 'Pending extraction'}
            </dd>
            <dt>Parse time</dt>
            <dd className="text-right text-zinc-200">
              {formatDuration(document.processing_seconds)}
            </dd>
            <dt>Added</dt>
            <dd className="text-right text-zinc-200">{formatDate(document.created_at)}</dd>
            <dt>Status</dt>
            <dd className="text-right text-zinc-200">{statusLabels[document.status]}</dd>
          </dl>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription>
              This removes <span className="text-zinc-200">{document.filename}</span>, its PDF, and
              extracted data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={isBusy} onClick={() => setShowDeleteDialog(false)}>
              Keep document
            </Button>
            <Button
              variant="destructive"
              disabled={isBusy}
              onClick={() => {
                void runAction(async () => {
                  await onDelete(document)
                  setShowDeleteDialog(false)
                })
              }}
            >
              {isBusy && <LoaderCircle className="animate-spin" />}
              Delete document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
