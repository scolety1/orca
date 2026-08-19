import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, CircleSlash, Folder, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { CLASSIFICATION_META, classificationBadge, healthBadge } from '@/lib/onboarding-labels'
import type { DirectoryBrowseResult, OnboardingAnalysis, OnboardingAnalysisError, OnboardingCommitResult } from '@/lib/types'

type Step = 'repository' | 'context' | 'analyzing' | 'review' | 'onboarded'

export function AddProjectPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('repository')
  const [repoPath, setRepoPath] = useState('')
  const [handoffText, setHandoffText] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseResult, setBrowseResult] = useState<DirectoryBrowseResult | null>(null)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const [analysis, setAnalysis] = useState<OnboardingAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState<OnboardingAnalysisError | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [addToKnown, setAddToKnown] = useState(true)
  const [addToActiveFleet, setAddToActiveFleet] = useState(false)
  const [addToWorkSet, setAddToWorkSet] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<OnboardingCommitResult | null>(null)

  async function openBrowser(dirPath?: string) {
    setBrowsing(true)
    setBrowseError(null)
    try {
      const result = await api.browseDirectory(dirPath)
      setBrowseResult(result)
      setBrowseOpen(true)
    } catch (err) {
      setBrowseError(err instanceof ApiError ? err.message : 'Could not list that directory.')
    } finally {
      setBrowsing(false)
    }
  }

  async function analyze() {
    if (!repoPath.trim()) return
    setError(null)
    setAnalysisError(null)
    setStep('analyzing')
    try {
      const result = await api.analyzeRepo(repoPath.trim(), handoffText.trim())
      if (result.ok) {
        setAnalysis(result)
        setAddToKnown(result.portfolioGating.knownProjects.default)
        setAddToActiveFleet(result.portfolioGating.activeFleet.default)
        setAddToWorkSet(result.portfolioGating.workSet.default)
      } else {
        setAnalysisError(result)
      }
      setStep('review')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not analyze this repository.')
      setStep('context')
    }
  }

  async function onboard() {
    if (!analysis) return
    setCommitting(true)
    setError(null)
    try {
      const result = await api.commitOnboarding(analysis, { knownProjects: addToKnown, activeFleet: addToActiveFleet, workSet: addToWorkSet })
      setCommitResult(result)
      setStep('onboarded')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not onboard this project.')
    } finally {
      setCommitting(false)
    }
  }

  const gating = analysis?.portfolioGating

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <header className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate('/projects')} aria-label="Back to Projects">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Add Project</h1>
          <p className="text-sm text-muted-foreground">Point TSF at an existing repository — it reads state read-only first, then tells you what it found.</p>
        </div>
      </header>

      <ol className="mb-6 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        {(['Repository', 'Context', 'Analyze', 'Review', 'Onboard'] as const).map((label, i) => {
          const stepIndex = ['repository', 'context', 'analyzing', 'review', 'onboarded'].indexOf(step)
          const active = i === Math.min(stepIndex, 4)
          return (
            <li key={label} className={cn('flex items-center gap-1 rounded-full px-2 py-1', active && 'bg-primary/15 text-foreground')}>
              {i > 0 && <ChevronRight className="size-3 opacity-50" />}
              {label}
            </li>
          )
        })}
      </ol>

      {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

      {step === 'repository' && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Repository path</label>
              <div className="flex gap-2">
                <input
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="C:\Users\you\Documents\my-project"
                  className="w-full min-w-0 rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button variant="outline" onClick={() => openBrowser()} disabled={browsing}>
                  {browsing ? <Loader2 className="size-4 animate-spin" /> : <Folder className="size-4" />}
                  Browse
                </Button>
              </div>
              {browseError && <div className="mt-1.5 text-xs text-destructive">{browseError}</div>}
            </div>

            {browseOpen && browseResult && (
              <div className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  <span className="truncate" title={browseResult.path}>{browseResult.path}</span>
                  {browseResult.parent && (
                    <Button variant="ghost" size="xs" onClick={() => openBrowser(browseResult.parent!)}>
                      Up
                    </Button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto tsf-scrollbar">
                  {browseResult.directories.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">No subdirectories here.</div>
                  ) : (
                    browseResult.directories.map((name) => (
                      <div key={name} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-accent">
                        <button className="flex min-w-0 flex-1 items-center gap-2 truncate text-left" onClick={() => openBrowser(`${browseResult.path}\\${name}`)}>
                          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{name}</span>
                        </button>
                        <Button size="xs" variant="secondary" onClick={() => { setRepoPath(`${browseResult.path}\\${name}`); setBrowseOpen(false) }}>
                          Select
                        </Button>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex justify-between border-t border-border px-3 py-2">
                  <Button size="xs" variant="ghost" onClick={() => setBrowseOpen(false)}>Close</Button>
                  <Button size="xs" onClick={() => { setRepoPath(browseResult.path); setBrowseOpen(false) }}>Select this folder</Button>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button disabled={!repoPath.trim()} onClick={() => setStep('context')}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'context' && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Migration handoff / context (optional)</label>
              <Textarea
                value={handoffText}
                onChange={(e) => setHandoffText(e.target.value)}
                placeholder="Paste a summary from the old project chat, if you have one. TSF treats this as evidence, not authority — it will check it against what the repository actually shows."
                rows={6}
              />
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep('repository')}>
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button onClick={analyze}>
                Analyze <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'analyzing' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Loader2 className="size-6 animate-spin text-primary" />
            <div className="text-sm font-medium">Analyzing repository — read-only</div>
            <div className="max-w-sm text-xs text-muted-foreground">
              Checking Git identity and state, discovering README/instructions/commands, reconciling your handoff against repository truth, and asking the planner for direction. Nothing on disk is being changed.
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'review' && analysisError && (
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
              <Button variant="outline" onClick={() => setStep('repository')}>
                <ArrowLeft className="size-4" /> Try a different path
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'review' && analysis && gating && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{analysis.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground" title={analysis.repoPath}>{analysis.repoPath}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {classificationBadge(analysis.migrationClassification.classification)}
                  {healthBadge(analysis.health.status)}
                </div>
              </div>
              {analysis.existingProjectId && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  This exact repository path is already onboarded as <strong>{analysis.existingProjectId}</strong>. Onboarding again will update its record rather than create a duplicate.
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                <div>Branch: <span className="text-foreground">{analysis.identity.branch ?? 'unknown'}{analysis.identity.detached ? ' (detached)' : ''}</span></div>
                <div>HEAD: <span className="font-mono text-foreground">{analysis.identity.head?.slice(0, 10) ?? 'none'}</span></div>
                <div>Commits: <span className="text-foreground">{analysis.identity.commitCount ?? 'unknown'}</span></div>
                <div>Maturity: <span className="text-foreground">{analysis.maturity.replace(/_/g, ' ')}</span></div>
                <div>Working tree: <span className="text-foreground">{analysis.currentState.dirty ? 'dirty' : 'clean'}</span></div>
                <div>
                  Orca: <span className="text-foreground">{analysis.orcaRegistration.checked ? (analysis.orcaRegistration.registered ? 'already registered' : 'not registered yet') : 'unknown (Orca unreachable)'}</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{CLASSIFICATION_META[analysis.migrationClassification.classification].description}</div>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {analysis.migrationClassification.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
              </ul>
            </CardContent>
          </Card>

          {analysis.handoffReconciliation.hasHandoff && (
            <Card>
              <CardContent className="space-y-2 p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Handoff reconciliation</div>
                {analysis.handoffReconciliation.discrepancies.length > 0 ? (
                  analysis.handoffReconciliation.discrepancies.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{d}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-status-healthy" /> Handoff agrees with observed repository state.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Direction</div>
                <div className="text-[10px] text-muted-foreground">{analysis.direction.providerLabel}</div>
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
                      <div className="text-[11px] font-medium text-primary">Recommended next mission</div>
                      <div className="text-sm font-medium">{analysis.direction.recommendedNextMission.title}</div>
                      <div className="text-xs text-muted-foreground">{analysis.direction.recommendedNextMission.rationale}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">Direction analysis unavailable ({analysis.direction.unavailableReason}). Repository facts above are still real and read-only.</div>
              )}
            </CardContent>
          </Card>

          {analysis.direction.upgradeCandidates.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Upgrade backlog (recommendations, not automatic missions)</div>
                {analysis.direction.upgradeCandidates.map((c, i) => (
                  <div key={i} className="rounded-md border border-border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <div className="text-sm font-medium">{c.title}</div>
                      <div className="flex gap-1">
                        <Badge variant="neutral">{c.category.replace(/_/g, ' ')}</Badge>
                        <Badge variant={c.importance === 'HIGH' ? 'degraded' : 'neutral'}>{c.importance}</Badge>
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.rationale}</p>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Confidence: {c.confidence} · {c.blocksCurrentWork ? 'Blocks current work' : 'Does not block current work'} · {c.safeToDefer ? 'Safe to defer' : 'Not safe to defer'}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Onboard</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={addToKnown} disabled={!gating.knownProjects.allowed} onChange={(e) => setAddToKnown(e.target.checked)} />
                Known Projects — TSF knows this project exists
              </label>
              <label className={cn('flex items-center gap-2 text-sm', !gating.activeFleet.allowed && 'opacity-40')}>
                <input type="checkbox" checked={addToActiveFleet && gating.activeFleet.allowed} disabled={!gating.activeFleet.allowed || !addToKnown} onChange={(e) => setAddToActiveFleet(e.target.checked)} />
                Active Fleet — actively managed
              </label>
              <label className={cn('flex items-center gap-2 text-sm', (!gating.workSet.allowed || !addToActiveFleet) && 'opacity-40')}>
                <input type="checkbox" checked={addToWorkSet && gating.workSet.allowed && addToActiveFleet} disabled={!gating.workSet.allowed || !addToActiveFleet} onChange={(e) => setAddToWorkSet(e.target.checked)} />
                Work Set — eligible for new work/dispatch
              </label>
              {!gating.workSet.allowed && <div className="text-[11px] text-muted-foreground">Work Set is unavailable for this classification — a Known/Active Fleet project is not automatically eligible for autonomous work.</div>}
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep('context')}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
                <Button disabled={committing || !addToKnown} onClick={onboard}>
                  {committing ? <Loader2 className="size-4 animate-spin" /> : null}
                  Onboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 'onboarded' && analysis && commitResult && (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <CheckCircle2 className="mx-auto size-8 text-status-healthy" />
            <div className="text-base font-semibold">{analysis.displayName} is onboarded</div>
            <div className="text-xs text-muted-foreground">
              {commitResult.activeFleet ? 'Added to Known Projects and Active Fleet' : 'Added to Known Projects'}{commitResult.workSet ? ' and Work Set' : ''}.
            </div>
            <div className="text-xs text-muted-foreground">
              {commitResult.orcaRegistration?.ok
                ? commitResult.orcaRegistration.alreadyRegistered
                  ? 'Already registered in Orca.'
                  : 'Registered in Orca.'
                : `Orca registration ${commitResult.orcaRegistration ? `unavailable (${commitResult.orcaRegistration.reason})` : 'not attempted'} — you can add it in Orca directly later.`}
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" onClick={() => navigate('/projects')}>Back to Projects</Button>
              <Button onClick={() => navigate(`/projects/${analysis.projectId}`)}>Open project</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
