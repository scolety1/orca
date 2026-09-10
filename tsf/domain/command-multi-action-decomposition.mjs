// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part A3:
// decomposes ONE free-text Command message into an ordered list of real
// { target, intent, rawClause } actions across potentially several
// projects -- the genuinely new capability dispatchAndRespond
// (command-responder.mjs) does not have: that function applies the SAME
// action to N projects, this module recognizes DISTINCT actions naming
// DIFFERENT projects in one message ("leave NWR alone, adopt Nytheria and
// keep going, EasyLife needs work").
//
// Pure, domain-only (no server import, matching this codebase's own
// domain/server layering -- see project-name-resolver.mjs for the
// server-layer counterpart this module deliberately does NOT reuse: that
// module's exclusion-clause semantics ("except X") don't apply here, since
// "leave X alone" is expressed as a real EXTERNAL_WORK_HOLD intent targeting
// X, never a silent drop). Never invents an execution intent that doesn't
// exist -- ADOPT_CANDIDATE_REPORT only, never an "ADOPT_CANDIDATE_EXECUTE"
// (see chat-responder.mjs's own hard-coded, load-bearing "chat has no tools
// and can't act on adoption" refusal -- this module's whole intent taxonomy
// respects that architectural fact, not works around it).
//
// CASE-31/CASE-32 STRUCTURAL P0 REPAIR (Full Conversational Control Plane
// Exhaustive Gauntlet V1): this module's own splitClauses/segmentByProject/
// intentsForSegmentText/isVerbNegated (an independently-authoritative,
// keyword-list-driven clause splitter with no concept of provenance or
// target-scoped verb boundaries) are RETIRED -- both real, confirmed P0s
// (target bleed: "Pause A, adopt B." wrongly adopted A too; reversal
// blindness: shared with domain/command-adoption-execution.mjs's own fix)
// traced back to this exact machinery. decomposeMultiAction is now a thin
// adapter over the ONE shared builder, ../domain/command-act-model.mjs
// (see that module's own header for the full boundary/target-scoping
// design) -- this file's own public shape ({ target, intent, rawClause }[]
// and MULTI_ACTION_INTENTS) is UNCHANGED so every existing consumer/test
// keeps working (RECONCILE BEFORE REPLACE -- no second, independently-
// drifting decomposer left alive).
import { loadProjectAliases } from './project-aliases.mjs'
import { decomposeMultiActionFromActs } from './command-act-model.mjs'

// FIXED (real, live-confirmed P0 -- Full Conversational Control Plane
// Exhaustive Gauntlet V1, Batch 2): "Don't adopt NWR; adopt EasyLife."
// used to have BOTH clauses classify as the plain ADOPT_CANDIDATE_REPORT,
// so classifyMultiActionEntries' own gate (server/command-multi-action-
// bridge.mjs -- requires >=2 DISTINGUISHING intents, not just >=2 targets)
// never fired, and the WHOLE message fell through to the single-message-
// level classifyAdoptionCommandIntent check instead, which wrongly refused
// EasyLife's completely separate, legitimate adoption request too.
// ADOPT_CANDIDATE_DECLINED is a real, distinct intent (not a duplicate
// label) precisely so the outer gate sees 2 genuinely different actions
// and routes through this module's own per-clause decomposition --
// server/command-multi-action-bridge.mjs's executeAdoptionCandidate
// already independently re-derives NOT_ADOPTION vs EXECUTE_ADOPTION from
// each clause's own raw text via classifyAdoptionCommandIntent, so both
// ids are handled by the exact same safe, already-correct execution
// function; this only fixes the GATE that decides whether that per-clause
// logic ever runs.
export const MULTI_ACTION_INTENTS = Object.freeze([
  'EXTERNAL_WORK_HOLD',
  'ADOPT_CANDIDATE_REPORT',
  'ADOPT_CANDIDATE_DECLINED',
  'START_KEEP_GOING',
  'ASSESS_AND_UPGRADE',
  // A single shared id for a negated START_KEEP_GOING/ASSESS_AND_UPGRADE/
  // EXTERNAL_WORK_HOLD act -- deliberately NOT a per-action *_DECLINED
  // variant like adoption's own: none of these has adoption's own
  // independent, real-state-grounded re-derivation function to route a
  // declined variant through, so this is routed to a single, generic,
  // safe "no action taken" report instead (server/command-multi-action-
  // bridge.mjs's handleEntry).
  'MULTI_ACTION_DECLINED',
  'STATUS_QUERY',
  'GENERAL'
])

// Real, tested entry point. `aliases` defaults to the real, durable alias
// table (project-aliases.mjs) -- a caller (test, or a future referent-
// resolution integration) can supply its own. Returns
// { target: projectId, intent, rawClause }[] in first-mention order;
// clauses naming no project at all (no target resolvable) are honestly
// dropped rather than emitting a fabricated null-target action.
export function decomposeMultiAction(message, projects, aliases = loadProjectAliases()) {
  return decomposeMultiActionFromActs(message, projects, aliases)
}
