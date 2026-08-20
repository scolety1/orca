import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { KeepGoingActiveRunView, KeepGoingRunState } from '@/lib/keep-going-types'

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

function linesOf(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function StartForm({ projectId, onStarted }: { projectId: string; onStarted: () => void }) {
  const { data: routing } = useApi(() => api.routing(), [])
  const [goal, setGoal] = useState('')
  const [criteria, setCriteria] = useState('')
  const [usageMode, setUsageMode] = useState('BALANCED')
  const [constraints, setConstraints] = useState('')
  const [stopConditions, setStopConditions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableModes = routing
    ? Object.keys(routing.usageModes).filter((mode) => !routing.reservedModes.includes(mode))
    : ['BALANCED']

  async function start() {
    const acceptanceCriteria = linesOf(criteria)
    if (!goal.trim() || acceptanceCriteria.length === 0) {
      setError('A goal and at least one acceptance criterion (one per line) are required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.startKeepGoing(projectId, {
        originalGoal: goal.trim(),
        acceptanceCriteria,
        usageMode,
        constraints: linesOf(constraints),
        stopConditions: linesOf(stopConditions)
      })
      onStarted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the run.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Keep Going / Overnight
        </div>
        <p className="text-xs text-muted-foreground">
          Establishes a bounded, checkpointed run against an immutable goal. TSF
          replans/continues/stops against this goal every wave — never against a worker&apos;s own
          claim.
        </p>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Goal</label>
          <Textarea
            rows={2}
            placeholder="What should this run accomplish?"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Acceptance criteria (one per line)
          </label>
          <Textarea
            rows={3}
            placeholder={'CRITERION_A\nCRITERION_B'}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Usage Mode
            </label>
            <select
              className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={usageMode}
              onChange={(e) => setUsageMode(e.target.value)}
            >
              {availableModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Constraints (one per line, optional)
          </label>
          <Textarea rows={2} value={constraints} onChange={(e) => setConstraints(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Stop conditions (one per line, optional)
          </label>
          <Textarea
            rows={2}
            value={stopConditions}
            onChange={(e) => setStopConditions(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-status-blocked">{error}</p>}
        <div>
          <Button size="sm" onClick={start} disabled={submitting}>
            {submitting ? 'Starting…' : 'Start'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LiveRun({
  projectId,
  run,
  onChanged
}: {
  projectId: string
  run: KeepGoingActiveRunView
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pause() {
    setBusy(true)
    setError(null)
    try {
      await api.pauseKeepGoing(projectId, 'OPERATOR_PAUSE')
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
      await api.resumeKeepGoing(projectId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume the run.')
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
            <Badge key={criterion} variant="neutral">
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
        </div>
      </CardContent>
    </Card>
  )
}

export function KeepGoingPanel({ projectId }: { projectId: string }) {
  const { data: run, loading, error, reload } = useApi(() => api.keepGoing(projectId), [projectId])

  if (loading) {
    return <LoadingState label="Loading Keep Going state…" />
  }
  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!run) {
    return null
  }

  return run.started ? (
    <LiveRun projectId={projectId} run={run} onChanged={reload} />
  ) : (
    <StartForm projectId={projectId} onStarted={reload} />
  )
}
