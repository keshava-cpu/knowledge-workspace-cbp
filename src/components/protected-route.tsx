import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
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
    return <Navigate to="/unauthorized" replace state={{ from: returnTo }} />
  }

  return children
}
