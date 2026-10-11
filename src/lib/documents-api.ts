import { getSupabaseClient } from './supabase'

export type DocumentStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface ExtractedBlock {
  kind: string
  text: string
  page_numbers: number[]
}

export interface ExtractedContent {
  markdown: string
  structured_json: unknown | null
  blocks: ExtractedBlock[]
}

export interface DocumentSummary {
  id: string
  job_id: string
  filename: string
  title: string
  content_type: string
  size_bytes: number
  created_at: string
  status: DocumentStatus
  error_message: string | null
  page_count: number | null
  processing_seconds: number | null
}

export interface DocumentDetail extends DocumentSummary {
  content: ExtractedContent | null
}

export interface JobSummary {
  id: string
  document_id: string
  status: DocumentStatus
  created_at: string
  updated_at: string
  error_message: string | null
}

export class DocumentsApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'DocumentsApiError'
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  timeoutMilliseconds = 20_000,
): Promise<T> {
  if (init?.signal?.aborted) {
    throw new DOMException('The request was aborted.', 'AbortError')
  }
  const supabase = getSupabaseClient()
  if (!supabase) {
    throw new DocumentsApiError('Supabase authentication is not configured.', 503)
  }
  const { data, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) {
    throw new DocumentsApiError('Could not restore your Supabase session. Sign in again.', 401)
  }
  if (!data.session?.access_token) {
    throw new DocumentsApiError('Sign in to access your documents.', 401)
  }

  let response: Response
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds)
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${data.session.access_token}`)
    response = await fetch(path, {
      ...init,
      headers,
      signal: init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new DocumentsApiError('The ingestion service request timed out.', 0)
    }
    throw new DocumentsApiError('The ingestion service is unavailable.', 0)
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const payload = (await response.json()) as { detail?: unknown }
      if (typeof payload.detail === 'string') {
        message = payload.detail
      }
    } catch {
      // Keep the status-based message when the service response is not JSON.
    }
    throw new DocumentsApiError(message, response.status)
  }

  return (await response.json()) as T
}

export function listDocuments(signal?: AbortSignal): Promise<DocumentSummary[]> {
  return requestJson('/api/documents', { signal })
}

export function getDocument(documentId: string, signal?: AbortSignal): Promise<DocumentDetail> {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}`, { signal })
}

export function getJob(jobId: string, signal?: AbortSignal): Promise<JobSummary> {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, { signal })
}

export function cancelJob(jobId: string): Promise<JobSummary> {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
}

export function deleteDocument(documentId: string): Promise<{ deleted: boolean }> {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' })
}

export async function uploadPdf(file: File, signal?: AbortSignal): Promise<DocumentDetail> {
  const formData = new FormData()
  formData.append('file', file)
  return requestJson('/api/documents', { method: 'POST', body: formData, signal }, 180_000)
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The request was aborted.', 'AbortError'))
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('The request was aborted.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function monitorJob(
  jobId: string,
  onUpdate: (job: JobSummary) => void,
  signal?: AbortSignal,
): Promise<JobSummary> {
  while (true) {
    const job = await getJob(jobId, signal)
    onUpdate(job)
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job
    }
    await delay(1200, signal)
  }
}
