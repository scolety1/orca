import { useState } from 'react'
import { Loader2, Stethoscope, Wrench } from 'lucide-react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ProjectHealthRepairCard } from '@/components/health-repair/ProjectHealthRepairCard'
import type { ProjectHealthDiagnosis } from '@/lib/health-repair-types'

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

export function HealthRepairCenterPage() {
  const { data, loading, error, reload } = useApi(() => api.healthRepairScan(), [])
  const [projects, setProjects] = useState<ProjectHealthDiagnosis[] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [repairingSelected, setRepairingSelected] = useState(false)
  const [selectedError, setSelectedError] = useState<string | null>(null)

  const list = projects ?? data?.projects ?? null

  function updateProject(updated: ProjectHealthDiagnosis) {
    setProjects((current) =>
      (current ?? data?.projects ?? []).map((p) =>
        p.projectId === updated.projectId ? updated : p
      )
    )
  }

  async function repairSelected() {
    const projectIds = Object.keys(selected).filter((id) => selected[id])
    if (projectIds.length === 0) {
      setSelectedError('Select at least one project first.')
      return
    }
    setRepairingSelected(true)
    setSelectedError(null)
    try {
      const result = await api.healthRepairSelected(projectIds)
      const byId = Object.fromEntries(result.results.map((r) => [r.projectId, r]))
      setProjects((current) =>
        (current ?? data?.projects ?? []).map((p) => {
          const r = byId[p.projectId]
          if (!r || !r.ok || !r.remainingCauses) {
            return p
          }
          return { ...p, causes: r.remainingCauses, readyForWork: r.readyForWork ?? p.readyForWork }
        })
      )
    } catch (err) {
      setSelectedError(err instanceof Error ? err.message : 'Repair Selected failed.')
    } finally {
      setRepairingSelected(false)
    }
  }

  if (loading) {
    return <LoadingState label="Scanning fleet Health…" />
  }
  if (error) {
    return <ErrorState message={error} />
  }
  if (!list) {
    return null
  }

  const selectedCount = Object.values(selected).filter(Boolean).length

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
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
              onChanged={updateProject}
            />
          ))}
        </div>
      )}
    </div>
  )
}
