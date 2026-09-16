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
import {
  pauseKeepGoingRun,
  resolveKeepGoingNeedsYou,
  resumeKeepGoingRun
} from './keep-going-controller.mjs'
import { withKeepGoingRun, readKeepGoingRun } from './keep-going-run-store.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'
import { replyToOrchestrationMessage } from '../adapters/orca-orchestration-bridge.mjs'
import { recordNeedsYouRelayOutcome } from '../domain/keep-going.mjs'

// Mirrors keep-going-http-routes.mjs's own mutateThroughStore exactly (not
// exported there, so duplicated rather than reaching across a route file
// -- same durable compare-and-swap primitive, same race-safety contract:
// re-reads fresh at call time, never trusts a snapshot captured earlier in
// the request). TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1: also mirrors
// that file's own fix -- this is Command's own "continue it"/"resume that"
// follow-up path (see header comment), exactly the shape a held project's
// generic "continue" request takes, so it needs the same real
// projectExecutionHolds entry for resumeKeepGoingRun's own hold gate to see
// anything at all.
async function mutateThroughStore(projectId, controllerFn) {
  return withKeepGoingRun(projectId, (current) => {
    const hold = readProjectExecutionHold(projectId)
    const { run } = controllerFn({
      keepGoingRuns: { [projectId]: current },
      projectExecutionHolds: { [projectId]: hold }
    })
    return run
  })
}

export async function pauseProjectRun(projectId, reason, clock) {
  return mutateThroughStore(projectId, (fakeOpState) =>
    pauseKeepGoingRun(fakeOpState, projectId, reason, clock)
  )
}

export async function resumeProjectRun(projectId, clock) {
  return mutateThroughStore(projectId, (fakeOpState) =>
    resumeKeepGoingRun(fakeOpState, projectId, clock)
  )
}

// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 4: the first real, wired
// resolution path for a project-scoped Needs You question -- through the
// SAME real compare-and-swap store primitive every other real mutation
// here already uses. `expectedRevision` forwards straight through to
// domain.resolveNeedsYou's own real assertExpectedRevision check (Stage 4
// Completion, finish item C) -- optional, so a caller that omits it keeps
// today's default semantics (a later answer freely replaces an earlier
// one); a caller that read a specific run revision before answering gets a
// real TSF_STALE_REVISION rejection if the run changed underneath it.
//
// TSF Overnight Product Completion V1, Phase 1 (zero-relay): this is the
// ONE real call site for a PROJECT-source Needs You resolution (both
// action-executor.mjs's canonical RESOLVE_NEEDS_YOU route and Command's
// own direct usage call this exact function -- confirmed, not assumed).
// If the resolved question originated from a real worker's own
// `orchestration ask` (raised by keep-going-dispatch-loop.mjs's settle
// step, tagged with an `escalation.messageId`), the owner's durable
// answer is now also relayed back to that same still-blocked worker via
// `orchestration reply` -- closing the loop the pilot found open
// (worker asks -> [nothing] -- the owner's own Needs You answer never
// reached the worker at all). The domain resolution above already
// durably committed by the time this runs, so a reply-back failure here
// (e.g. the worker's dispatch already ended, or the CLI is transiently
// unavailable) is reported, never silently swallowed, but never
// un-resolves the Needs You either -- the durable answer is the source of
// truth; failing to notify one specific worker process is a narrower,
// separately-diagnosable problem than losing the owner's answer would be.
export async function resolveProjectNeedsYou(
  projectId,
  needsYouId,
  resolution,
  clock,
  expectedRevision
) {
  let run = await mutateThroughStore(projectId, (fakeOpState) =>
    resolveKeepGoingNeedsYou(
      fakeOpState,
      projectId,
      needsYouId,
      resolution,
      clock,
      expectedRevision
    )
  )
  const resolved = run.needsYou.find((entry) => entry.id === needsYouId)
  const escalation = resolved?.escalation
  if (escalation?.kind === 'WORKER_ASK' && escalation.messageId) {
    const body = typeof resolution === 'string' ? resolution : JSON.stringify(resolution)
    const replyResult = await replyToOrchestrationMessage({
      id: escalation.messageId,
      body,
      run: escalation.orchestrationRunId
    })
    // Real Codex adversarial review finding: a relay failure (or a crash
    // between the resolve above and this call) previously left the
    // worker silently blocked forever, with the failure visible only in
    // a console.error log, not in canonical state. Stamped onto the SAME
    // needsYou entry's escalation field (a second, best-effort store
    // write -- never un-resolves the Needs You, never throws past this
    // point) so a stuck relay is durably discoverable, not lost.
    const outcome = replyResult.ok
      ? { relayedAt: clock().toISOString(), relayFailure: null }
      : {
          relayedAt: null,
          relayFailure: { reason: replyResult.reason, detail: replyResult.detail, at: clock().toISOString() }
        }
    if (!replyResult.ok) {
      console.error(
        `resolveProjectNeedsYou: durably resolved ${needsYouId} but failed to relay the answer back to worker message ${escalation.messageId} (${replyResult.reason}: ${replyResult.detail})`
      )
    }
    // Real Codex adversarial review finding: this used to always `return
    // run` -- the run from the FIRST (resolve) write -- even after this
    // second write durably advanced the revision and added the outcome.
    // Every caller of resolveProjectNeedsYou (action-executor.mjs's
    // RESOLVE_NEEDS_YOU route, Command's own direct usage) would then act
    // on/publish a stale revision, risking an avoidable TSF_STALE_REVISION
    // on its own very next CAS-protected call. Returns the fresher run
    // whenever the second write actually lands.
    try {
      run = await withKeepGoingRun(projectId, (current) =>
        recordNeedsYouRelayOutcome(current, needsYouId, outcome, resolved.resolvedAt, clock)
      )
    } catch (error) {
      console.error(
        `resolveProjectNeedsYou: failed to durably record the relay outcome for ${needsYouId}: ${error.message}`
      )
    }
  }
  return run
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
//
// Final Codex adversarial review of Finding #22 (session
// 01a0abf8-3229-7132-a655-6abfb7098c35), a real, pre-existing gap unrelated
// to that diff: a genuinely deliberative compound question like "Is NWR
// paused, or should I resume it?" kept "or should I resume it" as ONE
// clause -- the leading "or" defeated QUESTION_OPENER's start-of-clause
// anchor (it saw "or should I...", not "should I..."), so the bare
// "resume it" pronoun match fell through the question guard and mutated a
// real run.
//
// Splitting on every bare "or" (mirroring "and"/"but") was tried first and
// reverted: it fixes the case above but breaks the mirror-image case where
// the question word leads BOTH disjuncts ("Should I pause NWR or resume
// it?") -- splitting there strands "resume it" as its own clause that
// (correctly, by the CLAUSE_OPENS_WITH rule for a bare "resume NWR"/
// "resume it" directive) opens with the verb, losing the "Should I..."
// context that was never repeated after "or". Splitting on "or" only when
// it is immediately followed by a genuine question-opener word targets
// exactly the reported shape (the question word trails "or") without
// touching the lead-question shape (the question word is never adjacent
// to "or" there, so this narrower pattern never matches it).
const OR_BEFORE_QUESTION =
  /\bor(?=\s+(?:did|do|does|is|are|was|were|would|could|should|can|will)\s+(?:you|it|that|this|he|she|they|i|we)\b)/i
function splitIntoClauses(message) {
  return message
    .split(new RegExp(`[.!?;,]|\\band\\b|\\bbut\\b|${OR_BEFORE_QUESTION.source}`, 'i'))
    .map((c) => c.trim())
    .filter(Boolean)
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
const QUESTION_OPENER =
  /^(?:why|what|how|when|where|who|which)\b|^(?:did|do|does|is|are|was|were|would|could|should|can|will)\s+(?:you|it|that|this|he|she|they|i|we)\b/i
const CLAUSE_OPENS_WITH = (verbs) => new RegExp(`^(?:please\\s+)?(?:${verbs})\\b`, 'i')
const VERB_PLUS_PRONOUN = (verbs) =>
  new RegExp(`\\b(?:${verbs})\\s+(it|that|this|everything)\\b`, 'i')

const PAUSE_OPENER = CLAUSE_OPENS_WITH('pause')
const PAUSE_PRONOUN = VERB_PLUS_PRONOUN('pause')
// Pre-UI Productization V1, Priority 2, real gap: "rerun"/"retry" were not
// recognized as RESUME synonyms at all -- the owner's own literal example
// ("Rerun the failed one") fell through to a live-planner call or an
// honest non-match, never the real DISPATCH attempt a STALLED run's own
// "resume it"/"run it" phrasing already safely triggers (RUN_ALLOWED
// permits STALLED -> ACTIVE; classifyContinueAction's DISPATCH fallback is
// already proven safe by Lane A's own RESUME matrix). Same real
// capability, just 2 more natural synonyms recognized for it.
const RESUME_OPENER = CLAUSE_OPENS_WITH('resume|continue|rerun|retry')
const RESUME_PRONOUN = VERB_PLUS_PRONOUN('resume|continue|rerun|retry')

function clauseMatchesAction(clause, opener, pronoun) {
  if (NEGATION_OPENER.test(clause)) {
    return false
  }
  if (opener.test(clause)) {
    return true
  }
  // A bare object/pronoun match ("pause it") only counts as a directive
  // when the clause isn't itself an obvious question -- "pause NWR" (the
  // OPENER check above) is unaffected either way.
  return pronoun.test(clause) && !QUESTION_OPENER.test(clause)
}

// Returns 'PAUSE' | 'RESUME' | null. RESUME covers "resume"/"continue"/
// "rerun"/"retry" -- classifyContinueAction (called by the caller once a real
// project is identified) is what decides whether "continue"/"resume"
// actually means resuming a paused run or dispatching fresh work.
export function classifyRunActionVerb(message) {
  for (const clause of splitIntoClauses(message)) {
    if (clauseMatchesAction(clause, PAUSE_OPENER, PAUSE_PRONOUN)) {
      return 'PAUSE'
    }
    if (clauseMatchesAction(clause, RESUME_OPENER, RESUME_PRONOUN)) {
      return 'RESUME'
    }
  }
  return null
}
