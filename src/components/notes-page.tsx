import { useMemo, useState } from 'react'
import { FileText, NotebookPen } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { markdownDraft } from '../data/sample-data'

export function NotesPage() {
  const [content, setContent] = useState(markdownDraft)

  const preview = useMemo(() => {
    return content
      .split(/\n\n+/)
      .map((block) => {
        const trimmed = block.trim()
        if (!trimmed) return null

        if (trimmed.startsWith('# ')) {
          return <h1 key={trimmed} className="text-2xl font-semibold text-white">{trimmed.slice(2)}</h1>
        }

        if (trimmed.startsWith('## ')) {
          return <h2 key={trimmed} className="mt-4 text-xl font-semibold text-zinc-100">{trimmed.slice(3)}</h2>
        }

        if (trimmed.startsWith('### ')) {
          return <h3 key={trimmed} className="mt-4 text-lg font-medium text-zinc-200">{trimmed.slice(4)}</h3>
        }

        if (trimmed.startsWith('- ')) {
          const items = trimmed
            .split('\n')
            .filter((line) => line.startsWith('- '))
            .map((line) => line.replace(/^-\s*/, ''))

          return (
            <ul key={trimmed} className="ml-5 list-disc space-y-2 text-zinc-300">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )
        }

        if (trimmed.startsWith('> ')) {
          return <blockquote key={trimmed} className="border-l-2 border-indigo-400/50 pl-4 text-zinc-200">{trimmed.slice(2)}</blockquote>
        }

        return <p key={trimmed} className="text-zinc-300">{trimmed}</p>
      })
      .filter(Boolean)
  }, [content])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-indigo-300">Notes</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Working notes</h2>
        </div>
        <Button variant="outline" className="gap-2">
          <NotebookPen className="h-4 w-4" />
          Save note
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#10151c] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-zinc-500">
            <FileText className="h-4 w-4" />
            Edit
          </div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            aria-label="Markdown note editor"
            className="min-h-[500px] w-full resize-none rounded-xl border border-white/10 bg-[#0d1117] px-4 py-3 font-mono text-sm leading-7 text-zinc-100 outline-none ring-0 placeholder:text-zinc-500"
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#10151c] p-4">
          <div className="mb-3 text-sm uppercase tracking-[0.2em] text-zinc-500">Preview</div>
          <div className="prose prose-invert max-w-none space-y-3 text-zinc-200">{preview}</div>
        </div>
      </div>
    </div>
  )
}
