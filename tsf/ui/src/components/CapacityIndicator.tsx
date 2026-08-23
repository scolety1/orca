// Operator UX pass (spec section 6): a compact, non-dominant entry point
// for real provider capacity/reset info, reusing the real M5 signal
// unchanged (GET /api/capacity -- see server/capacity-http-routes.mjs).
// Never fabricates a number the CLI didn't report: a missing reading
// renders as "Unknown", not a guessed 0%/100%.
import { useState } from 'react'
import { BatteryMedium } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { ProviderCapacity } from '@/lib/capacity-types'

function formatResetIn(resetsAt: number | null): string | null {
  if (!resetsAt) {
    return null
  }
  const ms = resetsAt - Date.now()
  if (ms <= 0) {
    return 'resetting now'
  }
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return `${hours}h ${minutes}m`
}

function actionVariant(action?: string): 'healthy' | 'degraded' | 'blocked' | 'neutral' {
  if (!action || action === 'PROCEED') {
    return 'healthy'
  }
  if (action === 'PAUSE_AND_CHECKPOINT') {
    return 'blocked'
  }
  return 'degraded'
}

function ProviderPanel({ provider, label }: { provider: ProviderCapacity; label: string }) {
  if (!provider.available) {
    return (
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          <Badge variant="neutral">Unknown</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          No real capacity reading from this machine&apos;s Orca CLI right now.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant={actionVariant(provider.capacityAction?.action)}>
          {provider.capacityAction?.action.replace(/_/g, ' ') ?? 'Unknown'}
        </Badge>
      </div>
      <div className="flex flex-col gap-1.5 text-xs">
        {provider.session && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Session remaining</span>
            <span>
              {provider.session.remainingPercent}%
              {formatResetIn(provider.session.resetsAt) && (
                <span className="ml-1.5 text-muted-foreground">
                  · reset {formatResetIn(provider.session.resetsAt)}
                </span>
              )}
            </span>
          </div>
        )}
        {provider.weekly && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Weekly remaining</span>
            <span>
              {provider.weekly.remainingPercent}%
              {formatResetIn(provider.weekly.resetsAt) && (
                <span className="ml-1.5 text-muted-foreground">
                  · reset {formatResetIn(provider.weekly.resetsAt)}
                </span>
              )}
            </span>
          </div>
        )}
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{provider.primaryRole}</span>
          {provider.status && <span>status: {provider.status}</span>}
        </div>
        {provider.capacityAction && (
          <p className="mt-1 text-[11px] text-muted-foreground">{provider.capacityAction.reason}</p>
        )}
      </div>
    </div>
  )
}

// The single compact number shown on the collapsed trigger -- the worse
// (lower-remaining) of the two providers' remaining percent, so a glance
// at the sidebar answers "is anything close to running out."
function worstRemaining(
  snapshot: { claude: ProviderCapacity; codex: ProviderCapacity } | null
): number | null {
  if (!snapshot) {
    return null
  }
  const values = [snapshot.claude.remainingPercent, snapshot.codex.remainingPercent].filter(
    (v): v is number => v !== null && v !== undefined
  )
  return values.length ? Math.min(...values) : null
}

export function CapacityIndicator() {
  const [open, setOpen] = useState(false)
  const { data: snapshot, loading } = useApi(() => api.capacity(), [open])
  const available = snapshot?.ok && snapshot.available ? snapshot : null
  const worst = worstRemaining(available)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <BatteryMedium className="size-3.5" />
          Capacity{worst !== null ? `: ${worst}%` : ''}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provider capacity</DialogTitle>
        </DialogHeader>
        {loading && <p className="text-xs text-muted-foreground">Checking real provider usage…</p>}
        {snapshot?.ok && !snapshot.available && (
          <p className="text-xs text-muted-foreground">
            Capacity is honestly unknown right now{snapshot.reason ? ` (${snapshot.reason})` : ''}{' '}
            -- not enough to fabricate a reading.
          </p>
        )}
        {available && (
          <div className="flex flex-col gap-3">
            <ProviderPanel provider={available.claude} label="Claude" />
            <ProviderPanel provider={available.codex} label="Codex" />
            <p className="text-[10px] text-muted-foreground">
              Observed {new Date(available.observedAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
