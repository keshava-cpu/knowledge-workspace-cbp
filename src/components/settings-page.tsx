import { useEffect, useState } from 'react'
import { AlertTriangle, Database, HardDrive, Moon, Sun, Laptop, LoaderCircle } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { useAuth } from '../auth/auth-context'
import { getSupabaseClient } from '../lib/supabase'
import { useTheme, type Theme } from './theme-provider'

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
]

const FREE_FILE_STORAGE_LIMIT_BYTES = 1_000_000_000

function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function SettingsPage() {
  const { deleteAccount, updatePassword, user } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const supabase = getSupabaseClient()
  const userId = user?.id
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [storageBytes, setStorageBytes] = useState(0)
  const [isStorageLoading, setIsStorageLoading] = useState(true)
  const [storageUsageError, setStorageUsageError] = useState(false)

  useEffect(() => {
    if (!supabase || !userId) return

    const supabaseClient = supabase
    let isCancelled = false

    async function loadStorageUsage() {
      try {
        const { data, error: usageError } = await supabaseClient.rpc(
          'get_document_bucket_usage_bytes',
        )
        if (usageError) throw usageError

        const totalBytes = Number(data)
        if (!Number.isFinite(totalBytes) || totalBytes < 0) {
          throw new Error('Storage usage returned an invalid byte count.')
        }
        if (!isCancelled) setStorageBytes(totalBytes)
      } catch {
        if (!isCancelled) setStorageUsageError(true)
      } finally {
        if (!isCancelled) setIsStorageLoading(false)
      }
    }

    void loadStorageUsage()
    return () => {
      isCancelled = true
    }
  }, [supabase, userId])

  const remainingStorageBytes = Math.max(0, FREE_FILE_STORAGE_LIMIT_BYTES - storageBytes)

  async function handlePasswordUpdate() {
    setPasswordMessage(null)
    setError(null)
    try {
      await updatePassword(password)
      setPassword('')
      setPasswordMessage('Password sign-in is now enabled for this account.')
    } catch (passwordError) {
      setError(
        passwordError instanceof Error ? passwordError.message : 'Could not update your password.',
      )
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)
    try {
      await deleteAccount()
      navigate('/login', { replace: true })
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Could not delete your account.',
      )
      setIsDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-sm uppercase tracking-[0.22em] text-muted-foreground">Account</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Settings</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your workspace appearance and account data.
        </p>
      </header>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose how Knowledge Workspace looks on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-3">
              {themes.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  variant={theme === value ? 'default' : 'outline'}
                  className="justify-start"
                  onClick={() => setTheme(value)}
                >
                  <Icon />
                  {label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password sign-in</CardTitle>
            <CardDescription>
              Google-created accounts can set a password here to also sign in with email.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              type="password"
              name="workspace-password-update"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              placeholder="At least 6 characters"
              aria-label="New password"
              className="flex h-9 w-full max-w-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button disabled={password.length < 6} onClick={() => void handlePasswordUpdate()}>
              Set password
            </Button>
            {passwordMessage && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">{passwordMessage}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supabase storage limits</CardTitle>
            <CardDescription>
              Free-plan reference quotas. Database capacity is shared by all users of this project.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Database className="size-4 text-muted-foreground" aria-hidden="true" />
                  Postgres database
                </div>
                <p className="mt-3 text-2xl font-semibold">500 MB</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Per project, shared across its users
                </p>
              </div>
              <div className="border border-border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <HardDrive className="size-4 text-muted-foreground" aria-hidden="true" />
                  File Storage
                </div>
                <p className="mt-3 text-2xl font-semibold">1 GB</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Organization-wide, separate from database
                </p>
                <p className="mt-3 border-t border-border pt-3 text-sm">
                  Used by this app:{' '}
                  <span className="font-semibold">
                    {!supabase || !userId || storageUsageError
                      ? 'Unavailable'
                      : isStorageLoading
                        ? 'Loading...'
                        : formatBytes(storageBytes)}
                  </span>
                </p>
                <p className="mt-1 text-sm">
                  Estimated remaining:{' '}
                  <span className="font-semibold">
                    {!supabase || !userId || storageUsageError
                      ? 'Unavailable'
                      : isStorageLoading
                        ? 'Loading...'
                        : formatBytes(remainingStorageBytes)}
                  </span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Counts all users' PDFs in this app. Other buckets or projects in your organization
                  may reduce the actual remaining allowance.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              These are Free-plan limits, not live usage readings. Check your project plan and usage
              in{' '}
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Supabase Dashboard
              </a>
              .
            </p>
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle /> Delete account
            </CardTitle>
            <CardDescription>
              This permanently deletes your account, PDFs, jobs, extracted content, and Storage
              objects.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmation('')
                setError(null)
                setDeleteOpen(true)
              }}
            >
              Delete my account
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={deleteOpen} onOpenChange={(open) => !isDeleting && setDeleteOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account permanently?</DialogTitle>
            <DialogDescription>
              This is the first confirmation. All documents, parsing jobs, extracted content, and
              private PDFs tied to this account will be erased.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="delete-confirmation" className="text-sm font-medium">
              Type DELETE MY ACCOUNT to continue
            </label>
            <input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="flex h-9 w-full border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              autoComplete="off"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={isDeleting} onClick={() => setDeleteOpen(false)}>
              Keep account
            </Button>
            <Button
              variant="destructive"
              disabled={confirmation !== 'DELETE MY ACCOUNT' || isDeleting}
              onClick={() => void handleDelete()}
            >
              {isDeleting && <LoaderCircle className="animate-spin" />}
              Permanently delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
