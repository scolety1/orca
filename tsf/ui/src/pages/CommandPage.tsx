import { Minimize2, RefreshCw } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { CommandPanel } from '@/components/command/CommandPanel'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCommandDock } from '@/lib/command-dock-context'

// The conversational front door to the existing project planners, Health
// Repair, Prepare for Work, Work Set, Keep Going, Fleet Optimizer, and Orca
// execution -- not a second chatbot and not a second scheduler (spec Phase
// 4). The status panel here and CommandPanel's own dispatch/status answers
// both read the same real aggregator (GET /api/fleet/status, backed by
// domain/fleet-work-status.mjs -- also what GET /api/work uses), so a
// sentence in chat and a row in this table can never disagree.
//
// Full Command Mode: this IS the "expand"/full-screen destination
// GlobalCommandDock's own "Full view" link opens -- the SAME conversation
// (CommandConversationProvider, above the router) that the dock's floating
// panel shows, not a second one. "Collapse" below re-opens the dock
// (useCommandDock().open()) and returns to wherever this view was reached
// from, so the exact same in-progress conversation, draft, and attachments
// reappear as the floating panel with nothing lost.
export function CommandPage() {
  const { data: statuses, loading, error, reload } = useApi(() => api.fleetStatus(), [])
  const { open } = useCommandDock()
  const navigate = useNavigate()

  function collapse() {
    open()
    navigate(-1)
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Command</h1>
          <p className="text-sm text-muted-foreground">
            Ask what&apos;s running, name a project to work on it, or name several to prepare and
            start them together. Command routes through your existing planners, Health Repair, Prepare
            for Work, and Keep Going -- it never runs a second execution engine of its own.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={collapse} className="shrink-0 gap-1.5">
          <Minimize2 className="size-3.5" />
          Collapse to dock
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <div className="h-[calc(100vh-220px)] min-h-[480px]">
          <CommandPanel onActivity={reload} />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              What&apos;s running
            </h2>
            <Button size="icon-sm" variant="ghost" onClick={reload} aria-label="Refresh">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>

          {loading && !statuses ? (
            <LoadingState label="Loading fleet status…" />
          ) : error && !statuses ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !statuses || statuses.length === 0 ? (
            <EmptyState title="No known projects yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {statuses.map((s) => (
                <Link key={s.projectId} to={`/projects/${s.projectId}`}>
                  <Card>
                    <CardContent className="flex flex-col gap-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{s.displayName}</span>
                        {s.hasRun ? (
                          <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {s.feed?.state}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                            no run
                          </span>
                        )}
                      </div>
                      {s.hasRun && (
                        <p className="text-[11px] text-muted-foreground">{s.feed?.reason}</p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
