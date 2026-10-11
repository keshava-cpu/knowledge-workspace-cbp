import { useEffect, useState } from 'react'
import { NotebookPen, StickyNote } from 'lucide-react'
import { BlockNoteView } from '@blocknote/shadcn'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/shadcn/style.css'
import { SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import { Button } from '../../components/ui/button'

const STORAGE_KEY = 'knowledge-workspace-note'

const defaultContent = [
  {
    id: 'title-block',
    type: 'heading',
    props: { level: 2 },
    content: 'Research plan',
  },
  {
    id: 'summary-block',
    type: 'paragraph',
    content:
      'Capture notes, references, and action items in one place while keeping the workspace focused on learning outcomes.',
  },
  {
    id: 'task-block',
    type: 'bulletListItem',
    content: 'Review related papers and summarize key findings',
  },
  {
    id: 'task-block-2',
    type: 'bulletListItem',
    content: 'Organize research materials into reusable knowledge cards',
  },
]

function loadInitialContent() {
  if (typeof window === 'undefined') {
    return defaultContent
  }

  const storedNote = window.localStorage.getItem(STORAGE_KEY)

  if (!storedNote) {
    return defaultContent
  }

  try {
    const parsed = JSON.parse(storedNote)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultContent
  } catch {
    return defaultContent
  }
}

export function NotesPage() {
  const [title, setTitle] = useState(() => {
    if (typeof window === 'undefined') {
      return 'Working notes'
    }

    return window.localStorage.getItem(`${STORAGE_KEY}-title`) || 'Working notes'
  })

  const editor = useCreateBlockNote({
    initialContent: loadInitialContent(),
    trailingBlock: false,
    placeholder: 'Write a summary, idea, or next action...',
  })

  useEffect(() => {
    editor.onChange(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(editor.document))
    })
  }, [editor])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_KEY}-title`, title)
  }, [title])

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-indigo-300">Notes</p>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Note title"
            className="mt-2 w-full bg-transparent text-3xl font-semibold text-white outline-none placeholder:text-zinc-500"
            placeholder="Working notes"
          />
        </div>
        <Button variant="outline" className="gap-2">
          <NotebookPen className="h-4 w-4" />
          Autosave
        </Button>
      </div>

      <div className="rounded-none border border-white/10 bg-[#10151c] p-3 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]">
        <div className="mb-3 flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-zinc-500">
          <StickyNote className="h-4 w-4" />
          Editor
        </div>
        <BlockNoteView editor={editor} className="min-h-[560px]" slashMenu={false}>
          <SuggestionMenuController
            triggerCharacter="/"
            floatingUIOptions={{
              useFloatingOptions: {
                placement: 'bottom-start',
                middleware: [],
              },
            }}
          />
        </BlockNoteView>
      </div>
    </div>
  )
}
