import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { ProjectHealthRepairCard } from './ProjectHealthRepairCard'
import type { ProjectHealthDiagnosis } from '@/lib/health-repair-types'

// Health Repair demoted from its own top-level page to a project-scoped
// action ("Health: DEGRADED [Repair Health]") -- same real diagnosis/repair
// capability (ProjectHealthRepairCard, unmodified), just reached from the
// project it's actually about. Still reads the fleet-wide scan (no
// per-project scan endpoint exists) and picks this project's own entry --
// no backend change, no second diagnosis mechanism.
export function ProjectHealthTab({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useApi(() => api.healthRepairScan(), [])
  const [override, setOverride] = useState<ProjectHealthDiagnosis | null>(null)

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
  return (
    <ProjectHealthRepairCard
      project={diagnosis}
      selected={false}
      onToggleSelected={() => undefined}
      onChanged={setOverride}
    />
  )
}
