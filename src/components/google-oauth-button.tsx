import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { signInWithGoogle } from '../lib/auth-service'

interface GoogleOAuthButtonProps {
  returnTo: string
  disabled?: boolean
  onError: (message: string) => void
  onPendingChange: (pending: boolean) => void
}

export function GoogleOAuthButton({
  returnTo,
  disabled = false,
  onError,
  onPendingChange,
}: GoogleOAuthButtonProps) {
  const [isPending, setIsPending] = useState(false)

  async function handleClick() {
    if (disabled || isPending) return
    setIsPending(true)
    onPendingChange(true)
    onError('')

    try {
      await signInWithGoogle(returnTo)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Google sign-in could not be started.')
      setIsPending(false)
      onPendingChange(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-3 border-border bg-background text-foreground hover:bg-accent"
      disabled={disabled || isPending}
      aria-busy={isPending}
      onClick={() => void handleClick()}
    >
      {isPending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-5 items-center justify-center border border-border bg-white text-sm font-bold text-[#4285f4]"
        >
          G
        </span>
      )}
      {isPending ? 'Connecting to Google...' : 'Continue with Google'}
    </Button>
  )
}
