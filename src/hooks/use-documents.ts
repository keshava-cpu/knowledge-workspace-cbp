import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  DocumentsApiError,
  cancelJob,
  deleteDocument,
  getDocument,
  listDocuments,
  monitorDocumentIndexing,
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

async function followDocument(
  document: DocumentSummary,
  signal: AbortSignal,
  setDocuments: Dispatch<SetStateAction<DocumentSummary[]>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  try {
    let currentDoc = document

    if (currentDoc.status === 'queued' || currentDoc.status === 'processing') {
      const job = await monitorJob(
        currentDoc.job_id,
        (update) => updateDocumentStatus(setDocuments, currentDoc.id, update),
        signal,
      )
      if (signal.aborted || job.status === 'failed' || job.status === 'cancelled') {
        return
      }
      currentDoc = await getDocument(currentDoc.id, signal)
      if (signal.aborted) return
      setDocuments((current) => replaceDocument(current, currentDoc))
    }

    if (
      currentDoc.status === 'completed' &&
      (currentDoc.indexing_status === 'pending' || currentDoc.indexing_status === 'processing') &&
      !signal.aborted
    ) {
      const detail = await monitorDocumentIndexing(
        currentDoc.id,
        (update) => setDocuments((current) => replaceDocument(current, update)),
        signal,
      )
      if (!signal.aborted) {
        setDocuments((current) => replaceDocument(current, detail))
      }
    }
  } catch (docError) {
    if (!signal.aborted) {
      setError(`Could not refresh ${document.filename}: ${describeError(docError)}`)
    }
  }
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
          if (
            document.status === 'queued' ||
            document.status === 'processing' ||
            (document.status === 'completed' &&
              (document.indexing_status === 'pending' || document.indexing_status === 'processing'))
          ) {
            void followDocument(document, controller.signal, setDocuments, setError)
          }
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(describeError(loadError))
          setIsLoading(false)
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

      const lifecycleSignal = lifecycleController.current?.signal
      if (lifecycleSignal && !lifecycleSignal.aborted) {
        void followDocument(submitted, lifecycleSignal, setDocuments, setError)
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
