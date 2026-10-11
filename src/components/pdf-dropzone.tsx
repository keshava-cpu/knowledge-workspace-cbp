import { useRef, useState } from 'react'
import { FileUp, UploadCloud } from 'lucide-react'
import { Button } from '../../components/ui/button'

interface PdfDropzoneProps {
  disabled: boolean
  onFile: (file: File) => void
}

export function PdfDropzone({ disabled, onFile }: PdfDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function chooseFile(file?: File) {
    if (file) onFile(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="mb-6 border border-dashed border-indigo-400/35 bg-indigo-500/[0.04] p-4">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        aria-label="Choose a PDF to upload"
        onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="border border-indigo-400/25 bg-indigo-500/10 p-2 text-indigo-300">
            <FileUp className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-zinc-100">Add a PDF to your workspace</p>
            <p className="text-sm text-zinc-400">
              PDF files only. The server enforces the configured size limit.
            </p>
          </div>
        </div>
        <Button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="gap-2 bg-indigo-500 text-white hover:bg-indigo-400"
        >
          <UploadCloud className="h-4 w-4" />
          {disabled ? 'Processing PDF' : 'Choose PDF'}
        </Button>
      </div>
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
          if (!disabled) chooseFile(event.dataTransfer.files[0])
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
