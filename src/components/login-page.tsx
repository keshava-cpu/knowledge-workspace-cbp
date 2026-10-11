import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, BookOpen, LoaderCircle } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Separator } from '../../components/ui/separator'
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
        if (authError) {
          if (/already (?:been )?(?:registered|exists)/i.test(authError.message)) {
            setError('An account with this email already exists. Please sign in instead.')
            return
          }
          throw authError
        }
        if (data.user?.identities?.length === 0) {
          setError('An account with this email already exists. Please sign in instead.')
          return
        }
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
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/35 px-4 py-10">
      <div className="w-full max-w-md animate-page-enter">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BookOpen className="size-5" aria-hidden="true" />
          </div>
          <span className="text-lg font-semibold text-foreground">Knowledge Workspace</span>
        </div>

        <Card className="gap-0 border-border/80 shadow-lg shadow-black/5">
          <CardHeader className="gap-2 px-6 pb-5 pt-6">
            <CardTitle className="text-2xl">
              {returnTo !== '/' ? 'Sign in to continue' : 'Welcome back'}
            </CardTitle>
            <CardDescription>
              {returnTo !== '/'
                ? 'Sign in to access this private area of your workspace.'
                : 'Sign in to continue your reading and research.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="px-6 pb-6">
            <div
              className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
              role="group"
              aria-label="Account action"
            >
              <Button
                type="button"
                variant={mode === 'signin' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'signin'}
                disabled={isPending}
                onClick={() => setMode('signin')}
              >
                Sign in
              </Button>
              <Button
                type="button"
                variant={mode === 'register' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'register'}
                disabled={isPending}
                onClick={() => setMode('register')}
              >
                Create account
              </Button>
            </div>

            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              {mode === 'register' && (
                <label htmlFor="full-name" className="block space-y-1.5 text-sm font-medium">
                  <span>Full name</span>
                  <Input
                    id="full-name"
                    type="text"
                    autoComplete="name"
                    required
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Ava Chen"
                  />
                </label>
              )}

              <label htmlFor="email" className="block space-y-1.5 text-sm font-medium">
                <span>Email</span>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>

              <label htmlFor="password" className="block space-y-1.5 text-sm font-medium">
                <span>Password</span>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                />
              </label>

              <Button
                type="submit"
                disabled={isPending || !isConfigured}
                aria-busy={isPending}
                className="w-full"
              >
                {isPending ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Working...
                  </>
                ) : (
                  <>
                    {mode === 'signin' ? 'Sign in with email' : 'Create account'}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">OR</span>
              <Separator className="flex-1" />
            </div>

            <GoogleOAuthButton
              returnTo={returnTo}
              disabled={isPending || !isConfigured}
              onError={setError}
              onPendingChange={setIsPending}
            />

            {!isConfigured && (
              <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">
                Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local, then restart
                Vite to enable authentication.
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mt-4 border-l-2 border-destructive pl-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {notice && (
              <p
                role="status"
                className="mt-4 border-l-2 border-primary pl-3 text-sm text-muted-foreground"
              >
                {notice}
              </p>
            )}
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Your private library, notes, and documents in one place.
        </p>
      </div>
    </main>
  )
}
