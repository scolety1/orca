// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part A: the
// first real, first-ever adoption-EXECUTION primitive triggered from chat,
// for genuine project work (never the fixture-only tsf/domain/adoption.mjs
// path, never self-improvement). Pure, real revalidation logic -- every
// check below is a composable, independently-reasoned refusal with a real,
// specific reason, never a vague "not eligible". All I/O (run lookup, hold
// lookup, git worktree/ancestry checks) is gathered by the server layer
// (server/command-adoption-execution.mjs) and passed in here as plain facts
// -- this module makes no filesystem/process call of its own.
//
// HARD BOUNDARY, structurally enforced (not just documented): this module
// NEVER imports, reads, or references TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION
// or OWNER_AUTHORIZED_SELF_IMPROVEMENT_ADOPTION_V1 in any way, and its
// eligibility check below refuses outright (WRONG_CANDIDATE_KIND) any
// candidateKind other than 'KEEP_GOING_RUN'. This new capability
// (EXPLICIT_OWNER_COMMAND_ADOPTION) and the existing, disabled-by-design
// AUTONOMOUS_SELF_IMPROVEMENT_ADOPTION gate remain completely separate code
// paths with zero shared execution trigger.
export const COMMAND_ADOPTION_CANDIDATE_KINDS = Object.freeze(['KEEP_GOING_RUN'])

// Every ancestry classification the server layer's real
// `git merge-base --is-ancestor` check can honestly produce.
export const CANDIDATE_ANCESTRY_STATES = Object.freeze([
  'ALREADY_INCLUDED', // candidate SHA is an ancestor of (or equal to) canonical base HEAD -- honest no-op-but-record-a-receipt
  'FAST_FORWARD_AVAILABLE', // canonical base HEAD is an ancestor of candidate SHA -- a real merge is possible
  'DIVERGED', // neither is an ancestor of the other -- real refusal, never forced
  'UNKNOWN' // the real git probe itself failed -- honest refusal, never assumed safe
])

// Pure projection over run.waves (same real data Flight Recorder/
// resultCapsulesFromRun already read -- never a second, independently-
// drifting store). Part A's own dispatch-loop change threads `worktree`
// through each dispatch record into the settled wave's outcomes; this reads
// the MOST RECENT wave's outcomes and returns the single worktree every
// COMPLETED outcome in it agrees on, or null if the run has no waves, no
// COMPLETED outcomes, or the outcomes disagree (a genuinely ambiguous case
// -- honestly refused by the caller via worktreeResolved: false, never
// guessed).
export function resolveCandidateWorktreeFromRun(run) {
  if (!run || !Array.isArray(run.waves) || run.waves.length === 0) {
    return null
  }
  const lastWave = run.waves.at(-1)
  const outcomes = lastWave.waveResult?.outcomes
  if (!Array.isArray(outcomes)) {
    return null
  }
  const worktrees = new Set(
    outcomes.filter((o) => o.outcome === 'COMPLETED' && o.worktree).map((o) => o.worktree)
  )
  return worktrees.size === 1 ? [...worktrees][0] : null
}

