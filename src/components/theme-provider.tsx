/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light' | 'system'
type ThemeProviderProps = { children: ReactNode; defaultTheme?: Theme; storageKey?: string }
type ThemeProviderState = { theme: Theme; setTheme: (theme: Theme) => void }

const ThemeProviderContext = createContext<ThemeProviderState>({
  theme: 'system',
  setTheme: () => null,
})

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  )

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme
    root.classList.add(resolved)
  }, [theme])

  function setTheme(nextTheme: Theme) {
    localStorage.setItem(storageKey, nextTheme)
    setThemeState(nextTheme)
  }

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeProviderContext)
}
