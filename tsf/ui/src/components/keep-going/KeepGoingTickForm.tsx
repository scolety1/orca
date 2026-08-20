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
export function KeepGoingTickForm({
  projectId,
  onTicked
}: {
  projectId: string
  onTicked: () => void
}) {
  const [workItemId, setWorkItemId] = useState('')
  const [scope, setScope] = useState('')
  const [spec, setSpec] = useState('')
  const [worktree, setWorktree] = useState('current')
  const [agent, setAgent] = useState('codex')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runNow() {
    const scopePaths = linesOf(scope)
    if (!workItemId.trim() || scopePaths.length === 0) {
      setError('A work item id and at least one scope path (one per line) are required.')
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
          worktree: worktree.trim() || 'current',
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

  return (
    <div className="rounded-md border border-border p-3 text-[12px]">
      <div className="mb-2 font-medium text-muted-foreground">Run now (dispatch one work item)</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className="rounded-md border border-input bg-input px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Work item id"
          value={workItemId}
          onChange={(e) => setWorkItemId(e.target.value)}
        />
        <input
          className="rounded-md border border-input bg-input px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Worktree (default: current)"
          value={worktree}
          onChange={(e) => setWorktree(e.target.value)}
        />
        <input
          className="rounded-md border border-input bg-input px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Agent (default: codex)"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        />
      </div>
      <Textarea
        rows={2}
        className="mt-2"
        placeholder={'File scope, one path per line\nsrc/example.mjs'}
        value={scope}
        onChange={(e) => setScope(e.target.value)}
      />
      <Textarea
        rows={2}
        className="mt-2"
        placeholder="Spec (optional -- what should the worker do)"
        value={spec}
        onChange={(e) => setSpec(e.target.value)}
      />
      {error && <p className="mt-2 text-status-blocked">{error}</p>}
      {result && <p className="mt-2 text-muted-foreground">{result}</p>}
      <div className="mt-2">
        <Button size="sm" variant="outline" onClick={runNow} disabled={submitting}>
          {submitting ? 'Dispatching…' : 'Run now'}
        </Button>
      </div>
    </div>
  )
}
