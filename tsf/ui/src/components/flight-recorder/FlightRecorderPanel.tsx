import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { TimelineEvent } from '@/lib/flight-recorder-types'

function formatMs(ms: number | null): string {
  if (ms === null) {
    return '—'
  }
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) {
    return `${minutes}m`
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function EventRow({ event }: { event: TimelineEvent }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <div className="flex items-center gap-2">
        <Badge variant="neutral">{event.type}</Badge>
        <span className="text-muted-foreground">
          {'question' in event.detail ? String(event.detail.question) : ''}
          {'phase' in event.detail ? String(event.detail.phase) : ''}
          {'to' in event.detail ? `→ ${String(event.detail.to)}` : ''}
        </span>
      </div>
      <span className="whitespace-nowrap text-[11px] text-muted-foreground">
        {new Date(event.at).toLocaleString()}
      </span>
    </div>
  )
}

export function FlightRecorderPanel({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useApi(() => api.flightRecorder(projectId), [projectId])

  if (loading) {
    return <LoadingState label="Loading flight recorder…" />
  }
  if (error) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!data) {
    return null
  }
  if (!data.timeline) {
    return (
      <EmptyState
        title="No run recorded yet"
        description="Start a Keep Going run to see its timeline here."
      />
    )
  }

  const { timeline, bottleneck } = data
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Run Timeline
            </div>
            <Badge variant="neutral">{timeline.state}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
            <div>
              <div className="text-muted-foreground">Total elapsed</div>
              <div>{formatMs(timeline.totalElapsedMs)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Waves</div>
              <div>{timeline.wavesCompleted}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Open Needs You</div>
              <div>{timeline.openNeedsYouCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Retries</div>
              <div>
                {Object.keys(timeline.retryCounts).length === 0
                  ? 'none'
                  : Object.entries(timeline.retryCounts)
                      .map(([id, n]) => `${id}:${n}`)
                      .join(', ')}
              </div>
            </div>
          </div>
          {bottleneck && (
            <div className="rounded-md border border-status-degraded/40 bg-status-degraded/10 p-2 text-[12px]">
              <div className="mb-1 font-medium text-status-degraded">Largest time gap</div>
              {bottleneck.fromEvent} → {bottleneck.toEvent}: {formatMs(bottleneck.durationMs)}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Events
          </div>
          {timeline.events.map((event, i) => (
            <EventRow key={i} event={event} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
