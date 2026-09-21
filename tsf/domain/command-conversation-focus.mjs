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
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 3 (real Codex
// adversarial-review finding): anchoring to the LITERAL first character
// was too rigid -- "Please make NWR the focus.", "Okay, make NWR the
// focus." both wrongly failed to match. A bounded, optional polite/filler
// lead-in (the same "please"/"okay/ok," vocabulary this file's other
// guards already recognize, plus the "could/can/would/will you (please)"
// shape POLITE_SWITCH_REQUEST_PATTERN already treats as a genuine
// request-to-act) is allowed before the trigger without reopening the
// original unanchored exposure -- a QUESTION or MUSING opener ("Would
// Alice...", "One idea is to...") still isn't one of these specific
// bounded lead-ins, so none of round 2's fixed false positives return.
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 4 (now superseded, see
// round 5 below): the subject-capture span used `\S+`, which matches ANY
// non-whitespace run -- including a word ending in punctuation like
// "NWR;". That let the pattern cross a real clause boundary: "Please
// make sure to check NWR; the project is stable." was read as "make
// [sure to check NWR;] the project". Restricting each subject word to
// `[A-Za-z0-9'-]+` fixed that specific case, but a real Codex review
// found it was nowhere near enough -- a bare double-dash ("--") or a
// newline both still slip through as an accepted "word" or separator,
// and a common English idiom ("make sure ...", "make absolutely sure
// ...") can still consume 2-3 filler words before coincidentally
// reaching a real "the project"/"the focus" later in an unrelated
// sentence: "Could you make sure to archive the project notes for NWR",
// "Will you make sure NWR keeps the focus on quality" both wrongly fired.
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 5 (real Codex
// adversarial-review finding): chasing individual punctuation/idiom
// shapes was never going to converge -- there's no bounded list of ways
// 2-4 filler words can coincidentally bridge "make"/"set" to an unrelated
// later "the project/focus". The real fix is structural: shrink the
// subject span itself. Neither required DIRECT example ("Make NWR the
// project...", "Set TSF as the current project.") nor any existing test
// needs more than a 2-word project name with this specific trigger shape
// (multi-word names like "API Docs"/"Niners War Room" are only ever
// required with the "focus on"/causative-"have" trigger shapes, which
// don't have this collision risk). Capping the span at 1-2 words removes
// the room for a "make sure to archive ..." idiom (always 3+ filler
// words) to ever reach a coincidental "the project/focus" at all, closing
// the whole class rather than one shape of it. Each word must also START
// with a letter/digit/underscore (not a bare "-"/"--"), so a lone dash
// can never count as a "word" of the subject. The word class itself is
// now Unicode-aware (`\p{L}`/`\p{N}` with the `u` flag, plus "_" and both
// straight/curly apostrophes) -- project display names are arbitrary
// folder basenames with no ASCII restriction (server/onboarding.mjs), so
// the previous ASCII-only class wrongly refused real names like "Café",
// "O'Brien"/"O'Brien" (curly apostrophe), or "TSF_ORCA" (underscore).
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): round 5's 2-word cap still wasn't enough
// -- even a SINGLE filler word ("sure") sits right before "the project"
// in ordinary English ("make sure the project notes..."), so no word
// count can ever exclude it; "absolutely sure" is exactly 2 words; "set
// NWR aside" captures "aside" as the 2nd subject word before "as the
// project" continues an unrelated later clause. Chasing individual
// filler words was never going to converge (English has an unbounded
// supply: sure, certain, positive, ready, aside, straight, free, ...).
// The real, convergent fix constrains the OTHER side instead: what
// legitimately follows "the project"/"the focus". In every genuine
// directive (required or already in this file's tests), "the
// project/focus" is either the end of the message or immediately
// followed by one short, bounded completion describing focus itself
// ("we're focused on", "we focus on next"). In EVERY false positive this
// review (and the prior one) found, "the project/focus" is followed by
// MORE unrelated clause content ("notes for NWR are archived",
// "continues", "field in the test fixture", "of the report, not...").
// Requiring the message to actually END at (or just after) "the
// project/focus" closes the whole class of filler-word collisions at
// once, and as a welcome side effect also resolves the two previously-
// disclosed "unrelated sense of focus/project" referential-ambiguity
// residuals (see the test file) -- an ambiguous message now defaults to
// NOT moving focus, the safer direction per this codebase's own stated
// bias.
const CAUSATIVE_SUBJECT_WORD = "(?:-(?=[\\p{L}\\p{N}_])|[\\p{L}\\p{N}_])[\\p{L}\\p{N}\\p{M}_'’-]*"
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 7 (real Codex
// adversarial-review finding): `we'?re` only permitted the ASCII
// apostrophe, not the curly one (U+2019) this file already accepts
// everywhere else (CAUSATIVE_SUBJECT_WORD's own class) -- "Make NWR the
// project we're focused on." (typed with a curly apostrophe, as most
// real keyboards/autocorrect produce) wrongly failed to match a
// realistic variant of the required DIRECT example.
const CAUSATIVE_TRAILING_CONTINUATION =
  "(?:\\s+we['’]?re\\s+focus(?:ed|ing)\\s+on(?:\\s+next)?" +
  '|\\s+we\\s+are\\s+focus(?:ed|ing)\\s+on(?:\\s+next)?' +
  '|\\s+we\\s+focus\\s+on(?:\\s+next)?)?[.!]?\\s*$'
const CAUSATIVE_TRIGGER_PATTERN = new RegExp(
  `^\\s*(?:(?:please|okay|ok)[,\\s]+)*(?:(?:could|can|would|will)\\s+you\\s+(?:please\\s+)?)?(?:make\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+the\\s+(?:project|focus)|set\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+as\\s+the\\s+(?:current\\s+)?project)${CAUSATIVE_TRAILING_CONTINUATION}`,
  'iu'
)
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
// instruction, never an embedded clause).
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 3 (real Codex
// adversarial-review finding): round 2's own "no trailing ?" carve-out
// was itself unsafe -- it only checked the LAST character, so "Have API
// Docs become the project we focus on yet?!" (a real question ending in
// "?!") and any punctuation-free spoken question of this exact shape
// both slipped through as if they were directives. A real question about
// a plural/generic-sounding subject ("Have API Docs become the
// project...?") and the genuine causative imperative ("Have NWR become
// the project...") are surface-IDENTICAL without punctuation -- no
// bounded pattern can tell them apart from word order alone. Checking
// for a "?" ANYWHERE in the message (not just the last character) closes
// the "?!"/mid-message-"?" gap; the fully punctuation-free case is left
// as a disclosed, accepted residual (same P1-severity, irreducible
// ambiguity the first closure round already found, now precisely scoped
// rather than papered over by a fragile end-of-string check). This
// pattern is also a real TRIGGER in isExplicitSwitchMessage below, not
// only a guard exception -- round 2 wired it as an exception ONLY, so
// "Have NWR become the current project." (no separate "focus on"
// substring to coincidentally match EXPLICIT_SWITCH_PATTERN) wrongly
// stayed refused. Same `CAUSATIVE_SUBJECT_WORD` span-shrink and Unicode-
// aware word class as CAUSATIVE_TRIGGER_PATTERN's own round-5 fix (see
// there for why) applied to the subject span here too, for the identical
// clause-boundary-crossing and non-ASCII-name reasons.
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6: same
// CAUSATIVE_TRAILING_CONTINUATION requirement as CAUSATIVE_TRIGGER_PATTERN's
// own round-6 fix (see there for the full reasoning) applied here too --
// "Have NWR be the focus of the quarterly report." (previously a
// disclosed, accepted residual) is now correctly resolved to NOT a
// directive, since "of the quarterly report" isn't one of the bounded
// completions and the message doesn't end at "the focus".
const CAUSATIVE_IMPERATIVE_PATTERN = new RegExp(
  `^\\s*have\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+(?:become|be)\\s+the\\s+(?:current\\s+)?(?:project|focus)${CAUSATIVE_TRAILING_CONTINUATION}`,
  'iu'
)
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
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 3 (now reverted, see
// below): "make"/"set" were added as two more BARE verbs to this list to
// fix "Could you make NWR the focus?" being wrongly refused. A real Codex
// review proved this too permissive: "make"/"set" (unlike switch/focus/
// work/talk/discuss) are common general-purpose verbs, so the bare-verb
// match excepted the SUBJECT_INVERSION_QUESTION_OPENER guard for ANY
// "could/can/would/will you make/set ..." regardless of what follows --
// "Could you set a reminder to focus on NWR tomorrow" and "Will you make
// sure we go back after lunch" both wrongly moved focus/went back, since
// the guard was excepted even though neither is actually about switching.
// isGuardedAgainst below now excepts the SUBJECT_INVERSION_QUESTION_OPENER
// guard via CAUSATIVE_TRIGGER_PATTERN itself instead, for the make/set
// case specifically -- that pattern already requires the FULL "make X the
// project/focus"/"set X as the (current) project" shape (including this
// same polite lead-in), so it can never wrongly except an unrelated
// "make sure .../set a reminder ..." the way a bare verb match can.
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
      !CAUSATIVE_TRIGGER_PATTERN.test(trimmed) &&
      SUBJECT_INVERSION_QUESTION_OPENER.test(trimmed)) ||
    ((!CAUSATIVE_IMPERATIVE_PATTERN.test(trimmed) || trimmed.includes('?')) &&
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
  const trimmed = message.trim()
  return (
    !isGuardedAgainst(message) &&
    (EXPLICIT_SWITCH_PATTERN.test(message) ||
      CAUSATIVE_TRIGGER_PATTERN.test(trimmed) ||
      CAUSATIVE_IMPERATIVE_PATTERN.test(trimmed))
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
