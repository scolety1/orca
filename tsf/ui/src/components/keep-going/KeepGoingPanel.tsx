import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { KeepGoingActiveRunView, KeepGoingRunState } from '@/lib/keep-going-types'
import { KeepGoingStartForm } from './KeepGoingStartForm'
import { KeepGoingTickForm } from './KeepGoingTickForm'

const STATE_BADGE: Record<
  KeepGoingRunState,
  'primary' | 'neutral' | 'degraded' | 'healthy' | 'blocked'
> = {
  ACTIVE: 'primary',
  NEEDS_YOU: 'degraded',
  PAUSED: 'neutral',
  STALLED: 'degraded',
  COMPLETE: 'healthy',
  BLOCKED: 'blocked'
}

function LiveRun({
  projectId,
  run,
  onChanged,
  onStartNew
}: {
  projectId: string
  run: KeepGoingActiveRunView
  onChanged: () => void
  onStartNew: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pause() {
    setBusy(true)
    setError(null)
    try {
      await api.pauseKeepGoing(projectId, 'OPERATOR_PAUSE', run.revision)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pause the run.')
    } finally {
      setBusy(false)
    }
  }

  async function resume() {
    setBusy(true)
    setError(null)
    try {
      await api.resumeKeepGoing(projectId, run.revision)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume the run.')
    } finally {
      setBusy(false)
    }
  }

  // Without this, a STALLED run had no path back to usability from the
  // product surface at all: tickKeepGoingRun always re-checks the SAME
  // stuck wave and silently discards any new "Run now" work item (a real,
  // live-confirmed gap).
  async function abandonStalledWave() {
    setBusy(true)
    setError(null)
    try {
      await api.abandonStalledKeepGoingWave(
        projectId,
        'OPERATOR_ABANDONED_STALLED_WAVE',
        run.revision
      )
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not abandon the stalled wave.')
    } finally {
      setBusy(false)
    }
  }

  const canPause = run.state === 'ACTIVE' || run.state === 'NEEDS_YOU' || run.state === 'STALLED'
  const canResume = run.state === 'PAUSED'

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Keep Going / Overnight
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATE_BADGE[run.state]}>{run.state}</Badge>
            {run.readyForAdoption && <Badge variant="healthy">Ready for adoption</Badge>}
          </div>
        </div>

        <div className="text-sm font-medium">{run.goal}</div>
        <div className="flex flex-wrap gap-1">
          {run.acceptanceCriteria.map((criterion) => (
            <Badge
              key={criterion}
              variant={run.gap.satisfiedCriteria.includes(criterion) ? 'healthy' : 'neutral'}
            >
              {criterion}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Usage Mode</div>
            <div>{run.usageMode}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Waves completed</div>
            <div>{run.wavesCompleted}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Phase</div>
            <div>{run.phase}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Retries</div>
            <div>
              {Object.keys(run.retryCounts).length === 0
                ? 'none'
                : Object.entries(run.retryCounts)
                    .map(([id, n]) => `${id}:${n}`)
                    .join(', ')}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Budget</div>
            <div>
              {run.budget.maxWaves ?? '—'} waves · {run.budget.maxConcurrentWorkers ?? '—'} workers
            </div>
          </div>
        </div>

        <div className="text-[12px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted-foreground">Gap analysis</span>
            <Badge
              variant={
                run.gap.decision === 'STOP_COMPLETE'
                  ? 'healthy'
                  : run.gap.decision === 'STOP_BLOCKED'
                    ? 'blocked'
                    : 'neutral'
              }
            >
              {run.gap.decision}
            </Badge>
          </div>
          {run.gap.remainingGaps.length === 0 ? (
            <div className="text-status-healthy">All criteria independently verified.</div>
          ) : (
            <div>
              {run.gap.remainingGaps.length} of {run.acceptanceCriteria.length} criteria remain
              unverified: {run.gap.remainingGaps.join(', ')}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground">Workers</div>
            <div>
              {run.workers.length === 0 ? 'none dispatched yet' : `${run.workers.length} active`}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Verifier results</div>
            <div>
              {run.verifierResults.length === 0
                ? 'none recorded yet'
                : `${run.verifierResults.length} recorded`}
            </div>
          </div>
        </div>

        {run.constraints.length > 0 && (
          <div className="text-[12px]">
            <div className="text-muted-foreground">Constraints</div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {run.constraints.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          </div>
        )}

        {run.stopConditions.length > 0 && (
          <div className="text-[12px]">
            <div className="text-muted-foreground">Stop conditions</div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {run.stopConditions.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          </div>
        )}

        {run.openNeedsYou.length > 0 && (
          <div className="rounded-md border border-status-degraded/40 bg-status-degraded/10 p-2 text-[12px]">
            <div className="mb-1 font-medium text-status-degraded">Needs You</div>
            {run.openNeedsYou.map((entry) => (
              <div key={entry.id}>{entry.question}</div>
            ))}
          </div>
        )}

        {run.lastCheckpoint && (
          <div className="text-[11px] text-muted-foreground">
            Last checkpoint: {run.lastCheckpoint.phase} ·{' '}
            {new Date(run.lastCheckpoint.at).toLocaleString()}
          </div>
        )}

        {error && <p className="text-xs text-status-blocked">{error}</p>}

        {run.state === 'ACTIVE' && <KeepGoingTickForm projectId={projectId} onTicked={onChanged} />}

        <div className="flex gap-2">
          {canPause && (
            <Button size="sm" variant="outline" onClick={pause} disabled={busy}>
              Pause
            </Button>
          )}
          {canResume && (
            <Button size="sm" onClick={resume} disabled={busy}>
              Resume
            </Button>
          )}
          {run.state === 'STALLED' && (
            <Button size="sm" variant="outline" onClick={abandonStalledWave} disabled={busy}>
              Abandon stalled wave
            </Button>
          )}
          {(run.state === 'COMPLETE' || run.state === 'BLOCKED') && (
            <Button size="sm" onClick={onStartNew}>
              Start a new run
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function KeepGoingPanel({ projectId }: { projectId: string }) {
  const { data: run, loading, error, reload } = useApi(() => api.keepGoing(projectId), [projectId])
  const [startingNew, setStartingNew] = useState(false)

  if (loading) {
    return <LoadingState label="Loading Keep Going state…" />
  }
  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!run) {
    return null
  }

  const showStartForm = !run.started || startingNew
  return showStartForm ? (
    <KeepGoingStartForm
      projectId={projectId}
      onStarted={() => {
        setStartingNew(false)
        reload()
      }}
      expectedRevision={run.started ? run.revision : undefined}
    />
  ) : (
    <LiveRun
      projectId={projectId}
      run={run}
      onChanged={reload}
      onStartNew={() => setStartingNew(true)}
    />
  )
}
