import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import {
  CLASSIFICATION_META,
  classificationBadge,
  healthBadge,
  orcaStatusLabel,
  ProvenanceTag
} from '@/lib/onboarding-labels'
import { ReconciliationResolutionPanel } from '@/components/onboarding/ReconciliationResolutionPanel'
import type {
  OnboardingAnalysis,
  OnboardingAnalysisError,
  PortfolioGating,
  ReconciliationResolutionMode
} from '@/lib/onboarding-types'

export function AddProjectAnalysisErrorStep({
  analysisError,
  onTryAnotherPath
}: {
  analysisError: OnboardingAnalysisError
  onTryAnotherPath: () => void
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <CircleSlash className="size-4" /> Could not analyze this repository
        </div>
        <div className="text-xs text-muted-foreground">
          Reason: <code className="text-foreground">{analysisError.reason}</code>
          {analysisError.detail ? ` — ${analysisError.detail}` : ''}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onTryAnotherPath}>
            <ArrowLeft className="size-4" /> Try a different path
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function AddProjectReviewStep({
  analysis,
  gating,
  addToKnown,
  addToActiveFleet,
  addToWorkSet,
  onAddToKnownChange,
  onAddToActiveFleetChange,
  onAddToWorkSetChange,
  committing,
  refreshingOrcaStatus,
  retryingDirection,
  resolvingReconciliation,
  onRefreshOrcaStatus,
  onRetryDirection,
  onResolveConflict,
  onBack,
  onOnboard
}: {
  analysis: OnboardingAnalysis
  gating: PortfolioGating
  addToKnown: boolean
  addToActiveFleet: boolean
  addToWorkSet: boolean
  onAddToKnownChange: (value: boolean) => void
  onAddToActiveFleetChange: (value: boolean) => void
  onAddToWorkSetChange: (value: boolean) => void
  committing: boolean
  refreshingOrcaStatus: boolean
  retryingDirection: boolean
  resolvingReconciliation: boolean
  onRefreshOrcaStatus: () => void
  onRetryDirection: () => void
  onResolveConflict: (mode: ReconciliationResolutionMode) => void
  onBack: () => void
  onOnboard: () => void
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{analysis.displayName}</div>
              <div className="truncate text-xs text-muted-foreground" title={analysis.repoPath}>
                {analysis.repoPath}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {classificationBadge(analysis.migrationClassification.classification)}
              {healthBadge(analysis.health.status)}
            </div>
          </div>
          {analysis.existingProjectId && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              This exact repository path is already onboarded as{' '}
              <strong>{analysis.existingProjectId}</strong>. Onboarding again will update its record
              rather than create a duplicate.
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <ProvenanceTag kind="LIVE_REPO" />
            <span className="text-[10px] text-muted-foreground">
              Repository facts below are read live from Git just now.
            </span>
          </div>
          {analysis.identity.isLinkedWorktree && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This is a linked Git worktree — a bounded workstream, not the canonical project
                checkout
                {analysis.identity.worktreeSiblingCount
                  ? ` (one of ${analysis.identity.worktreeSiblingCount} worktree(s) sharing the same repository)`
                  : ''}
                . Confirm this is the location you mean before treating it as the project root.
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
            <div>
              Branch:{' '}
              <span className="text-foreground">
                {analysis.identity.branch ?? 'unknown'}
                {analysis.identity.detached ? ' (detached)' : ''}
              </span>
            </div>
            <div>
              HEAD:{' '}
              <span className="font-mono text-foreground">
                {analysis.identity.head?.slice(0, 10) ?? 'none'}
              </span>
            </div>
            <div>
              Commits:{' '}
              <span className="text-foreground">{analysis.identity.commitCount ?? 'unknown'}</span>
            </div>
            <div>
              Maturity:{' '}
              <span className="text-foreground">{analysis.maturity.replace(/_/g, ' ')}</span>
            </div>
            <div>
              Working tree:{' '}
              <span className="text-foreground">
                {analysis.currentState.dirty ? 'dirty' : 'clean'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              Orca:{' '}
              <span className="text-foreground">
                {orcaStatusLabel(analysis.orcaRegistration.status).label}
              </span>
              {!analysis.orcaRegistration.checked && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-4"
                  disabled={refreshingOrcaStatus}
                  onClick={onRefreshOrcaStatus}
                  aria-label="Refresh Orca status"
                  title="Refresh Orca status"
                >
                  <RefreshCw className={cn('size-3', refreshingOrcaStatus && 'animate-spin')} />
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ProvenanceTag kind="RECONCILED" />
            {CLASSIFICATION_META[analysis.migrationClassification.classification].description}
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {analysis.migrationClassification.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {analysis.handoffReconciliation.hasHandoff && (
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Handoff reconciliation <ProvenanceTag kind="RECONCILED" />
            </div>
            {analysis.handoffReconciliation.discrepancies.length > 0 ? (
              analysis.handoffReconciliation.discrepancies.map((d, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{d}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-status-healthy" /> Handoff agrees with
                observed repository state.
              </div>
            )}

            {analysis.handoffReconciliation.discrepancies.length > 0 && (
              <ReconciliationResolutionPanel
                reconciliation={analysis.handoffReconciliation}
                resolving={resolvingReconciliation}
                onResolve={onResolveConflict}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Direction <ProvenanceTag kind={analysis.direction.live ? 'PLANNER' : 'FALLBACK'} />
            </div>
            <div className="text-[10px] text-muted-foreground">
              {analysis.direction.providerLabel}
            </div>
          </div>
          {analysis.direction.live ? (
            <>
              <p className="text-sm">{analysis.direction.purpose}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground">Complete</div>
                  <p className="text-xs">{analysis.direction.completedSummary}</p>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground">Unfinished</div>
                  <p className="text-xs">{analysis.direction.unfinishedSummary}</p>
                </div>
              </div>
              {analysis.direction.recommendedNextMission && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                  <div className="text-[11px] font-medium text-primary">
                    Recommended next mission
                  </div>
                  <div className="text-sm font-medium">
                    {analysis.direction.recommendedNextMission.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {analysis.direction.recommendedNextMission.rationale}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Direction analysis unavailable ({analysis.direction.unavailableReason}). Repository
                facts above are still real and read-only.
              </div>
              <Button
                variant="outline"
                size="xs"
                disabled={retryingDirection}
                onClick={onRetryDirection}
              >
                {retryingDirection ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Retry direction analysis
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {analysis.direction.upgradeCandidates.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Upgrade backlog (recommendations, not automatic missions)
            </div>
            {analysis.direction.upgradeCandidates.map((c, i) => (
              <div key={i} className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="text-sm font-medium">{c.title}</div>
                  <div className="flex gap-1">
                    <Badge variant="neutral">{c.category.replace(/_/g, ' ')}</Badge>
                    <Badge variant={c.importance === 'HIGH' ? 'degraded' : 'neutral'}>
                      {c.importance}
                    </Badge>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.rationale}</p>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Confidence: {c.confidence} ·{' '}
                  {c.blocksCurrentWork ? 'Blocks current work' : 'Does not block current work'} ·{' '}
                  {c.safeToDefer ? 'Safe to defer' : 'Not safe to defer'}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Onboard
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addToKnown}
              disabled={!gating.knownProjects.allowed}
              onChange={(e) => onAddToKnownChange(e.target.checked)}
            />
            Known Projects — TSF knows this project exists
          </label>
          <label
            className={cn(
              'flex items-center gap-2 text-sm',
              !gating.activeFleet.allowed && 'opacity-40'
            )}
          >
            <input
              type="checkbox"
              checked={addToActiveFleet && gating.activeFleet.allowed}
              disabled={!gating.activeFleet.allowed || !addToKnown}
              onChange={(e) => onAddToActiveFleetChange(e.target.checked)}
            />
            Active Fleet — actively managed
          </label>
          <label
            className={cn(
              'flex items-center gap-2 text-sm',
              (!gating.workSet.allowed || !addToActiveFleet) && 'opacity-40'
            )}
          >
            <input
              type="checkbox"
              checked={addToWorkSet && gating.workSet.allowed && addToActiveFleet}
              disabled={!gating.workSet.allowed || !addToActiveFleet}
              onChange={(e) => onAddToWorkSetChange(e.target.checked)}
            />
            Work Set — eligible for new work/dispatch
          </label>
          {!gating.workSet.allowed && (
            <div className="text-[11px] text-muted-foreground">
              Work Set is unavailable for this classification — a Known/Active Fleet project is not
              automatically eligible for autonomous work.
            </div>
          )}
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            <Button disabled={committing || !addToKnown} onClick={onOnboard}>
              {committing ? <Loader2 className="size-4 animate-spin" /> : null}
              Onboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
