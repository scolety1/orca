import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { LoadingState, ErrorState, EmptyState, RefreshFailedBanner } from '@/components/States'
import { StatusChip } from '@/components/StatusChip'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CandidateCard } from '@/components/CandidateCard'
import { EstimatePanel } from '@/components/estimate/EstimatePanel'
import { FlightRecorderPanel } from '@/components/flight-recorder/FlightRecorderPanel'
import { KeepGoingPanel } from '@/components/keep-going/KeepGoingPanel'
import { PlannerChatPanel } from '@/components/chat/PlannerChatPanel'
import { RefreshProjectButton } from '@/components/onboarding/RefreshProjectButton'
import { MembershipPanel } from '@/components/projects/MembershipPanel'
import { ProjectResearchPanel } from '@/components/research/ProjectResearchPanel'
import { ProjectHealthTab } from '@/components/health-repair/ProjectHealthTab'
import { resolveProjectDetailTab } from '@/lib/project-work-deep-link'
import { humanizeConstant } from '@/lib/orchestration-terminology'
import { writeLastViewedProject } from '@/lib/last-viewed-project'

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => undefined)
}

function Ref({ label, head, tree }: { label: string; head?: string | null; tree?: string | null }) {
  if (!head) {
    return null
  }
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-mono">
        {head.slice(0, 12)}
        <button onClick={() => copy(head)} aria-label={`Copy ${label} head`}>
          <Copy className="size-3 text-muted-foreground" />
        </button>
        {tree && <span className="text-muted-foreground">/ tree {tree.slice(0, 8)}</span>}
      </span>
    </div>
  )
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  // key={id}: App.tsx's <Route path="/projects/:id"> reuses this element
  // across param changes -- without a remount here, navigating directly
  // between two project URLs (browser back/forward, address bar) kept the
  // previous project's useApi state and could render it under the new
  // project's id, including a wrong-entity RefreshFailedBanner on a failed
  // fetch. A real review finding. Same-entity background reloads (Refresh,
  // MembershipPanel Add/Remove) don't change `id`, so this doesn't
  // reintroduce the flash-to-spinner stabilization fix below.
  return <ProjectDetailPageForId key={id} id={id} />
}

