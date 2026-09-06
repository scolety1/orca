import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { ProjectCard } from '@/components/ProjectCard'
import { BulkActionBar } from '@/components/projects/BulkActionBar'
import { LifecycleFilterBar } from '@/components/projects/LifecycleFilterBar'
import { StartMissionDialog } from '@/components/missions/StartMissionDialog'
import { StartOvernightFleetDialog } from '@/components/missions/StartOvernightFleetDialog'
import { classifyProjectLifecycle, type LifecycleBucket } from '@/lib/project-lifecycle'
import { matchesSearch, sortProjects } from '@/lib/project-filtering'
import { readProjectsListFilters, writeProjectsListFilters } from '@/lib/projects-list-filters'
import { readLastViewedProject } from '@/lib/last-viewed-project'
import { loadProjectsSelection, saveProjectsSelection } from '@/lib/projects-selection-state'
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
  // Recovered from a stranded uncommitted worktree, narrowed on
  // reconciliation: filter/search/sort/scroll are already handled by the
  // URL (BUG-02) and last-viewed-project.ts -- only checkbox selection was
  // still lost on unmount, e.g. selecting a few projects, checking
  // something in Health Repair, and coming back to Projects.
  const [selected, setSelected] = useState<Record<string, boolean>>(loadProjectsSelection)
  useEffect(() => {
    saveProjectsSelection(selected)
  }, [selected])
  // BUG-02 (bug-ledger.json): filter/search/sort now live in the URL
  // (projects-list-filters.ts), not local useState -- clicking into a
  // project and back (or browser back/forward) restores exactly what was
  // showing, instead of resetting to defaults on every remount.
  const [searchParams, setSearchParams] = useSearchParams()
  const { filter, search, sort } = readProjectsListFilters(searchParams)
  function updateFilters(next: Partial<{ filter: LifecycleBucket | 'ALL'; search: string; sort: typeof sort }>) {
    setSearchParams(writeProjectsListFilters({ filter, search, sort, ...next }), { replace: true })
  }
  const [missionDialogOpen, setMissionDialogOpen] = useState(false)
  const [overnightDialogOpen, setOvernightDialogOpen] = useState(false)

  // Real-project validation finding (BUG-02, final review wave): the URL-
  // filter restoration above only covers a click-in-and-back round trip
  // within Projects' own history entry -- it does NOT address the bug's
  // own literal original complaint (leave for an entirely different
  // section, e.g. Health Repair, then return to Projects and still have
  // to re-find/re-scroll to the project you were just on), reproduced
  // live against a real project. Scrolling the last-viewed project into
  // view closes that gap without changing the default sort or silently
  // redirecting anywhere -- only fires on a genuinely fresh arrival (no
  // explicit filter/search/sort in the URL at all); a filtered/sorted
  // browser-back restoration is left exactly as BUG-02's own fix already
  // handles it, and never re-triggered by this.
  const lastViewedId = useMemo(() => readLastViewedProject(), [])
  const lastViewedCardRef = useRef<HTMLDivElement | null>(null)
  const hasAutoScrolledRef = useRef(false)
  useEffect(() => {
    if (hasAutoScrolledRef.current) {
      return
    }
    if (searchParams.toString() !== '') {
      hasAutoScrolledRef.current = true
      return
    }
    if (lastViewedCardRef.current) {
      lastViewedCardRef.current.scrollIntoView({ block: 'center' })
      hasAutoScrolledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio])

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

  const filtered = portfolio.knownProjects.filter((p, i) => {
    if (filter !== 'ALL' && buckets[i] !== filter) {
      return false
    }
    return matchesSearch(p, search)
  })
  const visible = sortProjects(filtered, sort)

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {error && <RefreshFailedBanner message={error} onRetry={reload} />}
      <header className="mb-2 flex items-start justify-between gap-4">
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

      {/* Sticky compact toolbar (spec section 8): pinned within <main>'s own
          scroll region (AppShell.tsx's existing "main owns the only scroll"
          discipline) so it stays reachable while scrolling a long project
          grid -- normal state shows the filter/sort/search bar, selected
          state swaps in the bulk action bar so it too never scrolls away. */}
      <div className="sticky top-0 z-10 -mx-8 bg-background px-8">
        {selectedIds.length > 0 ? (
          <div className="py-3">
            <BulkActionBar
              selectedIds={selectedIds}
              workSetBefore={portfolio.workSet}
              // Final-review-wave finding (cross-cutting adversarial
              // review): gating on bare `loading` alone re-enables actions
              // the instant a FAILED background reload's request settles
              // (use-api.ts's loading always clears in .finally(), even on
              // error) -- but on a failed reload, `portfolio`/workSetBefore
              // is still the STALE pre-mutation snapshot, not fresh. A
              // second action right after would compute cascadedFromWorkSet
              // against that stale data, exactly the fabricated-cascade
              // class BUG-03 exists to prevent. `error` stays truthy until
              // an explicit, successful retry (the existing
              // RefreshFailedBanner's own Retry button) actually lands, so
              // gating on it too keeps actions honestly disabled -- with a
              // real, visible way out -- until data is genuinely current.
              refreshing={loading || !!error}
              onClearSelection={() => setSelected({})}
              onChanged={reload}
              onStartMission={() => setMissionDialogOpen(true)}
              onStartOvernightFleet={() => setOvernightDialogOpen(true)}
            />
          </div>
        ) : (
          <LifecycleFilterBar
            active={filter}
            onChange={(next) => updateFilters({ filter: next })}
            counts={counts}
            search={search}
            onSearchChange={(next) => updateFilters({ search: next })}
            sort={sort}
            onSortChange={(next) => updateFilters({ sort: next })}
          />
        )}
      </div>

      <div className="pt-4">
        {visible.length === 0 ? (
          <EmptyState
            title="No projects match this filter"
            description="Try a different lifecycle filter or clear the search."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((project) => (
              <div
                key={project.id}
                ref={project.id === lastViewedId ? lastViewedCardRef : undefined}
              >
                <ProjectCard
                  project={project}
                  selectable
                  selected={selected[project.id] ?? false}
                  onToggleSelect={toggleSelect}
                />
              </div>
            ))}
          </div>
        )}
      </div>

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