// Revalidates a resolved adoption candidate against the project's CURRENT
// durable state (per-CLAUSE, real-time -- never a cached/stale snapshot).
// Returns { eligible: true, alreadyIncluded } or { eligible: false, reason, detail }.
export function revalidateCommandAdoptionCandidate({
  candidateKind,
  runExists,
  runState,
  candidateProjectId,
  targetProjectId,
  holdActive = false,
  holdDetail = null,
  worktreeResolved,
  worktreeClean,
  ancestry
}) {
  if (candidateKind !== 'KEEP_GOING_RUN') {
    return {
      eligible: false,
      reason: 'WRONG_CANDIDATE_KIND',
      detail: `this engine only ever adopts a real project-level Keep Going run candidate reaching READY_FOR_ADOPTION -- "${candidateKind}" is refused outright, never silently routed here (see the self-improvement adoption boundary this module structurally never crosses)`
    }
  }
  if (!runExists) {
    return {
      eligible: false,
      reason: 'CANDIDATE_NOT_FOUND',
      detail: 'no Keep Going run exists for this project any more -- the candidate this referred to is gone from current durable state'
    }
  }
  if (runState !== 'COMPLETE') {
    return {
      eligible: false,
      reason: 'NOT_READY_FOR_ADOPTION',
      detail: `the Keep Going run is not independently verified as ready (state: ${runState}, requires COMPLETE) -- refusing to adopt an unverified candidate`
    }
  }
  if (candidateProjectId !== targetProjectId) {
    return {
      eligible: false,
      reason: 'CROSS_PROJECT_CANDIDATE',
      detail: `the resolved candidate belongs to project "${candidateProjectId}", not the target project "${targetProjectId}" -- refusing to adopt across projects`
    }
  }
  if (holdActive) {
    return {
      eligible: false,
      reason: 'PROJECT_EXECUTION_HOLD_ACTIVE',
      detail: holdDetail ?? 'this project is under an active execution hold -- release it before adopting'
    }
  }
  if (!worktreeResolved) {
    return {
      eligible: false,
      reason: 'CANDIDATE_WORKTREE_UNRESOLVED',
      detail: 'no real worktree could be recovered for this run\'s settled work -- refusing to adopt without a real, inspectable candidate branch'
    }
  }
  if (!worktreeClean) {
    return {
      eligible: false,
      reason: 'CANDIDATE_WORKTREE_NOT_CLEAN',
      detail: 'the candidate worktree is not clean -- refusing to adopt uncommitted or unexpected state'
    }
  }
  if (ancestry === 'UNKNOWN') {
    return {
      eligible: false,
      reason: 'CANDIDATE_ANCESTRY_UNKNOWN',
      detail: 'the real ancestry check between the candidate and the canonical base could not be completed -- refusing to guess'
    }
  }
  if (ancestry === 'DIVERGED') {
    return {
      eligible: false,
      reason: 'CANDIDATE_DIVERGED_FROM_CANONICAL_BASE',
      detail: 'the candidate branch has diverged from the canonical base -- a fast-forward-only adoption is not possible; this is never forced or rebased'
    }
  }
  return { eligible: true, alreadyIncluded: ancestry === 'ALREADY_INCLUDED' }
}

// Narrow classifier for "does this message ask chat to actually EXECUTE an
// adoption, or just report/discuss one". Deliberately conservative -- fails
// closed to AMBIGUOUS/NOT_ADOPTION whenever genuinely unclear, per the
// mission's own required examples:
//   sufficient:     "adopt the Nytheria run", "accept that verified candidate",
//                    "the WorldForge one looks good, adopt it", "adopt both of those"
//   NOT sufficient:  "looks good", "continue", "what's ready?", "probably fine"
const ADOPTION_VERB_PATTERN = /\b(adopt(ed|ing|s)?|accept(ed|ing|s)?|approve[sd]?)\b/i
const HEDGE_PATTERN = /\b(maybe|perhaps|not sure|unsure|should i|should we|might|could we|possibly|i think|i guess|wonder(ing)?|what if)\b/i
const TRAILING_QUESTION_PATTERN = /\?\s*$/

export function classifyAdoptionCommandIntent(message) {
  const text = String(message ?? '')
  if (!ADOPTION_VERB_PATTERN.test(text)) {
    // No adoption verb at all -- "looks good"/"continue"/"what's ready?"/
    // "probably fine" all land here, honestly not this engine's concern.
    return 'NOT_ADOPTION'
  }
  if (HEDGE_PATTERN.test(text) || TRAILING_QUESTION_PATTERN.test(text)) {
    return 'AMBIGUOUS'
  }
  return 'EXECUTE_ADOPTION'
}
