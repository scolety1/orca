import { useState } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import type { EvalComparison, EvalPackSummary } from '@/lib/eval-types'

function CaseResultRow({
  result
}: {
  result: { caseId: string; passed: boolean; errored?: boolean }
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="min-w-0 truncate">{result.caseId}</span>
      <Badge variant={result.errored ? 'unknown' : result.passed ? 'healthy' : 'blocked'}>
        {result.errored ? 'ERRORED' : result.passed ? 'PASS' : 'FAIL'}
      </Badge>
    </div>
  )
}

function ComparisonCard({ comparison }: { comparison: EvalComparison }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Regression check
          </div>
          <Badge variant={comparison.recommendation === 'PROMOTE' ? 'healthy' : 'blocked'}>
            {comparison.recommendation}
          </Badge>
        </div>
        <div className="text-[12px] text-muted-foreground">
          {comparison.regressionCount} regression{comparison.regressionCount === 1 ? '' : 's'} ·{' '}
          {comparison.improvementCount} improvement{comparison.improvementCount === 1 ? '' : 's'}
        </div>
        {comparison.regressions.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[12px] text-status-blocked">
            {comparison.regressions.map((id) => (
              <li key={id}>• {id}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function PackDetail({ packId }: { packId: string }) {
  const { data, loading, error, reload } = useApi(() => api.evalHistory(packId), [packId])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<EvalComparison | null>(null)

  if (loading) {
    return <LoadingState label="Loading run history…" />
  }
  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!data) {
    return null
  }

  const latest = data.runs.at(-1)

  async function runNow() {
    setBusy(true)
    setActionError(null)
    setComparison(null)
    try {
      await api.runEvalPack(packId)
      reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not run this pack.')
    } finally {
      setBusy(false)
    }
  }

  async function checkForRegression() {
    setBusy(true)
    setActionError(null)
    try {
      const result = await api.evalRegressionCheck(packId)
      if (!result.ok) {
        setActionError(
          result.error === 'NO_BASELINE_YET'
            ? 'No prior run to compare against yet -- run this pack at least once first.'
            : result.error
        )
        return
      }
      setComparison(result.comparison)
      reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not check for a regression.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button size="sm" onClick={runNow} disabled={busy}>
          {busy ? 'Working…' : 'Run now'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={checkForRegression}
          disabled={busy || data.runs.length === 0}
        >
          Check for regression
        </Button>
      </div>
      {actionError && <p className="text-xs text-status-blocked">{actionError}</p>}
      {comparison && <ComparisonCard comparison={comparison} />}

      {!latest ? (
        <EmptyState title="No runs yet" description="Run this pack to see its first result." />
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Last run
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={latest.passRate === 1 ? 'healthy' : 'degraded'}>
                  {latest.passedCases}/{latest.totalCases} passed
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(latest.runAt).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {latest.results.map((r) => (
                <CaseResultRow key={r.caseId} result={r} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.runs.length > 1 && (
        <div className="text-[11px] text-muted-foreground">
          {data.runs.length} runs recorded, oldest to newest -- history is never rewritten.
        </div>
      )}
    </div>
  )
}

function PackListItem({
  pack,
  active,
  onSelect
}: {
  pack: EvalPackSummary
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-0.5 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-accent',
        active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{pack.packId}</span>
        <Badge variant="neutral">{pack.category}</Badge>
      </div>
      <span className="truncate text-[10px]">{pack.caseCount} cases</span>
    </button>
  )
}

export function EvaluationPage() {
  const { data: packs, loading, error } = useApi(() => api.evalPacks(), [])
  const [selected, setSelected] = useState<string | null>(null)
  const activeId = selected ?? packs?.packs[0]?.packId ?? null

  if (loading) {
    return <LoadingState label="Loading evaluation packs…" />
  }
  if (error) {
    return <ErrorState message={error} />
  }
  if (!packs) {
    return null
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Evaluation & Regression</h1>
        <p className="text-sm text-muted-foreground">
          Real eval packs measuring TSF&apos;s own already-adopted planner/worker/verifier/routing/
          memory/autonomy/estimator capabilities -- reproducible, versioned, and never rewriting
          history.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-1">
          {packs.packs.map((p) => (
            <PackListItem
              key={p.packId}
              pack={p}
              active={activeId === p.packId}
              onSelect={() => setSelected(p.packId)}
            />
          ))}
        </div>
        <div className="min-w-0">{activeId && <PackDetail packId={activeId} />}</div>
      </div>
    </div>
  )
}
