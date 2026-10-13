// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentDetail, DocumentSummary, JobSummary } from '../lib/documents-api'
import { useDocuments } from './use-documents'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const apiMocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  deleteDocument: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  monitorDocumentIndexing: vi.fn(),
  monitorJob: vi.fn(),
  uploadPdf: vi.fn(),
}))

vi.mock('../lib/documents-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/documents-api')>()
  return { ...actual, ...apiMocks }
})

function makeDocument(id: string): DocumentDetail {
  return {
    id,
    job_id: `job-${id}`,
    filename: `${id}.pdf`,
    title: id,
    content_type: 'application/pdf',
    size_bytes: 12,
    created_at: '2026-10-12T00:00:00Z',
    status: 'queued',
    error_message: null,
    page_count: null,
    processing_seconds: null,
    indexing_status: 'pending',
    indexed_chunks: 0,
    indexing_error: null,
    content: null,
  }
}

function makeJob(document: DocumentSummary, status: JobSummary['status']): JobSummary {
  return {
    id: document.job_id,
    document_id: document.id,
    status,
    created_at: document.created_at,
    updated_at: document.created_at,
    error_message: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useDocuments upload lifecycle', () => {
  let root: Root
  let current: ReturnType<typeof useDocuments>
  let jobMonitors: Map<
    string,
    { update: (job: JobSummary) => void; completion: ReturnType<typeof deferred<JobSummary>> }
  >

  function Probe() {
    current = useDocuments()
    return null
  }

  beforeEach(async () => {
    vi.resetAllMocks()
    jobMonitors = new Map()
    apiMocks.listDocuments.mockResolvedValue([])
    apiMocks.uploadPdf.mockImplementation(async (file: File) =>
      makeDocument(file.name.replace(/\.pdf$/i, '')),
    )
    apiMocks.monitorJob.mockImplementation((jobId: string, update: (job: JobSummary) => void) => {
      const completion = deferred<JobSummary>()
      jobMonitors.set(jobId, { update, completion })
      return completion.promise
    })

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<Probe />)
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
  })

  it('accepts a second upload while the first document is still processing', async () => {
    const firstFile = new File(['first'], 'first.pdf', { type: 'application/pdf' })
    const secondFile = new File(['second'], 'second.pdf', { type: 'application/pdf' })

    await act(async () => current.ingest(firstFile))
    const firstDocument = current.documents.find((item) => item.id === 'first')!
    await act(async () => {
      jobMonitors.get(firstDocument.job_id)!.update(makeJob(firstDocument, 'processing'))
    })

    expect(current.isUploading).toBe(false)
    expect(current.documents.find((item) => item.id === 'first')?.status).toBe('processing')

    await act(async () => current.ingest(secondFile))

    expect(current.documents.map((item) => item.id)).toEqual(['second', 'first'])
    expect(current.documents.find((item) => item.id === 'first')?.status).toBe('processing')
    expect(current.documents.find((item) => item.id === 'second')?.status).toBe('queued')
    expect(apiMocks.monitorJob).toHaveBeenCalledTimes(2)
  })

  it('applies parse updates to only their document and keeps indexing incomplete', async () => {
    const firstFile = new File(['first'], 'first.pdf', { type: 'application/pdf' })
    const secondFile = new File(['second'], 'second.pdf', { type: 'application/pdf' })

    await act(async () => current.ingest(firstFile))
    await act(async () => current.ingest(secondFile))
    const firstDocument = current.documents.find((item) => item.id === 'first')!
    const secondDocument = current.documents.find((item) => item.id === 'second')!

    await act(async () => {
      jobMonitors.get(firstDocument.job_id)!.update(makeJob(firstDocument, 'completed'))
      jobMonitors.get(secondDocument.job_id)!.update(makeJob(secondDocument, 'processing'))
    })

    expect(current.documents.find((item) => item.id === 'first')).toMatchObject({
      status: 'completed',
      indexing_status: 'pending',
    })
    expect(current.documents.find((item) => item.id === 'second')).toMatchObject({
      status: 'processing',
      indexing_status: 'pending',
    })
  })
})
