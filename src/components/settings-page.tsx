import { useState } from 'react'
import { Check, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../components/ui/button'

export function SettingsPage() {
  const [settings, setSettings] = useState({
    darkMode: true,
    autoSync: true,
    sourceHighlights: true,
    dailyDigest: false,
    setDefaultLibrary: 'All documents',
  })

  const [saved, setSaved] = useState('')

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings((current) => ({
      ...current,
      [key]: typeof current[key] === 'boolean' ? !current[key] : current[key],
    }))
  }

  const handleSave = () => {
    setSaved('Settings updated for the current demo session.')
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-indigo-300">Settings</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Workspace preferences</h2>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-300">
          <SlidersHorizontal className="h-4 w-4" />
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-white/10 bg-[#10151c] p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div>
            <p className="text-base font-medium text-white">Dark theme</p>
            <p className="text-sm text-zinc-400">Use the default research-focused reading surface.</p>
          </div>
          <button
            type="button"
            aria-label="Toggle dark theme"
            onClick={() => toggleSetting('darkMode')}
            className={[
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
              settings.darkMode ? 'bg-indigo-500' : 'bg-zinc-700',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-5 w-5 rounded-full bg-white transition-transform',
                settings.darkMode ? 'translate-x-6' : 'translate-x-1',
              ].join(' ')}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div>
            <p className="text-base font-medium text-white">Automatic sync</p>
            <p className="text-sm text-zinc-400">Keep notes and reader state synchronized with your workspace.</p>
          </div>
          <button
            type="button"
            aria-label="Toggle automatic sync"
            onClick={() => toggleSetting('autoSync')}
            className={[
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
              settings.autoSync ? 'bg-indigo-500' : 'bg-zinc-700',
            ].join(' ')}
          >
            <span className={['inline-block h-5 w-5 rounded-full bg-white transition-transform', settings.autoSync ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div>
            <p className="text-base font-medium text-white">Highlight source passages</p>
            <p className="text-sm text-zinc-400">Keep references, excerpts and page markers visible while reading.</p>
          </div>
          <button
            type="button"
            aria-label="Toggle source highlights"
            onClick={() => toggleSetting('sourceHighlights')}
            className={[
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
              settings.sourceHighlights ? 'bg-indigo-500' : 'bg-zinc-700',
            ].join(' ')}
          >
            <span className={['inline-block h-5 w-5 rounded-full bg-white transition-transform', settings.sourceHighlights ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div>
            <p className="text-base font-medium text-white">Daily reading digest</p>
            <p className="text-sm text-zinc-400">Deliver a brief summary of recently opened materials and highlights.</p>
          </div>
          <button
            type="button"
            aria-label="Toggle daily digest"
            onClick={() => toggleSetting('dailyDigest')}
            className={[
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
              settings.dailyDigest ? 'bg-indigo-500' : 'bg-zinc-700',
            ].join(' ')}
          >
            <span className={['inline-block h-5 w-5 rounded-full bg-white transition-transform', settings.dailyDigest ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
          </button>
        </div>

        <label className="block rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-300">
          Default library view
          <select
            value={settings.setDefaultLibrary}
            onChange={(event) => setSettings((current) => ({ ...current, setDefaultLibrary: event.target.value }))}
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2.5 text-zinc-100 outline-none"
          >
            <option>All documents</option>
            <option>Recently opened</option>
            <option>Needs review</option>
          </select>
        </label>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button variant="secondary" onClick={handleSave} className="gap-2">
            <Check className="h-4 w-4" />
            Save changes
          </Button>
          {saved && <span className="text-sm text-indigo-200">{saved}</span>}
        </div>
      </div>
    </div>
  )
}
