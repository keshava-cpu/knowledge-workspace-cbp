import { LoaderCircle } from 'lucide-react'
import { BrowserRouter, Navigate, useLocation } from 'react-router'
import { AuthProvider } from './auth/auth-provider'
import { AppShell } from './components/app-shell'
import { AuthCallbackPage } from './components/auth-callback-page'
import { LoginPage } from './components/login-page'
import { ThemeProvider } from './components/theme-provider'
import { useAuth } from './auth/auth-context'

function AppRoutes() {
  const { isLoading, user } = useAuth()
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}${location.hash}`

  if (location.pathname === '/auth/callback') {
    return <AuthCallbackPage />
  }

  if (isLoading) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />
        <p aria-live="polite">Restoring your session...</p>
      </main>
    )
  }

  if (!user) {
    return location.pathname === '/login' ? (
      <LoginPage />
    ) : (
      <Navigate to="/login" replace state={{ from: returnTo }} />
    )
  }

  if (location.pathname === '/login') {
    return <Navigate to="/" replace />
  }

  return <AppShell />
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="knowledge-workspace-theme">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
