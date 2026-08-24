import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { ProjectCard } from '@/components/ProjectCard'
import { BulkActionBar } from '@/components/projects/BulkActionBar'
import { LifecycleFilterBar, matchesSearch } from '@/components/projects/LifecycleFilterBar'
import { StartMissionDialog } from '@/components/missions/StartMissionDialog'
import { StartOvernightFleetDialog } from '@/components/missions/StartOvernightFleetDialog'
import { classifyProjectLifecycle, type LifecycleBucket } from '@/lib/project-lifecycle'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// Operator UX pass (spec section 2): the Projects page is a project
// control board -- lifecycle status, search, and bulk action are the
// primary surface. Usage Mode moved to mission-launch flows
// (StartMissionDialog/StartOvernightFleetDialog, spec section 7); it no
// longer occupies the top of this page.
export function ProjectsPage() {
  const navigate = useNavigate()
  const { data: portfolio, loading, error, reload } = useApi(() => api.portfolio(), [])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<LifecycleBucket | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [missionDialogOpen, setMissionDialogOpen] = useState(false)
  const [overnightDialogOpen, setOvernightDialogOpen] = useState(false)

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected])

  function toggleSelect(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Real V1 stabilization finding (Operator UX pass, real browser testing):
  // gating on bare `loading` replaced this whole page -- including
  // BulkActionBar/the mission dialogs and their own local result-summary
  // state -- with a bare spinner on every reload() a bulk action or
  // mission launch triggers, not just the first load. That silently
  // unmounted BulkActionBar an instant after it set a real success/skip
  // summary, so the operator never saw it -- reproduced directly in a real
  // browser (network request succeeded, but the DOM never showed the
  // result). Gating on `loading && !portfolio` instead means only the
  // genuine first load shows the spinner; a background reload keeps the
  // current UI (and any child's local state) mounted while it refreshes.
  if (loading && !portfolio) {
    return <LoadingState label="Loading Projects…" />
  }
  // A background reload failure (bulk action, mission launch) must not
  // replace already-loaded project data with a full-page error.
  if (error && !portfolio) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!portfolio) {
    return null
  }

  const buckets = portfolio.knownProjects.map((p) => classifyProjectLifecycle(p))
  const counts: Record<LifecycleBucket | 'ALL', number> = {
    ALL: portfolio.knownProjects.length,
    NEEDS_YOU: 0,
    NEEDS_REPAIR: 0,
    READY_FOR_WORK: 0,
    WORKING: 0,
    READY_FOR_ADOPTION: 0,
    PAUSED: 0,
    BLOCKED: 0,
    UNKNOWN: 0
  }
  for (const b of buckets) {
    counts[b] += 1
  }

  const visible = portfolio.knownProjects.filter((p, i) => {
    if (filter !== 'ALL' && buckets[i] !== filter) {
      return false
    }
    return matchesSearch(p, search)
  })

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {error && <RefreshFailedBanner message={error} onRetry={reload} />}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            What needs you, what needs repair, what&apos;s ready for work -- select several to act
            on them together.
          </p>
        </div>
        <Button size="sm" onClick={() => navigate('/projects/add')}>
          <Plus className="size-4" /> Add Project
        </Button>
      </header>

      <LifecycleFilterBar
        active={filter}
        onChange={setFilter}
        counts={counts}
        search={search}
        onSearchChange={setSearch}
      />

      {selectedIds.length > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          onClearSelection={() => setSelected({})}
          onChanged={reload}
          onStartMission={() => setMissionDialogOpen(true)}
          onStartOvernightFleet={() => setOvernightDialogOpen(true)}
        />
      )}

      {visible.length === 0 ? (
        <EmptyState
          title="No projects match this filter"
          description="Try a different lifecycle filter or clear the search."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              selectable
              selected={selected[project.id] ?? false}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardContent className="flex items-center justify-between p-4 text-xs text-muted-foreground">
          <span>
            Active Fleet: {portfolio.activeFleet.length} of {portfolio.knownProjects.length} known
            projects
          </span>
          <span>Work Set: {portfolio.workSet.length}</span>
        </CardContent>
      </Card>

      <StartMissionDialog
        open={missionDialogOpen}
        onOpenChange={setMissionDialogOpen}
        projectIds={selectedIds}
        onStarted={reload}
      />
      <StartOvernightFleetDialog
        open={overnightDialogOpen}
        onOpenChange={setOvernightDialogOpen}
        projectIds={selectedIds}
        onStarted={reload}
      />
    </div>
  )
}
