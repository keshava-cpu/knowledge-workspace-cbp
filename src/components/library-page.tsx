import { useMemo, useState } from 'react'
import { ArrowUpRight, FileUp, Filter, Search, Sparkles, UploadCloud } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { documents } from '../data/sample-data'

const statuses = ['All', 'Processed', 'Ingesting', 'Needs review', 'Queued'] as const

export function LibraryPage() {
  const [query, setQuery] = useState('')
  const [activeStatus, setActiveStatus] = useState<(typeof statuses)[number]>('All')

  const filteredDocuments = useMemo(() => {
    return documents.filter((document) => {
      const matchesStatus = activeStatus === 'All' || document.status === activeStatus
      const matchesQuery =
        query.trim() === '' ||
        [document.title, document.type, document.status].some((value) =>
          value.toLowerCase().includes(query.toLowerCase()),
        )

      return matchesStatus && matchesQuery
    })
  }, [activeStatus, query])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-indigo-300">Library</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Your knowledge base
          </h2>
        </div>
        <Button className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
          <UploadCloud className="h-4 w-4" />
          Upload document
        </Button>
      </div>

      <div className="mb-6 grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_auto]">
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-300">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search library"
            placeholder="Search books, notes, or topics"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
        </label>
        <Button variant="outline" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {statuses.map((status) => (
          <Button
            key={status}
            variant={activeStatus === status ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setActiveStatus(status)}
            className={
              activeStatus === status ? 'bg-indigo-500 text-white hover:bg-indigo-400' : ''
            }
          >
            {status}
          </Button>
        ))}
      </div>

      <div className="mb-6 rounded-2xl border border-dashed border-indigo-400/30 bg-indigo-500/5 p-4 text-sm text-zinc-300">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-300 ring-1 ring-indigo-400/20">
              <FileUp className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium text-zinc-100">Drop a PDF or note to begin ingestion</p>
              <p className="text-zinc-400">
                Sample upload zone for future document processing workflows.
              </p>
            </div>
          </div>
          <Button variant="outline">Browse files</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredDocuments.map((document) => (
          <article
            key={document.id}
            className="group rounded-2xl border border-white/10 bg-[#10151c] p-4 transition-colors hover:border-indigo-400/40 hover:bg-[#121a24]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="rounded-lg bg-zinc-800 p-2 text-indigo-300 ring-1 ring-white/10">
                <Sparkles className="h-4 w-4" />
              </div>
              <span
                className={[
                  'inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em]',
                  document.status === 'Processed' &&
                    'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/20',
                  document.status === 'Ingesting' &&
                    'bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20',
                  document.status === 'Needs review' &&
                    'bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20',
                  document.status === 'Queued' && 'bg-zinc-700 text-zinc-200 ring-1 ring-white/10',
                ].join(' ')}
              >
                {document.status}
              </span>
            </div>

            <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
              <span>{document.type}</span>
              <span>{document.pages} pages</span>
            </div>

            <h3 className="text-lg font-medium text-white">{document.title}</h3>
            <p className="mt-2 text-sm text-zinc-400">Updated {document.updated}</p>

            {document.status === 'Ingesting' && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                  <span>Ingestion</span>
                  <span>{document.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400"
                    style={{ width: `${document.progress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-zinc-400">Open source</span>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 px-0 text-indigo-300 hover:text-indigo-200"
              >
                Open
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </article>
        ))}
      </div>

      {filteredDocuments.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-[#10151c] p-8 text-center text-zinc-400">
          No documents match this filter yet.
        </div>
      )}
    </div>
  )
}
