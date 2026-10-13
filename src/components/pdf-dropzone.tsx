import { useRef, useState } from 'react'
import { AlertCircle, FileUp, UploadCloud } from 'lucide-react'
import { Button } from '../../components/ui/button'

// Must match MAX_UPLOAD_BYTES in backend/app/config.py (default 50 MiB).
// The Supabase Free plan also enforces a 50 MB per-file storage limit.
// Raising this beyond 50 MB requires a storage plan upgrade or a different
// storage backend — do not silently change this constant without updating
// both the backend env var and your storage configuration.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MiB

function formatMaxSize(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

interface PdfDropzoneProps {
  disabled: boolean
  onFile: (file: File) => void
}

export function PdfDropzone({ disabled, onFile }: PdfDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function validateAndSubmit(file?: File) {
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    setValidationError('')

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setValidationError('Only PDF files are supported.')
      return
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setValidationError(
        `This PDF is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which exceeds the ${formatMaxSize(MAX_UPLOAD_BYTES)} limit. ` +
          'To upload larger PDFs, upgrade your storage plan or adjust MAX_UPLOAD_BYTES in the backend configuration.',
      )
      return
    }

    onFile(file)
  }

  return (
    <section className="mb-6 border border-dashed border-indigo-400/35 bg-indigo-500/[0.04] p-4">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Choose a PDF to upload"
        onChange={(event) => validateAndSubmit(event.currentTarget.files?.[0])}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="border border-indigo-400/25 bg-indigo-500/10 p-2 text-indigo-300">
            <FileUp className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-zinc-100">Add a PDF to your workspace</p>
            <p className="text-sm text-zinc-400">
              PDF files only — maximum {formatMaxSize(MAX_UPLOAD_BYTES)}. The server also enforces
              this limit.
            </p>
          </div>
        </div>
        <Button
          type="button"
          disabled={disabled}
          onClick={() => {
            setValidationError('')
            inputRef.current?.click()
          }}
          className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400"
        >
          <UploadCloud className="h-4 w-4" />
          {disabled ? 'Uploading PDF' : 'Choose PDF'}
        </Button>
      </div>

      {validationError && (
        <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {validationError}
        </p>
      )}

      <div
        role="region"
        aria-label="PDF drop zone"
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setIsDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          if (!disabled) validateAndSubmit(event.dataTransfer.files[0])
        }}
        className={`flex min-h-20 items-center justify-center border px-4 py-5 text-center text-sm transition-colors ${
          isDragging
            ? 'border-indigo-300 bg-indigo-400/10 text-white'
            : 'border-white/10 bg-black/10 text-zinc-400'
        }`}
      >
        {isDragging ? 'Release to upload PDF' : 'Drag and drop a PDF here'}
      </div>
    </section>
  )
}
