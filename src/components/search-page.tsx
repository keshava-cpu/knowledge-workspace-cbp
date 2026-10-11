import { useMemo, useState } from 'react'
import { Search, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { searchResults } from '../data/sample-data'

const filters = ['All', 'Textbook', 'Research paper', 'Lecture notes'] as const

export function SearchPage() {
  const [query, setQuery] = useState('How does memory retrieval depend on context?')
  const [activeFilter, setActiveFilter] = useState<(typeof filters)[number]>('All')

  const filteredResults = useMemo(() => {
    return searchResults.filter((result) => {
      const matchesFilter = activeFilter === 'All' || result.documentType === activeFilter
      const matchesQuery =
        query.trim() === '' ||
        [result.title, result.section, result.excerpt].some((value) =>
          value.toLowerCase().includes(query.toLowerCase()),
        )

      return matchesFilter && matchesQuery
    })
  }, [activeFilter, query])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-indigo-400/20 bg-[#0d1117] p-5 shadow-[0_0_0_1px_rgba(99,102,241,0.1)]">
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <Search className="h-5 w-5 text-indigo-300" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search knowledge base"
            placeholder="Ask a question, concept, or topic"
            className="w-full bg-transparent text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Button
                key={filter}
                variant={activeFilter === filter ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setActiveFilter(filter)}
                className={activeFilter === filter ? 'bg-indigo-500 text-white hover:bg-indigo-400' : ''}
              >
                {filter}
              </Button>
            ))}
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">
            <Sparkles className="h-3 w-3" />
            Demo data only
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {filteredResults.map((result) => (
          <article
            key={result.id}
            className="rounded-2xl border border-white/10 bg-[#10151c] p-4 transition-colors hover:border-indigo-400/30"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
              <span>{result.documentType}</span>
              <span className="rounded-full border border-indigo-400/20 bg-indigo-500/8 px-2 py-1 text-[10px] text-indigo-200">
                {result.matchType}
              </span>
            </div>

            <div className="mb-2 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium text-white">{result.title}</h3>
                <p className="mt-1 text-sm text-zinc-400">{result.section}</p>
              </div>
              <span className="rounded-lg bg-white/[0.03] px-2 py-1 text-xs text-zinc-300">{result.page}</span>
            </div>

            <p className="text-[15px] leading-7 text-zinc-200">{result.excerpt}</p>
          </article>
        ))}
      </div>

      {filteredResults.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-[#10151c] p-8 text-center text-zinc-400">
          No demonstration results match that query yet.
        </div>
      )}
    </div>
  )
}
