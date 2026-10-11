import type { ReactNode } from 'react'
import { LockKeyhole, LoaderCircle } from 'lucide-react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/auth-context'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isConfigured, isLoading, user } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div
        className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center text-sm text-muted-foreground animate-page-enter"
        aria-live="polite"
      >
        <LoaderCircle className="size-5 animate-spin text-primary" />
        <span>Restoring your secure session...</span>
      </div>
    )
  }

  if (!isConfigured || !user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center animate-page-enter">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <LockKeyhole className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Sign in required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This workspace area is private. Continue to sign in to access it.
          </p>
        </div>
        <Navigate to="/login" replace state={{ from: returnTo }} />
      </div>
    )
  }

  return children
}
