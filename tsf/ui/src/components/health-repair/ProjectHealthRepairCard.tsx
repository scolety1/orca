import { useState } from 'react'
import { Bot, ClipboardList, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { RepairClassBadge } from '@/components/RepairClassBadge'
import { api, ApiError } from '@/lib/api'
import type {
  HealthCauseDiagnosis,
  ProjectHealthDiagnosis,
  RepairMissionSpec
} from '@/lib/health-repair-types'

// One cause row: its own summary, badge, and (for AUTO_REPAIR_SAFE /
// GOVERNED_REPAIR_MISSION only) an action. TIM_REQUIRED and NOT_A_DEFECT
// causes are shown for evidence but never carry an action button here --
// see STYLEGUIDE.md's "UI copy must not overclaim" rule: nothing renders
// a button implying TSF can act on a cause it genuinely cannot.
function CauseRow({
  cause,
  onRepair,
  onPrepareMission,
  busy
}: {
  cause: HealthCauseDiagnosis
  onRepair: (cause: HealthCauseDiagnosis) => void
  onPrepareMission: (cause: HealthCauseDiagnosis) => void
  busy: boolean
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{cause.cause}</span>
          <RepairClassBadge repairClass={cause.repairClass} />
        </div>
        <p className="mt-0.5 text-[12px] text-foreground/90">{cause.summary}</p>
      </div>
      {cause.repairClass === 'AUTO_REPAIR_SAFE' && (
        <Button size="xs" variant="secondary" disabled={busy} onClick={() => onRepair(cause)}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Bot className="size-3" />}
          Repair
        </Button>
      )}
      {cause.repairClass === 'GOVERNED_REPAIR_MISSION' && (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => onPrepareMission(cause)}>
          <Wrench className="size-3" />
          Prepare mission
        </Button>
      )}
    </li>
  )
}

// Recovered from a stranded uncommitted worktree, reconciled: busy/running
// state for Repair and Run-baseline now lives in the parent
// (HealthRepairCenterPage's health-repair-activity.ts tracking, durable
// across navigation) instead of local state here -- this card is now a
// controlled component for those two actions. Mission-prep stays local
// (never part of the durable-activity refactor): it never mutates project
// state, so nothing needs to survive this card unmounting. BUG-05's
// result.error / repairResult?.reason / repairResult?.detail fallback
// chain (added to `repair()` independently on current main after the
// stranded worktree diverged) is preserved -- moved into the parent's
// startRepair, see HealthRepairCenterPage.tsx.
export function ProjectHealthRepairCard({
  project,
  selected,
  onToggleSelected,
  runningCause,
  baselineRunning,
  onStartRepair,
  onStartBaseline
}: {
  project: ProjectHealthDiagnosis
  selected: boolean
  onToggleSelected: (checked: boolean) => void
  runningCause: string | null
  baselineRunning: boolean
  onStartRepair: (cause: string) => void
  onStartBaseline: () => void
}) {
  const [missionBusyCause, setMissionBusyCause] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missionSpec, setMissionSpec] = useState<RepairMissionSpec | null>(null)

  async function prepareMission(cause: HealthCauseDiagnosis) {
    setMissionBusyCause(cause.cause)
    setError(null)
    try {
      const result = await api.healthRepairPrepareMission(project.projectId, cause.cause)
      if (!result.ok) {
        setError('error' in result ? result.error : 'Could not prepare a mission.')
        return
      }
      setMissionSpec(result.spec)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not prepare a mission.')
    } finally {
      setMissionBusyCause(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-1"
            checked={selected}
            onChange={(e) => onToggleSelected(e.target.checked)}
            aria-label={`Select ${project.displayName}`}
          />
          <div>
            <CardTitle className="flex items-center gap-2">
              {project.displayName}
              <RepairClassBadge repairClass={project.repairClass} />
            </CardTitle>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {project.repoPath}
            </p>
          </div>
        </div>
        {project.repairClass !== 'TIM_REQUIRED' && (
          <Button size="xs" variant="ghost" disabled={baselineRunning} onClick={onStartBaseline}>
            {baselineRunning ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Run baseline check
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {project.causes.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[12px] text-status-healthy">
            <ClipboardList className="size-3.5" />
            No open causes on record -- ready for work.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {project.causes.map((cause) => (
              <CauseRow
                key={cause.cause}
                cause={cause}
                busy={runningCause === cause.cause || missionBusyCause === cause.cause}
                onRepair={(item) => onStartRepair(item.cause)}
                onPrepareMission={prepareMission}
              />
            ))}
          </ul>
        )}
        {error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
      </CardContent>

      <Dialog open={missionSpec !== null} onOpenChange={(open) => !open && setMissionSpec(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Repair mission spec -- {missionSpec?.projectDisplayName}</DialogTitle>
            <DialogDescription>
              A real mission spec, ready to dispatch. This does not create a code checkout or
              start an agent on its own.
            </DialogDescription>
          </DialogHeader>
          {missionSpec && (
            <div className="flex flex-col gap-3 text-[12px]">
              <p>{missionSpec.originalGoal}</p>
              <Separator />
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Acceptance criteria
                </div>
                <ul className="list-disc pl-4">
                  {missionSpec.acceptanceCriteria.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Constraints
                </div>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {missionSpec.constraints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setMissionSpec(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
