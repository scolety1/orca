import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { ProjectHealthRepairCard } from './ProjectHealthRepairCard'
import { overallRepairClass } from '@/lib/health-repair-types'
import type {
  BaselineCheckResult,
  ProjectHealthDiagnosis,
  RepairActionResult
} from '@/lib/health-repair-types'
import {
  listHealthRepairActivities,
  startHealthRepairActivity,
  subscribeHealthRepairActivities
} from '@/lib/health-repair-activity'

// Health Repair demoted from its own top-level page to a project-scoped
// action ("Health: DEGRADED [Repair Health]") -- same real diagnosis/repair
// capability (ProjectHealthRepairCard, unmodified), just reached from the
// project it's actually about. Still reads the fleet-wide scan (no
// per-project scan endpoint exists) and picks this project's own entry --
// no backend change, no second diagnosis mechanism.
//
// Reconciled alongside HealthRepairCenterPage.tsx's durable-activity
// refactor: this tab is a second real consumer of ProjectHealthRepairCard
// (added by the Operator UI / Information Architecture Consolidation,
// after the stranded worktree this recovery pulled from had already
// forked -- caught by a clean typecheck, not by inspection). Wired to the
// SAME health-repair-activity.ts tracking as the fleet page rather than a
// second, tab-local busy-state mechanism, matching this file's own
// existing "no second diagnosis mechanism" discipline -- switching away
// from this tab and back no longer loses an in-flight repair's busy state
// either.
export function ProjectHealthTab({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useApi(() => api.healthRepairScan(), [])
  const [override, setOverride] = useState<ProjectHealthDiagnosis | null>(null)
  const [activities, setActivities] = useState(listHealthRepairActivities)
  const appliedActivities = useRef(new Set<string>())

  useEffect(() => subscribeHealthRepairActivities(setActivities), [])

  useEffect(() => {
    for (const activity of activities) {
      if (
        activity.status === 'RUNNING' ||
        activity.kind === 'REPAIR_SELECTED' ||
        !activity.projectIds.includes(projectId) ||
        appliedActivities.current.has(activity.operationId)
      ) {
        continue
      }
      appliedActivities.current.add(activity.operationId)
      if (activity.status === 'FAILED') {
        continue
      }
      const result =
        activity.kind === 'BASELINE'
          ? (activity.result as BaselineCheckResult)
          : (activity.result as RepairActionResult)
      const causes =
        activity.kind === 'BASELINE'
          ? (result as BaselineCheckResult).causes
          : (result as RepairActionResult).causesAfter
      // Same guarantee/caveat as HealthRepairCenterPage.tsx: startRepair
      // throws rather than settling without causesAfter, but the type
      // stays optional to also cover the FAILED case.
      if (!causes) {
        continue
      }
      setOverride((current) => {
        const base = current ?? data?.projects.find((p) => p.projectId === projectId) ?? null
        return base
          ? {
              ...base,
              causes,
              repairClass: overallRepairClass(causes),
              readyForWork: result.readyForWork ?? base.readyForWork
            }
          : current
      })
    }
  }, [activities, data, projectId])

  if (loading && !data) {
    return <LoadingState label="Checking Health…" />
  }
  if (error && !data) {
    return <ErrorState message={error} onRetry={reload} />
  }
  const diagnosis = override ?? data?.projects.find((p) => p.projectId === projectId) ?? null
  if (!diagnosis) {
    return <EmptyState title="No Health diagnosis available" description="Run a fleet Health scan from More → Health Repair Center." />
  }
  const runningForProject = activities.filter(
    (activity) => activity.status === 'RUNNING' && activity.projectIds.includes(projectId)
  )
  return (
    <ProjectHealthRepairCard
      project={diagnosis}
      selected={false}
      onToggleSelected={() => undefined}
      runningCause={runningForProject.find((activity) => activity.kind === 'REPAIR')?.cause ?? null}
      baselineRunning={runningForProject.some((activity) => activity.kind === 'BASELINE')}
      onStartRepair={(cause) =>
        startHealthRepairActivity({
          kind: 'REPAIR',
          projectIds: [projectId],
          cause,
          run: async () => {
            const result = await api.healthRepairRepair(projectId, cause)
            // BUG-05 (preserved, same as HealthRepairCenterPage.tsx's
            // startRepair): result.error covers a background-runner
            // exception, repairResult?.reason/.detail cover a real repair
            // action that ran and failed.
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
      onStartBaseline={() =>
        startHealthRepairActivity({
          kind: 'BASELINE',
          projectIds: [projectId],
          run: () => api.healthRepairBaseline(projectId)
        })
      }
    />
  )
}
