// M11: TSF-native Flight Recorder -- a pure projection over M4's real,
// already-durable Run Journal (keep-going.mjs's transitions/waves/
// checkpoints/needsYou/retryCounts), producing a coherent chronological
// timeline with real elapsed/waiting durations. Concepts borrowed from
// OpenTelemetry/GenAI semantic conventions (spans, events, durations) --
// no OpenTelemetry SDK or external observability stack added, per Tim's
// own explicit "do not add a giant external observability stack"
// instruction. Because this is a stateless projection recomputed fresh
// from the SAME source of truth every time (never a separately
// persisted event log), it can never desync from the Run Journal --
// acceptance item 8's reconciliation requirement holds by construction.
//
// Privacy (acceptance item 7): only phase names/reasons/digests/question
// text TSF itself generated are captured -- never a wave's full
// wavePlan/waveResult payload (which may contain worker output/diffs),
// matching this program's established "compact projection, never a raw
// dump" discipline (buildProjectContextCapsule, retrieveExperiencesForCapsule).
export const EVENT_TYPES = Object.freeze([
  'RUN_CREATED',
  'STATE_TRANSITION',
  'WAVE_RECORDED',
  'CHECKPOINT',
  'NEEDS_YOU_RAISED',
  'NEEDS_YOU_RESOLVED'
])

function durationMs(fromIso, toIso) {
  if (!fromIso || !toIso) {
    return null
  }
  const d = Date.parse(toIso) - Date.parse(fromIso)
  return Number.isFinite(d) && d >= 0 ? d : null
}

export function buildRunTimeline(run) {
  const events = [
    { type: 'RUN_CREATED', at: run.createdAt, detail: { goal: run.originalGoal.statement } }
  ]
  for (const t of run.transitions) {
    events.push({
      type: 'STATE_TRANSITION',
      at: t.at,
      detail: { from: t.from, to: t.to, reason: t.reason }
    })
  }
  for (const w of run.waves) {
    events.push({ type: 'WAVE_RECORDED', at: w.recordedAt, detail: { digest: w.digest } })
  }
  for (const c of run.checkpoints) {
    events.push({
      type: 'CHECKPOINT',
      at: c.at,
      detail: { phase: c.phase, note: c.note, state: c.state }
    })
  }
  for (const n of run.needsYou) {
    events.push({
      type: 'NEEDS_YOU_RAISED',
      at: n.raisedAt,
      detail: { id: n.id, question: n.question }
    })
    if (n.resolvedAt) {
      events.push({
        type: 'NEEDS_YOU_RESOLVED',
        at: n.resolvedAt,
        detail: { id: n.id, resolution: n.resolution }
      })
    }
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  // Real elapsed segments between consecutive events, never fabricated
  // -- null whenever a timestamp is missing or unparseable rather than
  // guessed.
  const segments = events.slice(1).map((event, i) => ({
    fromEvent: events[i].type,
    toEvent: event.type,
    fromAt: events[i].at,
    toAt: event.at,
    durationMs: durationMs(events[i].at, event.at)
  }))

  return {
    schemaVersion: 'TSF_RUN_TIMELINE_V1',
    runId: run.id,
    projectId: run.projectId,
    state: run.state,
    events,
    segments,
    totalElapsedMs: durationMs(run.createdAt, run.updatedAt),
    wavesCompleted: run.waves.length,
    retryCounts: { ...run.retryCounts },
    openNeedsYouCount: run.needsYou.filter((n) => !n.resolvedAt).length
  }
}

// Acceptance item 2 ("Tim can identify why time was spent waiting") --
// the single largest real segment. Honestly null when fewer than 2
// events exist to measure a gap between, never a fabricated zero.
export function findBottleneck(timeline) {
  const measurable = timeline.segments.filter((s) => s.durationMs !== null)
  if (measurable.length === 0) {
    return null
  }
  return measurable.reduce((max, s) => (s.durationMs > max.durationMs ? s : max))
}
