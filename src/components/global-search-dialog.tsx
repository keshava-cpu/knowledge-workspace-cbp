import { useEffect, useRef, useState } from 'react'
import { FileText, LoaderCircle, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { searchDocuments, type DocumentSearchResult } from '../lib/documents-api'

interface GlobalSearchDialogProps {
  open: boolean
  onClose: () => void
}

function groupResults(results: DocumentSearchResult[]): {
  books: DocumentSearchResult[]
} {
  // Currently all results are book/document passages.
  // Extend this grouping when notes or other content types are added.
  return { books: results }
}

export function GlobalSearchDialog({ open, onClose }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocumentSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [announced, setAnnounced] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const normalizedQuery = query.trim()

  // Track the previous 'open' value to reset state when the dialog is opened
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setQuery('')
      setResults([])
      setError('')
      setLoading(false)
    }
  }

  // Focus input when dialog opens.
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 10)
      return () => window.clearTimeout(timer)
    }
  }, [open])

  // Debounced search with abort on stale requests.
  useEffect(() => {
    if (!open || !normalizedQuery) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')

      searchDocuments(normalizedQuery, { limit: 8 }, controller.signal)
        .then((items) => {
          setResults(items)
          setLoading(false)
          const count = items.length
          setAnnounced(
            count === 0 ? 'No results.' : `${count} result${count !== 1 ? 's' : ''} found.`,
          )
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted) return
          setError(searchError instanceof Error ? searchError.message : 'Search failed.')
          setLoading(false)
        })
    }, 280)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, normalizedQuery])

  // Escape closes the dialog.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open, onClose])

  function openResult(result: DocumentSearchResult) {
    const page = result.page_numbers[0]
    const path = `/reader/${encodeURIComponent(result.document_id)}?q=${encodeURIComponent(normalizedQuery)}${page ? `&page=${page}` : ''}`
    navigate(path)
    onClose()
  }

  function clearSearch() {
    setQuery('')
    setResults([])
    setError('')
    setLoading(false)
    setAnnounced('')
    inputRef.current?.focus()
  }

  if (!open) return null

  // If query is blank, results should be empty
  const displayedResults = normalizedQuery ? results : []
  const { books } = groupResults(displayedResults)
  const hasResults = displayedResults.length > 0

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      {/* Panel */}
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] shadow-2xl">
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          {loading ? (
            <LoaderCircle
              className="size-5 shrink-0 animate-spin text-indigo-400"
              aria-hidden="true"
            />
          ) : (
            <Search className="size-5 shrink-0 text-zinc-400" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            id="global-search-input"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value.trim()) {
                setResults([])
                setError('')
                setLoading(false)
              }
            }}
            placeholder="Search concepts, books, or passages…"
            aria-label="Global workspace search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear global search"
              title="Clear search"
              className="rounded p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-400"
            >
              <X className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="rounded p-1 text-zinc-500 hover:text-zinc-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-400"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Live region for screen-reader announcements */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {announced}
        </span>

        {/* Results area */}
        <div className="max-h-[60vh] overflow-y-auto" role="listbox" aria-label="Search results">
          {error && (
            <p role="alert" className="px-5 py-4 text-sm text-rose-300">
              {error}
            </p>
          )}

          {!loading && !error && normalizedQuery && !hasResults && (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">
              No passages matched <span className="text-zinc-300">"{normalizedQuery}"</span>
            </p>
          )}

          {!normalizedQuery && !loading && (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">
              Type to search your indexed documents.
            </p>
          )}

          {hasResults && (
            <section aria-label="Books and notes">
              <div className="border-b border-white/5 px-5 py-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                  Books &amp; Documents
                </p>
              </div>
              <ol>
                {books.map((result) => (
                  <li key={result.chunk_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => openResult(result)}
                      className="flex w-full flex-col gap-1 px-5 py-3 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-medium text-zinc-100">
                          <FileText
                            className="size-3.5 shrink-0 text-indigo-400"
                            aria-hidden="true"
                          />
                          <span className="truncate">{result.title}</span>
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center gap-1 text-xs text-zinc-500">
                          {result.page_numbers.length > 0 && (
                            <span>p. {result.page_numbers[0]}</span>
                          )}
                          {result.retrieval_methods.includes('semantic') && (
                            <span className="rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-sky-300">
                              Semantic
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm leading-6 text-zinc-400">
                        {result.excerpt}
                      </p>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-white/5 px-5 py-2 text-[11px] text-zinc-600">
          <span>↵ open &nbsp; Esc close</span>
          <span>
            Workspace search &mdash;{' '}
            <button
              type="button"
              className="hover:text-zinc-400"
              onClick={() => {
                navigate(`/search?q=${encodeURIComponent(normalizedQuery)}`)
                onClose()
              }}
            >
              advanced search ↗
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
