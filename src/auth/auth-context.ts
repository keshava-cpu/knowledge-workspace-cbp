import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export interface AuthContextValue {
  isConfigured: boolean
  isLoading: boolean
  session: Session | null
  user: User | null
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
