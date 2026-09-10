// Command architecture round 3: actionable follow-up context ("pause it",
// "continue that", "run it"). Routes a resolved project id into the SAME
// durable keep-going-controller.mjs mutations every other real caller
// (the HTTP routes, keep-going-http-routes.mjs's own mutateThroughStore)
// uses -- Command never becomes a second execution/scheduling mechanism,
// it only resolves WHICH project a follow-up means and calls the one real
// pause/resume capability that already exists. "run it"/"fix it" continue
// to use chat-dispatch-bridge.mjs's planAndDispatchFromCommand directly
// (command-responder.mjs's own existing path) -- this module is only the
// PAUSE/RESUME half that had no Command-facing path at all before this.
import { pauseKeepGoingRun, resumeKeepGoingRun } from './keep-going-controller.mjs'
import { withKeepGoingRun, readKeepGoingRun } from './keep-going-run-store.mjs'

// Mirrors keep-going-http-routes.mjs's own mutateThroughStore exactly (not
// exported there, so duplicated rather than reaching across a route file
// -- same durable compare-and-swap primitive, same race-safety contract:
// re-reads fresh at call time, never trusts a snapshot captured earlier in
// the request).
async function mutateThroughStore(projectId, controllerFn) {
  return withKeepGoingRun(projectId, (current) => {
    const { run } = controllerFn({ keepGoingRuns: { [projectId]: current } })
    return run
  })
}

export async function pauseProjectRun(projectId, reason, clock) {
  return mutateThroughStore(projectId, (fakeOpState) => pauseKeepGoingRun(fakeOpState, projectId, reason, clock))
}

export async function resumeProjectRun(projectId, clock) {
  return mutateThroughStore(projectId, (fakeOpState) => resumeKeepGoingRun(fakeOpState, projectId, clock))
}

// "continue"/"resume" is genuinely ambiguous in isolation -- for a PAUSED
// run it means resume; for anything else (no run, an already-ACTIVE run)
// it means the same thing "run it" does (dispatch/continue coding work),
// since an ACTIVE run already advances on its own and there is nothing
// durable to "resume" from. Read fresh -- never guessed from a possibly-
// stale opState the caller captured earlier.
export function classifyContinueAction(projectId) {
  const run = readKeepGoingRun(projectId)
  return run?.state === 'PAUSED' ? 'RESUME' : 'DISPATCH'
}

// Deliberately independent of chat-responder.mjs's shared DISPATCH_REQUEST/
// FIX_REQUEST taxonomy (never modified here, and shared with the
// per-project chat path) -- PAUSE/RESUME had NO Command-facing recognition
// at all before this (chat-responder.mjs has no pause/resume intent), so
// this is new detection, not a rerouting of an existing one.
//
// Judged per-CLAUSE (split on sentence/comma/coordinating-conjunction
// boundaries, mirroring -- deliberately more simply, this is a narrower
// action class -- chat-responder.mjs's own splitIntoClauses idea, never
// its actual shared code) so "don't touch TSF, pause NWR" correctly pauses
// NWR (the negation is in an earlier, unrelated clause) and "pause NWR" is
// recognized regardless of where in the message it falls, not only at the
// absolute string start. A clause counts as the verb genuinely being
// used as a directive when it OPENS with the verb (optionally after
// "please") -- covering both a bare object ("pause NWR") and a pronoun
// ("pause it") -- or the verb is immediately followed by a back-reference
// pronoun anywhere in the clause ("go ahead and pause it"). Never a bare
// verb with no object/pronoun at all ("is it paused?", "the tick paused
// the wave" -- neither opens its clause with the verb nor has a pronoun
// immediately after it).
function splitIntoClauses(message) {
  return message.split(/[.!?;,]|\band\b|\bbut\b/i).map((c) => c.trim()).filter(Boolean)
}

const NEGATION_OPENER = /^(?:please\s+)?(?:don'?t|do not|never|shouldn'?t|won'?t)\b/i
// TSF Overnight Control-Plane Burn-In V2, Lane C (real, live-confirmed
// while writing a stateful dogfood sequence, not guessed): splitIntoClauses
// strips the trailing "?" as a delimiter before this ever runs, so a
// literal question like "why did you pause it?" survives as the clause
// "why did you pause it" -- which DOES contain "pause it" as a substring
// and was being misread as a genuine directive (VERB_PLUS_PRONOUN below),
// producing a leaky "invalid overnight run transition: PAUSED -> PAUSED"
// error instead of ever reaching a real explanation. Mirrors
// NEGATION_OPENER's own narrow "clause OPENS with X" shape -- only a
// clause that opens with an unambiguous WH-word or auxiliary-inversion
// question form is excluded; "pause NWR, why?" (the question in a LATER,
// separate clause) still correctly pauses NWR in its own first clause.
const QUESTION_OPENER = /^(?:why|what|how|when|where|who|which)\b|^(?:did|do|does|is|are|was|were|would|could|should|can|will)\s+(?:you|it|that|this|he|she|they|i|we)\b/i
const CLAUSE_OPENS_WITH = (verbs) => new RegExp(`^(?:please\\s+)?(?:${verbs})\\b`, 'i')
const VERB_PLUS_PRONOUN = (verbs) => new RegExp(`\\b(?:${verbs})\\s+(it|that|this|everything)\\b`, 'i')

const PAUSE_OPENER = CLAUSE_OPENS_WITH('pause')
const PAUSE_PRONOUN = VERB_PLUS_PRONOUN('pause')
const RESUME_OPENER = CLAUSE_OPENS_WITH('resume|continue')
const RESUME_PRONOUN = VERB_PLUS_PRONOUN('resume|continue')

function clauseMatchesAction(clause, opener, pronoun) {
  if (NEGATION_OPENER.test(clause)) return false
  if (opener.test(clause)) return true
  // A bare object/pronoun match ("pause it") only counts as a directive
  // when the clause isn't itself an obvious question -- "pause NWR" (the
  // OPENER check above) is unaffected either way.
  return pronoun.test(clause) && !QUESTION_OPENER.test(clause)
}

// Returns 'PAUSE' | 'RESUME' | null. RESUME covers both "resume" and
// "continue" -- classifyContinueAction (called by the caller once a real
// project is identified) is what decides whether "continue"/"resume"
// actually means resuming a paused run or dispatching fresh work.
export function classifyRunActionVerb(message) {
  for (const clause of splitIntoClauses(message)) {
    if (clauseMatchesAction(clause, PAUSE_OPENER, PAUSE_PRONOUN)) return 'PAUSE'
    if (clauseMatchesAction(clause, RESUME_OPENER, RESUME_PRONOUN)) return 'RESUME'
  }
  return null
}
