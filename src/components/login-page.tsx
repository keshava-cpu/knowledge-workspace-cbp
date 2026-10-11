import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, Mail } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-context'
import { GoogleOAuthButton } from './google-oauth-button'
import { getAuthCallbackUrl, safeReturnPath } from '../lib/auth-service'
import { getSupabaseClient } from '../lib/supabase'

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { isConfigured, isLoading, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const returnTo = safeReturnPath((location.state as { from?: string } | null)?.from)

  useEffect(() => {
    if (!isLoading && user) navigate(returnTo, { replace: true })
  }, [isLoading, navigate, returnTo, user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    setError('')
    setNotice('')

    const supabase = getSupabaseClient()
    if (!supabase) {
      setError(
        'Authentication is not configured. Add the Supabase frontend values and restart Vite.',
      )
      return
    }

    setIsPending(true)
    try {
      if (mode === 'signin') {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (authError) throw authError
        if (!data.session) {
          setError('Sign-in returned no active session. Please try again.')
        }
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: getAuthCallbackUrl(returnTo),
          },
        })
        if (authError) throw authError
        if (!data.session) {
          setNotice(
            'Check your email for a confirmation link. Open it in this same browser and browser profile, then return here to sign in.',
          )
        }
      }
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : 'Authentication failed. Please try again.',
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-6 overflow-hidden border border-white/10 bg-[#10151c] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="border-b border-white/10 bg-gradient-to-br from-indigo-500/8 via-transparent to-transparent p-8 lg:border-b-0 lg:border-r">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300">Access</p>
          <h2 className="mt-4 text-4xl font-semibold text-white">
            A focused workspace for reading and research.
          </h2>
          <p className="mt-4 max-w-md text-zinc-300">
            Sign in to access your private workspace, notes and ingested documents.
          </p>

          <div className="mt-8 space-y-3 text-sm text-zinc-200">
            <div className="flex items-center gap-3 border border-white/10 bg-white/[0.02] p-3">
              <Mail className="h-4 w-4 text-indigo-300" />
              <span>Document access and reading metadata</span>
            </div>
            <div className="flex items-center gap-3 border border-white/10 bg-white/[0.02] p-3">
              <KeyRound className="h-4 w-4 text-indigo-300" />
              <span>Email and Google authentication through Supabase Auth</span>
            </div>
          </div>
        </div>

        <div className="p-8">
          <div
            className="mb-6 inline-flex border border-white/10 bg-white/[0.03] p-1"
            role="group"
            aria-label="Authentication method"
          >
            <button
              type="button"
              aria-pressed={mode === 'signin'}
              disabled={isPending}
              onClick={() => setMode('signin')}
              className={[
                'border px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-300 disabled:opacity-50',
                mode === 'signin' ? 'bg-white text-zinc-950' : 'text-zinc-300',
              ].join(' ')}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === 'register'}
              disabled={isPending}
              onClick={() => setMode('register')}
              className={[
                'border border-transparent px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-300 disabled:opacity-50',
                mode === 'register' ? 'bg-white text-zinc-950' : 'text-zinc-300',
              ].join(' ')}
            >
              Register
            </button>
          </div>

          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            {mode === 'register' && (
              <label className="block text-sm text-zinc-300">
                Full name
                <input
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Ava Chen"
                  className="mt-2 w-full border border-white/10 bg-[#0d1117] px-3 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-300"
                />
              </label>
            )}

            <label className="block text-sm text-zinc-300">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ava@workspace.example"
                className="mt-2 w-full border border-white/10 bg-[#0d1117] px-3 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-300"
              />
            </label>

            <label className="block text-sm text-zinc-300">
              Password
              <input
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="mt-2 w-full border border-white/10 bg-[#0d1117] px-3 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-300"
              />
            </label>

            <Button
              type="submit"
              disabled={isPending || !isConfigured}
              aria-busy={isPending}
              className="w-full gap-2 bg-indigo-500 text-white hover:bg-indigo-400"
            >
              {isPending
                ? 'Working...'
                : mode === 'signin'
                  ? 'Sign in with email'
                  : 'Create account'}
              {!isPending && <ArrowRight className="h-4 w-4" />}
            </Button>

            <div className="relative my-4 text-center text-xs uppercase tracking-[0.2em] text-zinc-500 before:absolute before:left-0 before:top-1/2 before:h-px before:w-full before:bg-white/10 before:content-['']">
              <span className="relative bg-[#10151c] px-2">Or</span>
            </div>

            <GoogleOAuthButton
              returnTo={returnTo}
              disabled={isPending}
              onError={setError}
              onPendingChange={setIsPending}
            />
          </form>

          {!isConfigured && (
            <p className="mt-4 border-l-2 border-amber-300/60 pl-3 text-sm text-amber-100">
              Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to a root .env.local file,
              then restart Vite to enable authentication.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 border-l-2 border-rose-400/60 pl-3 text-sm text-rose-200"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mt-4 border-l-2 border-emerald-400/60 pl-3 text-sm text-emerald-200"
            >
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
