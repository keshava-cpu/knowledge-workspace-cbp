import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../../components/ui/empty'
import { DocumentCard } from './document-card'
import { PdfDropzone } from './pdf-dropzone'
import { useDocuments } from '../hooks/use-documents'
import type { DocumentStatus } from '../lib/documents-api'
import { FileSearch } from 'lucide-react'

const statuses: { label: string; value: DocumentStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Queued', value: 'queued' },
  { label: 'Processing', value: 'processing' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
]

function DocumentGridSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Loading documents">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <Skeleton className="size-10" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16 w-full" />
          <div className="flex justify-between border-t border-border pt-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function LibraryPage() {
  const [query, setQuery] = useState('')
  const [activeStatus, setActiveStatus] = useState<DocumentStatus | 'all'>('all')
  const { documents, isLoading, isUploading, error, setError, ingest, cancel, remove } =
    useDocuments()

  const filteredDocuments = useMemo(() => {
    return documents.filter((document) => {
      const matchesStatus = activeStatus === 'all' || document.status === activeStatus
      const matchesQuery =
        query.trim() === '' ||
        [document.title, document.filename, document.status].some((value) =>
          value.toLowerCase().includes(query.toLowerCase()),
        )

      return matchesStatus && matchesQuery
    })
  }, [activeStatus, documents, query])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-indigo-300">Library</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Your knowledge base
          </h2>
        </div>
      </div>

      <PdfDropzone disabled={isUploading} onFile={(file) => void ingest(file)} />

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start justify-between gap-4 border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-rose-200/70 hover:text-rose-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="mb-6 border border-white/10 bg-white/[0.03] p-3">
        <label className="flex items-center gap-2 border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-300">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search library"
            placeholder="Search books, notes, or topics"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {statuses.map(({ label, value }) => (
          <Button
            key={value}
            variant={activeStatus === value ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setActiveStatus(value)}
            className={activeStatus === value ? 'bg-indigo-500 text-white hover:bg-indigo-400' : ''}
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <DocumentGridSkeleton />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {filteredDocuments.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onCancel={cancel}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {!isLoading && !error && filteredDocuments.length === 0 && (
        <Empty className="mt-6 bg-[#10151c] text-zinc-400">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSearch />
            </EmptyMedia>
            <EmptyTitle>
              {documents.length === 0 ? 'Your library is empty' : 'No matching documents'}
            </EmptyTitle>
            <EmptyDescription>
              {documents.length === 0
                ? 'Upload a PDF to start building your private knowledge base.'
                : 'Try a different search term or status filter.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
