import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from './auth-context'
import { getSupabaseClient } from '../lib/supabase'

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = getSupabaseClient()
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(() => client !== null)

  useEffect(() => {
    if (!client) return

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [client])

  async function signOut() {
    if (!client) return
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) throw error
  }

  async function deleteAccount() {
    if (!client) throw new Error('Supabase authentication is not configured.')
    const { error } = await client.rpc('delete_my_account')
    if (error) throw error
    await client.auth.signOut({ scope: 'local' })
  }

  async function updatePassword(password: string) {
    if (!client) throw new Error('Supabase authentication is not configured.')
    const { error } = await client.auth.updateUser({ password })
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        isConfigured: client !== null,
        isLoading,
        session,
        user: session?.user ?? null,
        signOut,
        deleteAccount,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
