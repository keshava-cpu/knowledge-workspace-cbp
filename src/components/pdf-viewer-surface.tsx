import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Minus, Plus, Search } from 'lucide-react'
import { usePlugin } from '@embedpdf/core/react'
import { DocumentContent } from '@embedpdf/plugin-document-manager/react'
import {
  GlobalPointerProvider,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react'
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
import type { DocumentSearchResult } from '../lib/documents-api'

interface PdfViewerSurfaceProps {
  documentId: string
  query: string
  onQueryChange: (query: string) => void
  searching: boolean
  searchError: string
  results: DocumentSearchResult[]
  onFirstPageRender: (pageIndex: number) => void
}

interface PageMarker {
  result: DocumentSearchResult
  pageNumber: number
  topPercent: number
  lane: number
  laneCount: number
}

interface PendingJump {
  pageNumber: number
  startedAt: number
}

function pageMarkerPositions(
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

  const markers = results.flatMap((result) =>
    [...new Set(result.page_numbers)].flatMap((pageNumber) => {
      const topPercent = pagePositions.get(pageNumber)
      return topPercent === undefined ? [] : [{ result, pageNumber, topPercent }]
    }),
  )
  const byPage = new Map<number, PageMarker[]>()
  for (const marker of markers) {
    const group = byPage.get(marker.pageNumber) ?? []
    group.push({ ...marker, lane: 0, laneCount: 1 })
    byPage.set(marker.pageNumber, group)
  }

  return [...byPage.values()].flatMap((group) =>
    group.map((marker, lane) => ({ ...marker, lane, laneCount: group.length })),
  )
}

export function PdfViewerSurface({
  documentId,
  query,
  onQueryChange,
  searching,
  searchError,
  results,
  onFirstPageRender,
}: PdfViewerSurfaceProps) {
  const [selectedResultId, setSelectedResultId] = useState('')
  const [pageInput, setPageInput] = useState<string | null>(null)
  const [jumpMeasured, setJumpMeasured] = useState(false)
  const pendingJump = useRef<PendingJump | null>(null)
  const scroll = useScroll(documentId)
  const zoom = useZoom(documentId)
  const { plugin: scrollPlugin, ready } = usePlugin<ScrollPlugin>(ScrollPlugin.id)
  const layout = useMemo(() => {
    if (!scroll.provides || scroll.state.totalPages < 1) return null
    try {
      return scroll.provides.getLayout()
    } catch {
      return null
    }
  }, [scroll.provides, scroll.state.totalPages])
  const resultOnCurrentPage = results.find((result) =>
    result.page_numbers.includes(scroll.state.currentPage),
  )
  const selectedResultOnCurrentPage = results.some(
    (result) =>
      result.chunk_id === selectedResultId &&
      result.page_numbers.includes(scroll.state.currentPage),
  )
  const activeResultId = selectedResultOnCurrentPage
    ? selectedResultId
    : (resultOnCurrentPage?.chunk_id ?? '')

  useEffect(() => {
    if (!scrollPlugin || !scroll.provides) return
    const unsubscribePageChange = scroll.provides.onPageChange(() => setPageInput(null))
    let unsubscribe: (() => void) | undefined
    void ready.then(() => {
      unsubscribe = scrollPlugin.provides().onPageChangeState((event) => {
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
      unsubscribePageChange()
      unsubscribe?.()
    }
  }, [documentId, ready, scroll.provides, scrollPlugin])

  const markers = useMemo(() => pageMarkerPositions(results, layout), [layout, results])

  function jumpToPage(pageNumber: number, result?: DocumentSearchResult) {
    if (!scroll.provides || pageNumber < 1 || pageNumber > scroll.state.totalPages) return
    pendingJump.current = { pageNumber, startedAt: performance.now() }
    setJumpMeasured(false)
    setPageInput(null)
    if (result) setSelectedResultId(result.chunk_id)
    scroll.provides.scrollToPage({ pageNumber, behavior: 'smooth' })
  }

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

      <div className="grid grid-cols-[30px_minmax(0,1fr)] lg:grid-cols-[34px_minmax(0,1fr)_minmax(17rem,22rem)]">
        <div
          className="relative h-[68vh] min-h-[30rem] max-h-[56rem] border-r border-border bg-muted/30"
          aria-label="Search result markers"
        >
          {markers.map((marker) => {
            const isActive = marker.result.chunk_id === activeResultId
            const leftPercent = ((marker.lane + 1) / (marker.laneCount + 1)) * 100
            const semantic = marker.result.retrieval_methods.includes('semantic')
            return (
              <button
                key={`${marker.result.chunk_id}-${marker.pageNumber}`}
                type="button"
                onClick={() => jumpToPage(marker.pageNumber, marker.result)}
                aria-label={`Go to page ${marker.pageNumber}, ${marker.result.title}`}
                title={`Page ${marker.pageNumber}`}
                className={[
                  'absolute z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background transition-transform hover:scale-150',
                  semantic ? 'bg-sky-400' : 'bg-amber-400',
                  isActive ? 'z-20 size-3 ring-2 ring-foreground' : '',
                ].join(' ')}
                style={{ top: `${marker.topPercent}%`, left: `${leftPercent}%` }}
              />
            )
          })}
        </div>

        <div className="relative h-[68vh] min-h-[30rem] max-h-[56rem] min-w-0 overflow-hidden bg-zinc-200 dark:bg-zinc-800">
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

        <aside className="col-span-2 max-h-[24rem] overflow-y-auto border-t border-border lg:col-span-1 lg:max-h-none lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">Source passages</h3>
            <span className="text-xs tabular-nums text-muted-foreground">{results.length}</span>
          </div>
          {results.length ? (
            <ol className="divide-y divide-border">
              {results.map((result) => (
                <li key={result.chunk_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedResultId(result.chunk_id)
                      const pageNumber = result.page_numbers[0]
                      if (pageNumber) jumpToPage(pageNumber, result)
                    }}
                    className={[
                      'w-full border-l-2 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                      activeResultId === result.chunk_id
                        ? 'border-l-sky-400 bg-muted/30'
                        : 'border-l-transparent',
                    ].join(' ')}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {result.page_numbers.length
                          ? result.page_numbers.map((page) => `p. ${page}`).join(' · ')
                          : 'Page unavailable'}
                      </span>
                      <span>{result.retrieval_methods.join(' + ')}</span>
                    </span>
                    <span className="mt-2 block whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                      {result.excerpt}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">
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
