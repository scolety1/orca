// Operator UX pass (spec sections 7 & 8): multi-project mission launch.
// Usage Mode now belongs here, at the point of launching real work, not
// pinned to the top of the Projects browse page. Reuses the real,
// per-project, already-governed Keep Going start (api.startKeepGoing) for
// each selected project -- a common goal or per-project goals, never one
// shared session/worktree; each project stays independently governed.
import { useState } from 'react'
import { Loader2, PlayCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError } from '@/lib/api'

type GoalMode = 'COMMON' | 'PER_PROJECT'

const USAGE_MODES = ['TEST_MINIMAL', 'ECONOMY', 'BALANCED', 'MAXIMUM']

export function StartMissionDialog({
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
  const [mode, setMode] = useState<GoalMode>('COMMON')
  const [commonGoal, setCommonGoal] = useState('')
  const [perProjectGoal, setPerProjectGoal] = useState<Record<string, string>>({})
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [usageMode, setUsageMode] = useState('BALANCED')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<
    { projectId: string; ok: boolean; detail: string }[] | null
  >(null)

  const criteria = acceptanceCriteria
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const canStart =
    projectIds.length > 0 &&
    criteria.length > 0 &&
    (mode === 'COMMON'
      ? commonGoal.trim().length > 0
      : projectIds.every((id) => (perProjectGoal[id] ?? '').trim().length > 0))

  async function start() {
    setBusy(true)
    setResults(null)
    const outcomes = await Promise.allSettled(
      projectIds.map((projectId) =>
        api.startKeepGoing(projectId, {
          originalGoal: mode === 'COMMON' ? commonGoal.trim() : perProjectGoal[projectId].trim(),
          acceptanceCriteria: criteria,
          usageMode
        })
      )
    )
    setResults(
      outcomes.map((outcome, i) => ({
        projectId: projectIds[i],
        ok: outcome.status === 'fulfilled',
        detail:
          outcome.status === 'fulfilled'
            ? 'Started.'
            : outcome.reason instanceof ApiError
              ? outcome.reason.message
              : 'Failed to start.'
      }))
    )
    setBusy(false)
    onStarted()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="size-4 text-primary" />
            Start mission
          </DialogTitle>
          <DialogDescription>
            {projectIds.length} project(s) selected. Each project starts its own real, independently
            governed Keep Going run -- never one shared session.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2 text-[11px]">
            {projectIds.map((id) => (
              <span key={id} className="rounded-full border border-border px-2 py-0.5">
                {id}
              </span>
            ))}
          </div>

          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={mode === 'COMMON' ? 'secondary' : 'outline'}
              onClick={() => setMode('COMMON')}
            >
              Common goal
            </Button>
            <Button
              size="sm"
              variant={mode === 'PER_PROJECT' ? 'secondary' : 'outline'}
              onClick={() => setMode('PER_PROJECT')}
            >
              Per-project goals
            </Button>
          </div>

          {mode === 'COMMON' ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Goal (applies to every selected project)
              </label>
              <Textarea
                value={commonGoal}
                onChange={(e) => setCommonGoal(e.target.value)}
                placeholder="Continue each selected project toward its currently recommended next bounded mission."
                rows={3}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {projectIds.map((id) => (
                <div key={id}>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    {id}
                  </label>
                  <Textarea
                    value={perProjectGoal[id] ?? ''}
                    onChange={(e) =>
                      setPerProjectGoal((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                    placeholder={`Goal for ${id}…`}
                    rows={2}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Acceptance criteria (one per line, applies to every selected project)
            </label>
            <Textarea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder={'Real tests pass\nNo new lint/typecheck failures'}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[11px] font-medium text-muted-foreground">Usage Mode</label>
            <select
              value={usageMode}
              onChange={(e) => setUsageMode(e.target.value)}
              className="rounded-md border border-input bg-input px-2 py-1 text-xs"
            >
              {USAGE_MODES.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              Provider strategy: capacity + expiry aware (automatic)
            </span>
          </div>

          {results && (
            <div className="flex flex-col gap-1 rounded-md border border-border p-2 text-[11px]">
              {results.map((r) => (
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
                <PlayCircle className="size-4" />
              )}
              Start mission
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
