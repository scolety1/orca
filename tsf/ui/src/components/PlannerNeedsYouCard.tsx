import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { OtherNeedsYouItem } from '@/lib/home-needs-you-items'

// Pre-UI Productization V1, Priority 5: the real, inline answer action a
// planner mission's own Needs-You question was missing -- previously a
// permanent, non-clickable dead end (HQPage.tsx's own prior comment: "No
// standalone finding/planner-mission page exists yet"). Split into its own
// file (same convention as KeepGoingTickForm.tsx) so HQPage.tsx doesn't
// grow past the repo's max-lines lint budget, and so per-item answer/busy/
// error state is properly scoped -- HQPage.tsx renders one of these per
// planner Needs-You item in a list, which a single top-level useState
// could never do correctly.
export function PlannerNeedsYouCard({
  item,
  onResolved
}: {
  item: OtherNeedsYouItem
  onResolved: () => void
}) {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit() {
    if (!item.plannerMissionId || !item.plannerNeedsYouId || !answer.trim()) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.resolvePlannerNeedsYou(item.plannerMissionId, item.plannerNeedsYouId, answer.trim())
      setSent(true)
      onResolved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the answer.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-status-degraded/40 bg-status-degraded/5">
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">{item.label}</div>
          <Badge variant="degraded">Planner</Badge>
        </div>
        <div className="text-xs text-muted-foreground">{item.reason}</div>
        {sent ? (
          <div className="text-[11px] text-status-healthy">Answer sent.</div>
        ) : (
          <>
            <Textarea
              rows={2}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer…"
              className="text-xs"
            />
            {error && <div className="text-[11px] text-destructive">{error}</div>}
            <Button size="sm" disabled={busy || !answer.trim()} onClick={submit}>
              {busy ? 'Sending…' : 'Answer'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
