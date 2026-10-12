import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { EmbedPDF, type PluginBatchRegistrations } from '@embedpdf/core/react'
import { createPluginRegistration } from '@embedpdf/core'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import { ConsoleLogger } from '@embedpdf/models'
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react'
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/react'
import { RenderPluginPackage } from '@embedpdf/plugin-render/react'
import { RotatePluginPackage } from '@embedpdf/plugin-rotate/react'
import { ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll/react'
import { SelectionPluginPackage } from '@embedpdf/plugin-selection/react'
import { SpreadMode, SpreadPluginPackage } from '@embedpdf/plugin-spread/react'
import { TilingPluginPackage } from '@embedpdf/plugin-tiling/react'
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react'
import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react'
import {
  getDocumentPdfBlob,
  searchDocuments,
  type DocumentSearchResult,
} from '../lib/documents-api'
import { PdfViewerSurface } from './pdf-viewer-surface'

const logger = new ConsoleLogger()

interface PdfDocumentViewerProps {
  documentId: string
  initialQuery: string
}

export function PdfDocumentViewer({ documentId, initialQuery }: PdfDocumentViewerProps) {
  const [query, setQuery] = useState(initialQuery)
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfError, setPdfError] = useState('')
  const [searchState, setSearchState] = useState<{
    key: string
    results: DocumentSearchResult[]
    error: string
    loading: boolean
  }>({ key: '', results: [], error: '', loading: false })
  const normalizedQuery = query.trim()
  const searchKey = `${normalizedQuery}\u0000${documentId}`
  const isCurrentSearch = searchState.key === searchKey
  const results = isCurrentSearch ? searchState.results : []
  const searching = isCurrentSearch && searchState.loading
  const searchError = isCurrentSearch ? searchState.error : ''
  const pdfReadyAt = useRef<number | null>(null)
  const firstPageMeasured = useRef(false)
  const { engine, isLoading: engineLoading, error: engineError } = usePdfiumEngine({ logger })

  useEffect(() => {
    let objectUrl = ''
    const controller = new AbortController()
    const startedAt = performance.now()

    getDocumentPdfBlob(documentId, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        pdfReadyAt.current = performance.now()
        setPdfUrl(objectUrl)
        console.info('pdf_original_download_ms', Math.round(performance.now() - startedAt))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPdfError(error instanceof Error ? error.message : 'Could not load the original PDF.')
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      pdfReadyAt.current = null
      firstPageMeasured.current = false
    }
  }, [documentId])

  useEffect(() => {
    if (!normalizedQuery) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSearchState({ key: searchKey, results: [], error: '', loading: true })
      searchDocuments(normalizedQuery, { documentId }, controller.signal)
        .then((items) => {
          setSearchState({ key: searchKey, results: items, error: '', loading: false })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSearchState({
            key: searchKey,
            results: [],
            error: error instanceof Error ? error.message : 'Search failed.',
            loading: false,
          })
        })
    }, 280)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [documentId, normalizedQuery, searchKey])

  const plugins = useMemo<PluginBatchRegistrations>(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: pdfUrl ? [{ url: pdfUrl, documentId }] : [],
      }),
      createPluginRegistration(ViewportPluginPackage, { viewportGap: 8 }),
      createPluginRegistration(ScrollPluginPackage, {
        defaultStrategy: ScrollStrategy.Vertical,
        defaultPageGap: 16,
      }),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
      createPluginRegistration(SpreadPluginPackage, { defaultSpreadMode: SpreadMode.None }),
      createPluginRegistration(RotatePluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5 }),
      createPluginRegistration(SelectionPluginPackage),
    ],
    [documentId, pdfUrl],
  )

  function handleFirstPageRender(pageIndex: number) {
    if (pageIndex !== 0 || firstPageMeasured.current || pdfReadyAt.current === null) return
    firstPageMeasured.current = true
    console.info('pdf_first_page_render_ms', Math.round(performance.now() - pdfReadyAt.current))
  }

  if (engineError) {
    return (
      <p role="alert" className="mt-6 border-l-2 border-destructive pl-3 text-sm text-destructive">
        {engineError.message}
      </p>
    )
  }

  return (
    <section className="mt-8" aria-label="PDF reader and search results">
      {engineLoading && (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
          Preparing PDF viewer
        </div>
      )}
      {!pdfUrl && !pdfError && !engineLoading && (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
          Loading original PDF
        </div>
      )}
      {pdfError && (
        <p role="alert" className="border-y border-destructive/30 py-4 text-sm text-destructive">
          {pdfError}
        </p>
      )}
      {pdfUrl && engine && (
        <EmbedPDF engine={engine} plugins={plugins}>
          {({ pluginsReady, activeDocumentId }) =>
            pluginsReady && activeDocumentId ? (
              <DocumentContent documentId={activeDocumentId}>
                {({ isLoaded, isError }) =>
                  isLoaded ? (
                    <PdfViewerSurface
                      documentId={activeDocumentId}
                      query={query}
                      onQueryChange={setQuery}
                      searching={searching}
                      searchError={searchError}
                      results={results}
                      onFirstPageRender={handleFirstPageRender}
                    />
                  ) : isError ? (
                    <p
                      role="alert"
                      className="border-y border-destructive/30 py-4 text-sm text-destructive"
                    >
                      The PDF could not be rendered.
                    </p>
                  ) : (
                    <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                      <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      Opening PDF
                    </div>
                  )
                }
              </DocumentContent>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Initializing PDF viewer
              </div>
            )
          }
        </EmbedPDF>
      )}
    </section>
  )
}
