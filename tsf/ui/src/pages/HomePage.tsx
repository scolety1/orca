import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, Compass, Gauge, PackageCheck, UserCheck } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/StatusChip'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { Button } from '@/components/ui/button'

function SectionTitle({ icon: Icon, children }: { icon: typeof Gauge; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </div>
  )
}

export function HomePage() {
  const { data: portfolio, loading: pLoading, error: pError, reload: reloadPortfolio } = useApi(() => api.portfolio(), [])
  const { data: work, loading: wLoading, error: wError, reload: reloadWork } = useApi(() => api.work(), [])

  if (pLoading || wLoading) return <LoadingState label="Loading HQ…" />
  if (pError) return <ErrorState message={pError} onRetry={reloadPortfolio} />
  if (wError) return <ErrorState message={wError} onRetry={reloadWork} />
  if (!portfolio || !work) return null

  const needsYou = [...work.blocked, ...work.readyForAdoption]
  const degradedProjects = portfolio.knownProjects.filter((p) => p.healthStatus === 'DEGRADED' || p.healthStatus === 'BLOCKED')

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">HQ</h1>
        <p className="text-sm text-muted-foreground">Operator overview across the current Work Set.</p>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Active Fleet</div>
            <div className="text-2xl font-semibold">{portfolio.activeFleet.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Work Set</div>
            <div className="text-2xl font-semibold">{portfolio.workSet.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Usage Mode</div>
            <div className="text-2xl font-semibold">{portfolio.usageMode}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Provider capacity</div>
            <div className="text-2xl font-semibold text-muted-foreground">Unknown</div>
          </CardContent>
        </Card>
      </div>

      <section className="mb-8">
        <SectionTitle icon={UserCheck}>Needs you</SectionTitle>
        {needsYou.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-6" />} title="Nothing needs you right now" description="No blocked work and no candidates waiting on an adoption decision." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {needsYou.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card className="border-status-degraded/40 bg-status-degraded/5 transition-colors hover:border-status-degraded/70">
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle>{p.displayName}</CardTitle>
                    <StatusChip status={p.health.status} />
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">{p.mission.blockedReason ?? (p.candidate?.state === 'READY_FOR_ADOPTION' ? 'Candidate is ready for your adoption decision.' : p.mission.state)}</CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle icon={Compass}>Working</SectionTitle>
          {work.active.length === 0 ? (
            <EmptyState title="No active work" description="Nothing is currently in planning or execution in this Work Set." />
          ) : (
            <div className="flex flex-col gap-2">
              {work.active.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="rounded-md border border-border p-3 text-sm hover:border-primary/50">
                  {p.displayName} — {p.mission.state}
                </Link>
              ))}
            </div>
          )}
        </section>
        <section>
          <SectionTitle icon={PackageCheck}>Recently completed</SectionTitle>
          {work.recentlyCompleted.length === 0 ? (
            <EmptyState title="Nothing completed yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {work.recentlyCompleted.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:border-primary/50">
                  <span>{p.displayName}</span>
                  <Badge variant="healthy">Adopted</Badge>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section>
        <SectionTitle icon={AlertTriangle}>Project Health</SectionTitle>
        {degradedProjects.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-6" />} title="All known projects are healthy" />
        ) : (
          <div className="flex flex-col gap-2">
            {degradedProjects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:border-primary/50">
                <span>{p.displayName}</span>
                <div className="flex items-center gap-2">
                  <StatusChip status={p.healthStatus} />
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8">
        <Link to="/work">
          <Button variant="outline" size="sm">
            Open Work <ArrowRight className="size-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  )
}
