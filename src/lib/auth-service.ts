import { getSupabaseClient } from './supabase'

export function safeReturnPath(value: string | null | undefined): string {
  try {
    const target = new URL(value || '/', window.location.origin)
    if (target.origin !== window.location.origin || target.pathname === '/auth/callback') {
      return '/'
    }
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return '/'
  }
}

export function getAuthCallbackUrl(returnTo: string | null | undefined): string {
  const callback = new URL('/auth/callback', window.location.origin)
  callback.searchParams.set('next', safeReturnPath(returnTo))
  return callback.toString()
}

function requireSupabase() {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error(
      'Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart Vite.',
    )
  }
  return client
}

export async function signInWithGoogle(returnTo: string | null | undefined): Promise<void> {
  const { error } = await requireSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: getAuthCallbackUrl(returnTo) },
  })
  if (error) throw error
}
