import { useState } from 'react'
import { Check, Circle, Copy, FileEdit, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { api, ApiError } from '@/lib/api'
import type { CandidateView } from '@/lib/types'

const STATE_VARIANT: Record<string, 'healthy' | 'degraded' | 'blocked' | 'neutral' | 'primary'> = {
  READY_FOR_ADOPTION: 'primary',
  ADOPTED: 'healthy',
  REJECTED: 'blocked',
  REVISION_REQUESTED: 'degraded',
  BLOCKED: 'blocked',
  NOT_READY: 'neutral'
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => undefined)
}

export function CandidateCard({ candidate, onChanged }: { candidate: CandidateView; onChanged: () => void }) {
  const [confirming, setConfirming] = useState<'ADOPT' | 'REJECT' | null>(null)
  const [revising, setRevising] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function decide(decision: 'ADOPT' | 'REJECT' | 'REQUEST_REVISION') {
    setBusy(true)
    setError(null)
    try {
      const requestId = `ui-${crypto.randomUUID()}`
      const res = await api.decideCandidate(candidate.projectId, { decision, requestId, reason: reason || undefined })
      // Owner language contract: the raw receipt hash stays out of this
      // primary confirmation -- it's real audit evidence, not something an
      // owner needs to act on in the moment (see ProjectDetailPage's own
      // Receipts tab for that).
      setResult(`${decision.replace('_', ' ')} recorded — candidate is now ${res.candidateState}.`)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Decision failed.')
    } finally {
      setBusy(false)
      setConfirming(null)
      setRevising(false)
    }
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            Candidate
            <Badge variant={STATE_VARIANT[candidate.state] ?? 'neutral'}>{candidate.state.replace(/_/g, ' ')}</Badge>
          </CardTitle>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {candidate.head && (
              <>
                <span>Version</span>
                <span className="font-mono">{candidate.head.slice(0, 12)}</span>
                <button onClick={() => copy(candidate.head!)} aria-label="Copy candidate version">
                  <Copy className="size-3" />
                </button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {candidate.implementationSummary && <p className="text-sm text-muted-foreground">{candidate.implementationSummary}</p>}

        {candidate.filesChanged.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Changed</div>
            <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
              {candidate.filesChanged.map((f) => (
                <li key={f} className="truncate">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {candidate.testsRun.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tests</div>
            <ul className="flex flex-col gap-0.5 text-[12px]">
              {candidate.testsRun.map((t, i) => {
                const known = t.failed !== undefined || t.exitCode !== undefined
                const passed = t.failed === 0 || t.exitCode === 0
                return (
                  <li key={i} className="flex items-center gap-1.5">
                    {!known ? <Circle className="size-2.5 text-muted-foreground" /> : passed ? <Check className="size-3 text-status-healthy" /> : <XCircle className="size-3 text-status-blocked" />}
                    <span className="text-muted-foreground">{t.command ?? 'check'}</span>
                    {t.passed !== undefined && (
                      <span className="font-mono text-[11px]">
                        {t.passed}/{(t.passed ?? 0) + (t.failed ?? 0)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {candidate.residualRisks && (
          <div className="rounded-md border border-status-degraded/30 bg-status-degraded/5 p-2 text-[12px] text-status-degraded">Residual risk: {candidate.residualRisks}</div>
        )}

        <Separator />

        {!candidate.decidable ? (
          <div className="text-[11px] text-muted-foreground">
            This candidate is historical evidence from a completed pilot — it already has a recorded decision and isn&apos;t live-decidable in this UI.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => setConfirming('ADOPT')}>
              <ShieldCheck className="size-4" /> Adopt
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRevising(true)}>
              <FileEdit className="size-4" /> Request revision
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirming('REJECT')}>
              <XCircle className="size-4" /> Reject
            </Button>
          </div>
        )}
        {error && <div className="text-[11px] text-destructive">{error}</div>}
        {result && <div className="text-[11px] text-status-healthy">{result}</div>}
      </CardContent>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirming === 'ADOPT' ? 'Adopt this candidate?' : 'Reject this candidate?'}</DialogTitle>
            <DialogDescription>
              {confirming === 'ADOPT'
                ? 'This binds your decision to the exact verified candidate and records a receipt. It does not push, merge, or deploy anything.'
                : 'This marks the candidate rejected and records a receipt. The source project is unaffected.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant={confirming === 'REJECT' ? 'destructive' : 'default'} size="sm" disabled={busy} onClick={() => confirming && decide(confirming)}>
              Confirm {confirming === 'ADOPT' ? 'adopt' : 'reject'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={revising} onOpenChange={setRevising}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a revision</DialogTitle>
            <DialogDescription>Describe what should change. This becomes the feedback bound to the next attempt.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs to change?" rows={4} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRevising(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !reason.trim()} onClick={() => decide('REQUEST_REVISION')}>
              Submit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
