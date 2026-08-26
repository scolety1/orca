// Operator UX pass (spec section 9): "Start Overnight Fleet" as a
// first-class flow. Composes existing, already-adopted systems only --
// per-project Keep Going start (M2), the real capacity signal (M5, via
// GET /api/capacity) for a safe-recommendation note -- no new scheduler.
// Runs sequentially in priority order: one project's TIM_REQUIRED/blocked
// state is reported and skipped, never stopping the rest of the batch.
import { useEffect, useState } from 'react'
import { Loader2, CalendarClock, GripVertical } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useApi } from '@/lib/use-api'
import { api, ApiError } from '@/lib/api'
import { OVERNIGHT_USAGE_MODES as USAGE_MODES } from '@/lib/usage-modes'
import { useSensitiveProjectIds } from '@/lib/use-sensitive-project-ids'

const DEFAULT_CRITERIA =
  'Real tests pass\nNo new lint/typecheck failures\nStop and checkpoint at any TIM_REQUIRED, credentials, destructive, or production-impacting decision'
const DEFAULT_GOAL = 'Continue this project toward its currently recommended next bounded mission.'

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function StartOvernightFleetDialog({
  open,
  onOpenChange,
  projectIds,
  onStarted
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectIds: string[]
  onStarted: () => void
}) {
  const [order, setOrder] = useState<string[]>(projectIds)
  const [globalMode, setGlobalMode] = useState('MAXIMUM')
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA)
  const [continueAroundBlocked, setContinueAroundBlocked] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<
    { projectId: string; ok: boolean; runId?: string; state?: string; detail: string }[]
  >([])
  const { data: capacity } = useApi(() => api.capacity(), [open])
  const sensitiveIds = useSensitiveProjectIds(open)

  useEffect(() => {
    setOrder(projectIds)
  }, [projectIds])

  const criteriaList = criteria
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const canStart = order.length > 0 && criteriaList.length > 0

  async function start() {
    setBusy(true)
    setProgress([])
    for (const projectId of order) {
      try {
        const runView = await api.startKeepGoing(projectId, {
          originalGoal: DEFAULT_GOAL,
          acceptanceCriteria: criteriaList,
          usageMode: overrides[projectId] ?? globalMode
        })
        setProgress((prev) => [
          ...prev,
          runView.started
            ? {
                projectId,
                ok: true,
                runId: runView.runId,
                state: runView.state,
                detail: `Mission created -- run ${runView.runId}, status ${runView.state}.`
              }
            : {
                projectId,
                ok: false,
                detail: 'Server accepted the request but did not report a started run.'
              }
        ])
      } catch (err) {
        const detail = err instanceof ApiError ? err.message : 'Failed to start.'
        setProgress((prev) => [...prev, { projectId, ok: false, detail }])
        if (!continueAroundBlocked) {
          break
        }
      }
    }
    setBusy(false)
    onStarted()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" />
            Start overnight fleet
          </DialogTitle>
          <DialogDescription>
            Starts each project&apos;s own real Keep Going run in priority order -- reuses Keep
            Going, capacity-aware routing, and Work Set as they already exist; no second scheduler.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Priority (drag not required -- use the arrows)
            </label>
            <div className="flex flex-col gap-1">
              {order.map((id, i) => (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                >
                  <GripVertical className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{id}</span>
                  {sensitiveIds.has(id) && (
                    <span
                      className="rounded-full border border-status-blocked/40 bg-status-blocked/10 px-1.5 py-0.5 text-[10px] text-status-blocked"
                      title="Sensitive project -- High Assurance is a reserved usage mode, not yet available. No usage mode substitutes for it."
                    >
                      High Assurance required (reserved)
                    </span>
                  )}
                  <select
                    value={overrides[id] ?? ''}
                    onChange={(e) =>
                      setOverrides(
                        (prev) =>
                          ({ ...prev, [id]: e.target.value || undefined }) as Record<string, string>
                      )
                    }
                    className="rounded-md border border-input bg-input px-1.5 py-0.5 text-[10px]"
                    title="Per-project Usage Mode override"
                  >
                    <option value="">Global ({globalMode.replace(/_/g, ' ')})</option>
                    {USAGE_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={i === 0}
                    onClick={() => setOrder((prev) => move(prev, i, i - 1))}
                    className="rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label={`Move ${id} up`}
                  >
                    ↑
                  </button>
                  <button
                    disabled={i === order.length - 1}
                    onClick={() => setOrder((prev) => move(prev, i, i + 1))}
                    className="rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label={`Move ${id} down`}
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[11px] font-medium text-muted-foreground">
              Global Usage Mode
            </label>
            <select
              value={globalMode}
              onChange={(e) => setGlobalMode(e.target.value)}
              className="rounded-md border border-input bg-input px-2 py-1 text-xs"
            >
              {USAGE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={continueAroundBlocked}
              onChange={(e) => setContinueAroundBlocked(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Continue around blocked projects (recommended -- one project failing to start never
            stops the rest)
          </label>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Acceptance criteria (applies to every project; edit as needed)
            </label>
            <Textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={3} />
          </div>

          {capacity?.ok && capacity.available && (
            <p className="rounded-md border border-border p-2 text-[11px] text-muted-foreground">
              TSF&apos;s recommendation, from real provider capacity: Claude{' '}
              {capacity.claude.capacityAction?.action.replace(/_/g, ' ').toLowerCase() ?? 'unknown'}
              , Codex{' '}
              {capacity.codex.capacityAction?.action.replace(/_/g, ' ').toLowerCase() ?? 'unknown'}.
              Prefer spending Claude planning/review capacity before it resets; preserve Codex
              implementation capacity for the run.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Stops for: consequential product decisions, adoption requiring you, credentials/money,
            production, destructive actions, and source/admission ambiguity -- same as any other
            Keep Going run.
          </p>

          {progress.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-border p-2 text-[11px]">
              {progress.map((r) => (
                <div
                  key={r.projectId}
                  className={r.ok ? 'text-status-healthy' : 'text-destructive'}
                >
                  {r.projectId}: {r.detail}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button size="sm" disabled={!canStart || busy} onClick={start}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              Start overnight fleet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
