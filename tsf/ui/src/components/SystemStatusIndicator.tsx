// Safe Update Manager V1, operator UX (spec Phase 8): a compact, non-
// dominant entry point for TSF's own runtime/update identity -- same
// trigger-button-in-sidebar -> Dialog-with-facts shape as
// CapacityIndicator.tsx, reusing real data (GET /api/runtime-identity,
// GET /api/update-safety) unchanged. Deliberately not another dashboard --
// this never invents an "Apply Now" self-restart button, since safely
// self-restarting the very process serving this UI is a genuinely separate
// piece of engineering (a supervisor/watchdog process, not yet built) --
// it tells the operator the real, exact next command instead of
// pretending a one-click action exists.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
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
import type { RuntimeIdentityState, UpdateSafetyState } from '@/lib/system-status-types'

const RUNTIME_BADGE: Record<
  RuntimeIdentityState,
  { label: string; variant: 'healthy' | 'degraded' | 'unknown' }
> = {
  UP_TO_DATE: { label: 'Up to date', variant: 'healthy' },
  LIVE_RUNTIME_STALE: { label: 'Restart required', variant: 'degraded' },
  UI_BUNDLE_STALE: { label: 'UI rebuild needed', variant: 'degraded' },
  UNKNOWN: { label: 'Unknown', variant: 'unknown' }
}

const SAFETY_BADGE: Record<
  UpdateSafetyState,
  { label: string; variant: 'healthy' | 'degraded' | 'blocked' }
> = {
  SAFE_NOW: { label: 'Safe to update', variant: 'healthy' },
  WAIT_FOR_ACTIVE_WORK: { label: 'Active work in progress', variant: 'degraded' },
  TIM_REQUIRED: { label: 'Needs you', variant: 'blocked' }
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 10) : 'unknown'
}

export function SystemStatusIndicator() {
  const [open, setOpen] = useState(false)
  const {
    data: identity,
    loading: identityLoading,
    reload: reloadIdentity
  } = useApi(() => api.runtimeIdentity(), [open])
  const {
    data: safety,
    loading: safetyLoading,
    reload: reloadSafety
  } = useApi(() => api.updateSafety(), [open])
  const runtimeBadge = identity ? RUNTIME_BADGE[identity.state] : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <span
            className={
              runtimeBadge?.variant === 'healthy'
                ? 'size-1.5 rounded-full bg-status-healthy'
                : runtimeBadge?.variant === 'degraded'
                  ? 'size-1.5 rounded-full bg-status-degraded'
                  : 'size-1.5 rounded-full bg-status-unknown'
            }
            aria-hidden
          />
          System{runtimeBadge ? `: ${runtimeBadge.label}` : ''}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>TSF system status</span>
            <button
              onClick={() => {
                reloadIdentity()
                reloadSafety()
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Refresh"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </DialogTitle>
        </DialogHeader>

        {(identityLoading || safetyLoading) && !identity && !safety && (
          <p className="text-xs text-muted-foreground">Checking real runtime identity…</p>
        )}

        {identity && (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Runtime identity</span>
              {runtimeBadge && <Badge variant={runtimeBadge.variant}>{runtimeBadge.label}</Badge>}
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Running (this process)</span>
                <span className="font-mono">{shortSha(identity.runningCommit)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">On disk right now</span>
                <span className="font-mono">{shortSha(identity.diskCommit)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Served UI bundle</span>
                <span className="font-mono">{shortSha(identity.uiBundleCommit)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>pid {identity.pid}</span>
                <span>started {new Date(identity.startedAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{identity.reason}</p>
            </div>
          </div>
        )}

        {safety && (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Update safety</span>
              <Badge variant={SAFETY_BADGE[safety.state].variant}>
                {SAFETY_BADGE[safety.state].label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{safety.reason}</p>
            {safety.blockingProjectIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {safety.blockingProjectIds.map((id) => (
                  <Link
                    key={id}
                    to={`/projects/${id}`}
                    className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  >
                    {id}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {identity && identity.state !== 'UP_TO_DATE' && (
          <p className="rounded-md border border-border p-2 text-[11px] text-muted-foreground">
            {identity.state === 'UI_BUNDLE_STALE' &&
              'Run `cd tsf/ui && npm run build`, then reload this page.'}
            {identity.state === 'LIVE_RUNTIME_STALE' &&
              (safety?.state === 'SAFE_NOW'
                ? 'Restart the tsf-server process (e.g. reload the TSF plugin from Orca) to pick up the current commit -- no active work will be interrupted.'
                : 'A restart is needed to pick up the current commit, but real work is in progress -- wait for it to clear, or resolve what needs you, before restarting.')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
