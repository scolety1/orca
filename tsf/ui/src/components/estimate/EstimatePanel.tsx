import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, RefreshFailedBanner } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { DeliveryPlanStatus, ProjectEstimateResult } from '@/lib/estimate-types'

const STATUS_BADGE: Record<DeliveryPlanStatus, 'neutral' | 'healthy' | 'degraded' | 'blocked'> = {
  NO_DEADLINE_SET: 'neutral',
  ON_TRACK: 'healthy',
  AT_RISK: 'degraded',
  UNREALISTIC: 'blocked'
}

function hours(n: number): string {
  return `${Math.round(n)}h`
}

function GenerateForm({ projectId, onGenerated }: { projectId: string; onGenerated: () => void }) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [deadlineDate, setDeadlineDate] = useState('')
  const [ideaBrief, setIdeaBrief] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.generateEstimate(projectId, {
        startDate: new Date(startDate).toISOString(),
        ...(deadlineDate ? { deadlineDate: new Date(deadlineDate).toISOString() } : {}),
        ...(ideaBrief.trim() ? { ideaBrief: ideaBrief.trim() } : {})
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onGenerated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate an estimate.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Project Estimate / Delivery Plan
        </div>
        <p className="text-xs text-muted-foreground">
          Decomposes this project into a Work Breakdown Structure and runs a deterministic Monte
          Carlo estimate. Leave the idea brief empty to ground the WBS in this project&apos;s own
          real onboarding evidence; fill it in only for a preliminary, no-repo idea estimate.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Start date
            </label>
            <input
              type="date"
              className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Deadline (optional)
            </label>
            <input
              type="date"
              className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Idea brief (optional -- only for a no-repo preliminary estimate)
          </label>
          <Textarea rows={2} value={ideaBrief} onChange={(e) => setIdeaBrief(e.target.value)} />
        </div>
        {error && <p className="text-xs text-status-blocked">{error}</p>}
        <div>
          <Button size="sm" onClick={generate} disabled={submitting}>
            {submitting ? 'Generating…' : 'Generate estimate'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EstimateResultView({
  result,
  onRegenerate
}: {
  result: ProjectEstimateResult
  onRegenerate: () => void
}) {
  const { plan } = result
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Project Estimate / Delivery Plan
          </div>
          <div className="flex items-center gap-2">
            {result.preliminary && <Badge variant="neutral">Preliminary (idea only)</Badge>}
            <Badge variant={STATUS_BADGE[plan.status]}>{plan.status}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-3">
          <div>
            <div className="mb-1 text-muted-foreground">Active engineering effort</div>
            <div>
              P50 {hours(plan.estimate.activeEffortHours.p50)} · P80{' '}
              {hours(plan.estimate.activeEffortHours.p80)} · P95{' '}
              {hours(plan.estimate.activeEffortHours.p95)}
            </div>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">Human-operator effort</div>
            <div>
              P50 {hours(plan.estimate.humanEffortHours.p50)} · P80{' '}
              {hours(plan.estimate.humanEffortHours.p80)} · P95{' '}
              {hours(plan.estimate.humanEffortHours.p95)}
            </div>
          </div>
          <div>
            <div className="mb-1 text-muted-foreground">Wall-clock (no parallelism)</div>
            <div>
              P50 {hours(plan.estimate.wallClockHours.p50)} · P80{' '}
              {hours(plan.estimate.wallClockHours.p80)} · P95{' '}
              {hours(plan.estimate.wallClockHours.p95)}
            </div>
          </div>
        </div>

        <div className="text-[12px]">
          <div className="text-muted-foreground">Scheduled delivery</div>
          <div>
            Projected end: {new Date(plan.projectEndDate).toLocaleDateString()}
            {plan.deadlineDate && (
              <>
                {' '}
                · Deadline: {new Date(plan.deadlineDate).toLocaleDateString()} ·{' '}
                {plan.deadlineProbability === null
                  ? 'no probability computed'
                  : `${Math.round(plan.deadlineProbability * 100)}% chance of hitting it`}
              </>
            )}
          </div>
        </div>

        <div className="text-[12px]">
          <div className="mb-1 text-muted-foreground">Scheduled tasks ({plan.schedule.length})</div>
          <ul className="flex flex-col gap-1">
            {plan.schedule.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-2">
                <span>{task.title}</span>
                <span className="whitespace-nowrap text-muted-foreground">
                  {new Date(task.startDate).toLocaleDateString()} –{' '}
                  {new Date(task.endDate).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {result.wbs.some((task) => task.assumptions.length > 0) && (
          <div className="text-[12px]">
            <div className="mb-1 text-muted-foreground">Assumptions</div>
            <ul className="flex flex-col gap-0.5">
              {result.wbs.flatMap((task) =>
                task.assumptions.map((a) => <li key={`${task.id}-${a}`}>• {a}</li>)
              )}
            </ul>
          </div>
        )}

        <div className="text-[11px] text-muted-foreground">
          Generated {new Date(result.generatedAt).toLocaleString()}
        </div>

        <div>
          <Button size="sm" variant="outline" onClick={onRegenerate}>
            Regenerate
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function EstimatePanel({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useApi(() => api.estimate(projectId), [projectId])
  const [regenerating, setRegenerating] = useState(false)

  if (loading && !data) {
    return <LoadingState label="Loading estimate…" />
  }
  // Regenerating an estimate reload()s this same project's estimate. A
  // transient failure there must not blow away an existing estimate --
  // only a genuine first load with nothing yet should show the full error
  // state.
  if (error && !data) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!data) {
    return null
  }

  const existing = data.estimate
  return (
    <>
      {error && <RefreshFailedBanner message={error} onRetry={reload} />}
      {!existing || regenerating ? (
        <GenerateForm
          projectId={projectId}
          onGenerated={() => {
            setRegenerating(false)
            reload()
          }}
        />
      ) : (
        <EstimateResultView result={existing} onRegenerate={() => setRegenerating(true)} />
      )}
    </>
  )
}
