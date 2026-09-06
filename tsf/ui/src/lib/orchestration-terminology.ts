// BUG-09 (bug-ledger.json): raw internal SCREAMING_SNAKE_CASE checkpoint
// phases, gap decisions, and Flight Recorder event types were rendered
// verbatim in several places (KeepGoingPanel.tsx's Phase field/Last
// checkpoint/Gap analysis badge, LiveWorkFeed.tsx's drill-down section,
// the whole of FlightRecorderPanel.tsx) -- meaningless to a non-engineer,
// unlike run.state/LiveWorkFeedState, which already went through a
// deliberate translation layer (live-work-feed.ts) built for BUG-14.
// This closes the same gap for the constants that layer doesn't cover.
//
// Every map below is a real, already-observed value (cited from the
// actual write sites in server/keep-going-dispatch-loop.mjs, domain/
// keep-going.mjs, domain/flight-recorder.mjs) -- never invented. An
// unrecognized value (a future phase this map hasn't caught up to yet)
// still degrades to a readable label via humanizeConstant rather than
// either crashing or silently showing nothing.

// Best-effort fallback for any SCREAMING_SNAKE_CASE constant not in a
// specific map below: "WAVE_DISPATCHED_PARTIAL" -> "Wave dispatched
// partial". Never the sole translation for a known value (the specific
// maps below read better), but keeps a genuinely new/unmapped constant
// from ever showing as raw, unbroken snake_case.
// Real, live-discovered crash (Operator IA consolidation hands-on pass): a
// real project's own resultCapsule can genuinely have status: null (a
// worker result recorded before a status was ever set) -- ProjectDetailPage
// passed it straight through, unguarded, and every caller of this function
// crashed the ENTIRE page (JSX children evaluate eagerly for every tab,
// not just the active one). Never throw on missing input again.
export function humanizeConstant(value: string | null | undefined): string {
  if (value == null) {
    return 'Unknown'
  }
  const words = value.toLowerCase().split('_').filter(Boolean)
  if (words.length === 0) {
    return value
  }
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '')
}

const PHASE_LABELS: Record<string, string> = {
  RUN_STARTED: 'Run started',
  RUN_RESUMED: 'Run resumed',
  OPERATOR_PAUSED: 'Paused by operator',
  CAPACITY_PAUSED: 'Paused (provider capacity)',
  DISPATCH_FAILED: 'Dispatch failed',
  WAVE_DISPATCHED: 'Work dispatched',
  WAVE_DISPATCHED_PARTIAL: 'Work partially dispatched',
  WAVE_STILL_IN_FLIGHT: 'Work in progress',
  WAVE_STALLED: 'Stalled',
  WAVE_SETTLED: 'Wave settled',
  RETRY_BUDGET_NEEDS_YOU: 'Needs you (retries exhausted)',
  STALLED_WAVE_ABANDONED: 'Stalled wave abandoned',
  RETRY_BUDGET_EXCEEDED_ESCALATION_SKIPPED: 'Retry budget exceeded'
}

export function humanizePhase(phase: string): string {
  return PHASE_LABELS[phase] ?? humanizeConstant(phase)
}

const GAP_DECISION_LABELS: Record<string, string> = {
  CONTINUE: 'In progress',
  STOP_COMPLETE: 'All criteria verified',
  STOP_BLOCKED: 'Blocked',
  STOP_BUDGET_EXHAUSTED: 'Budget exhausted'
}

export function humanizeGapDecision(decision: string): string {
  return GAP_DECISION_LABELS[decision] ?? humanizeConstant(decision)
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  RUN_CREATED: 'Run created',
  STATE_TRANSITION: 'State changed',
  WAVE_RECORDED: 'Wave recorded',
  CHECKPOINT: 'Checkpoint',
  NEEDS_YOU_RAISED: 'Needs you raised',
  NEEDS_YOU_RESOLVED: 'Needs you resolved'
}

export function humanizeEventType(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? humanizeConstant(eventType)
}

// Operator IA consolidation: ResearchMission phases (tsf/domain/research-
// mission.mjs's computeResearchMissionPhase -- CREATED/EXECUTING/
// WAITING_NEEDS_INPUT/COMPLETE/BLOCKED, the same five values every backend
// surface already reads) shown on primary surfaces (HQ/Work) in the same
// human-first vocabulary Keep Going runs already use.
const RESEARCH_PHASE_LABELS: Record<string, string> = {
  CREATED: 'Starting research',
  EXECUTING: 'Researching',
  WAITING_NEEDS_INPUT: 'Needs your approval',
  COMPLETE: 'Complete',
  BLOCKED: 'Blocked'
}

export function humanizeResearchPhase(phase: string): string {
  return RESEARCH_PHASE_LABELS[phase] ?? humanizeConstant(phase)
}
