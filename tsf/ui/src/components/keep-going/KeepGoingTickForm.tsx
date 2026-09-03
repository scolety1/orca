import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

function linesOf(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

// One caller-supplied work item at a time -- tickKeepGoingRun itself
// refuses to fabricate a plan, so an operator triggering "Run now" from
// the UI supplies exactly what a planning session would: what to build
// and where. Kept deliberately minimal (single item) rather than a full
// multi-item batch editor. Split out of KeepGoingPanel.tsx to keep that
// file under the repo's max-lines lint limit.
// BUG-15: defaultWorkItemId/defaultScope let the panel prefill these from
// a real, just-abandoned stalled work item's own workItemId/scope -- the
// safest real recovery this codebase supports today (there is no single-
// work-item "Retry" domain primitive, see keep-going.mjs) is Abandon
// followed by a fresh dispatch of the same real work, and this is what
// makes that one click instead of retyping it from scratch. Still fully
// editable -- never auto-submitted.
export function KeepGoingTickForm({
  projectId,
  onTicked,
  defaultWorkItemId,
  defaultScope
}: {
  projectId: string
  onTicked: () => void
  defaultWorkItemId?: string
  defaultScope?: string
}) {
  const [workItemId, setWorkItemId] = useState(defaultWorkItemId ?? '')
  const [scope, setScope] = useState(defaultScope ?? '')
  const [spec, setSpec] = useState('')
  // No pre-filled default -- see hasExplicitPlacement (keep-going-dispatch-loop.mjs).
  const [worktree, setWorktree] = useState('')
  const [agent, setAgent] = useState('codex')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runNow() {
    const scopePaths = linesOf(scope)
    if (!workItemId.trim() || scopePaths.length === 0 || !worktree.trim()) {
      setError(
        'A work item id, at least one scope path (one per line), and an explicit worktree are required -- there is no safe default for where a real dispatch lands.'
      )
      return
    }
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const tickResult = await api.tickKeepGoing(projectId, [
        {
          id: workItemId.trim(),
          scope: scopePaths,
          ...(spec.trim() ? { spec: spec.trim() } : {}),
          worktree: worktree.trim(),
          agent: agent.trim() || 'codex'
        }
      ])
      setResult(`${tickResult.action}${tickResult.reason ? `: ${tickResult.reason}` : ''}`)
      onTicked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not tick the run.')
    } finally {
      setSubmitting(false)
    }
  }

  // BUG-10 (bug-ledger.json): every field below now has a persistent
  // <label> above it (the KeepGoingStartForm.tsx/StartMissionDialog.tsx
  // convention) instead of relying solely on a placeholder that vanishes
  // on the first keystroke, and the scope/spec textareas are sized to
  // actually review multi-line pasted content (5-10 file paths, a longer
  // spec) instead of a cramped 2 rows. Worktree/Agent are grouped under
  // an explicit "Advanced" heading, matching the codebase's own established
  // idea (KeepGoingStartForm.tsx's real Usage Mode/budget fields are
  // similarly grouped) -- Worktree stays visible and required (there is no
  // safe default for where a real dispatch lands), just clearly marked as
  // the advanced/technical half of this form rather than blended in with
  // the ordinary work-item/scope/spec fields above it.
  return (
    <div className="rounded-md border border-border p-3 text-[12px]">
      <div className="mb-3 font-medium text-muted-foreground">Run now (dispatch one work item)</div>

      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Work item id
          </label>
          <input
            className="w-full rounded-md border border-input bg-input px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. impl-1"
            value={workItemId}
            onChange={(e) => setWorkItemId(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            File scope (one path per line)
          </label>
          <Textarea
            rows={5}
            placeholder="src/example.mjs"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Spec (optional -- what should the worker do)
          </label>
          <Textarea
            rows={4}
            placeholder="What should the worker do?"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
          />
        </div>

        <div className="rounded-md border border-dashed border-border p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Advanced
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Worktree (required)
              </label>
              <input
                className="w-full rounded-md border border-input bg-input px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="An exact path, or literally 'current'"
                value={worktree}
                onChange={(e) => setWorktree(e.target.value)}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                No safe default -- required so a real dispatch never lands somewhere unintended.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Agent
              </label>
              <input
                className="w-full rounded-md border border-input bg-input px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="codex"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {error && <p className="mt-2 text-status-blocked">{error}</p>}
      {result && <p className="mt-2 text-muted-foreground">{result}</p>}
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={runNow} disabled={submitting}>
          {submitting ? 'Dispatching…' : 'Run now'}
        </Button>
      </div>
    </div>
  )
}
