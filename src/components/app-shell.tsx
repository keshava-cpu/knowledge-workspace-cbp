import { useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router'
import {
  Bell,
  BookOpenText,
  ChevronDown,
  FileText,
  Library,
  LogIn,
  Menu,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  UserCircle2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { LibraryPage } from './library-page'
import { LoginPage } from './login-page'
import { NotesPage } from './notes-page'
import { ReaderPage } from './reader-page'
import { SearchPage } from './search-page'
import { SettingsPage } from './settings-page'

interface NavItem {
  label: string
  to: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { label: 'Library', to: '/', icon: Library },
  { label: 'Reader', to: '/reader', icon: BookOpenText },
  { label: 'Search', to: '/search', icon: Search },
  { label: 'Notes', to: '/notes', icon: NotebookPen },
  { label: 'Login', to: '/login', icon: LogIn },
  { label: 'Settings', to: '/settings', icon: Settings },
]

const pageTitles: Record<string, string> = {
  '/': 'Library',
  '/reader': 'Reader',
  '/search': 'Global search',
  '/notes': 'Notes',
  '/login': 'Account',
  '/settings': 'Settings',
}

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const activeTitle = pageTitles[location.pathname] ?? 'Knowledge workspace'

  return (
    <div className="min-h-screen bg-[#0b0d12] text-zinc-100">
      <div className="flex min-h-screen">
        <aside
          className={[
            'border-r border-white/10 bg-[#11151c] transition-all duration-200',
            sidebarCollapsed ? 'hidden w-20 lg:block' : 'hidden w-64 lg:block',
            mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 block w-64 lg:hidden' : 'hidden',
          ].join(' ')}
        >
          <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-wide">Knowledge</p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Workspace</p>
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse sidebar"
              className="ml-auto hidden lg:inline-flex"
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              <ChevronDown
                className={[
                  'h-4 w-4 transition-transform',
                  sidebarCollapsed ? 'rotate-90' : '-rotate-90',
                ].join(' ')}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close menu"
              className="inline-flex lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <nav className="space-y-2 px-3 py-4">
            {navItems.map(({ label, to, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-white/5 text-white ring-1 ring-white/10'
                      : 'text-zinc-300 hover:bg-white/3 hover:text-white',
                    sidebarCollapsed ? 'justify-center px-2' : '',
                  ].join(' ')
                }
              >
                <Icon className="h-4 w-4" />
                {!sidebarCollapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </nav>

          <div
            className={[
              'mt-auto border-t border-white/10 p-3',
              sidebarCollapsed ? 'px-2' : '',
            ].join(' ')}
          >
            <div
              className={[
                'flex items-center gap-3 rounded-lg bg-white/3 p-2',
                sidebarCollapsed ? 'justify-center' : '',
              ].join(' ')}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30">
                <UserCircle2 className="h-4 w-4" />
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">Ava Chen</p>
                  <p className="text-[11px] text-zinc-400">Researcher</p>
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-white/10 bg-[#0b0d12]/90 px-4 backdrop-blur-sm sm:px-6">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle sidebar"
                className="inline-flex lg:hidden"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Toggle sidebar"
                className="hidden lg:inline-flex"
                onClick={() => setSidebarCollapsed((value) => !value)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Workspace</p>
                <h1 className="text-lg font-semibold text-zinc-100">{activeTitle}</h1>
              </div>
            </div>

            <div className="hidden min-w-0 flex-1 items-center justify-center px-4 md:flex">
              <label className="flex w-full max-w-xl items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
                <Search className="h-4 w-4 text-zinc-400" />
                <input
                  aria-label="Global search"
                  placeholder="Search concepts, books, or passages"
                  className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" aria-label="Notifications">
                <Bell className="h-4 w-4" />
              </Button>
              <Button variant="outline" className="hidden sm:inline-flex">
                <FileText className="mr-2 h-4 w-4" />
                New note
              </Button>
              <Button variant="secondary" className="gap-2">
                <UserCircle2 className="h-4 w-4" />
                Ava
              </Button>
            </div>
          </header>

          <main className="flex-1 overflow-auto bg-[#0b0d12]">
            <Routes>
              <Route path="/" element={<LibraryPage />} />
              <Route path="/reader" element={<ReaderPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}
