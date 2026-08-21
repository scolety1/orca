// Mirrors tsf/domain/flight-recorder.mjs's real TSF_RUN_TIMELINE_V1 shape
// as served by tsf/server/flight-recorder-http-routes.mjs. Kept in its
// own file rather than lib/types.ts to avoid growing that file past the
// repo's max-lines lint limit.
export type TimelineEventType =
  | 'RUN_CREATED'
  | 'STATE_TRANSITION'
  | 'WAVE_RECORDED'
  | 'CHECKPOINT'
  | 'NEEDS_YOU_RAISED'
  | 'NEEDS_YOU_RESOLVED'

export type TimelineEvent = {
  type: TimelineEventType
  at: string
  detail: Record<string, unknown>
}

export type TimelineSegment = {
  fromEvent: TimelineEventType
  toEvent: TimelineEventType
  fromAt: string
  toAt: string
  durationMs: number | null
}

export type RunTimeline = {
  schemaVersion: string
  runId: string
  projectId: string
  state: string
  events: TimelineEvent[]
  segments: TimelineSegment[]
  totalElapsedMs: number | null
  wavesCompleted: number
  retryCounts: Record<string, number>
  openNeedsYouCount: number
}

export type FlightRecorderView = {
  ok: true
  projectId: string
  timeline: RunTimeline | null
  bottleneck: TimelineSegment | null
}
