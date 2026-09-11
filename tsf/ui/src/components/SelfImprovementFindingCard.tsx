import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OtherNeedsYouItem } from '@/lib/home-needs-you-items'
import type { SelfImprovementFindingRecord } from '@/lib/self-improvement-finding-api'

// Manual Self-Improvement Finding Disposition V1: the real, inline action
// a self-improvement finding's Needs-You card was missing -- previously a
// permanent, non-clickable dead end (and a READY_FOR_ADOPTION finding was
// invisible in the UI entirely). Reuses CandidateCard.tsx's own
// established decide-action shape (busy state, inline result/error, no
// dead ends). Split into its own file for the same reasons
// PlannerNeedsYouCard.tsx was: HQPage.tsx's own max-lines budget, and
// correctly-scoped per-item state for a dynamic list.
//
// Owner language contract: "Finding" / "Apply verified fix" / "Start
// fix" / "Dismiss" on the primary card; raw evidence/transitions/
// candidate-fix-scope JSON stays behind a closed-by-default "Advanced"
// disclosure (same real pattern PlannerChatPanel.tsx's own "Advanced:
// override worktree" already established), never shown on the primary
// surface.
export function SelfImprovementFindingCard({
  item,
  onChanged
}: {
  item: OtherNeedsYouItem
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detail, setDetail] = useState<SelfImprovementFindingRecord | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const findingId = item.findingId
  // Only ACTION 1 (Apply verified fix) is offered when a real verified
  // candidate exists (category === 'READY_FOR_ADOPTION', per
  // domain/fleet-attention-status.mjs's own selfImprovementItems) --
  // ACTION 2 (Start fix) otherwise (NEEDS_OWNER or
  // FAILED_REQUIRES_ATTENTION, both real, legal Start-Fix-eligible
  // statuses server-side). Never "Adopt finding" when there is no real
  // adoption candidate.
  const canApply = item.category === 'READY_FOR_ADOPTION'

  async function toggleDetails() {
    setDetailsOpen((open) => !open)
    if (!findingId || detail || detailError) {
      return
    }
    try {
      const res = await api.selfImprovementFinding(findingId)
      setDetail(res.finding)
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not load details.')
    }
  }

  async function runAction(action: () => Promise<{ ok: boolean; reason?: string }>, successText: string) {
    if (!findingId) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await action()
      if (!res.ok) {
        setError(res.reason ?? 'The action was refused.')
        return
      }
      setResult(successText)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function applyFix() {
    if (!findingId) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.applyVerifiedFix(findingId)
      if (!res.ok) {
        setError(res.reason ?? 'The fix could not be applied.')
        return
      }
      if (!res.adopted) {
        // A truthful, non-crash outcome: the call itself succeeded, but
        // the real adoption path refused (e.g. the owner adoption-
        // authorization gate is closed) -- never claim success it didn't
        // reach.
        setError(`Not applied: ${res.adoptionReason ?? 'blocked'}`)
        return
      }
      setResult('Applied.')
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The fix could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-status-degraded/40 bg-status-degraded/5">
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="text-left text-sm font-medium hover:underline" onClick={toggleDetails}>
            {item.label}
          </button>
          <Badge variant="degraded">Finding</Badge>
        </div>
        <div className="text-xs text-muted-foreground">{item.reason}</div>
        {detailsOpen && (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
            {detailError && <div className="text-destructive">{detailError}</div>}
            {!detail && !detailError && <div>Loading…</div>}
            {detail && (
              <div className="flex flex-col gap-1">
                <div>Verification status: {detail.status}</div>
                {detail.candidateFixScope?.summary && <div>Proposed fix: {detail.candidateFixScope.summary}</div>}
                <details className="mt-1">
                  <summary className="cursor-pointer">Advanced: raw evidence &amp; history</summary>
                  <div className="mt-1 text-[10px]">
                    {detail.transitions.length} recorded transition{detail.transitions.length === 1 ? '' : 's'}
                  </div>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                    {JSON.stringify(detail.evidence, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
        {error && <div className="text-[11px] text-destructive">{error}</div>}
        {result ? (
          <div className="text-[11px] text-status-healthy">{result}</div>
        ) : (
          <div className="flex gap-2">
            {canApply ? (
              <Button size="sm" disabled={busy} onClick={applyFix}>
                {busy ? 'Applying…' : 'Apply verified fix'}
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => runAction(() => api.startFix(findingId!), 'Fix started.')}>
                {busy ? 'Starting…' : 'Start fix'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => runAction(() => api.dismissSelfImprovementFinding(findingId!), 'Dismissed.')}
            >
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
