import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  DocumentsApiError,
  cancelJob,
  deleteDocument,
  getDocument,
  listDocuments,
  monitorJob,
  uploadPdf,
  type DocumentDetail,
  type DocumentSummary,
  type JobSummary,
} from '../lib/documents-api'

function replaceDocument(documents: DocumentSummary[], update: DocumentSummary): DocumentSummary[] {
  const exists = documents.some((document) => document.id === update.id)
  if (exists) {
    return documents.map((document) => (document.id === update.id ? update : document))
  }
  return [update, ...documents]
}

function describeError(error: unknown): string {
  if (error instanceof DocumentsApiError) {
    return error.message
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

function updateDocumentStatus(
  setDocuments: Dispatch<SetStateAction<DocumentSummary[]>>,
  documentId: string,
  job: JobSummary,
) {
  setDocuments((current) =>
    current.map((document) =>
      document.id === documentId
        ? {
            ...document,
            status: job.status,
            error_message: job.error_message,
          }
        : document,
    ),
  )
}

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lifecycleController = useRef<AbortController | null>(null)
  const uploadController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    lifecycleController.current = controller

    async function loadDocuments() {
      try {
        const loaded = await listDocuments(controller.signal)
        if (controller.signal.aborted) return
        setDocuments(loaded)
        setIsLoading(false)

        for (const document of loaded) {
          if (document.status === 'queued' || document.status === 'processing') {
            void followJob(document, controller.signal)
          }
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(describeError(loadError))
          setIsLoading(false)
        }
      }
    }

    async function followJob(document: DocumentSummary, signal: AbortSignal) {
      try {
        const job = await monitorJob(
          document.job_id,
          (update) => updateDocumentStatus(setDocuments, document.id, update),
          signal,
        )
        if (job.status === 'completed' && !signal.aborted) {
          const detail = await getDocument(document.id, signal)
          setDocuments((current) => replaceDocument(current, detail))
        }
      } catch (jobError) {
        if (!signal.aborted) {
          setError(`Could not refresh ${document.filename}: ${describeError(jobError)}`)
        }
      }
    }

    void loadDocuments()
    return () => {
      controller.abort()
      if (lifecycleController.current === controller) {
        lifecycleController.current = null
      }
    }
  }, [])

  async function ingest(file: File) {
    setError(null)
    setIsUploading(true)
    const controller = new AbortController()
    uploadController.current = controller

    try {
      const submitted: DocumentDetail = await uploadPdf(file, controller.signal)
      setDocuments((current) => replaceDocument(current, submitted))
      const job = await monitorJob(
        submitted.job_id,
        (update) => updateDocumentStatus(setDocuments, submitted.id, update),
        controller.signal,
      )
      if (job.status === 'completed') {
        const detail = await getDocument(submitted.id, controller.signal)
        setDocuments((current) => replaceDocument(current, detail))
      }
    } catch (uploadError) {
      if (!controller.signal.aborted) {
        setError(describeError(uploadError))
      }
    } finally {
      if (uploadController.current === controller) {
        uploadController.current = null
        setIsUploading(false)
      }
    }
  }

  async function cancel(document: DocumentSummary) {
    try {
      const job = await cancelJob(document.job_id)
      updateDocumentStatus(setDocuments, document.id, job)
    } catch (cancelError) {
      setError(`Could not cancel ${document.filename}: ${describeError(cancelError)}`)
    }
  }

  async function remove(document: DocumentSummary) {
    try {
      await deleteDocument(document.id)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
    } catch (deleteError) {
      setError(`Could not delete ${document.filename}: ${describeError(deleteError)}`)
    }
  }

  useEffect(
    () => () => {
      lifecycleController.current?.abort()
      uploadController.current?.abort()
    },
    [],
  )

  return { documents, isLoading, isUploading, error, setError, ingest, cancel, remove }
}