function ProjectDetailPageForId({ id }: { id?: string }) {
  const { data: project, loading, error, reload } = useApi(() => api.project(id!), [id])
  // BUG-12 (bug-ledger.json): a Work/Home card's deep link (?tab=keep-going
  // etc., see project-work-deep-link.ts) now lands directly on the exact
  // surface instead of always the Overview tab. resolveProjectDetailTab
  // falls back to 'overview' for a missing/unrecognized value, so a plain
  // /projects/:id link (no query) or a stale/hand-edited one behaves
  // exactly as before.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveProjectDetailTab(searchParams.get('tab'))
  // BUG-02 (bug-ledger.json), real-project validation finding: the bug's
  // own title is "Last-viewed project/navigation position is not reliably
  // preserved" -- the URL-search-params fix above only covers Projects'
  // own filter/search/sort surviving a click-in-and-back round trip, not
  // the ORIGINAL literal complaint (leave for Health Repair/another
  // section, come back to Projects, still have to re-find the project) --
  // reproduced live against a real project during final review. This is
  // the other half: remember the single fact of which project this was,
  // so Projects can scroll it into view (see ProjectsPage.tsx).
  //
  // Independent-verification finding: this must key off the loaded
  // project, not the raw route param -- writing on the bare id fires even
  // when api.project(id!) never resolves (a stale/broken deep link, a
  // deleted project), overwriting a real prior last-viewed project with a
  // dead id that then matches nothing on Projects, silently defeating the
  // whole feature until another valid project is viewed.
  useEffect(() => {
    if (project?.id) {
      writeLastViewedProject(project.id)
    }
  }, [project?.id])

  // Real V1 stabilization finding (see ProjectsPage.tsx for the full real-
  // browser reproduction): gating on bare loading flashes this whole page
  // to a spinner -- and unmounts MembershipPanel/PlannerChatPanel/etc. and
  // their own local state -- on every background reload (Refresh,
  // MembershipPanel's Add/Remove), not just the first load.
  if (loading && !project) {
    return <LoadingState label="Loading project…" />
  }
  // A background refresh failure (Refresh, MembershipPanel Add/Remove, a
  // reload() elsewhere on this page) must not blow away an already-loaded
  // project -- only a genuine first load with nothing yet should show the
  // full error state. See RefreshFailedBanner for the same-page recovery.
  if (error && !project) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!project) {
    return null
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      {error && <RefreshFailedBanner message={error} onRetry={reload} />}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{project.displayName}</h1>
            {project.sourceClass === 'FIXTURE' ? (
              <Badge variant="fixture">Fixture</Badge>
            ) : (
              <Badge variant="neutral">Real project</Badge>
            )}
          </div>
          {project.purpose && (
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{project.purpose}</p>
          )}
          {project.evidence.onboarding && (
            <div className="mt-2">
              <RefreshProjectButton projectId={project.id} onRefreshed={reload} />
            </div>
          )}
        </div>
        <button
          onClick={() =>
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev)
              next.set('tab', 'health')
              return next
            })
          }
          aria-label="Open Health tab"
        >
          <StatusChip status={project.health.status} />
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div>
          <Tabs
            value={activeTab}
            onValueChange={(tab) => setSearchParams((prev) => {
              const next = new URLSearchParams(prev)
              if (tab === 'overview') {
                next.delete('tab')
              } else {
                next.set('tab', tab)
              }
              return next
            }, { replace: true })}
          >
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="keep-going">Keep Going</TabsTrigger>
              <TabsTrigger value="research">Research</TabsTrigger>
              <TabsTrigger value="health">Health</TabsTrigger>
              <TabsTrigger value="estimate">Estimate</TabsTrigger>
              <TabsTrigger value="flight-recorder">Flight Recorder</TabsTrigger>
              <TabsTrigger value="adoption">Adoption</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="receipts">Receipts</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 flex flex-col gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Fleet membership
                  </div>
                  <MembershipPanel project={project} onChanged={reload} />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Mission
                    </div>
                    <div className="text-sm">{project.mission.state}</div>
                    {project.mission.blockedReason && (
                      <div className="mt-1 text-xs text-status-degraded">
                        {project.mission.blockedReason}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Baseline
                    </div>
                    <div className="text-xs text-muted-foreground">
                      tests {project.baseline.tests} · lint {project.baseline.lint} · types{' '}
                      {project.baseline.typecheck}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Release
                  </div>
                  <Ref
                    label="Stable"
                    head={project.release.stable.head}
                    tree={project.release.stable.tree}
                  />
                  {project.release.previousStable && (
                    <Ref
                      label="Previous Stable"
                      head={project.release.previousStable.head}
                      tree={project.release.previousStable.tree}
                    />
                  )}
                  {project.release.upgrade && (
                    <Ref
                      label="Upgrade"
                      head={project.release.upgrade.head}
                      tree={project.release.upgrade.tree}
                    />
                  )}
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">Testing</span>
                    <span>{project.release.testing}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">Adoption</span>
                    <span>{project.release.adoption}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">Published</span>
                    <span>{project.release.published}</span>
                  </div>
                </CardContent>
              </Card>

              {project.evidence.selectedMission && (
                <Card>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recent decision
                    </div>
                    <div className="text-sm font-medium">
                      {project.evidence.selectedMission.title}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {project.evidence.selectedMission.rationale}
                    </p>
                  </CardContent>
                </Card>
              )}

              {project.evidence.onboarding && (
                <Card>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Onboarding
                      </div>
                      <Badge variant="neutral">
                        {project.evidence.onboarding.migrationClassification.classification.replace(
                          /_/g,
                          ' '
                        )}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Maturity: {project.evidence.onboarding.maturity.replace(/_/g, ' ')} ·
                      Alignment: {project.evidence.onboarding.alignment}
                    </div>
                    {project.evidence.onboarding.unfinishedSummary && (
                      <p className="text-xs text-muted-foreground">
                        {project.evidence.onboarding.unfinishedSummary}
                      </p>
                    )}
                    {project.evidence.onboarding.upgradeCandidates.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        <div className="text-[11px] font-medium text-muted-foreground">
                          Upgrade backlog ({project.evidence.onboarding.upgradeCandidates.length})
                        </div>
                        {project.evidence.onboarding.upgradeCandidates.slice(0, 3).map((c, i) => (
                          <div key={i} className="text-xs">
                            • {c.title}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground">
                      Orca:{' '}
                      {project.evidence.onboarding.orcaRegistration.checked
                        ? project.evidence.onboarding.orcaRegistration.registered
                          ? 'registered'
                          : 'not registered'
                        : 'unknown'}{' '}
                      · Analyzed {new Date(project.evidence.onboarding.analyzedAt).toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              )}

              {project.restrictions.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Restrictions
                    </div>
                    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {project.restrictions.map((r) => (
                        <li key={r}>• {r}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="keep-going" className="mt-4">
              <KeepGoingPanel projectId={project.id} />
            </TabsContent>

            <TabsContent value="research" className="mt-4">
              <ProjectResearchPanel projectId={project.id} />
            </TabsContent>

            <TabsContent value="health" className="mt-4">
              <ProjectHealthTab projectId={project.id} />
            </TabsContent>

            <TabsContent value="estimate" className="mt-4">
              <EstimatePanel projectId={project.id} />
            </TabsContent>

            <TabsContent value="flight-recorder" className="mt-4">
              <FlightRecorderPanel projectId={project.id} />
            </TabsContent>

            <TabsContent value="adoption" className="mt-4">
              {project.candidate ? (
                <CandidateCard candidate={project.candidate} onChanged={reload} />
              ) : (
                <EmptyState title="No candidate recorded" />
              )}
            </TabsContent>

            <TabsContent value="evidence" className="mt-4 flex flex-col gap-4">
              {project.evidence.resultCapsules.length === 0 ? (
                <EmptyState title="No recorded work results" />
              ) : (
                project.evidence.resultCapsules.map((r, i) => (
                  <Card key={i}>
                    <CardContent className="flex flex-col gap-2 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{r.id}</span>
                        <Badge
                          variant={
                            r.status === 'SUCCEEDED' || r.status === 'COMPLETED'
                              ? 'healthy'
                              : 'blocked'
                          }
                          title={r.status ?? undefined}
                        >
                          {humanizeConstant(r.status)}
                        </Badge>
                      </div>
                      {r.implementationSummary && (
                        <p className="text-xs text-muted-foreground">{r.implementationSummary}</p>
                      )}
                      {r.workerIdentity && (
                        <div className="font-mono text-[10px] text-muted-foreground">
                          session {String(r.workerIdentity.orcaSessionId ?? '')}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="receipts" className="mt-4">
              {project.receipts.chain.length === 0 ? (
                <EmptyState
                  title="No receipts recorded"
                  description="Receipts appear once a mission, candidate, verifier result, or adoption decision has happened."
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-[11px] text-muted-foreground">
                    Chain{' '}
                    {project.receipts.chainValid ? (
                      <span className="text-status-healthy">verified</span>
                    ) : (
                      <span className="text-status-blocked">invalid</span>
                    )}{' '}
                    · {project.receipts.chain.length} receipts
                  </div>
                  {project.receipts.chain.map((r) => (
                    <div
                      key={r.receiptHash}
                      className="rounded-md border border-border p-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.kind}</span>
                        <span className="text-muted-foreground">
                          {new Date(r.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{r.result ?? r.decision ?? '—'}</span>
                        <span className="font-mono">{r.receiptHash.slice(0, 12)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="h-[calc(100vh-220px)] min-h-[420px]">
          <PlannerChatPanel projectId={project.id} projectName={project.displayName} />
        </div>
      </div>
    </div>
  )
}
