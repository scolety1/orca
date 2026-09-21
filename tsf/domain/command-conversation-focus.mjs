// TSF Hands-Free Command + Project Manager V1: durable Command conversation
// focus. Distinguishes CURRENT FOCUS (the project a Command conversation is
// currently centered on) from TURN TARGETS (projects explicitly referenced
// in one message, already recorded per-turn as `resolvedProjectIds` on the
// Command thread -- never duplicated here) and a RECENT PROJECT STACK for
// natural "go back" behavior. Pure, no I/O -- server/chat-http-routes.mjs
// persists whatever this returns.
//
// Never guesses a focus switch from ambiguity: multiple turn targets, zero
// turn targets, or a fuzzy-only match all leave focus unchanged. Only an
// EXACT turn-target match (never fuzzy) can move focus, mirroring
// project-name-resolver.mjs's own dispatch-safety discipline.
import { isoNow } from './canonical.mjs'
import {
  DELIBERATIVE_STATEMENT_OPENER,
  COPULA_QUESTION_OPENER,
  SUBJECT_INVERSION_QUESTION_OPENER,
  REPORTED_SPEECH_MARKER,
  RETRACTION_MARKER_PATTERN,
  MID_SENTENCE_HEDGE_MARKER
} from '../server/chat-responder.mjs'

export const RECENT_PROJECT_STACK_CAP = 8

