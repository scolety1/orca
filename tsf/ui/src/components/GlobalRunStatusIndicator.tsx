// Persistent global execution visibility (bug-ledger.json): a mission/run-
// specific view of what's RUNNING/PAUSED/WAITING/STALLED/VERIFYING/
// NEEDS_YOU/READY_FOR_ADOPTION, visible from anywhere in TSF (mounted once
// in AppShell.tsx's sidebar, alongside SystemStatusIndicator/
// CapacityIndicator -- same trigger-button -> Dialog-with-facts shape as
// SystemStatusIndicator.tsx, reusing real data (GET /api/work, the same
// call Work/Home/Fleet already make) rather than inventing a new endpoint
// or a vague project-level "a wave is in flight" summary.
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { RefreshCw, Radio } from 'lucide-react'
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
import { EmptyState } from '@/components/States'
import { buildGlobalRunStatusItems, sortByUrgency, mostUrgentState } from '@/lib/global-run-status'
import { liveWorkFeedBadgeVariant } from '@/lib/work-feed-lookup'
import { projectDeepLinkTo } from '@/lib/project-work-deep-link'

function relativeTime(iso: string | null): string {
  if (!iso) {
    return 'no checkpoint recorded yet'
  }
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) {
    return new Date(iso).toLocaleString()
  }
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function GlobalRunStatusIndicator() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  // Refetches on every navigation (not just on open, unlike
  // SystemStatusIndicator) -- "visible from anywhere" means the always-
  // shown trigger badge itself should stay current as the operator moves
  // around, not just once a dialog is opened.
  const { data: work, loading, reload } = useApi(() => api.work(), [location.pathname])
  const items = work ? sortByUrgency(buildGlobalRunStatusItems(work)) : []
  const urgent = mostUrgentState(items)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <Radio className="size-3" />
          {loading && !work
            ? 'Active runs…'
            : items.length === 0
              ? 'No active runs'
              : `Active runs: ${items.length}`}
          {urgent && (
            <Badge variant={liveWorkFeedBadgeVariant(urgent)} className="ml-auto">
              {urgent}
            </Badge>
          )}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>Active runs across the fleet</span>
            <button
              onClick={reload}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Refresh"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </DialogTitle>
        </DialogHeader>

        {loading && !work && (
          <p className="text-xs text-muted-foreground">Checking real run state…</p>
        )}

        {work && items.length === 0 && (
          <EmptyState title="Nothing running right now" description="No project has a live Keep Going run in progress." />
        )}

        {items.length > 0 && (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <Link
                key={item.id}
                to={projectDeepLinkTo(item.id, {
                  tab: item.state === 'READY_FOR_ADOPTION' ? 'adoption' : 'keep-going',
                  runId: item.runId
                })}
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border p-3 text-xs transition-colors hover:border-primary/40"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{item.displayName}</span>
                  <Badge variant={liveWorkFeedBadgeVariant(item.state)}>{item.state}</Badge>
                </div>
                <p className="text-muted-foreground">{item.reason}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Last checkpoint: {relativeTime(item.lastCheckpointAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
