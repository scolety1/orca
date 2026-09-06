import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Compass,
  FlaskConical,
  PackageCheck,
  ShieldCheck,
  UserCheck,
  Wrench
} from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import {
  buildHomeNeedsYouItems,
  countDistinctNeedsYouProjects,
  homeNeedsYouItemKey
} from '@/lib/home-needs-you-items'
import { isResearchMissionWorkItem, type RecentlyCompletedItem, type WorkItem } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/StatusChip'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { Button } from '@/components/ui/button'
import { CapacityIndicator } from '@/components/CapacityIndicator'
import { SystemStatusIndicator } from '@/components/SystemStatusIndicator'
import { projectDeepLinkTo } from '@/lib/project-work-deep-link'
import { CommandPanel } from '@/components/command/CommandPanel'
import { ResearchMissionCard } from '@/components/research/ResearchMissionCard'

function SectionTitle({ icon: Icon, children }: { icon: typeof Compass; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </div>
  )
}

// Operator IA consolidation V1: HQ replaces the Home/Command split -- the
// Command composer lives directly here (CommandPanel, unmodified, same
// component CommandPage.tsx already embedded), alongside the same
// attention-first sections Home already had, now widened to include
// ResearchMissions (tsf/domain/work-feed-summary.mjs already buckets them
// into the SAME active/needsYou/blocked/recentlyCompleted arrays -- no
// second aggregation here). /command, /agents, /evaluation, /fleet, and
// /health-repair remain real, reachable routes (deep links, More page) --
// this page only changes what's in PRIMARY navigation.
export function HQPage() {
  const { data: portfolio, loading: pLoading, error: pError, reload: reloadPortfolio } = useApi(() => api.portfolio(), [])
  const { data: work, loading: wLoading, error: wError, reload: reloadWork } = useApi(() => api.work(), [])
  const [preparing, setPreparing] = useState(false)
  const [prepareResult, setPrepareResult] = useState<string | null>(null)

  function reloadAll() {
    reloadPortfolio()
    reloadWork()
  }

  if ((pLoading && !portfolio) || (wLoading && !work)) {
    return <LoadingState label="Loading HQ…" />
  }
  if (pError && !portfolio) {
    return <ErrorState message={pError} onRetry={reloadPortfolio} />
  }
  if (wError && !work) {
    return <ErrorState message={wError} onRetry={reloadWork} />
  }
  if (!portfolio || !work) {
    return null
  }

  const needsYou = buildHomeNeedsYouItems(work)
  const researchNeedsYou = work.needsYou.filter(isResearchMissionWorkItem)
  const degradedProjects = portfolio.knownProjects.filter((p) => p.healthStatus === 'DEGRADED' || p.healthStatus === 'BLOCKED')
  const activeProjects = work.active.filter((p): p is WorkItem => !isResearchMissionWorkItem(p))
  const activeResearch = work.active.filter(isResearchMissionWorkItem)
  // A Keep Going run genuinely WAITING (e.g. for provider capacity/resource
  // pressure) is real, durable state (live-work-feed.mjs) already carried
  // on each active item -- surfaced as its own section rather than buried
  // inside "Active Work". Disclosed limitation: a research node waiting on
  // the Resource Pressure Governor has no equivalent DURABLE signal yet
  // (research-mission-fleet-driver.mjs decides fresh each cycle, never
  // persists it) -- it stays visible under Active Research as "Researching"
  // until that's fixed, rather than fabricating a state here.
  const waitingForResources = activeProjects.filter((p) => p.liveWorkFeed?.state === 'WAITING')
  const recentlyCompletedResearch = work.recentlyCompleted.filter(isResearchMissionWorkItem)
  const recentlyCompletedProjects = work.recentlyCompleted.filter(
    (p): p is Exclude<RecentlyCompletedItem, { kind: 'RESEARCH_MISSION' }> => !isResearchMissionWorkItem(p)
  )

  async function prepareDegraded() {
    setPreparing(true)
    setPrepareResult(null)
    try {
      const result = await api.prepareForWork(degradedProjects.map((p) => p.id))
      const ready = result.results.filter((r) => r.readyForWork).length
      setPrepareResult(`${ready}/${result.results.length} now ready for work.`)
      reloadPortfolio()
    } catch (err) {
      setPrepareResult(err instanceof Error ? err.message : 'Prepare for Work failed.')
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {pError && <RefreshFailedBanner message={pError} onRetry={reloadPortfolio} />}
      {wError && <RefreshFailedBanner message={wError} onRetry={reloadWork} />}
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">HQ</h1>
        <p className="text-sm text-muted-foreground">
          What&apos;s running, what&apos;s waiting, what needs you -- and a place to just ask.
        </p>
      </header>

      {/* Command composer -- the one obvious place to type "research X",
          name a project, or ask what's running, without navigating away. */}
      <section className="mb-8 h-[420px]">
        <CommandPanel onActivity={reloadAll} />
      </section>

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Needs you</div>
            <div className="text-2xl font-semibold">{countDistinctNeedsYouProjects(needsYou)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Active work</div>
            <div className="text-2xl font-semibold">{activeProjects.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Active research</div>
            <div className="text-2xl font-semibold">{activeResearch.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Ready for adoption</div>
            <div className="text-2xl font-semibold">{work.readyForAdoption.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <div className="text-[11px] text-muted-foreground">Provider capacity</div>
              <div className="text-2xl font-semibold">See panel</div>
            </div>
            <CapacityIndicator />
          </CardContent>
        </Card>
      </div>

      {degradedProjects.length > 0 && (
        <Card className="mb-8 border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-sm">
              <Wrench className="size-4 text-primary" />
              {degradedProjects.length} project{degradedProjects.length === 1 ? '' : 's'} need
              {degradedProjects.length === 1 ? 's' : ''} Health preparation.
            </div>
            <div className="flex items-center gap-3">
              {prepareResult && <span className="text-[11px] text-muted-foreground">{prepareResult}</span>}
              <Button size="sm" disabled={preparing} onClick={prepareDegraded}>
                {preparing ? 'Preparing…' : 'Prepare Projects for Work'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="mb-8">
        <SectionTitle icon={UserCheck}>Needs you</SectionTitle>
        {needsYou.length === 0 && researchNeedsYou.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="size-6" />}
            title="Nothing needs you right now"
            description="No blocked work and no candidates waiting on an adoption decision."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {needsYou.map((p) => (
              <Link
                key={homeNeedsYouItemKey(p)}
                to={projectDeepLinkTo(p.id, {
                  tab: p.liveWorkFeed ? (p.liveWorkFeed.state === 'READY_FOR_ADOPTION' ? 'adoption' : 'keep-going') : undefined,
                  runId: p.runId
                })}
              >
                <Card className="border-status-degraded/40 bg-status-degraded/5 transition-colors hover:border-status-degraded/70">
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <div>
                      <div className="text-sm font-medium">{p.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.liveWorkFeed?.reason ?? p.mission.blockedReason ?? (p.candidate?.state === 'READY_FOR_ADOPTION' ? 'Candidate is ready for your adoption decision.' : p.mission.state)}
                      </div>
                    </div>
                    <StatusChip status={p.health.status} />
                  </CardContent>
                </Card>
              </Link>
            ))}
            {researchNeedsYou.map((item) => (
              <ResearchMissionCard key={item.missionId} item={item} />
            ))}
          </div>
        )}
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle icon={Compass}>Active work</SectionTitle>
          {activeProjects.length === 0 ? (
            <EmptyState title="No active work" description="Nothing is currently in planning or execution." />
          ) : (
            <div className="flex flex-col gap-2">
              {activeProjects.map((p) => (
                <Link
                  key={p.id}
                  to={projectDeepLinkTo(p.id, { tab: p.liveWorkFeed ? 'keep-going' : undefined, runId: p.runId })}
                  className="rounded-md border border-border p-3 text-sm hover:border-primary/50"
                >
                  {p.displayName} — {p.liveWorkFeed?.reason ?? p.mission.state}
                </Link>
              ))}
            </div>
          )}
        </section>
        <section>
          <SectionTitle icon={FlaskConical}>Active research</SectionTitle>
          {activeResearch.length === 0 ? (
            <EmptyState title="No active research" description="Ask Command to research something to get started." />
          ) : (
            <div className="flex flex-col gap-2">
              {activeResearch.map((item) => (
                <ResearchMissionCard key={item.missionId} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle icon={Clock}>Waiting for resources</SectionTitle>
          {waitingForResources.length === 0 ? (
            <EmptyState title="Nothing waiting" description="No run is currently paused for provider/resource capacity." />
          ) : (
            <div className="flex flex-col gap-2">
              {waitingForResources.map((p) => (
                <Link key={p.id} to={projectDeepLinkTo(p.id, { tab: 'keep-going', runId: p.runId })} className="rounded-md border border-border p-3 text-sm hover:border-primary/50">
                  {p.displayName} — {p.liveWorkFeed?.reason ?? 'Waiting for resources'}
                </Link>
              ))}
            </div>
          )}
        </section>
        <section>
          <SectionTitle icon={ShieldCheck}>Verification / adoption</SectionTitle>
          {work.verifying.length === 0 && work.readyForAdoption.length === 0 ? (
            <EmptyState title="Nothing to verify" description="No work is currently being verified or waiting on an adoption decision." />
          ) : (
            <div className="flex flex-col gap-2">
              {work.verifying.map((p) => (
                <Link key={`verifying-${p.id}`} to={projectDeepLinkTo(p.id, { tab: 'keep-going', runId: p.runId })} className="rounded-md border border-border p-3 text-sm hover:border-primary/50">
                  {p.displayName} — Verifying
                </Link>
              ))}
              {work.readyForAdoption.map((p) => (
                <Link key={`adopt-${p.id}`} to={projectDeepLinkTo(p.id, { tab: 'adoption', runId: p.runId })} className="rounded-md border border-border p-3 text-sm hover:border-primary/50">
                  {p.displayName} — Ready for adoption
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mb-8">
        <SectionTitle icon={PackageCheck}>Recently completed</SectionTitle>
        {recentlyCompletedProjects.length === 0 && recentlyCompletedResearch.length === 0 ? (
          <EmptyState title="Nothing completed yet" />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recentlyCompletedProjects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:border-primary/50">
                <span>{p.displayName}</span>
                <Badge variant="healthy">Adopted</Badge>
              </Link>
            ))}
            {recentlyCompletedResearch.map((item) => (
              <ResearchMissionCard key={item.missionId} item={item} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <SectionTitle icon={AlertTriangle}>Project health</SectionTitle>
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

      <section>
        <SectionTitle icon={ShieldCheck}>Resource / capacity status</SectionTitle>
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <CapacityIndicator />
            <SystemStatusIndicator />
          </CardContent>
        </Card>
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