// REAL DOGFOOD FINDING (round 1, misrecognition/correction safety): a
// natural spoken correction after a misrecognized/ambiguous turn -- "No, I
// meant X" -- did not move focus at all, even with a single exact target,
// because it matched none of the original switch phrasings. "I meant" is
// bounded-safe to add: it still requires the caller's OWN exact-match
// target resolution to have found exactly one project in the same
// message, so this can never manufacture a target out of nothing -- it
// only widens which phrasings are TRUSTED to act on a target already
// found by that separate, stricter, unaffected mechanism.
const EXPLICIT_SWITCH_PATTERN =
  /\b(?:switch(?:\s+(?:to|over to))?|let'?s work on|focus on|talk about|discuss|I meant)\b/i
const GO_BACK_PATTERN = /\bgo\s+back\b/i

// REAL DOGFOOD FINDING (round 1, P1 x2, Codex-confirmed): neither pattern
// above had any question or negation guard. "Should I switch to B?" moved
// focus despite being a deliberative question (the owner asking, not
// directing); "Do not talk about B" moved focus despite being an explicit
// prohibition. Both guards stay message-wide and narrow (not full clause-
// splitting like chat-responder.mjs's own isGenuineDirective) to keep this
// classifier the small, separate, easily-audited surface its own header
// above describes -- deliberately biased toward a false NEGATIVE (the
// owner repeats an unambiguous switch phrase) over a false POSITIVE (focus
// silently moves without a genuine directive).
const DELIBERATIVE_QUESTION_PATTERN =
  /\b(?:should|could|would|can|may|might)\s+(?:i|we|you)\b[^.!]*\?/i
// DIRECTIVE SEMANTICS CLOSURE V1, round 2 (real Codex adversarial-review
// finding): "shouldn't we switch to NWR" (contraction), "no need to
// switch to NWR", "I refuse to switch to NWR" all evaded this narrower
// vocabulary and moved real focus.
const NEGATION_GUARD_PATTERN =
  /\b(?:do not|don'?t|never|stop|shouldn'?t|couldn'?t|wouldn'?t|no\s+need\s+to|refuse(?:d|s)?\s+to)\b/i
// A named-project (not pronoun) subject-inversion question -- "should NWR
// be the project we focus on", "would NWR make sense to switch to", "do
// the notes say switch to NWR", "has NWR become the project we should
// focus on". COPULA_QUESTION_OPENER/SUBJECT_INVERSION_QUESTION_OPENER
// only cover a PRONOUN subject (is it/should we); this file has no
// project catalog at classification time to name-match against, so this
// checks the STRUCTURAL shape instead -- modal/aux opener, 1-4 words
// (room for a multi-word project name), then a copula-ish verb
// (be/become/make sense/say). Real directives ("Switch to NWR") never
// start with one of these modals at all, so this can never reintroduce
// a false negative on the genuine trigger phrasings.
// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (P0, real Codex adversarial-
// review finding): "can"/"will" were missing from the modal list --
// "Can NWR be the project we focus on"/"Will NWR be the project we focus
// on" both still moved real focus.
const NAMED_SUBJECT_QUESTION_PATTERN =
  /^\s*(?:should|could|would|can|will|has|have|do|does|did)\s+\S+(?:\s+\S+){0,3}\s+(?:be|become|make\s+sense|say)\b/i

// REAL DOGFOOD FINDING (post-mission, P0, same bug class already fixed in
// server/command-run-action-bridge.mjs's classifyRunActionVerb, commit
// b9097ba9b5): DELIBERATIVE_QUESTION_PATTERN only catches a genuine
// question (requires a trailing "?"), so a musing STATEMENT never phrased
// as a question -- "Maybe we should switch to NWR", "I wonder if we
// should go back", "I guess we could talk about the landing page for
// now" -- evaded both guards and silently moved the durable Command
// focus exactly like an unambiguous directive would. DIRECTIVE SEMANTICS
// CLOSURE V1: DELIBERATIVE_STATEMENT_OPENER is now imported from
// server/chat-responder.mjs, the one canonical musing-opener vocabulary
// every consequential classifier in this codebase shares (was an
// independently-maintained copy here).
//
// The SAME "?"-required gap also affected DELIBERATIVE_QUESTION_PATTERN
// itself: "should we switch to NWR" (spoken, no punctuation) evaded it
// too, since [^.!]*\? requires a literal "?". COPULA_QUESTION_OPENER/
// SUBJECT_INVERSION_QUESTION_OPENER (also imported from chat-responder.mjs
// -- same fix as that file's own isGenuineDirective) close this the same
// punctuation-independent way.
function isGuardedAgainst(message) {
  const trimmed = message.trim()
  return (
    DELIBERATIVE_QUESTION_PATTERN.test(message) ||
    NEGATION_GUARD_PATTERN.test(message) ||
    DELIBERATIVE_STATEMENT_OPENER.test(trimmed) ||
    COPULA_QUESTION_OPENER.test(trimmed) ||
    SUBJECT_INVERSION_QUESTION_OPENER.test(trimmed) ||
    NAMED_SUBJECT_QUESTION_PATTERN.test(trimmed) ||
    REPORTED_SPEECH_MARKER.test(trimmed) ||
    RETRACTION_MARKER_PATTERN.test(trimmed) ||
    MID_SENTENCE_HEDGE_MARKER.test(trimmed)
  )
}

// Real, narrow, conservative regex classifiers -- deliberately NOT reusing
// chat-responder.mjs's own intent array: a false positive here silently
// moves focus, so this stays a small, separate, easily-audited surface.
export function isExplicitSwitchMessage(message) {
  return !isGuardedAgainst(message) && EXPLICIT_SWITCH_PATTERN.test(message)
}

export function isGoBackMessage(message) {
  return !isGuardedAgainst(message) && GO_BACK_PATTERN.test(message)
}

function pushStack(stack, projectId) {
  if (!projectId) {
    return stack
  }
  return [projectId, ...stack.filter((id) => id !== projectId)].slice(0, RECENT_PROJECT_STACK_CAP)
}

function emptyFocus(clock) {
  return { focusProjectId: null, recentProjectStack: [], updatedAt: isoNow(clock) }
}

// currentFocus: TSF_COMMAND_FOCUS_V1 | null (server/data-store.mjs's
//   opState.commandFocus, as-is -- null before the very first Command turn).
// turnTargetProjectIds: string[] -- EXACT (never fuzzy) project-name-resolver
//   matches for THIS message only.
// decisionClass: 'AUTO_DECIDE' | 'RECOMMEND_AND_PROCEED' | 'TIM_REQUIRED'
//   (chat-responder.mjs's classifyDecision) -- AUTO_DECIDE means a
//   read-only status/question turn, which must never move focus on its own.
// isExplicitSwitch / isGoBack: booleans from the classifiers above, computed
//   by the caller against the SAME message.
export function nextCommandFocus(
  currentFocus,
  { turnTargetProjectIds = [], decisionClass, isExplicitSwitch = false, isGoBack = false },
  clock
) {
  const base = currentFocus ?? emptyFocus(clock)
  const exactTargets = [...new Set(turnTargetProjectIds)]
  const singleTarget = exactTargets.length === 1 ? exactTargets[0] : null

  if (isGoBack) {
    if (singleTarget) {
      // "go back to X" -- explicit target wins outright.
      const stack = pushStack(
        base.recentProjectStack.filter((id) => id !== singleTarget),
        base.focusProjectId
      )
      return { focusProjectId: singleTarget, recentProjectStack: stack, updatedAt: isoNow(clock) }
    }
    // "go back" (no target) -- pop the most recent stack entry, re-pushing
    // the old focus so a second "go back" can return to it.
    const [popped, ...rest] = base.recentProjectStack
    if (!popped) {
      // Nothing to go back to -- honest no-op, never fabricate a target.
      return { ...base, updatedAt: isoNow(clock) }
    }
    const stack = pushStack(rest, base.focusProjectId)
    return { focusProjectId: popped, recentProjectStack: stack, updatedAt: isoNow(clock) }
  }

  if (isExplicitSwitch && singleTarget) {
    if (singleTarget === base.focusProjectId) {
      return { ...base, updatedAt: isoNow(clock) }
    }
    const stack = pushStack(base.recentProjectStack, base.focusProjectId)
    return { focusProjectId: singleTarget, recentProjectStack: stack, updatedAt: isoNow(clock) }
  }

  // A dispatch-worthy or consequential turn (never a plain AUTO_DECIDE
  // status/question) naming exactly one project moves focus there --
  // "Research waiver mechanics..." naming NWR both targets AND focuses NWR.
  if (decisionClass !== 'AUTO_DECIDE' && singleTarget) {
    if (singleTarget === base.focusProjectId) {
      return { ...base, updatedAt: isoNow(clock) }
    }
    const stack = pushStack(base.recentProjectStack, base.focusProjectId)
    return { focusProjectId: singleTarget, recentProjectStack: stack, updatedAt: isoNow(clock) }
  }

  // AUTO_DECIDE (read-only status/question), no turn target, multiple turn
  // targets, or a fuzzy-only match (never reaches here as an exact target
  // at all) -- focus never moves out of ambiguity or a mere mention.
  return { ...base, updatedAt: isoNow(clock) }
}
