import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StartOvernightFleetDialog } from '@/components/missions/StartOvernightFleetDialog'
import type { FleetSchedule } from '@/lib/fleet-types'

function ProjectScheduleCard({ project }: { project: FleetSchedule['projects'][number] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{project.projectId}</span>
          {project.deadlineMet !== null && (
            <Badge variant={project.deadlineMet ? 'healthy' : 'blocked'}>
              {project.deadlineMet ? 'DEADLINE MET' : 'DEADLINE MISSED'}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{project.reasoning}</p>
        {project.schedule.length === 0 ? (
          <div className="text-xs text-status-degraded">No slots scheduled (capacity paused).</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {project.schedule.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-[12px]">
                <span>{t.title}</span>
                <span className="text-muted-foreground">
                  hour {t.startHour}–{t.endHour}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function FleetPage() {
  const { data: portfolio, loading, error, reload } = useApi(() => api.portfolio(), [])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [priorities, setPriorities] = useState<Record<string, number>>({})
  const [maxConcurrentWorkers, setMaxConcurrentWorkers] = useState(2)
  const [schedule, setSchedule] = useState<FleetSchedule | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Real V1 stabilization finding (spec section 9): this page's single
  // "Start Overnight Fleet" button used to silently fall back to the whole
  // Work Set whenever nothing was checked -- an operator who had never
  // touched a checkbox on this page could launch it against every Work Set
  // project without meaning to. Two separately labeled triggers instead:
  // one only for an explicit checkbox selection, one only for the Work Set
  // by name -- never an invisible default between them.
  const [overnightOpenSelected, setOvernightOpenSelected] = useState(false)
  const [overnightOpenWorkSet, setOvernightOpenWorkSet] = useState(false)

  // Real V1 stabilization finding (see ProjectsPage.tsx for the full real-
  // browser reproduction): gating on bare `loading` would unmount
  // StartOvernightFleetDialog -- and its own local progress state -- the
  // instant a reload fires, before the operator can see what happened.
  if (loading && !portfolio) {
    return <LoadingState label="Loading Work Set…" />
  }
  // A background reload failure must not replace already-loaded portfolio
  // data with a full-page error.
  if (error && !portfolio) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!portfolio) {
    return null
  }

  const selectedIds = Object.keys(selected).filter((id) => selected[id])
  const hasSelection = selectedIds.length > 0

  async function build() {
    if (selectedIds.length === 0) {
      setActionError('Select at least one project.')
      return
    }
    setBusy(true)
    setActionError(null)
    setSchedule(null)
    try {
      const result = await api.fleetSchedule({
        projectIds: selectedIds,
        priorities,
        maxConcurrentWorkers
      })
      if (!result.ok) {
        setActionError(
          result.error === 'NO_ESTIMATE_ON_FILE_FOR_PROJECT'
            ? `${result.detail} has no estimate on file yet -- generate one on its Estimate tab first.`
            : result.error
        )
        return
      }
      setSchedule(result.schedule)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not build a fleet schedule.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {error && <RefreshFailedBanner message={error} onRetry={reload} />}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-md">
          <h1 className="text-xl font-semibold tracking-tight">Fleet Planning</h1>
          <p className="text-sm text-muted-foreground">
            A proposed, explained execution schedule across your Work Set -- reuses each
            project&apos;s own real estimate (Estimate tab) and real provider capacity. Building a
            schedule here never authorizes or dispatches anything on its own; Start Overnight Fleet
            does, using each project&apos;s own real Keep Going run.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!hasSelection}
            onClick={() => setOvernightOpenSelected(true)}
          >
            <CalendarClock className="size-4" />
            {`Start Overnight Fleet for selected (${selectedIds.length})`}
          </Button>
          {portfolio.workSet.length > 0 && (
            <Button size="sm" onClick={() => setOvernightOpenWorkSet(true)}>
              <CalendarClock className="size-4" />
              {`Start Overnight Fleet for Work Set (${portfolio.workSet.length})`}
            </Button>
          )}
        </div>
      </header>

      {portfolio.workSet.length === 0 ? (
        <EmptyState
          title="No projects in the Work Set"
          description="Add projects to the Work Set first."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              {portfolio.workSet.map((id) => (
                <div key={id} className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selected[id] ?? false}
                    onChange={(e) => setSelected((prev) => ({ ...prev, [id]: e.target.checked }))}
                  />
                  <span className="min-w-0 flex-1 truncate">{id}</span>
                  <label className="text-[11px] text-muted-foreground">Priority</label>
                  <input
                    type="number"
                    min={1}
                    className="w-16 rounded-md border border-input bg-input px-2 py-1 text-xs"
                    value={priorities[id] ?? 1}
                    onChange={(e) =>
                      setPriorities((prev) => ({ ...prev, [id]: Number(e.target.value) }))
                    }
                  />
                </div>
              ))}
              <div className="flex items-center gap-3">
                <label className="text-[11px] text-muted-foreground">
                  Max concurrent workers (Windows safety)
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-16 rounded-md border border-input bg-input px-2 py-1 text-xs"
                  value={maxConcurrentWorkers}
                  onChange={(e) => setMaxConcurrentWorkers(Number(e.target.value))}
                />
              </div>
              {actionError && <p className="text-xs text-status-blocked">{actionError}</p>}
              <div>
                <Button size="sm" onClick={build} disabled={busy}>
                  {busy ? 'Building…' : 'Build schedule'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {schedule && (
            <>
              <Card>
                <CardContent className="flex items-center justify-between p-4 text-[12px]">
                  <span>
                    Effective concurrency: {schedule.effectiveConcurrency} / requested{' '}
                    {schedule.requestedConcurrency}
                  </span>
                  <Badge variant={schedule.capacityAction === 'PROCEED' ? 'healthy' : 'degraded'}>
                    {schedule.capacityAction}
                  </Badge>
                </CardContent>
              </Card>
              {schedule.projects.map((p) => (
                <ProjectScheduleCard key={p.projectId} project={p} />
              ))}
            </>
          )}
        </div>
      )}

      <StartOvernightFleetDialog
        open={overnightOpenSelected}
        onOpenChange={setOvernightOpenSelected}
        projectIds={selectedIds}
        onStarted={reload}
      />
      <StartOvernightFleetDialog
        open={overnightOpenWorkSet}
        onOpenChange={setOvernightOpenWorkSet}
        projectIds={portfolio.workSet}
        onStarted={reload}
      />
    </div>
  )
}
