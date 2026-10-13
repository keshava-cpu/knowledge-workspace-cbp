import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Highlighter,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { usePlugin } from '@embedpdf/core/react'
import { DocumentContent } from '@embedpdf/plugin-document-manager/react'
import {
  GlobalPointerProvider,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react'
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react'
import { RenderLayer } from '@embedpdf/plugin-render/react'
import { Rotate } from '@embedpdf/plugin-rotate/react'
import {
  ScrollPlugin,
  Scroller,
  useScroll,
  type LayoutChangePayload,
} from '@embedpdf/plugin-scroll/react'
import { SelectionLayer } from '@embedpdf/plugin-selection/react'
import { TilingLayer } from '@embedpdf/plugin-tiling/react'
import { Viewport } from '@embedpdf/plugin-viewport/react'
import { useZoom } from '@embedpdf/plugin-zoom/react'
import { Button } from '../../components/ui/button'
import { Toggle } from '../../components/ui/toggle'
import type { DocumentSearchResult } from '../lib/documents-api'

interface PdfViewerSurfaceProps {
  documentId: string
  query: string
  onQueryChange: (query: string) => void
  searching: boolean
  searchError: string
  results: DocumentSearchResult[]
  onFirstPageRender: (pageIndex: number) => void
  initialPage?: number
}

/** One consolidated marker per page — shows the count of matching passages. */
interface PageMarker {
  pageNumber: number
  topPercent: number
  results: DocumentSearchResult[]
  hasSemantic: boolean
}

interface PendingJump {
  pageNumber: number
  startedAt: number
}

interface PageHighlight {
  key: string
  left: number
  top: number
  width: number
  height: number
}

function buildPageHighlights(
  results: DocumentSearchResult[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
): PageHighlight[] {
  if (pageWidth <= 0 || pageHeight <= 0) return []

  return results.flatMap((result) =>
    result.location_metadata.flatMap((location, locationIndex) => {
      if (location.page_no !== pageNumber || !location.bbox || typeof location.bbox !== 'object') {
        return []
      }

      const bbox = location.bbox as Record<string, unknown>
      const { l, t, r, b } = bbox
      const origin = typeof bbox.coord_origin === 'string' ? bbox.coord_origin.toUpperCase() : ''
      if (
        typeof l !== 'number' ||
        typeof t !== 'number' ||
        typeof r !== 'number' ||
        typeof b !== 'number' ||
        ![l, t, r, b].every(Number.isFinite) ||
        (origin !== 'TOPLEFT' && origin !== 'BOTTOMLEFT')
      ) {
        return []
      }

      const topCoordinate = origin === 'BOTTOMLEFT' ? pageHeight - t : t
      const bottomCoordinate = origin === 'BOTTOMLEFT' ? pageHeight - b : b
      const left = Math.max(0, l)
      const top = Math.max(0, topCoordinate)
      const right = Math.min(pageWidth, r)
      const bottom = Math.min(pageHeight, bottomCoordinate)
      if (right <= left || bottom <= top) return []

      return [
        {
          key: `${result.chunk_id}-${locationIndex}`,
          left: (left / pageWidth) * 100,
          top: (top / pageHeight) * 100,
          width: ((right - left) / pageWidth) * 100,
          height: ((bottom - top) / pageHeight) * 100,
        },
      ]
    }),
  )
}

/** Translate the raw retrieval method strings into readable labels. */
function formatRetrievalMethod(method: string): string {
  if (method === 'semantic') return 'Semantic'
  if (method === 'exact') return 'Exact match'
  if (method === 'fulltext') return 'Full-text'
  // Legacy label produced by the in-memory store
  if (method === 'lexical') return 'Text match'
  return method
}

/**
 * Build one consolidated marker per page from the search results.
 * This prevents a page from being cluttered with one dot per chunk.
 */
function buildPageMarkers(
  results: DocumentSearchResult[],
  layout: LayoutChangePayload | null,
): PageMarker[] {
  if (!layout || layout.totalContentSize.height <= 0) return []

  const pagePositions = new Map<number, number>()
  for (const item of layout.virtualItems) {
    for (const page of item.pageLayouts) {
      const pageCenter = item.y + page.y + page.rotatedHeight / 2
      pagePositions.set(page.pageNumber, (pageCenter / layout.totalContentSize.height) * 100)
    }
  }

  // Group results by page (a chunk may reference multiple pages)
  const byPage = new Map<number, DocumentSearchResult[]>()
  for (const result of results) {
    for (const pageNumber of new Set(result.page_numbers)) {
      const group = byPage.get(pageNumber) ?? []
      group.push(result)
      byPage.set(pageNumber, group)
    }
  }

  const markers: PageMarker[] = []
  for (const [pageNumber, pageResults] of byPage.entries()) {
    const topPercent = pagePositions.get(pageNumber)
    if (topPercent === undefined) continue
    markers.push({
      pageNumber,
      topPercent,
      results: pageResults,
      hasSemantic: pageResults.some((r) => r.retrieval_methods.includes('semantic')),
    })
  }
  return markers
}

export function PdfViewerSurface({
  documentId,
  query,
  onQueryChange,
  searching,
  searchError,
  results,
  onFirstPageRender,
  initialPage,
}: PdfViewerSurfaceProps) {
  const [selectedPage, setSelectedPage] = useState<number | null>(null)
  const [hoveredPageNumber, setHoveredPageNumber] = useState<number | null>(null)
  const [highlightedChunkIds, setHighlightedChunkIds] = useState<Set<string>>(() => new Set())
  const [pageSortOrder, setPageSortOrder] = useState<'asc' | 'desc' | null>(null)
  const [pageInput, setPageInput] = useState<string | null>(null)
  const [jumpMeasured, setJumpMeasured] = useState(false)
  const pendingJump = useRef<PendingJump | null>(null)
  const initialJumpDone = useRef(false)
  const scroll = useScroll(documentId)
  const zoom = useZoom(documentId)
  const { provides: documentManager } = useDocumentManagerCapability()
  const { plugin: scrollPlugin, ready } = usePlugin<ScrollPlugin>(ScrollPlugin.id)
  const pdfDocument = documentManager?.getDocument(documentId)

  // ── Fix for "Maximum update depth exceeded" ──────────────────────────────
  // scroll.provides is a new object reference on every render from the EmbedPDF
  // hook. Including it as a useEffect dependency causes:
  //   scroll.provides changes → effect re-runs → subscribes events → state
  //   updates → re-render → scroll.provides changes again → infinite loop.
  //
  // Solution: keep scroll.provides in a ref (updated each render synchronously)
  // so that effect callbacks always read the current value without needing it
  // as a dependency, and the effect only runs once when the plugin is ready.
  const scrollProvidesRef = useRef(scroll.provides)
  useEffect(() => {
    scrollProvidesRef.current = scroll.provides
  }, [scroll.provides])

  const layout = useMemo(() => {
    if (!scroll.provides || scroll.state.totalPages < 1) return null
    try {
      return scroll.provides.getLayout()
    } catch {
      return null
    }
  }, [scroll.provides, scroll.state.totalPages])

  // The "active" page for the passages panel:
  // · Use the explicitly-selected page (from a marker/passage click) if it
  //   still has results.
  // · Otherwise track the current scroll position.
  const activeResultsPage =
    selectedPage !== null && results.some((r) => r.page_numbers.includes(selectedPage))
      ? selectedPage
      : scroll.state.currentPage

  useEffect(() => {
    if (!scrollPlugin) return

    let unsubscribePageChange: (() => void) | undefined
    let unsubscribeState: (() => void) | undefined

    // Subscribe inside the ready-promise callback so we always capture the
    // provides object at subscription time from the ref (not from closure).
    void ready.then(() => {
      const provides = scrollProvidesRef.current
      if (!provides) return

      unsubscribePageChange = provides.onPageChange(() => {
        setPageInput(null)
        // When the user manually scrolls, clear explicit selection so the
        // panel tracks the viewport position again.
        setSelectedPage(null)
      })

      unsubscribeState = scrollPlugin.provides().onPageChangeState((event) => {
        const pending = pendingJump.current
        if (
          pending &&
          event.documentId === documentId &&
          event.state.targetPage === pending.pageNumber &&
          !event.state.isChanging
        ) {
          console.info('pdf_jump_complete_ms', Math.round(performance.now() - pending.startedAt))
          pendingJump.current = null
          setJumpMeasured(true)
        }
      })
    })

    return () => {
      unsubscribePageChange?.()
      unsubscribeState?.()
    }
    // scrollPlugin and ready are stable references from the EmbedPDF context
    // and are the correct minimal dependency set — deliberately not including
    // scroll.provides (see the ref pattern above).
  }, [documentId, ready, scrollPlugin])

  const markers = useMemo(() => buildPageMarkers(results, layout), [layout, results])
  const displayedResults = useMemo(() => {
    if (!pageSortOrder) return results
    return [...results].sort((left, right) => {
      const leftPage = left.page_numbers[0]
      const rightPage = right.page_numbers[0]
      if (leftPage === undefined) return rightPage === undefined ? 0 : 1
      if (rightPage === undefined) return -1
      return pageSortOrder === 'asc' ? leftPage - rightPage : rightPage - leftPage
    })
  }, [pageSortOrder, results])

  const jumpToPage = useCallback(
    (pageNumber: number) => {
      const provides = scrollProvidesRef.current
      if (!provides || pageNumber < 1 || pageNumber > scroll.state.totalPages) return
      pendingJump.current = { pageNumber, startedAt: performance.now() }
      setJumpMeasured(false)
      setPageInput(null)
      setSelectedPage(pageNumber)
      provides.scrollToPage({ pageNumber, behavior: 'smooth' })
    },
    [scroll.state.totalPages],
  )

  useEffect(() => {
    if (initialJumpDone.current) return
    if (
      initialPage &&
      initialPage >= 1 &&
      scrollProvidesRef.current &&
      scroll.state.totalPages >= initialPage
    ) {
      initialJumpDone.current = true
      jumpToPage(initialPage)
    }
  }, [initialPage, jumpToPage, scroll.state.totalPages])

  return (
    <section className="border-y border-border" aria-label="PDF reader and search results">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-3">
        <label className="flex min-w-48 flex-1 items-center gap-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Search this PDF"
            placeholder="Search this document"
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {searching && (
            <LoaderCircle
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Searching"
            />
          )}
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Clear PDF search"
              title="Clear search"
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
            >
              <X className="size-4" />
            </button>
          )}
        </label>
        {searchError && (
          <p role="alert" className="w-full text-sm text-destructive">
            {searchError}
          </p>
        )}

        <div
          className="flex items-center gap-1 border-l border-border pl-3"
          role="group"
          aria-label="PDF controls"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => zoom.provides?.zoomOut()}
            disabled={!zoom.provides}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round((zoom.state.currentZoomLevel || 1) * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => zoom.provides?.zoomIn()}
            disabled={!zoom.provides}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus />
          </Button>
          <form
            className="ml-2 flex items-center gap-1 border-l border-border pl-3"
            onSubmit={(event) => {
              event.preventDefault()
              const targetPage = Number(pageInput ?? scroll.state.currentPage)
              if (Number.isInteger(targetPage)) jumpToPage(targetPage)
            }}
          >
            <input
              type="number"
              min={1}
              max={scroll.state.totalPages || undefined}
              value={pageInput ?? String(scroll.state.currentPage)}
              onChange={(event) => setPageInput(event.target.value)}
              aria-label="Page number"
              className="h-8 w-14 border border-input bg-card px-2 text-center text-sm tabular-nums"
            />
            <span className="text-xs text-muted-foreground">
              / {scroll.state.totalPages || '...'}
            </span>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-[30px_minmax(0,1fr)] lg:h-[calc(100dvh-14rem)] lg:min-h-[24rem] lg:grid-rows-1 lg:grid-cols-[34px_minmax(0,1fr)_minmax(17rem,22rem)]">
        {/* Search result rail — one consolidated marker per page */}
        <div
          className="relative h-[calc(100dvh-17rem)] min-h-[18rem] border-r border-border bg-muted/30 lg:h-full lg:min-h-0"
          aria-label="Search result page markers"
        >
          {markers.map((marker) => {
            const isActive = marker.pageNumber === activeResultsPage
            const multiPassage = marker.results.length > 1
            return (
              <button
                key={marker.pageNumber}
                type="button"
                onClick={() => jumpToPage(marker.pageNumber)}
                onMouseEnter={() => setHoveredPageNumber(marker.pageNumber)}
                onMouseLeave={() => setHoveredPageNumber(null)}
                onFocus={() => setHoveredPageNumber(marker.pageNumber)}
                onBlur={() => setHoveredPageNumber(null)}
                aria-label={`Go to page ${marker.pageNumber} — ${marker.results.length} ${marker.results.length === 1 ? 'passage' : 'passages'}`}
                title={`Page ${marker.pageNumber} · ${marker.results.length} passage${marker.results.length !== 1 ? 's' : ''}`}
                className={[
                  'absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background transition-transform hover:scale-150',
                  marker.hasSemantic ? 'bg-sky-400' : 'bg-amber-400',
                  isActive ? 'z-20 ring-2 ring-foreground' : '',
                  multiPassage ? 'size-3' : 'size-2',
                ].join(' ')}
                style={{ top: `${marker.topPercent}%` }}
              >
                <span className="sr-only">
                  {multiPassage ? `${marker.results.length} passages` : '1 passage'}
                </span>
              </button>
            )
          })}
        </div>

        {/* PDF canvas */}
        <div className="relative h-[calc(100dvh-17rem)] min-h-[18rem] min-w-0 overflow-hidden bg-zinc-200 dark:bg-zinc-800 lg:h-full lg:min-h-0">
          <DocumentContent documentId={documentId}>
            {({ isLoading, isError, isLoaded }) => {
              if (isError)
                return (
                  <p role="alert" className="p-6 text-sm text-destructive">
                    The PDF could not be rendered.
                  </p>
                )
              if (isLoading || !isLoaded)
                return (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Opening PDF
                  </div>
                )
              return (
                <GlobalPointerProvider documentId={documentId} className="h-full">
                  <Viewport
                    documentId={documentId}
                    className="h-full w-full bg-zinc-200 dark:bg-zinc-800"
                  >
                    <Scroller
                      documentId={documentId}
                      className="min-h-full w-full"
                      renderPage={({ pageIndex }) => (
                        <Rotate
                          documentId={documentId}
                          pageIndex={pageIndex}
                          className="relative mx-auto bg-white shadow-sm"
                          style={{ backgroundColor: '#fff' }}
                        >
                          <PagePointerProvider
                            documentId={documentId}
                            pageIndex={pageIndex}
                            className="relative h-full w-full"
                          >
                            <RenderLayer
                              documentId={documentId}
                              pageIndex={pageIndex}
                              onLoad={() => onFirstPageRender(pageIndex)}
                              style={{ pointerEvents: 'none' }}
                            />
                            <TilingLayer
                              documentId={documentId}
                              pageIndex={pageIndex}
                              style={{ pointerEvents: 'none' }}
                            />
                            <SelectionLayer documentId={documentId} pageIndex={pageIndex} />
                            {pdfDocument?.pages[pageIndex] &&
                              (hoveredPageNumber === pageIndex + 1 ||
                                highlightedChunkIds.size > 0) &&
                              buildPageHighlights(
                                results.filter(
                                  (result) =>
                                    highlightedChunkIds.has(result.chunk_id) ||
                                    (hoveredPageNumber === pageIndex + 1 &&
                                      result.page_numbers.includes(pageIndex + 1)),
                                ),
                                pageIndex + 1,
                                pdfDocument.pages[pageIndex].size.width,
                                pdfDocument.pages[pageIndex].size.height,
                              ).map((highlight) => (
                                <div
                                  key={highlight.key}
                                  aria-hidden="true"
                                  className="pointer-events-none absolute z-10 border border-amber-500/80 bg-amber-300/45 mix-blend-multiply"
                                  style={{
                                    left: `${highlight.left}%`,
                                    top: `${highlight.top}%`,
                                    width: `${highlight.width}%`,
                                    height: `${highlight.height}%`,
                                  }}
                                />
                              ))}
                          </PagePointerProvider>
                        </Rotate>
                      )}
                    />
                  </Viewport>
                </GlobalPointerProvider>
              )
            }}
          </DocumentContent>
        </div>

        {/* Source passages panel — shows results for the active/selected page first */}
        <aside className="col-span-2 flex max-h-[24rem] min-h-0 flex-col overflow-hidden border-t border-border lg:col-span-1 lg:h-full lg:max-h-full lg:border-l lg:border-t-0">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">Source passages</h3>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">{results.length}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  setPageSortOrder((order) =>
                    order === null ? 'asc' : order === 'asc' ? 'desc' : null,
                  )
                }
                aria-label={
                  pageSortOrder === null
                    ? 'Sort passages by page number ascending'
                    : pageSortOrder === 'asc'
                      ? 'Sort passages by page number descending'
                      : 'Reset passage sort to relevance'
                }
                title={
                  pageSortOrder === null
                    ? 'Sort by page number'
                    : pageSortOrder === 'asc'
                      ? 'Sort by page descending'
                      : 'Reset to relevance order'
                }
              >
                {pageSortOrder === 'asc' ? (
                  <ArrowUp />
                ) : pageSortOrder === 'desc' ? (
                  <ArrowDown />
                ) : (
                  <ArrowUpDown />
                )}
              </Button>
            </div>
          </div>
          {results.length ? (
            <ol className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
              {displayedResults.map((result) => {
                const isActive = result.page_numbers.includes(activeResultsPage)
                const isHighlighted = highlightedChunkIds.has(result.chunk_id)
                return (
                  <li key={result.chunk_id} className="relative">
                    <Toggle
                      variant="outline"
                      size="sm"
                      pressed={isHighlighted}
                      onPressedChange={(pressed) => {
                        setHighlightedChunkIds((current) => {
                          const next = new Set(current)
                          if (pressed) next.add(result.chunk_id)
                          else next.delete(result.chunk_id)
                          return next
                        })
                      }}
                      aria-label="Highlight this passage in the PDF"
                      title={isHighlighted ? 'Remove PDF highlight' : 'Highlight in PDF'}
                      className="absolute right-2 top-2 z-10 h-7 min-w-7 border-border bg-card p-1 data-[state=on]:border-amber-500 data-[state=on]:bg-amber-200 data-[state=on]:text-amber-950"
                    >
                      <Highlighter aria-hidden="true" />
                    </Toggle>
                    <button
                      type="button"
                      onClick={() => {
                        const pageNumber = result.page_numbers[0]
                        if (pageNumber) jumpToPage(pageNumber)
                      }}
                      className={[
                        'w-full border-l-2 px-4 py-3 pr-12 text-left transition-colors hover:bg-muted/50',
                        isActive ? 'border-l-sky-400 bg-muted/30' : 'border-l-transparent',
                      ].join(' ')}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {result.page_numbers.length
                            ? result.page_numbers.map((page) => `p. ${page}`).join(' · ')
                            : 'Page unavailable'}
                        </span>
                        <span>
                          {result.retrieval_methods.map(formatRetrievalMethod).join(' + ')}
                        </span>
                      </span>
                      <span className="mt-2 block whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                        {result.excerpt}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="min-h-0 flex-1 overflow-y-auto px-4 py-6 text-sm text-muted-foreground">
              {query.trim()
                ? 'No passages matched this query.'
                : 'Search this document to see source passages.'}
            </p>
          )}
        </aside>
      </div>
      <span className="sr-only" aria-live="polite">
        {jumpMeasured ? `Jumped to page ${scroll.state.currentPage}.` : ''}
      </span>
    </section>
  )
}
