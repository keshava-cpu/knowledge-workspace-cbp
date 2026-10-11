import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from './auth-context'
import { getSupabaseClient } from '../lib/supabase'

async function removeUserStorageObjects(userId: string) {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase authentication is not configured.')

  const bucket = client.storage.from('knowledge-workspace-documents')
  const folders = [userId]
  const paths: string[] = []

  while (folders.length > 0) {
    const folder = folders.pop()
    if (!folder) continue

    let offset = 0
    const pageSize = 100
    while (true) {
      const { data, error } = await bucket.list(folder, { limit: pageSize, offset })
      if (error) throw error

      for (const item of data) {
        const path = `${folder}/${item.name}`
        if (item.id) paths.push(path)
        else folders.push(path)
      }

      if (data.length < pageSize) break
      offset += data.length
    }
  }

  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await bucket.remove(paths.slice(index, index + 100))
    if (error) throw error
  }
}

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

    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser()
    if (userError) throw userError
    if (!user) throw new Error('Could not identify the signed-in account.')

    await removeUserStorageObjects(user.id)

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
