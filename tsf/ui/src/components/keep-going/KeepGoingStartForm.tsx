import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

function linesOf(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

// Mirrors tsf/domain/keep-going.mjs's DEFAULT_BUDGET so the form's starting
// values match what a run would get if the operator left them untouched.
const DEFAULT_BUDGET = {
  maxWaves: 20,
  maxRetriesPerTask: 2,
  maxConcurrentWorkers: 2,
  stallThresholdMs: 30 * 60 * 1000
}

export function KeepGoingStartForm({
  projectId,
  onStarted,
  expectedRevision
}: {
  projectId: string
  onStarted: () => void
  expectedRevision?: number
}) {
  const { data: routing } = useApi(() => api.routing(), [])
  const [goal, setGoal] = useState('')
  const [criteria, setCriteria] = useState('')
  const [usageMode, setUsageMode] = useState('BALANCED')
  const [constraints, setConstraints] = useState('')
  const [stopConditions, setStopConditions] = useState('')
  const [budget, setBudget] = useState(DEFAULT_BUDGET)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableModes = routing
    ? Object.keys(routing.usageModes).filter((mode) => !routing.reservedModes.includes(mode))
    : ['BALANCED']

  function budgetField(key: keyof typeof DEFAULT_BUDGET, label: string, divisor = 1) {
    return (
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</label>
        <input
          type="number"
          min={0}
          className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={budget[key] / divisor}
          onChange={(e) =>
            setBudget((prev) => ({ ...prev, [key]: Number(e.target.value) * divisor }))
          }
        />
      </div>
    )
  }

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
        stopConditions: linesOf(stopConditions),
        budget,
        expectedRevision
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
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">Budget</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {budgetField('maxWaves', 'Max waves')}
            {budgetField('maxRetriesPerTask', 'Max retries/task')}
            {budgetField('maxConcurrentWorkers', 'Max concurrent workers')}
            {budgetField('stallThresholdMs', 'Stall threshold (min)', 60 * 1000)}
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
