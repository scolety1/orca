import { useEffect, useRef, useState } from 'react'
import { Loader2, Stethoscope, Wrench } from 'lucide-react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ProjectHealthRepairCard } from '@/components/health-repair/ProjectHealthRepairCard'
import { overallRepairClass } from '@/lib/health-repair-types'
import type {
  BaselineCheckResult,
  ProjectHealthDiagnosis,
  RepairActionResult,
  RepairSelectedResult
} from '@/lib/health-repair-types'
import {
  listHealthRepairActivities,
  startHealthRepairActivity,
  subscribeHealthRepairActivities,
  type HealthRepairActivity
} from '@/lib/health-repair-activity'

function FleetSummary({ projects }: { projects: ProjectHealthDiagnosis[] }) {
  const ready = projects.filter((p) => p.readyForWork).length
  const autoRepairable = projects.filter((p) => p.repairClass === 'AUTO_REPAIR_SAFE').length
  const needsMission = projects.filter((p) => p.repairClass === 'GOVERNED_REPAIR_MISSION').length
  const needsYou = projects.filter((p) => p.repairClass === 'TIM_REQUIRED').length
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-6 p-4 text-[12px]">
        <span>
          <strong className="text-status-healthy">{ready}</strong> ready for work
        </span>
        <span>
          <strong className="text-decision-auto">{autoRepairable}</strong> auto-repairable
        </span>
        <span>
          <strong className="text-decision-recommend">{needsMission}</strong> need a repair mission
        </span>
        <span>
          <strong className="text-decision-tim">{needsYou}</strong> need you
        </span>
        <span className="text-muted-foreground">{projects.length} total</span>
      </CardContent>
    </Card>
  )
}

