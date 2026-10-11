import { ArrowLeft, House, LockKeyhole, SearchX } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'

export function UnauthorizedPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const returnTo = (location.state as { from?: string } | null)?.from

  return (
    <section className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-12 text-center animate-page-enter">
      <div className="mb-5 flex size-12 items-center justify-center border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
        <LockKeyhole className="size-5" aria-hidden="true" />
      </div>
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        Access required
      </p>
      <h2 className="mt-3 text-3xl font-semibold text-foreground">Please sign in</h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        You need to be signed in to view this page. Sign in to continue to your requested page.
      </p>
      <Button className="mt-6" onClick={() => navigate('/login', { state: { from: returnTo } })}>
        Sign in
      </Button>
    </section>
  )
}

export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <section className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-12 text-center animate-page-enter">
      <div className="mb-5 flex size-12 items-center justify-center border border-border bg-muted text-muted-foreground">
        <SearchX className="size-5" aria-hidden="true" />
      </div>
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        Error 404
      </p>
      <h2 className="mt-3 text-3xl font-semibold text-foreground">Page not found</h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        This address doesn't lead to a page in your workspace. Check the URL or return to your
        library.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft />
          Go back
        </Button>
        <Button onClick={() => navigate('/')}>
          <House />
          Library
        </Button>
      </div>
    </section>
  )
}
