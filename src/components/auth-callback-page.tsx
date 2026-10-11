import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-context'
import { safeReturnPath } from '../lib/auth-service'

function readCallbackError(): string | null {
  const parameters = new URLSearchParams(window.location.search)
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const code = parameters.get('error_code') ?? parameters.get('error') ?? fragment.get('error')
  if (!code) return null

  if (code === 'access_denied' || code === 'user_cancelled_authorize') {
    return 'Google sign-in was cancelled. You can try again whenever you are ready.'
  }

  const description = parameters.get('error_description') ?? fragment.get('error_description') ?? ''
  return description || 'Authentication could not be completed. Please try again.'
}

export function AuthCallbackPage() {
  const { isConfigured, isLoading, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [callbackError] = useState(readCallbackError)
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get('next'))

  useEffect(() => {
    if (!callbackError && isConfigured && !isLoading && user) {
      navigate(returnTo, { replace: true })
    }
  }, [callbackError, isConfigured, isLoading, navigate, returnTo, user])

  const error =
    callbackError ??
    (!isConfigured
      ? 'Supabase is not configured. Add the required frontend environment values and restart Vite.'
      : !isLoading && !user
        ? 'Authentication could not be restored. Start sign-in again in this browser.'
        : null)

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-12 text-center">
      {error ? (
        <>
          <p
            role="alert"
            className="max-w-md border-l-2 border-destructive pl-3 text-left text-sm text-destructive"
          >
            {error}
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/login">Return to sign in</Link>
          </Button>
        </>
      ) : (
        <>
          <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden="true" />
          <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
            Restoring your Supabase session...
          </p>
        </>
      )}
    </main>
  )
}
