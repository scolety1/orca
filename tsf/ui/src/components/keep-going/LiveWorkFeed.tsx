import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import type { KeepGoingActiveRunView } from '@/lib/keep-going-types'
import { projectLiveWorkFeedState, type LiveWorkFeedState } from '@/lib/live-work-feed'
import { humanizePhase } from '@/lib/orchestration-terminology'

// M3's Live Work Feed: real, non-fabricated status (Tim should not
// normally need Orca terminals). Every field here already exists on the
// run KeepGoingPanel fetches -- no new endpoint, no second data source.
const STATE_BADGE: Record<LiveWorkFeedState, 'primary' | 'neutral' | 'degraded' | 'healthy'> = {
  PLANNING: 'neutral',
  WORKING: 'primary',
  WAITING: 'neutral',
  VERIFYING: 'primary',
  STALLED: 'degraded',
  NEEDS_YOU: 'degraded',
  REVISION: 'neutral',
  READY_FOR_ADOPTION: 'healthy',
  COMPLETED: 'healthy'
}

export function LiveWorkFeed({ run }: { run: KeepGoingActiveRunView }) {
  const [showDetail, setShowDetail] = useState(false)
  const projection = projectLiveWorkFeedState(run)

  return (
    <div className="rounded-md border border-border p-3 text-[12px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Work Feed
          </span>
          <Badge variant={STATE_BADGE[projection.state]}>{projection.state}</Badge>
        </div>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowDetail((v) => !v)}
        >
          {showDetail ? 'Hide' : 'Drill down'}
        </button>
      </div>
      <div className="mt-1 text-muted-foreground">{projection.reason}</div>
      {showDetail && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <div>
            Phase: <span className="text-foreground" title={run.phase}>{humanizePhase(run.phase)}</span>
          </div>
          <div>
            Rounds completed: <span className="text-foreground">{run.wavesCompleted}</span>
          </div>
          <div>
            Orca orchestration Run:{' '}
            {run.orchestrationRunId ? (
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                {run.orchestrationRunId}
              </code>
            ) : (
              <span>none created yet</span>
            )}
          </div>
          {run.orchestrationRunId && (
            <div>
              Inspect via Orca:{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                orca orchestration task-list --run {run.orchestrationRunId} --json
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
