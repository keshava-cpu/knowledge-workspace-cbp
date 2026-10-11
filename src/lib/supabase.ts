import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null | undefined

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client

  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) {
    client = null
    return client
  }

  try {
    new URL(url)
    client = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        // AuthCallbackPage performs the single PKCE code exchange explicitly.
        detectSessionInUrl: true,
        flowType: 'pkce',
        persistSession: true,
      },
    })
  } catch {
    client = null
  }

  return client
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseClient() !== null
}
