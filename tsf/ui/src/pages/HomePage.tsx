import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Compass,
  PackageCheck,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/StatusChip'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { Button } from '@/components/ui/button'
import { CapacityIndicator } from '@/components/CapacityIndicator'
import { projectDeepLinkTo } from '@/lib/project-work-deep-link'

function SectionTitle({
  icon: Icon,
  children
}: {
  icon: typeof Compass
  children: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </div>
  )
}

// Operator UX pass (spec section 11): Home answers "what needs my
// attention?" first -- Needs You, Working, Ready for Adoption, Provider
// Capacity, and a single Recommended action, all from real, already-
// computed data (portfolio + work), never a raw log dump. "Overnight" as a
// section distinct from "Working" is deliberately not fabricated here: a
// Keep Going run doesn't currently record whether it was started via
// Start Mission or Start Overnight Fleet, so there is no real signal to
// split on yet -- both surface together under Working, honestly.
export function HomePage() {
  const {
    data: portfolio,
    loading: pLoading,
    error: pError,
    reload: reloadPortfolio
  } = useApi(() => api.portfolio(), [])
  const {
    data: work,
    loading: wLoading,
    error: wError,
    reload: reloadWork
  } = useApi(() => api.work(), [])
  const [preparing, setPreparing] = useState(false)
  const [prepareResult, setPrepareResult] = useState<string | null>(null)

  // Real V1 stabilization finding (see ProjectsPage.tsx for the full real-
  // browser reproduction of the same pattern's worst case): gating on bare
  // loading flashes this whole page to a spinner on every background
  // reload (e.g. after Prepare Projects for Work), not just the first
  // load. `&& !portfolio`/`&& !work` keeps the page mounted through a
  // background reload.
  if ((pLoading && !portfolio) || (wLoading && !work)) {
    return <LoadingState label="Loading HQ…" />
  }
  // A background reload failure (e.g. after Prepare Projects for Work) must
  // not replace already-loaded portfolio/work data with a full-page error --
  // only a genuine first load with nothing yet should do that.
  if (pError && !portfolio) {
    return <ErrorState message={pError} onRetry={reloadPortfolio} />
  }
  if (wError && !work) {
    return <ErrorState message={wError} onRetry={reloadWork} />
  }
  if (!portfolio || !work) {
    return null
  }

  // BUG-14 (bug-ledger.json): this previously omitted work.needsYou and
  // work.stalled -- a project whose Keep Going run was genuinely STALLED
  // or NEEDS_YOU never appeared here at all (Work's own "Needs you /
  // blocked" section, WorkPage.tsx, always included them). Same run-driven
  // buckets Work uses, so Home and Work can never disagree about what
  // needs the operator. buildHomeNeedsYouItems also tags each entry with
  // which bucket it came from -- see its own header for why a bare
  // `key={p.id}` would collide (a project can legitimately appear in both
  // work.blocked and work.needsYou/stalled at once).
  const needsYou = buildHomeNeedsYouItems(work)
  const degradedProjects = portfolio.knownProjects.filter(
    (p) => p.healthStatus === 'DEGRADED' || p.healthStatus === 'BLOCKED'
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
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">HQ</h1>
        <p className="text-sm text-muted-foreground">What needs your attention, right now.</p>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Needs you</div>
            {/* Real-project adversarial-hardening finding: a bare
                needsYou.length counts ATTENTION REASONS, not distinct
                PROJECTS -- the same project can appear more than once
                (e.g. legacy-blocked AND run-STALLED at once), inflating
                this number past what a human reads it as ("how many
                projects need me"). The detail list below still shows
                every real reason-card individually, unchanged. */}
            <div className="text-2xl font-semibold">{countDistinctNeedsYouProjects(needsYou)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground">Working</div>
            <div className="text-2xl font-semibold">{work.active.length}</div>
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
              {prepareResult && (
                <span className="text-[11px] text-muted-foreground">{prepareResult}</span>
              )}
              <Button size="sm" disabled={preparing} onClick={prepareDegraded}>
                {preparing ? 'Preparing…' : 'Prepare Projects for Work'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="mb-8">
        <SectionTitle icon={UserCheck}>Needs you</SectionTitle>
        {needsYou.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="size-6" />}
            title="Nothing needs you right now"
            description="No blocked work and no candidates waiting on an adoption decision."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {needsYou.map((p) => (
              // BUG-12: a run-driven entry deep-links to its exact surface
              // (Adoption for a ready candidate, Keep Going otherwise); a
              // legacy blocked project (no liveWorkFeed, no run) has no
              // exact run to link to and keeps the plain Overview link.
              <Link
                key={homeNeedsYouItemKey(p)}
                to={projectDeepLinkTo(p.id, {
                  tab: p.liveWorkFeed
                    ? p.liveWorkFeed.state === 'READY_FOR_ADOPTION'
                      ? 'adoption'
                      : 'keep-going'
                    : undefined,
                  runId: p.runId
                })}
              >
                <Card className="border-status-degraded/40 bg-status-degraded/5 transition-colors hover:border-status-degraded/70">
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle>{p.displayName}</CardTitle>
                    <StatusChip status={p.health.status} />
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    {/* BUG-14: a run-driven needsYou/stalled entry's real
                        reason (liveWorkFeed.reason, e.g. "run state is
                        STALLED") previously fell through to the generic
                        mission.state text WorkPage.tsx already avoids. */}
                    {p.liveWorkFeed?.reason ??
                      p.mission.blockedReason ??
                      (p.candidate?.state === 'READY_FOR_ADOPTION'
                        ? 'Candidate is ready for your adoption decision.'
                        : p.mission.state)}
                  </CardContent>
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
            <EmptyState
              title="No active work"
              description="Nothing is currently in planning or execution in this Work Set."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {work.active.map((p) => (
                // work.active mixes run-driven and legacy (no-run) entries
                // (see work-feed-summary.mjs) -- only a real run has an
                // exact Keep Going tab to deep-link to; a legacy entry
                // keeps the plain Overview link, same as before.
                <Link
                  key={p.id}
                  to={projectDeepLinkTo(p.id, {
                    tab: p.liveWorkFeed ? 'keep-going' : undefined,
                    runId: p.runId
                  })}
                  className="rounded-md border border-border p-3 text-sm hover:border-primary/50"
                >
                  {/* BUG-14: previously always showed the stale legacy
                      mission.state even for a run-driven item, unlike
                      WorkPage.tsx's own Active section. */}
                  {p.displayName} — {p.liveWorkFeed?.reason ?? p.mission.state}
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
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:border-primary/50"
                >
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
          <EmptyState
            icon={<CheckCircle2 className="size-6" />}
            title="All known projects are healthy"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {degradedProjects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:border-primary/50"
              >
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
