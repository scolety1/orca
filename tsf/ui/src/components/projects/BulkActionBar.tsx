// Operator UX pass (spec section 3): the contextual bulk-action bar shown
// once at least one project is selected. Every action here already exists
// as a real, single- or multi-project endpoint -- this only fans requests
// out over the current selection and reports what happened, honestly.
// Bulk selection never increases authority: each action's own real
// per-project gating (Work Set eligibility, TIM_REQUIRED, etc.) still
// applies -- an ineligible project is skipped and explained, never forced
// through, and never blocks the rest of the batch.
import { useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  ListChecks,
  PlayCircle,
  Plus,
  ShieldCheck,
  Stethoscope,
  Wrench,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

type ActionKey =
  | 'analyze'
  | 'scanHealth'
  | 'prepareForWork'
  | 'addFleet'
  | 'removeFleet'
  | 'addWorkSet'
  | 'removeWorkSet'

const ACTION_LABEL: Record<ActionKey, string> = {
  analyze: 'Analyze selected',
  scanHealth: 'Scan Health',
  prepareForWork: 'Prepare for Work',
  addFleet: 'Add to Active Fleet',
  removeFleet: 'Remove from Active Fleet',
  addWorkSet: 'Add to Work Set',
  removeWorkSet: 'Remove from Work Set'
}

export function BulkActionBar({
  selectedIds,
  onClearSelection,
  onChanged,
  onStartMission,
  onStartOvernightFleet
}: {
  selectedIds: string[]
  onClearSelection: () => void
  onChanged: () => void
  onStartMission: () => void
  onStartOvernightFleet: () => void
}) {
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(key: ActionKey, fn: () => Promise<string>) {
    setBusy(key)
    setError(null)
    setSummary(null)
    try {
      setSummary(await fn())
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : `${ACTION_LABEL[key]} failed.`)
    } finally {
      setBusy(null)
    }
  }

  async function analyzeSelected() {
    // No dedicated bulk-analyze endpoint -- Prepare for Work's own first
    // stage already IS a real live re-scan per project, so this reuses it
    // rather than adding a second implementation of the same refresh.
    const result = await api.prepareForWork(selectedIds)
    const refreshed = result.results.filter((r) =>
      r.stages.some((s) => s.stage === 'REFRESH' && s.ok)
    ).length
    return `Analyzed ${refreshed}/${result.results.length} selected project(s).`
  }

  async function prepareForWork() {
    const result = await api.prepareForWork(selectedIds)
    const ready = result.results.filter((r) => r.readyForWork).length
    const skipped = result.results.filter((r) => !r.ok)
    return `${ready}/${result.results.length} ready for work.${
      skipped.length
        ? ` ${skipped.length} skipped: ${skipped.map((s) => `${s.projectId} (${s.error})`).join(', ')}`
        : ''
    }`
  }

  async function scanHealth() {
    await api.healthRepairScan()
    return `Health scanned for the fleet (includes the ${selectedIds.length} selected project(s)).`
  }

  async function membership(field: 'activeFleet' | 'workSet', add: boolean) {
    const result =
      field === 'activeFleet'
        ? await api.setActiveFleetMembership(selectedIds, add)
        : await api.setWorkSetMembership(selectedIds, add)
    const base = `${result.applied.length}/${selectedIds.length} ${add ? 'added' : 'removed'}.`
    return result.skipped.length
      ? `${base} ${result.skipped.length} skipped: ${result.skipped.map((s) => `${s.projectId} (${s.reason})`).join('; ')}`
      : base
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 flex items-center gap-1.5 text-xs font-medium">
          <ListChecks className="size-3.5 text-primary" />
          {selectedIds.length} selected
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => run('analyze', analyzeSelected)}
        >
          {busy === 'analyze' ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Analyze selected
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => run('scanHealth', scanHealth)}
        >
          {busy === 'scanHealth' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Stethoscope className="size-3.5" />
          )}
          Scan Health
        </Button>
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() => run('prepareForWork', prepareForWork)}
        >
          {busy === 'prepareForWork' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Wrench className="size-3.5" />
          )}
          Prepare for Work
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run('addFleet', () => membership('activeFleet', true))}
        >
          <Plus className="size-3.5" /> Active Fleet
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run('removeFleet', () => membership('activeFleet', false))}
        >
          <X className="size-3.5" /> Active Fleet
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run('addWorkSet', () => membership('workSet', true))}
        >
          <Plus className="size-3.5" /> Work Set
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => run('removeWorkSet', () => membership('workSet', false))}
        >
          <X className="size-3.5" /> Work Set
        </Button>
        <Button size="sm" variant="secondary" onClick={onStartMission}>
          <PlayCircle className="size-3.5" /> Start Mission
        </Button>
        <Button size="sm" variant="secondary" onClick={onStartOvernightFleet}>
          <CalendarClock className="size-3.5" /> Start Overnight Fleet
        </Button>
        <Button size="sm" variant="ghost" onClick={onClearSelection}>
          Clear
        </Button>
      </div>
      {summary && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3 shrink-0 text-status-healthy" />
          {summary}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
