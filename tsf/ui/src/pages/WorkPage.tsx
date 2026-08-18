import { Link } from 'react-router-dom'
import { CircleSlash, PackageCheck, PlayCircle, ShieldCheck } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusChip } from '@/components/StatusChip'
import { Badge } from '@/components/ui/badge'

function Section({ icon: Icon, title, children }: { icon: typeof PlayCircle; title: string; children: React.ReactNode }) {
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

export function WorkPage() {
  const { data: work, loading, error, reload } = useApi(() => api.work(), [])

  if (loading) return <LoadingState label="Loading Work…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!work) return null

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Work</h1>
        <p className="text-sm text-muted-foreground">Planner, worker, and verifier activity across the current Work Set — concise, not terminal spam.</p>
      </header>

      <Section icon={PlayCircle} title="Active">
        {work.active.length === 0 ? (
          <EmptyState title="No active missions" description="No project in the Work Set currently has a planner or worker in progress." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {work.active.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card>
                  <CardHeader>
                    <CardTitle>{p.displayName}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">{p.mission.state}</CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section icon={CircleSlash} title="Blocked">
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
                  <CardContent className="text-xs text-muted-foreground">{p.mission.blockedReason ?? p.mission.state}</CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section icon={ShieldCheck} title="Ready for adoption">
        {work.readyForAdoption.length === 0 ? (
          <EmptyState title="No candidates waiting" description="Nothing has an independent verifier-GREEN candidate pending your decision." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {work.readyForAdoption.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`}>
                <Card className="border-primary/40">
                  <CardHeader>
                    <CardTitle>{p.displayName}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">{p.candidate?.implementationSummary ?? 'Candidate awaiting review.'}</CardContent>
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
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:border-primary/50">
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
    </div>
  )
}
