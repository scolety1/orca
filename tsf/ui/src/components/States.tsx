import type { ReactNode } from 'react'
import { Loader2, AlertCircle, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <AlertCircle className="size-7 text-destructive" />
      <div className="text-sm text-foreground">{message}</div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

// A background refresh failing (e.g. Retry, a bulk action, RefreshProjectButton)
// must not replace still-good, already-loaded data with a full-page error --
// only a genuine first load with no data yet should do that. Callers show
// this alongside the existing view instead.
export function RefreshFailedBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-status-degraded/40 bg-status-degraded/5 px-3 py-2 text-xs text-status-degraded">
      <div className="flex items-center gap-2">
        <AlertCircle className="size-3.5 shrink-0" />
        <span>{message} — showing the last data loaded.</span>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-7" />}</div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && <div className="max-w-sm text-xs text-muted-foreground">{description}</div>}
      {action}
    </div>
  )
}
