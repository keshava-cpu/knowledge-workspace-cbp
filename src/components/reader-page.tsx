import { useState } from 'react'
import { ChevronRight, PanelRightClose, PanelRightOpen, Search, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { bookContent, bookSections } from '../data/sample-data'

export function ReaderPage() {
  const [tocOpen, setTocOpen] = useState(true)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [selectedSection, setSelectedSection] = useState('overview')

  const activeSection = bookSections.find((section) => section.id === selectedSection) ?? bookSections[0]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-indigo-300">Reading</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Neural Systems and Memory</h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <span>Page 18</span>
          <span className="text-zinc-500">/ 212</span>
        </div>
      </div>

      <div className="flex gap-6">
        <aside
          className={[
            'rounded-2xl border border-white/10 bg-[#10151c] p-4 transition-all',
            tocOpen ? 'w-72 shrink-0' : 'w-16 shrink-0',
          ].join(' ')}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button variant="ghost" className="px-1 text-zinc-300" onClick={() => setTocOpen((value) => !value)}>
              <ChevronRight className={['h-4 w-4 transition-transform', tocOpen ? 'rotate-90' : ''].join(' ')} />
            </Button>
            {tocOpen && <span className="text-xs uppercase tracking-[0.25em] text-zinc-400">Contents</span>}
          </div>

          {tocOpen && (
            <nav className="space-y-2">
              {bookSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setSelectedSection(section.id)}
                  className={[
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    selectedSection === section.id
                      ? 'bg-indigo-500/10 text-indigo-200 ring-1 ring-indigo-400/25'
                      : 'text-zinc-300 hover:bg-white/5',
                  ].join(' ')}
                >
                  <span>{section.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">p. {section.page}</span>
                </button>
              ))}
            </nav>
          )}
        </aside>

        <article className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-[#10151c] px-5 py-6 sm:px-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">Current section</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{activeSection.label}</h3>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.03] px-2.5 py-1.5 ring-1 ring-white/10">
                <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                Demo document view
              </span>
            </div>
          </div>

          <div className="space-y-6 text-[15px] leading-8 text-zinc-200">
            {bookContent.map((section) => (
              <section key={section.title} className="space-y-4">
                <h4 className="text-xl font-medium text-zinc-100">{section.title}</h4>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>
        </article>

        <aside
          className={[
            'rounded-2xl border border-white/10 bg-[#10151c] p-4 transition-all',
            assistantOpen ? 'w-72 shrink-0' : 'w-14 shrink-0',
          ].join(' ')}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            {assistantOpen && <span className="text-xs uppercase tracking-[0.25em] text-zinc-400">Assistant</span>}
            <Button variant="ghost" className="px-1 text-zinc-300" onClick={() => setAssistantOpen((value) => !value)}>
              {assistantOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          </div>

          {assistantOpen && (
            <div className="space-y-4">
              <div className="rounded-xl bg-indigo-500/8 p-3 ring-1 ring-indigo-400/20">
                <div className="mb-2 flex items-center gap-2 text-indigo-200">
                  <Search className="h-4 w-4" />
                  <span className="text-sm font-medium">Context search</span>
                </div>
                <p className="text-sm text-zinc-300">
                  Compare the chapter’s explanation of synaptic plasticity with the later retrieval findings.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">Source passages</p>
                <ul className="space-y-2 text-sm text-zinc-300">
                  <li className="rounded-lg bg-white/[0.03] p-2">“Memory formation depends on repeated activation...”</li>
                  <li className="rounded-lg bg-white/[0.03] p-2">“Retrieval is most effective when the original context...”</li>
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
