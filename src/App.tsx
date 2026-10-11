import { BrowserRouter } from 'react-router'
import { AuthProvider } from './auth/auth-provider'
import { AppShell } from './components/app-shell'
import { ThemeProvider } from './components/theme-provider'

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="knowledge-workspace-theme">
      <BrowserRouter>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
