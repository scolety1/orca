import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import {
  extractAttachmentContext,
  type MigrationContextAttachment
} from '@/lib/migration-context-attachments'
import { AddProjectRepositoryStep } from '@/components/onboarding/AddProjectRepositoryStep'
import { AddProjectContextStep } from '@/components/onboarding/AddProjectContextStep'
import {
  AddProjectAnalysisErrorStep,
  AddProjectReviewStep
} from '@/components/onboarding/AddProjectReviewStep'
import type {
  DirectoryBrowseResult,
  OnboardingAnalysis,
  OnboardingAnalysisError,
  OnboardingCommitResult,
  ReconciliationResolutionMode
} from '@/lib/onboarding-types'

type Step = 'repository' | 'context' | 'analyzing' | 'review' | 'onboarded'

// V1 stabilization finding (onboarding reconciliation deadlock): losing an
// already-made resolution decision to an accidental reload/navigation would
// reintroduce a milder version of the same problem this fix exists to
// solve. sessionStorage is per-tab, best-effort only — never load-bearing
// for anything durable (the real, permanent record is the committed
// onboarding receipt persisted server-side).
const WIZARD_STORAGE_KEY = 'tsf.addProject.wizardState.v1'

function loadSavedWizardState(): {
  step: Step
  repoPath: string
  handoffText: string
  analysis: OnboardingAnalysis
  addToKnown: boolean
  addToActiveFleet: boolean
  addToWorkSet: boolean
} | null {
  try {
    const raw = sessionStorage.getItem(WIZARD_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const saved = JSON.parse(raw)
    if (saved?.step === 'review' && saved.analysis?.ok) {
      return saved
    }
    return null
  } catch {
    return null
  }
}

function clearSavedWizardState() {
  try {
    sessionStorage.removeItem(WIZARD_STORAGE_KEY)
  } catch {
    // best-effort convenience only
  }
}

export function AddProjectPage() {
  const navigate = useNavigate()
  const restored = useState(loadSavedWizardState)[0]
  const [step, setStep] = useState<Step>(restored?.step ?? 'repository')
  const [repoPath, setRepoPath] = useState(restored?.repoPath ?? '')
  const [handoffText, setHandoffText] = useState(restored?.handoffText ?? '')
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseResult, setBrowseResult] = useState<DirectoryBrowseResult | null>(null)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const [analysis, setAnalysis] = useState<OnboardingAnalysis | null>(restored?.analysis ?? null)
  const [analysisError, setAnalysisError] = useState<OnboardingAnalysisError | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [addToKnown, setAddToKnown] = useState(restored?.addToKnown ?? true)
  const [addToActiveFleet, setAddToActiveFleet] = useState(restored?.addToActiveFleet ?? false)
  const [addToWorkSet, setAddToWorkSet] = useState(restored?.addToWorkSet ?? false)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<OnboardingCommitResult | null>(null)

  const [attachments, setAttachments] = useState<MigrationContextAttachment[]>([])
  const [attachmentDragActive, setAttachmentDragActive] = useState(false)
  const [refreshingOrcaStatus, setRefreshingOrcaStatus] = useState(false)
  const [retryingDirection, setRetryingDirection] = useState(false)
  const [resolvingReconciliation, setResolvingReconciliation] = useState(false)

  // Persist the in-review wizard state (including any reconciliation
  // resolution just made) so an accidental reload/navigation during Review
  // doesn't silently discard it — the same class of lost decision this fix
  // exists to prevent, just a step earlier.
  useEffect(() => {
    if (step !== 'review' || !analysis) {
      return
    }
    try {
      sessionStorage.setItem(
        WIZARD_STORAGE_KEY,
        JSON.stringify({
          step,
          repoPath,
          handoffText,
          analysis,
          addToKnown,
          addToActiveFleet,
          addToWorkSet
        })
      )
    } catch {
      // best-effort convenience only — never load-bearing
    }
  }, [step, repoPath, handoffText, analysis, addToKnown, addToActiveFleet, addToWorkSet])

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

  function selectRepoPath(path: string) {
    setRepoPath(path)
    setBrowseOpen(false)
  }

  // Repo truth outranks document claims — attachments/paste are evidence fed
  // into the same handoffText the reconciliation logic already treats as
  // untrusted prose, never injected as a separate authority. Bounded: only
  // the extracted text/summary is appended, never the entire raw file.
  function combinedHandoffText(): string {
    const attachmentBlocks = attachments
      .filter((a) => a.extractedText)
      .map((a) => `=== Attached: ${a.name} (${a.type || 'unknown type'}) ===\n${a.extractedText}`)
    return [handoffText.trim(), ...attachmentBlocks].filter(Boolean).join('\n\n')
  }

  async function analyze() {
    if (!repoPath.trim()) {
      return
    }
    setError(null)
    setAnalysisError(null)
    setStep('analyzing')
    clearSavedWizardState() // starting a fresh analysis — any stale saved Review state no longer applies
    try {
      const result = await api.analyzeRepo(repoPath.trim(), combinedHandoffText())
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

  async function addFiles(files: FileList | File[]) {
    const extracted = await Promise.all(Array.from(files).map(extractAttachmentContext))
    setAttachments((prev) => [...prev, ...extracted])
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // Standalone "Refresh Orca status" action (defect 3): re-checks
  // registration alone, without re-running the whole analysis.
  async function refreshOrcaStatus() {
    if (!analysis) {
      return
    }
    setRefreshingOrcaStatus(true)
    try {
      const result = await api.refreshOrcaStatus(analysis.repoPath)
      setAnalysis({ ...analysis, orcaRegistration: result.orcaRegistration })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refresh Orca status.')
    } finally {
      setRefreshingOrcaStatus(false)
    }
  }

  // Standalone "Retry direction analysis" action (defect 4): re-runs only
  // the live planner call, never re-persists, never fabricates a mission if
  // the planner is still down.
  async function retryDirection() {
    if (!analysis) {
      return
    }
    setRetryingDirection(true)
    try {
      const result = await api.retryDirection(analysis.repoPath, combinedHandoffText())
      if (result.ok) {
        setAnalysis({ ...analysis, direction: result.direction })
      } else {
        setError(result.detail ?? 'Direction analysis is still unavailable.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not retry direction analysis.')
    } finally {
      setRetryingDirection(false)
    }
  }

  // V1 stabilization finding (onboarding reconciliation deadlock): the
  // Review screen could detect a handoff/live-repo conflict with no control
  // anywhere to ever resolve it, which forced TIM_REQUIRED and left every
  // downstream toggle permanently disabled. Read-only, same facts /analyze
  // already read — never re-runs the live planner, never touches Orca/TSF
  // state persistence.
  async function resolveConflict(mode: ReconciliationResolutionMode) {
    if (!analysis) {
      return
    }
    setResolvingReconciliation(true)
    setError(null)
    try {
      const result = await api.resolveReconciliation(analysis.repoPath, combinedHandoffText(), {
        mode
      })
      if (result.ok) {
        const nextAnalysis: OnboardingAnalysis = {
          ...analysis,
          migrationClassification: result.migrationClassification,
          portfolioGating: result.portfolioGating,
          handoffReconciliation: result.handoffReconciliation,
          health: result.health
        }
        setAnalysis(nextAnalysis)
        setAddToKnown(result.portfolioGating.knownProjects.default)
        setAddToActiveFleet(result.portfolioGating.activeFleet.default)
        setAddToWorkSet(result.portfolioGating.workSet.default)
      } else {
        setError(result.detail ?? 'Could not resolve the discrepancy.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve the discrepancy.')
    } finally {
      setResolvingReconciliation(false)
    }
  }

  async function onboard() {
    if (!analysis) {
      return
    }
    setCommitting(true)
    setError(null)
    try {
      const result = await api.commitOnboarding(analysis, {
        knownProjects: addToKnown,
        activeFleet: addToActiveFleet,
        workSet: addToWorkSet
      })
      setCommitResult(result)
      setStep('onboarded')
      clearSavedWizardState()
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate('/projects')}
          aria-label="Back to Projects"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Add Project</h1>
          <p className="text-sm text-muted-foreground">
            Point TSF at an existing repository — it reads state read-only first, then tells you
            what it found.
          </p>
        </div>
      </header>

      <ol className="mb-6 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        {(['Repository', 'Context', 'Analyze', 'Review', 'Onboard'] as const).map((label, i) => {
          const stepIndex = ['repository', 'context', 'analyzing', 'review', 'onboarded'].indexOf(
            step
          )
          const active = i === Math.min(stepIndex, 4)
          return (
            <li
              key={label}
              className={cn(
                'flex items-center gap-1 rounded-full px-2 py-1',
                active && 'bg-primary/15 text-foreground'
              )}
            >
              {i > 0 && <ChevronRight className="size-3 opacity-50" />}
              {label}
            </li>
          )
        })}
      </ol>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {step === 'repository' && (
        <AddProjectRepositoryStep
          repoPath={repoPath}
          onRepoPathChange={setRepoPath}
          browsing={browsing}
          browseError={browseError}
          browseOpen={browseOpen}
          browseResult={browseResult}
          onOpenBrowser={openBrowser}
          onSelectPath={selectRepoPath}
          onCloseBrowse={() => setBrowseOpen(false)}
          onNext={() => setStep('context')}
        />
      )}

      {step === 'context' && (
        <AddProjectContextStep
          handoffText={handoffText}
          onHandoffTextChange={setHandoffText}
          attachments={attachments}
          attachmentDragActive={attachmentDragActive}
          onDragActiveChange={setAttachmentDragActive}
          onAddFiles={(files) => void addFiles(files)}
          onRemoveAttachment={removeAttachment}
          onBack={() => setStep('repository')}
          onAnalyze={analyze}
        />
      )}

      {step === 'analyzing' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Loader2 className="size-6 animate-spin text-primary" />
            <div className="text-sm font-medium">Analyzing repository — read-only</div>
            <div className="max-w-sm text-xs text-muted-foreground">
              Checking Git identity and state, discovering README/instructions/commands, reconciling
              your handoff against repository truth, and asking the planner for direction. Nothing
              on disk is being changed.
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'review' && analysisError && (
        <AddProjectAnalysisErrorStep
          analysisError={analysisError}
          onTryAnotherPath={() => setStep('repository')}
        />
      )}

      {step === 'review' && analysis && gating && (
        <AddProjectReviewStep
          analysis={analysis}
          gating={gating}
          addToKnown={addToKnown}
          addToActiveFleet={addToActiveFleet}
          addToWorkSet={addToWorkSet}
          onAddToKnownChange={setAddToKnown}
          onAddToActiveFleetChange={setAddToActiveFleet}
          onAddToWorkSetChange={setAddToWorkSet}
          committing={committing}
          refreshingOrcaStatus={refreshingOrcaStatus}
          retryingDirection={retryingDirection}
          resolvingReconciliation={resolvingReconciliation}
          onRefreshOrcaStatus={() => void refreshOrcaStatus()}
          onRetryDirection={() => void retryDirection()}
          onResolveConflict={(mode) => void resolveConflict(mode)}
          onBack={() => setStep('context')}
          onOnboard={() => void onboard()}
        />
      )}

      {step === 'onboarded' && analysis && commitResult && (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <div className="mx-auto flex size-8 items-center justify-center rounded-full bg-status-healthy/15 text-status-healthy">
              ✓
            </div>
            <div className="text-base font-semibold">{analysis.displayName} is onboarded</div>
            <div className="text-xs text-muted-foreground">
              {commitResult.activeFleet
                ? 'Added to Known Projects and Active Fleet'
                : 'Added to Known Projects'}
              {commitResult.workSet ? ' and Work Set' : ''}.
            </div>
            <div className="text-xs text-muted-foreground">
              {commitResult.orcaRegistration?.ok
                ? commitResult.orcaRegistration.alreadyRegistered
                  ? 'Already registered in Orca.'
                  : 'Registered in Orca.'
                : `Orca registration ${commitResult.orcaRegistration ? `unavailable (${commitResult.orcaRegistration.reason})` : 'not attempted'} — you can add it in Orca directly later.`}
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" onClick={() => navigate('/projects')}>
                Back to Projects
              </Button>
              <Button onClick={() => navigate(`/projects/${analysis.projectId}`)}>
                Open project
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
