import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FlaskConical } from 'lucide-react'
import type { OwnerWorkItem } from '@/lib/operator-snapshot-types'

// TSF Final Pre-UI P1 Closure V1, P1 #1: the real, inline answer action a
// research mission's own Needs-You question was missing -- previously a
// permanent, non-clickable dead end (a research NEEDS_YOU item rendered
// via the plain, read-only ResearchMissionCard, with no way to answer the
// real question shown in `reason`). Mirrors PlannerNeedsYouCard.tsx's own
// exact real pattern (one card per open question, per-item answer/busy/
// error/sent state). `item.openNeedsYou[0]` is the question this card
// answers -- HQPage.tsx only renders this component when that array is
// non-empty (a NEEDS_YOU research item always has at least one real open
// question, by construction of owner-work-model.mjs's own
// RESEARCH_PHASE_TO_OWNER_STATE mapping).
export function ResearchNeedsYouCard({
  item,
  onResolved
}: {
  item: OwnerWorkItem
  onResolved: () => void
}) {
  const question = item.openNeedsYou?.[0]
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit() {
    if (!item.missionId || !question || !answer.trim()) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.resolveResearchNeedsYou(item.missionId, question.id, answer.trim())
      setSent(true)
      onResolved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the answer.')
    } finally {
      setBusy(false)
    }
  }

  if (!question) {
    return null
  }

  return (
    <Card className="border-status-degraded/40 bg-status-degraded/5">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 p-3 pb-0">
        <CardTitle className="flex items-center gap-1.5 text-sm leading-snug">
          <FlaskConical className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="line-clamp-2">{item.researchQuestion ?? item.missionId}</span>
        </CardTitle>
        <Badge variant="degraded">Research</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="text-xs text-muted-foreground">{question.question}</div>
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
