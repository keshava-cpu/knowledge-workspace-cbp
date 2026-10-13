import { useEffect, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/button'
import {
  listDocuments,
  searchDocuments,
  type DocumentSearchResult,
  type DocumentSummary,
} from '../lib/documents-api'

type SearchScope = 'workspace' | 'document'

export function SearchPage() {
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [scope, setScope] = useState<SearchScope>('workspace')
  const [selectedDocumentId, setSelectedDocumentId] = useState('')
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [searchState, setSearchState] = useState<{
    key: string
    results: DocumentSearchResult[]
    error: string
    loading: boolean
  }>({ key: '', results: [], error: '', loading: false })
  const [loadingDocuments, setLoadingDocuments] = useState(true)
  const [documentsError, setDocumentsError] = useState('')
  const normalizedQuery = query.trim()
  const searchKey = `${normalizedQuery}\u0000${scope}\u0000${selectedDocumentId}`
  const isCurrentSearch = searchState.key === searchKey
  const results = isCurrentSearch ? searchState.results : []
  const loading = isCurrentSearch && searchState.loading
  const error = isCurrentSearch ? searchState.error : ''

  useEffect(() => {
    const controller = new AbortController()
    listDocuments(controller.signal)
      .then(setDocuments)
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return
        setDocumentsError(
          requestError instanceof Error ? requestError.message : 'Could not load documents.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDocuments(false)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!normalizedQuery || (scope === 'document' && !selectedDocumentId)) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchState({ key: searchKey, results: [], error: '', loading: true })
      searchDocuments(
        normalizedQuery,
        { documentId: scope === 'document' ? selectedDocumentId : undefined },
        controller.signal,
      )
        .then((items) => {
          setSearchState({ key: searchKey, results: items, error: '', loading: false })
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted) return
          setSearchState({
            key: searchKey,
            results: [],
            error: requestError instanceof Error ? requestError.message : 'Search failed.',
            loading: false,
          })
        })
    }, 280)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, scope, selectedDocumentId, searchKey])

  const searchableDocuments = documents.filter(
    (document) => document.status === 'completed' && document.indexing_status === 'completed',
  )

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="border-b border-border pb-5">
        <p className="text-xs font-medium uppercase text-muted-foreground">Passage retrieval</p>
        <h2 className="mt-2 text-2xl font-semibold text-foreground">Search your library</h2>
      </header>

      <section className="border-b border-border py-5" aria-label="Search controls">
        <label className="flex items-center gap-3 border border-input bg-card px-4 py-3">
          <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search passages"
            placeholder="Search concepts, exact phrases, or questions"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {loading && (
            <LoaderCircle
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Searching"
            />
          )}
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div
            className="inline-flex border border-border p-1"
            role="group"
            aria-label="Search scope"
          >
            <Button
              type="button"
              variant={scope === 'workspace' ? 'default' : 'ghost'}
              size="sm"
              aria-pressed={scope === 'workspace'}
              onClick={() => setScope('workspace')}
            >
              Workspace
            </Button>
            <Button
              type="button"
              variant={scope === 'document' ? 'default' : 'ghost'}
              size="sm"
              aria-pressed={scope === 'document'}
              onClick={() => setScope('document')}
            >
              One document
            </Button>
          </div>

          {scope === 'document' && (
            <label className="flex min-w-56 flex-1 items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only">Choose a document</span>
              <select
                value={selectedDocumentId}
                onChange={(event) => setSelectedDocumentId(event.target.value)}
                disabled={loadingDocuments || searchableDocuments.length === 0}
                className="h-9 w-full min-w-0 border border-input bg-card px-3 text-sm text-foreground"
              >
                <option value="">
                  {loadingDocuments
                    ? 'Loading documents...'
                    : searchableDocuments.length
                      ? 'Choose an indexed document'
                      : 'No indexed documents'}
                </option>
                {searchableDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <span className="text-xs text-muted-foreground" aria-live="polite">
            {loading
              ? 'Searching passages'
              : `${results.length} ${results.length === 1 ? 'passage' : 'passages'}`}
          </span>
        </div>
      </section>

      <section className="divide-y divide-border" aria-label="Search results" aria-live="polite">
        {error && (
          <p role="alert" className="border-b border-destructive/30 py-5 text-sm text-destructive">
            {error}
          </p>
        )}
        {documentsError && (
          <p role="alert" className="border-b border-destructive/30 py-5 text-sm text-destructive">
            {documentsError}
          </p>
        )}

        {results.map((result) => (
          <article key={result.chunk_id} className="py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/reader/${encodeURIComponent(result.document_id)}?q=${encodeURIComponent(query.trim())}${result.page_numbers[0] ? `&page=${result.page_numbers[0]}` : ''}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {result.title}
                  </Link>
                  <Link
                    to={`/documents/${encodeURIComponent(result.document_id)}`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    title="View parsed text and metadata"
                  >
                    [parsed]
                  </Link>
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">{result.filename}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
                <span className="text-muted-foreground">
                  {result.page_numbers.length
                    ? result.page_numbers.map((page) => `p. ${page}`).join(' · ')
                    : 'Page unavailable'}
                </span>
                {result.retrieval_methods.map((method) => (
                  <span
                    key={method}
                    className="border border-border px-2 py-1 text-muted-foreground"
                  >
                    {method === 'semantic' ? 'Semantic' : 'Text match'}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/85">
              {result.excerpt}
            </p>
          </article>
        ))}

        {!loading && !error && query.trim() && results.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {scope === 'document' && !selectedDocumentId
              ? 'Choose an indexed document to search within it.'
              : 'No passages matched this query.'}
          </p>
        )}
        {!query.trim() && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Enter a query to retrieve passages from your indexed documents.
          </p>
        )}
      </section>
    </div>
  )
}
