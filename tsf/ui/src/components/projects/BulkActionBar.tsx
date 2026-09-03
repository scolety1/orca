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
  ChevronDown,
  Loader2,
  ListChecks,
  PlayCircle,
  ShieldCheck,
  Stethoscope,
  Wrench
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import {
  ACTIVE_FLEET_EXPLANATION,
  WORK_SET_EXPLANATION,
  ACTIVE_FLEET_REMOVAL_CASCADE_NOTE,
  cascadedFromWorkSet
} from '@/lib/membership-tier-copy'

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
  workSetBefore,
  refreshing,
  onClearSelection,
  onChanged,
  onStartMission,
  onStartOvernightFleet
}: {
  selectedIds: string[]
  // BUG-03 (bug-ledger.json): the real Work Set membership BEFORE this
  // action, so a Remove-from-Active-Fleet action can honestly report the
  // real cascade (domain/portfolio.mjs's setActiveFleet also drops Work
  // Set membership for the same projects) instead of leaving it silent.
  workSetBefore: string[]
  // Independent-verification finding: onChanged (ProjectsPage's reload())
  // only bumps a tick and returns immediately -- it does NOT await the
  // actual portfolio refetch, so a second action started right after a
  // first one could still read the FIRST action's now-stale workSetBefore
  // prop, silently under-reporting a real cascade. refreshing is the
  // parent's real portfolio-loading-or-errored flag: disabling actions
  // while it's true means the next action can only start once a
  // SUCCESSFUL reload has actually delivered the fresh workSetBefore.
  // Cross-cutting-review finding: gating on bare loading alone isn't
  // enough -- a FAILED background reload also clears loading (use-api.ts's
  // own .finally()) while leaving portfolio/workSetBefore stale, so
  // ProjectsPage passes loading || !!error here, keeping actions honestly
  // disabled (with the existing RefreshFailedBanner's Retry as the real
  // way out) until data is genuinely current, not just until the request
  // merely finished.
  refreshing: boolean
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
    const parts = [base]
    // BUG-03 (bug-ledger.json): report the real cascade honestly -- any
    // project that was actually removed from Active Fleet AND was in the
    // Work Set before this action lost Work Set membership too, as a real
    // side effect of setActiveFleet's own invariant (domain/portfolio.mjs),
    // not a fabricated warning.
    if (field === 'activeFleet' && !add) {
      const cascaded = cascadedFromWorkSet(result.applied, workSetBefore)
      if (cascaded.length > 0) {
        parts.push(`Also removed from Work Set: ${cascaded.join(', ')}.`)
      }
    }
    if (result.skipped.length) {
      parts.push(
        `${result.skipped.length} skipped: ${result.skipped.map((s) => `${s.projectId} (${s.reason})`).join('; ')}`
      )
    }
    return parts.join(' ')
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
          disabled={busy !== null || refreshing}
          onClick={() => run('analyze', analyzeSelected)}
        >
          {busy === 'analyze' ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Analyze selected
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || refreshing}
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
          disabled={busy !== null || refreshing}
          onClick={() => run('prepareForWork', prepareForWork)}
        >
          {busy === 'prepareForWork' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Wrench className="size-3.5" />
          )}
          Prepare for Work
        </Button>
        <DropdownMenu
          trigger={() => (
            <span className="flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-primary/40">
              Active Fleet <ChevronDown className="size-3.5" />
            </span>
          )}
        >
          {(close) => (
            <>
              <p className="px-2 pb-1.5 pt-1 text-[10px] text-muted-foreground">
                {ACTIVE_FLEET_EXPLANATION}
              </p>
              <DropdownMenuItem
                disabled={busy !== null || refreshing}
                onClick={() => {
                  close()
                  run('addFleet', () => membership('activeFleet', true))
                }}
              >
                Add to Active Fleet
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy !== null || refreshing}
                onClick={() => {
                  close()
                  run('removeFleet', () => membership('activeFleet', false))
                }}
              >
                Remove from Active Fleet
              </DropdownMenuItem>
              <p className="px-2 pt-1.5 text-[10px] text-muted-foreground">
                {ACTIVE_FLEET_REMOVAL_CASCADE_NOTE}
              </p>
            </>
          )}
        </DropdownMenu>
        <DropdownMenu
          trigger={() => (
            <span className="flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-primary/40">
              Work Set <ChevronDown className="size-3.5" />
            </span>
          )}
        >
          {(close) => (
            <>
              <p className="px-2 pb-1.5 pt-1 text-[10px] text-muted-foreground">
                {WORK_SET_EXPLANATION}
              </p>
              <DropdownMenuItem
                disabled={busy !== null || refreshing}
                onClick={() => {
                  close()
                  run('addWorkSet', () => membership('workSet', true))
                }}
              >
                Add to Work Set
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy !== null || refreshing}
                onClick={() => {
                  close()
                  run('removeWorkSet', () => membership('workSet', false))
                }}
              >
                Remove from Work Set
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenu>
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
