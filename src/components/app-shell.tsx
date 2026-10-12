import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Bell, FileText, Search } from 'lucide-react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '../../components/ui/sidebar'
import { AppSidebar } from '../../components/app-sidebar'
import { useAuth } from '../auth/auth-context'
import { LibraryPage } from './library-page'
import { NotesPage } from './notes-page'
import { ProtectedRoute } from './protected-route'
import { ReaderPage } from './reader-page'
import { SearchPage } from './search-page'
import { SettingsPage } from './settings-page'
import { NotFoundPage, UnauthorizedPage } from './status-pages'

const pageTitles: Record<string, string> = {
  '/': 'Library',
  '/reader': 'Reader',
  '/search': 'Global search',
  '/notes': 'Notes',
  '/login': 'Account',
  '/unauthorized': 'Access required',
  '/settings': 'Settings',
}

const DocumentReaderPage = lazy(() =>
  import('./document-reader-page').then((module) => ({ default: module.DocumentReaderPage })),
)

export function AppShell() {
  const [signOutError, setSignOutError] = useState('')
  const [globalQuery, setGlobalQuery] = useState('')
  const globalSearchRef = useRef<HTMLInputElement>(null)
  const { user, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTitle = location.pathname.startsWith('/documents/')
    ? 'Document'
    : (pageTitles[location.pathname] ??
      (location.pathname === '/auth/callback'
        ? 'Account'
        : location.pathname === '/unauthorized'
          ? 'Access required'
          : 'Page not found'))

  useEffect(() => {
    function focusGlobalSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        globalSearchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusGlobalSearch)
    return () => window.removeEventListener('keydown', focusGlobalSearch)
  }, [])

  async function handleSignOut() {
    setSignOutError('')
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Could not sign out.')
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar user={user} onSignOut={handleSignOut} />
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="-ml-2" />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Workspace
              </p>
              <h1 className="truncate text-lg font-semibold text-foreground">{activeTitle}</h1>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-center px-4 md:flex">
            <label className="flex w-full max-w-xl items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
              <Search className="size-4" />
              <input
                ref={globalSearchRef}
                type="text"
                name="workspace-search"
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter')
                    navigate(`/search?q=${encodeURIComponent(globalQuery)}`)
                }}
                aria-label="Global search"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Search concepts, books, or passages"
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label="Notifications">
              <Bell />
            </Button>
            <Button
              variant="outline"
              className="hidden sm:inline-flex"
              onClick={() => navigate('/notes')}
            >
              <FileText className="mr-2 size-4" />
              New note
            </Button>
          </div>
        </header>

        <main className="min-h-[calc(100vh-4rem)] flex-1 bg-background">
          {signOutError && (
            <p
              role="alert"
              className="border-b border-destructive/20 bg-destructive/10 px-6 py-2 text-sm text-destructive"
            >
              {signOutError}
            </p>
          )}
          <div key={`${location.pathname}${location.search}`} className="animate-page-enter">
            <Routes>
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <LibraryPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/reader"
                element={
                  <ProtectedRoute>
                    <ReaderPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/search"
                element={
                  <ProtectedRoute>
                    <SearchPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/notes"
                element={
                  <ProtectedRoute>
                    <NotesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/documents/:documentId"
                element={
                  <ProtectedRoute>
                    <Suspense
                      fallback={
                        <div className="p-8 text-sm text-muted-foreground" role="status">
                          Opening document...
                        </div>
                      }
                    >
                      <DocumentReaderPage />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route path="/unauthorized" element={<UnauthorizedPage />} />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
