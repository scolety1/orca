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
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 2 (real Codex
// adversarial-review finding): the first attempt at this fix added "make
// X the project/focus" / "set X as the (current) project" as two more
// UNANCHORED alternatives inside EXPLICIT_SWITCH_PATTERN itself, unlike
// every other trigger phrase above (all narrow, and -- more importantly
// -- never a natural fit for a question/musing/reported-speech opener the
// way a short "make X the Y" imperative shape is). A real Codex review
// reproduced ~10 false positives from this: the trigger fired mid-
// sentence inside a genuine question ("Would Alice make NWR the focus?"),
// a musing ("One idea is to make NWR the focus."), reported/historical
// speech ("Alice said to make NWR the focus.", "Yesterday, the tool set
// NWR as the current project."), and a retraction using vocabulary
// RETRACTION_MARKER_PATTERN didn't cover yet. None of the existing guard
// patterns caught these, because they were tuned against the original,
// narrower trigger set's actual exposure surface, not this one.
// Anchoring both new phrase shapes to the very START of the message
// closes the whole class at once: a genuine direct instruction naturally
// LEADS with the verb ("Make NWR the project...", "Set TSF as the
// current project."), while every reproduced false positive above
// required the trigger to appear after a question/musing/reported-speech
// opener earlier in the same message. Kept as a separate pattern (not
// folded back into EXPLICIT_SWITCH_PATTERN) specifically so it stays
// anchored -- mixing an anchored and an unanchored alternative inside one
// alternation is easy to get wrong on a future edit.
const CAUSATIVE_TRIGGER_PATTERN =
  /^\s*(?:make\s+\S+(?:\s+\S+){0,3}\s+the\s+(?:project|focus)|set\s+\S+(?:\s+\S+){0,3}\s+as\s+the\s+(?:current\s+)?project)\b/i
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
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 1 (now reverted, see
// below): "have" was removed from this list on the assumption that every
// subject this pattern sees is a singular project name, making "have X
// become...?" ungrammatical as a question. A real Codex adversarial
// review proved that assumption wrong: the subject-capture slot
// (`\S+(?:\s+\S+){0,3}`) is a generic 1-4-word span, not restricted to a
// singular name -- a genuinely plural/generic subject ("the project
// leads", "the steering committee") makes "have" a perfectly grammatical
// question opener too ("Have the project leads become ready to switch to
// NWR?" wrongly moved focus). "have" is restored below; the narrow,
// POSITIVE exception right after this pattern targets only the one shape
// that's actually unambiguous.
const NAMED_SUBJECT_QUESTION_PATTERN =
  /^\s*(?:should|could|would|can|will|has|have|do|does|did)\s+\S+(?:\s+\S+){0,3}\s+(?:be|become|make\s+sense|say)\b/i
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 2: the real
// causative-imperative reading of "have" ("Have [object] [do
// something]", like "Have him call me" -- imperative mood, doesn't
// conjugate for the object's number) is distinguishable from a genuine
// "have" QUESTION by what immediately follows become/be: a real question
// about readiness/willingness continues with an adjective or infinitive
// ("become ready to...", "become willing to..."), never with a bare
// "the project"/"the focus" -- only the causative-imperative reading does
// that ("Have NWR become THE PROJECT..."). Message-start anchored (the
// causative-imperative reading is always the whole message's own
// instruction, never an embedded clause) and excludes a trailing "?" (a
// real, if oddly-phrased, question keeps the discipline this file already
// applies elsewhere: a literal "?" is never itself proof of a genuine
// question, but combined with the "the project/focus" completion it is
// -- see "Have API Docs become the project we focus on next?", a real,
// plausible question about a plural-sounding project name).
const CAUSATIVE_IMPERATIVE_PATTERN =
  /^\s*have\s+\S+(?:\s+\S+){0,3}\s+(?:become|be)\s+the\s+(?:current\s+)?(?:project|focus)\b/i
// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (P0, real Codex adversarial-
// review finding): SUBJECT_INVERSION_QUESTION_OPENER's "could/would/can/
// will YOU" branch (added round 1 for the punctuation-free-question fix)
// has no polite-request carve-out, unlike isGenuineDirective's own
// POLITE_REQUEST_MARKER -- "Could you switch to NWR, please" was wrongly
// refused. Deliberately narrower than reusing POLITE_REQUEST_MARKER
// wholesale: this file has no TELL_ME_WHETHER-equivalent information-
// request guard, so excluding the question-opener check on any bare
// "could/can/would/will you" would also have wrongly UN-guarded "Could
// you tell me whether we should switch to NWR" (a genuine information
// request, correctly refused today). Requiring the switch-trigger verb to
// immediately follow "you" targets exactly the polite-REQUEST-TO-ACT
// shape the finding was about, without reopening that regression.
const POLITE_SWITCH_REQUEST_PATTERN =
  /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:switch|focus|work|talk|discuss)\b/i

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
    (!POLITE_SWITCH_REQUEST_PATTERN.test(trimmed) &&
      SUBJECT_INVERSION_QUESTION_OPENER.test(trimmed)) ||
    ((!CAUSATIVE_IMPERATIVE_PATTERN.test(trimmed) || /\?\s*$/.test(trimmed)) &&
      NAMED_SUBJECT_QUESTION_PATTERN.test(trimmed)) ||
    REPORTED_SPEECH_MARKER.test(trimmed) ||
    RETRACTION_MARKER_PATTERN.test(trimmed) ||
    MID_SENTENCE_HEDGE_MARKER.test(trimmed)
  )
}

// Real, narrow, conservative regex classifiers -- deliberately NOT reusing
// chat-responder.mjs's own intent array: a false positive here silently
// moves focus, so this stays a small, separate, easily-audited surface.
export function isExplicitSwitchMessage(message) {
  return (
    !isGuardedAgainst(message) &&
    (EXPLICIT_SWITCH_PATTERN.test(message) || CAUSATIVE_TRIGGER_PATTERN.test(message.trim()))
  )
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