// Recovered from a stranded uncommitted worktree: repairingSelected (a
// single boolean, lost on navigation away from this page) is replaced by
// health-repair-activity.ts's durable, concurrent activity tracking --
// Repair/Run-baseline/Repair-selected now survive an unmount/remount and
// can run for more than one project at once without one hiding another's
// busy state.
export function HealthRepairCenterPage() {
  const { data, loading, error, reload } = useApi(() => api.healthRepairScan(), [])
  const [projects, setProjects] = useState<ProjectHealthDiagnosis[] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [activities, setActivities] = useState(listHealthRepairActivities)
  const [selectedError, setSelectedError] = useState<string | null>(null)
  const appliedActivities = useRef(new Set<string>())

  const list = projects ?? data?.projects ?? null

  useEffect(() => subscribeHealthRepairActivities(setActivities), [])

  useEffect(() => {
    if (!projects && !data?.projects) {
      return
    }
    for (const activity of activities) {
      if (activity.status === 'RUNNING' || appliedActivities.current.has(activity.operationId)) {
        continue
      }
      appliedActivities.current.add(activity.operationId)
      if (activity.status === 'FAILED') {
        setSelectedError(activity.error ?? 'Health Repair failed.')
        continue
      }
      if (activity.kind === 'REPAIR_SELECTED') {
        const result = activity.result as RepairSelectedResult
        const byId = Object.fromEntries(result.results.map((item) => [item.projectId, item]))
        setProjects((current) =>
          (current ?? data?.projects ?? []).map((project) => {
            const item = byId[project.projectId]
            return item?.ok && item.remainingCauses
              ? {
                  ...project,
                  causes: item.remainingCauses,
                  repairClass: overallRepairClass(item.remainingCauses),
                  readyForWork: item.readyForWork ?? project.readyForWork
                }
              : project
          })
        )
        continue
      }
      const projectId = activity.projectIds[0]
      const result =
        activity.kind === 'BASELINE'
          ? (activity.result as BaselineCheckResult)
          : (activity.result as RepairActionResult)
      const causes =
        activity.kind === 'BASELINE'
          ? (result as BaselineCheckResult).causes
          : (result as RepairActionResult).causesAfter
      // startRepair throws (never returns) when the durable operation
      // settles without causesAfter, so a COMPLETED REPAIR activity here
      // always has it -- but RepairActionResult's own type keeps it
      // optional (it covers the FAILED case too), so TypeScript can't see
      // that guarantee. Checked explicitly rather than asserted away.
      if (!causes) {
        continue
      }
      setProjects((current) =>
        (current ?? data?.projects ?? []).map((project) =>
          project.projectId === projectId
            ? {
                ...project,
                causes,
                repairClass: overallRepairClass(causes),
                readyForWork: result.readyForWork ?? project.readyForWork
              }
            : project
        )
      )
    }
  }, [activities, data?.projects, projects])

  function repairSelected() {
    const projectIds = Object.keys(selected).filter((id) => selected[id])
    if (projectIds.length === 0) {
      setSelectedError('Select at least one project first.')
      return
    }
    setSelectedError(null)
    startHealthRepairActivity({
      kind: 'REPAIR_SELECTED',
      projectIds,
      run: () => api.healthRepairSelected(projectIds)
    })
  }

  function startRepair(projectId: string, cause: string) {
    setSelectedError(null)
    startHealthRepairActivity({
      kind: 'REPAIR',
      projectIds: [projectId],
      cause,
      run: async () => {
        const result = await api.healthRepairRepair(projectId, cause)
        // BUG-05 (preserved from the pre-refactor repair()): a validation
        // rejection (TIM_REQUIRED, not AUTO_REPAIR_SAFE) or a background-
        // runner exception both settle as {ok:false}, the latter with no
        // repairResult/causesAfter at all -- result.error covers that
        // case, repairResult?.reason/.detail cover a real repair action
        // that ran and failed. Thrown here (rather than returned) so
        // startHealthRepairActivity's own catch records it durably.
        if (!result.ok || !result.causesAfter) {
          throw new Error(
            result.error ??
              result.repairResult?.reason ??
              result.repairResult?.detail ??
              'Repair failed.'
          )
        }
        return result
      }
    })
  }

  function startBaseline(projectId: string) {
    setSelectedError(null)
    startHealthRepairActivity({
      kind: 'BASELINE',
      projectIds: [projectId],
      run: () => api.healthRepairBaseline(projectId)
    })
  }

  if (loading && !list) {
    return <LoadingState label="Scanning fleet Health…" />
  }
  // Rescan (below) reloads this same scan. A transient failure there must
  // not blow away already-diagnosed projects (or repairs already applied
  // locally via Repair Selected) -- only a genuine first scan with nothing
  // yet should show the full error state.
  if (error && !list) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!list) {
    return null
  }

  const selectedCount = Object.values(selected).filter(Boolean).length
  const runningActivities = activities.filter((activity) => activity.status === 'RUNNING')
  const repairingSelected = runningActivities.some(
    (activity) => activity.kind === 'REPAIR_SELECTED'
  )

  function runningForProject(
    projectId: string,
    kind: HealthRepairActivity['kind']
  ): HealthRepairActivity | undefined {
    return runningActivities.find(
      (activity) => activity.kind === kind && activity.projectIds.includes(projectId)
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {error && <RefreshFailedBanner message={error} onRetry={reload} />}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Stethoscope className="size-5 text-primary" />
            Health Repair Center
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Diagnoses why a project reads less than fully healthy and repairs what TSF can safely
            fix on its own. Never turns a project green cosmetically -- a paused, read-only, or
            dirty-preserve project is shown as-is, not as broken.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedCount === 0 || repairingSelected}
            onClick={repairSelected}
          >
            {repairingSelected ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wrench className="size-4" />
            )}
            Repair selected ({selectedCount})
          </Button>
          <Button size="sm" onClick={reload}>
            <Stethoscope className="size-4" />
            Scan fleet Health
          </Button>
        </div>
      </header>

      {runningActivities.length > 0 && (
        <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          {runningActivities.length} Health Repair operation
          {runningActivities.length === 1 ? '' : 's'} continuing in the background. You can leave
          this page and return without interrupting them.
        </div>
      )}

      {selectedError && <p className="mb-4 text-[12px] text-destructive">{selectedError}</p>}

      {list.length === 0 ? (
        <EmptyState title="No Known Projects yet" description="Onboard a project first." />
      ) : (
        <div className="flex flex-col gap-4">
          <FleetSummary projects={list} />
          {list.map((project) => (
            <ProjectHealthRepairCard
              key={project.projectId}
              project={project}
              selected={selected[project.projectId] ?? false}
              onToggleSelected={(checked) =>
                setSelected((prev) => ({ ...prev, [project.projectId]: checked }))
              }
              runningCause={runningForProject(project.projectId, 'REPAIR')?.cause ?? null}
              baselineRunning={!!runningForProject(project.projectId, 'BASELINE')}
              onStartRepair={(cause) => startRepair(project.projectId, cause)}
              onStartBaseline={() => startBaseline(project.projectId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
