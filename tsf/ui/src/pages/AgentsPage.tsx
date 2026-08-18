import { useState } from 'react'
import { Copy, FolderOpen, TerminalSquare } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => undefined)
}

function AgentSessions({ projectId }: { projectId: string }) {
  const { data, loading, error } = useApi(() => api.agents(projectId), [projectId])
  if (loading) return <LoadingState label="Loading session evidence…" />
  if (error) return <ErrorState message={error} />
  if (!data) return null
  if (data.sessions.length === 0) return <EmptyState title="No recorded sessions" />

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{data.note}</div>
      <div className="flex flex-col gap-2">
        {data.sessions.map((s, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-1 p-3">
              <div className="flex items-center gap-2">
                <TerminalSquare className="size-3.5 text-primary" />
                <span className="text-xs font-medium">{String(s.role ?? 'session')}</span>
                {s.providerId ? <Badge variant="neutral">{String(s.providerId)}</Badge> : null}
                {s.modelObserved ? <span className="text-[10px] text-muted-foreground">{String(s.modelObserved)}</span> : null}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{String(s.orcaSessionId ?? '')}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {data.worktrees.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Worktrees</div>
          <div className="flex flex-col gap-1.5">
            {data.worktrees.map((w) => (
              <div key={w} className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border p-2 font-mono text-[11px] text-muted-foreground">
                <span className="min-w-0 truncate">{w.split('::').pop()}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => copy(w.split('::').pop() ?? w)} aria-label="Copy worktree path" title="Copy worktree path">
                    <Copy className="size-3.5" />
                  </button>
                  <span title="Open this path as a worktree in Orca — no direct deep-link exists yet">
                    <FolderOpen className="size-3.5 opacity-50" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function AgentsPage() {
  const { data: projects, loading, error } = useApi(() => api.projects(), [])
  const [selected, setSelected] = useState<string | null>(null)
  const activeId = selected ?? projects?.[0]?.id ?? null

  if (loading) return <LoadingState label="Loading Agents…" />
  if (error) return <ErrorState message={error} />
  if (!projects) return null

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-muted-foreground">Recorded Orca session and worktree evidence per project — drill-down, more technical by design. Open a worktree path directly in Orca for live inspection.</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <div className="flex flex-col gap-1">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={cn('truncate rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-accent', activeId === p.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground')}
            >
              {p.displayName}
            </button>
          ))}
        </div>
        <div className="min-w-0">{activeId && <AgentSessions projectId={activeId} />}</div>
      </div>
    </div>
  )
}
