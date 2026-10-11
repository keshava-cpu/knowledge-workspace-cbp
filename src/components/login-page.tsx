import { useState, type FormEvent } from 'react'
import { ArrowRight, Globe, KeyRound, Mail } from 'lucide-react'
import { Button } from '../../components/ui/button'

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [status, setStatus] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(
      mode === 'signin'
        ? 'Demo sign-in ready for future Supabase Auth integration.'
        : 'Demo account setup ready for future Supabase Auth integration.',
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-6 overflow-hidden rounded-3xl border border-white/10 bg-[#10151c] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="border-b border-white/10 bg-gradient-to-br from-indigo-500/8 via-transparent to-transparent p-8 lg:border-b-0 lg:border-r">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300">Access</p>
          <h2 className="mt-4 text-4xl font-semibold text-white">A focused workspace for reading and research.</h2>
          <p className="mt-4 max-w-md text-zinc-300">
            Sign in to sync notes, keep track of reading activity and prepare for future document ingestion flows.
          </p>

          <div className="mt-8 space-y-3 text-sm text-zinc-200">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <Mail className="h-4 w-4 text-indigo-300" />
              <span>Document access and reading metadata</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <KeyRound className="h-4 w-4 text-indigo-300" />
              <span>Secure authentication hooks for future provider setup</span>
            </div>
          </div>
        </div>

        <div className="p-8">
          <div className="mb-6 inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={[
                'rounded-lg px-4 py-2 text-sm transition-colors',
                mode === 'signin' ? 'bg-white text-zinc-950' : 'text-zinc-300',
              ].join(' ')}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={[
                'rounded-lg px-4 py-2 text-sm transition-colors',
                mode === 'register' ? 'bg-white text-zinc-950' : 'text-zinc-300',
              ].join(' ')}
            >
              Register
            </button>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <label className="block text-sm text-zinc-300">
                Full name
                <input
                  type="text"
                  placeholder="Ava Chen"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
              </label>
            )}

            <label className="block text-sm text-zinc-300">
              Email
              <input
                type="email"
                placeholder="ava@workspace.example"
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
            </label>

            <label className="block text-sm text-zinc-300">
              Password
              <input
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
            </label>

            <Button type="submit" className="w-full gap-2 bg-indigo-500 text-white hover:bg-indigo-400">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
              <ArrowRight className="h-4 w-4" />
            </Button>

            <div className="relative my-4 text-center text-xs uppercase tracking-[0.2em] text-zinc-500 before:absolute before:left-0 before:top-1/2 before:h-px before:w-full before:bg-white/10 before:content-['']">
              <span className="relative bg-[#10151c] px-2">Or continue with</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button variant="outline" className="gap-2">
                <Globe className="h-4 w-4" />
                GitHub
              </Button>
              <Button variant="outline" className="gap-2">
                <Mail className="h-4 w-4" />
                Google
              </Button>
            </div>
          </form>

          {status && <p className="mt-4 rounded-xl border border-indigo-400/20 bg-indigo-500/8 px-3 py-2 text-sm text-indigo-200">{status}</p>}
        </div>
      </div>
    </div>
  )
}
