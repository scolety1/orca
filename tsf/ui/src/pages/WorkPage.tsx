import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleSlash, PackageCheck, PlayCircle, CalendarClock, ShieldCheck } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/StatusChip'
import { Badge } from '@/components/ui/badge'
import { StartMissionDialog } from '@/components/missions/StartMissionDialog'
import { StartOvernightFleetDialog } from '@/components/missions/StartOvernightFleetDialog'

function Section({
  icon: Icon,
  title,
  children
}: {
  icon: typeof PlayCircle
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </div>
      {children}
    </section>
  )
}

// Operator UX pass (spec section 12): Work is the mission command center --
// Projects are repositories, Work is what's happening TO them. "+ Start
// Mission"/"+ Start Overnight Fleet" default to the current Work Set (the
// projects TSF may already dispatch new work for), reusing the same
// launcher dialogs Projects' bulk action bar opens -- no second
// implementation.
export function WorkPage() {
  const { data: work, loading, error, reload } = useApi(() => api.work(), [])
  const { data: portfolio } = useApi(() => api.portfolio(), [])
  const [missionOpen, setMissionOpen] = useState(false)
  const [overnightOpen, setOvernightOpen] = useState(false)

  // Real V1 stabilization finding (see ProjectsPage.tsx for the full real-
  // browser reproduction): gating on bare `loading` unmounts
  // StartMissionDialog/StartOvernightFleetDialog -- and their own local
  // result-summary state -- the instant onStarted's reload() fires, before
  // the operator can see what happened. `loading && !work` keeps the page
  // mounted through a background reload.
  if (loading && !work) {
    return <LoadingState label="Loading Work…" />
  }
  // A background reload failure must not replace already-loaded work data
  // with a full-page error.
  if (error && !work) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!work) {
    return null
  }

  const workSetIds = portfolio?.workSet ?? []
  const hasEligibleProjects = workSetIds.length > 0

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {error && <RefreshFailedBanner message={error} onRetry={reload} />}
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Work</h1>
          <p className="text-sm text-muted-foreground">
            What&apos;s happening to your projects -- planner, worker, and verifier activity, not
            terminal spam.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!hasEligibleProjects}
            onClick={() => setMissionOpen(true)}
          >
            <PlayCircle className="size-4" /> Start Mission
          </Button>
          <Button size="sm" disabled={!hasEligibleProjects} onClick={() => setOvernightOpen(true)}>
            <CalendarClock className="size-4" /> Start Overnight Fleet
          </Button>
        </div>
      </header>

      {!hasEligibleProjects && (
        <EmptyState
          title="No projects in the Work Set yet"
          description="Prepare projects for work on the Projects page, then add them to the Work Set, before starting a mission here."
          action={
            <Link to="/projects">
              <Button size="sm" variant="outline">
                Open Projects
              </Button>
            </Link>
          }
        />
      )}

      <Section icon={PlayCircle} title="Active">
        {work.active.length === 0 ? (
          <EmptyState
            title="No active missions"
            description="No project in the Work Set currently has a planner or worker in progress."
            action={
              hasEligibleProjects ? (
                <Button size="sm" onClick={() => setMissionOpen(true)}>
                  <PlayCircle className="size-4" /> Start Mission
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {work.active.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card>
                  <CardHeader>
                    <CardTitle>{p.displayName}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {p.mission.state}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section icon={CircleSlash} title="Needs you / blocked">
        {work.blocked.length === 0 ? (
          <EmptyState title="Nothing blocked" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {work.blocked.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card className="border-status-blocked/40">
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle>{p.displayName}</CardTitle>
                    <StatusChip status={p.health.status} />
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {p.mission.blockedReason ?? p.mission.state}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section icon={ShieldCheck} title="Ready for adoption">
        {work.readyForAdoption.length === 0 ? (
          <EmptyState
            title="No candidates waiting"
            description="Nothing has an independent verifier-GREEN candidate pending your decision."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {work.readyForAdoption.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card className="border-primary/40">
                  <CardHeader>
                    <CardTitle>{p.displayName}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {p.candidate?.implementationSummary ?? 'Candidate awaiting review.'}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section icon={PackageCheck} title="Recently completed">
        {work.recentlyCompleted.length === 0 ? (
          <EmptyState title="Nothing completed yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {work.recentlyCompleted.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:border-primary/50"
              >
                <span>{p.displayName}</span>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="healthy">Adopted</Badge>
                  {p.adoptedAt && <span>{new Date(p.adoptedAt).toLocaleString()}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <StartMissionDialog
        open={missionOpen}
        onOpenChange={setMissionOpen}
        projectIds={workSetIds}
        onStarted={reload}
      />
      <StartOvernightFleetDialog
        open={overnightOpen}
        onOpenChange={setOvernightOpen}
        projectIds={workSetIds}
        onStarted={reload}
      />
    </div>
  )
}
