import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router'
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
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-12 text-center">
      {error ? (
        <>
          <p
            role="alert"
            className="border-l-2 border-rose-400/60 pl-3 text-left text-sm text-rose-200"
          >
            {error}
          </p>
          <Link
            to="/login"
            className="mt-6 border border-white/15 px-4 py-2 text-sm text-zinc-200 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-1 focus-visible:outline-white"
          >
            Return to sign in
          </Link>
        </>
      ) : (
        <>
          <LoaderCircle className="h-6 w-6 animate-spin text-indigo-300" aria-hidden="true" />
          <p className="mt-4 text-sm text-zinc-300" aria-live="polite">
            Restoring your Supabase session...
          </p>
        </>
      )}
    </div>
  )
}
