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
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 (real dogfood finding, disposable-
// state rant scenario): "actually" -- an extremely common, natural way
// to lead into a spoken self-correction/afterthought directive ("actually
// make NWR the focus", "actually, have NWR become the current project")
// -- was missing from this lead-in list, so a message starting with it
// failed to match the trigger AT ALL, not just the guard. Added to the
// SAME bounded filler list as "please"/"okay"/"ok". Shared between both
// causative patterns below (round 6-7 only added a lead-in to
// CAUSATIVE_TRIGGER_PATTERN; CAUSATIVE_IMPERATIVE_PATTERN never had one
// at all -- "Please have NWR become the current project." had this exact
// gap too, closed here for consistency).
const CAUSATIVE_LEAD_IN =
  '(?:(?:please|okay|ok|actually)[,\\s]+)*(?:(?:could|can|would|will)\\s+you\\s+(?:please\\s+)?)?'
const CAUSATIVE_TRIGGER_PATTERN = new RegExp(
  `^\\s*${CAUSATIVE_LEAD_IN}(?:make\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+the\\s+(?:project|focus)|set\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+as\\s+the\\s+(?:current\\s+)?project)${CAUSATIVE_TRAILING_CONTINUATION}`,
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
  `^\\s*${CAUSATIVE_LEAD_IN}have\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+(?:become|be)\\s+the\\s+(?:current\\s+)?(?:project|focus)${CAUSATIVE_TRAILING_CONTINUATION}`,
  'iu'
)
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 (real Codex adversarial-
// review finding): NAMED_SUBJECT_QUESTION_PATTERN's own guard-exception
// below requires the FULL CAUSATIVE_IMPERATIVE_PATTERN (with its trailing-
// continuation requirement) to match -- but appending a real "I meant X"
// self-correction ("Have Alpha become the focus -- no wait, I meant
// Beta") breaks that trailing-continuation requirement (there's more text
// after "the focus" than the bounded completion allows), so the guard
// wrongly re-applied and refused an otherwise-genuine causative-
// imperative correction. This SHAPE-only variant (same subject/copula/
// completion match, no trailing-continuation requirement) is passed by
// verifiedCorrectionTarget ONLY, as isGuardedByNonRetraction's optional
// causativeImperativePattern override -- see that function's own comment
// for why relaxing this for EVERY caller (the first attempt at this fix)
// reopened a different, already-disclosed P1-closure residual, and why
// scoping the relaxation to the correction path alone is safe.
const CAUSATIVE_IMPERATIVE_SHAPE_PATTERN = new RegExp(
  `^\\s*${CAUSATIVE_LEAD_IN}have\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+(?:become|be)\\s+the\\s+(?:current\\s+)?(?:project|focus)\\b`,
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
// Bare detector -- "I meant" appearing anywhere at all, with no attempt
// to judge from text alone whether it's a genuine name correction (see
// correctedSwitchTarget's own comment below for why two earlier attempts
// at that judgment both failed real review). Used only as a search
// anchor and as a fallback-safety signal, never as a guard exception.
const MEANT_CORRECTION_PATTERN = /\bI\s+meant\b/i
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 (real dogfood finding, disposable-
// state rant scenario): "switch to Alpha -- no wait, I meant Beta" is one
// of the MOST natural real spoken self-corrections there is -- and this
// file already has a dedicated, bounded-safe mechanism for exactly this
// shape ("I meant X", added for real dogfood round 1's own "misrecognized
// turn" finding, see EXPLICIT_SWITCH_PATTERN above). But "no wait" is
// ALSO a real retraction marker, and the message-wide RETRACTION_MARKER_PATTERN
// guard ran first and unconditionally, silently defeating the very
// correction mechanism built to handle this. "I meant X" is a POSITIVE
// completion of intent, not an abandonment -- when it's present, the
// message is a correction, not a full retraction, and the guard should
// step aside.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 3 (real Codex adversarial-
// review finding): round 2's exclusion-list approach (excluding "I meant
// to/that/for...") was itself an unbounded chase -- "I meant I'd ask...",
// "I meant we should...", "I meant like...", "I meant um to..." all slip
// past a finite word blocklist the exact same way "make sure"/"make
// certain"/"make ready" slipped past this file's OWN earlier finite-
// blocklist attempt for the causative trigger (see CAUSATIVE_SUBJECT_WORD's
// own history above) -- a finite list can never exclude an unbounded set
// of English continuations. Text alone can never reliably tell a genuine
// name correction from an unrelated later clause that happens to contain
// "I meant" -- but exactMatches (the REAL candidate names) can: a name
// correction is data-verifiable, structural text-pattern-matching isn't.
// This guard reverts to the ORIGINAL, fully conservative behavior (a
// retraction marker ALWAYS blocks isExplicitSwitchMessage/isGoBackMessage,
// full stop) -- the "was this actually a resolved correction, not a
// retraction" decision now lives entirely in the caller
// (server/chat-http-routes.mjs), which has the real exactMatches data
// this file deliberately never does, ORing correctedSwitchTarget's own
// verified, non-null result into isExplicitSwitch. See
// correctedSwitchTarget's own comment below for how it stays safe
// without a word-exclusion list at all.
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding): split out from isGuardedAgainst -- every guard EXCEPT
// the retraction check. The caller-side correction override (see
// isRetractionCorrectable below) must except ONLY the retraction guard,
// never any of the others -- round 3's own `.corrected` override ORed
// blindly over isExplicitSwitchMessage's WHOLE guarded result, so it
// silently bypassed reported-speech ("I said I meant Beta." -- reported
// speech, not a directive), question (SUBJECT_INVERSION_QUESTION_OPENER:
// "Did I say switch to Alpha -- no wait, I meant Beta?"), negation, and
// hedge guards too, any time "I meant X" happened to resolve. A genuine
// correction can only ever except the ONE guard it's meant to except.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 (real Codex adversarial-
// review finding, and a self-caught regression while fixing it): Finding 3
// needed the causative-imperative guard-exception to fire WITHOUT
// requiring CAUSATIVE_IMPERATIVE_PATTERN's own trailing-continuation to
// reach message-end, since a real "-- no wait, I meant X" suffix always
// breaks that requirement ("Have Alpha become the focus -- no wait, I
// meant Beta" wrongly stayed refused). But swapping the FULL pattern for
// CAUSATIVE_IMPERATIVE_SHAPE_PATTERN in this shared function reopened the
// P1-closure round-6 disclosed residual it was built to protect: a fully
// punctuation-free "have" question about a plural/generic subject
// ("Have API Docs become the project we focus on yet") has no "?" and no
// retraction marker either, so relaxing the exception here for EVERY
// caller (not just correction) let NAMED_SUBJECT_QUESTION_PATTERN's guard
// go inert, and EXPLICIT_SWITCH_PATTERN's own unrelated, unanchored
// "focus on" match then wrongly fired. The two needs are only in tension
// for a message that ALSO contains a genuine "I meant" correction anchor
// -- which is exactly the one case correctedSwitchTarget itself already
// requires before it can ever return non-null. Parameterizing which
// causative-imperative pattern feeds the exception keeps
// isGuardedByNonRetraction's own default (the FULL, trailing-continuation-
// requiring pattern) exactly as conservative as before round 5 for every
// existing caller (isGuardedAgainst, isExplicitSwitchMessage,
// isGoBackMessage), while verifiedCorrectionTarget below opts into the
// relaxed SHAPE-only variant only for its own correction-scoped check --
// where an unrelated punctuation-free question can never slip through
// anyway, because correctedSwitchTarget still refuses unless a real
// "I meant" anchor is present.
function isGuardedByNonRetraction(
  message,
  causativeImperativePattern = CAUSATIVE_IMPERATIVE_PATTERN
) {
  const trimmed = message.trim()
  return (
    DELIBERATIVE_QUESTION_PATTERN.test(message) ||
    NEGATION_GUARD_PATTERN.test(message) ||
    DELIBERATIVE_STATEMENT_OPENER.test(trimmed) ||
    COPULA_QUESTION_OPENER.test(trimmed) ||
    (!POLITE_SWITCH_REQUEST_PATTERN.test(trimmed) &&
      !CAUSATIVE_TRIGGER_PATTERN.test(trimmed) &&
      SUBJECT_INVERSION_QUESTION_OPENER.test(trimmed)) ||
    ((!causativeImperativePattern.test(trimmed) || trimmed.includes('?')) &&
      NAMED_SUBJECT_QUESTION_PATTERN.test(trimmed)) ||
    REPORTED_SPEECH_MARKER.test(trimmed) ||
    MID_SENTENCE_HEDGE_MARKER.test(trimmed)
  )
}
function isGuardedAgainst(message) {
  return isGuardedByNonRetraction(message) || RETRACTION_MARKER_PATTERN.test(message.trim())
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

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 (real dogfood finding, disposable-
// state rant scenario): "switch to Alpha -- no wait, I meant Beta" names
// BOTH projects by exact match, so the caller's own turn-target
// resolution correctly finds TWO exact matches -- and nextCommandFocus's
// own "never guess a switch out of ambiguity" rule (exactly right for
// genuine ambiguity, e.g. "let's talk about Alpha and Beta") then
// silently refuses to switch at all, defeating the correction.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 3 (replacing two prior
// failed attempts): rounds 1 and 2 both tried to bound "what counts as
// the corrected name" with TEXT-ONLY heuristics -- an unbounded search
// window (round 1) and a finite verb-phrase exclusion list (round 2) --
// and each was found unsafe, because text alone can never distinguish a
// genuine name correction from an unrelated later clause that merely
// contains "I meant". The fix that actually converges: stop guessing
// from text structure and require the corrected name to appear
// IMMEDIATELY (module a small, bounded set of spoken disfluencies) after
// the LAST "I meant" in the message, matched directly against the REAL
// candidate names in exactMatches with Unicode-aware word boundaries.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding, four more real bugs in round 3's own implementation):
// (1) the disfluency strip had no word boundary after "well"/"uh"/"um",
//     so it chopped the FRONT off an unrelated real name -- "I meant
//     Wellness" lost "Well" and failed to match "wellness" at all (a
//     real false negative), while "I meant Wellspring" (with only
//     "spring" as a real candidate) lost "Well" and WRONGLY matched
//     "spring" (an unsafe false positive) -- now requires "well"/"uh"/
//     "um" to be a whole word (not immediately followed by another
//     letter/digit) before stripping it.
// (2) the match boundary excluded only `\p{L}\p{N}_`, not the hyphen/
//     apostrophe/combining-mark characters this file's own
//     CAUSATIVE_SUBJECT_WORD already treats as name-continuing -- "I
//     meant Alpha-Two" (only "Alpha" a real candidate) wrongly matched
//     "Alpha" as if it were the WHOLE name, ignoring the "-Two" that
//     makes it a different, unresolved name. Now excludes the same
//     character set CAUSATIVE_SUBJECT_WORD does.
// (3) the "or/and <second candidate>" ambiguity check required the
//     second candidate immediately after "or"/"and" with zero words in
//     between, so "I meant Beta or the Gamma project"/"...or maybe
//     Gamma"/"...and also Gamma" all silently dropped the second
//     candidate and wrongly resolved to Beta alone. Now allows up to 2
//     filler words between the conjunction and the second candidate
//     (mirroring this file's own established 1-2-word bounded-span
//     convention elsewhere) without reopening the unbounded-search
//     problem an unrelated LATER mention exploited in round 2 (that
//     still requires 3+ intervening words and stays correctly excluded).
// (4) two real projects can share the exact same display name/alias (no
//     uniqueness invariant enforces otherwise) -- resolving to whichever
//     one happened to sort first was an arbitrary, silent guess between
//     two real, different destinations. Now treated as ambiguity too.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 (real Codex adversarial-
// review finding, three more real bugs): (1) the match boundary's hyphen
// exclusion made ANY hyphen name-continuing, including "--" used as
// ordinary sentence-pause punctuation elsewhere in this exact file ("I
// meant Alpha--that's the one" wrongly refused to match "Alpha") -- a
// SINGLE hyphen not followed by another hyphen still continues a name
// (the genuine "Alpha-Two" case), but "--" (or more) no longer does,
// matching how this file's own retraction/trailing-continuation patterns
// already treat "--" as punctuation, not name text. (2) "and/or" (a
// single, extremely common compound token) wasn't recognized as a
// conjunction at all, so "I meant Beta and/or Gamma" wrongly resolved to
// Beta alone; added as an explicit alternative. (3) "I meant Well" (where
// "Well" is itself the intended, real corrected name) always had "Well"
// stripped as a disfluency first, even with nothing left over to
// disambiguate it from -- now tried WITHOUT any disfluency-stripping
// first, and only falls back to the disfluency-stripped interpretation
// if the literal, unstripped text doesn't already resolve to a real
// candidate; this also fixes "I meant Well-known" the same way, and
// requires no special-casing beyond preferring the literal reading. "er"
// added to the recognized disfluency list (same bounded, common-
// filler-word class as "uh"/"um"/"well").
//
// Disclosed, not fixed (real Codex review findings, but genuinely
// unbounded to chase further): a disfluency word that ALSO happens to be
// the exact name of a different real project ("I meant, like, Beta"
// where a project is literally named "Like") is irreducibly ambiguous
// without real semantic understanding -- resolves to the literal name
// match, the same defensible "prefer the literal reading" choice used
// for "Well" above. A possessive suffix on a real name ("I meant Alpha's
// project") is indistinguishable from a genuinely apostrophe'd compound
// name ("O'Brien") by this pattern -- both look identical to a bounded
// regex; refusing to guess (a false negative) is the safe direction this
// codebase is deliberately biased toward everywhere else. Ellipsis- or
// dash-joined conjunctions with no surrounding whitespace ("or...
// Gamma", "or—maybe—Gamma") remain unrecognized -- unusual typographic
// styles unlikely from real typed or voice input, unlike the single,
// well-justified "and/or" token added above.
export function correctedSwitchTarget(message, exactMatches) {
  if (!Array.isArray(exactMatches) || exactMatches.length === 0) {
    return null
  }
  const anchorPattern = new RegExp(MEANT_CORRECTION_PATTERN.source, 'gi')
  let anchorEnd = -1
  let found
  while ((found = anchorPattern.exec(message))) {
    anchorEnd = found.index + found[0].length
  }
  if (anchorEnd === -1) {
    return null
  }
  const named = exactMatches.filter((m) => m.matchedPhrase)
  if (named.length === 0) {
    return null
  }
  const alternation = named
    .map((m) => m.matchedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const boundary = "(?:(?![\\p{L}\\p{N}\\p{M}_'’]|-(?!-))|$)"
  const soloPattern = new RegExp(
    `^(${alternation})${boundary}(?:\\s*,?\\s*(?:and\\/or|or|and)\\s+(?:\\S+\\s+){0,2}(${alternation})${boundary})?`,
    'iu'
  )
  const rawRest = message.slice(anchorEnd).replace(/^[,\s]*/, '')
  const strippedRest = rawRest.replace(/^(?:(?:uh|um|er|well)(?![\p{L}\p{N}_]))?[,\s]*/iu, '')
  const solo = rawRest.match(soloPattern) ?? strippedRest.match(soloPattern)
  if (!solo || solo[2]) {
    return null
  }
  const matchedLower = solo[1].toLowerCase()
  const winners = named.filter((m) => m.matchedPhrase.toLowerCase() === matchedLower)
  return winners.length === 1 ? winners[0].project.id : null
}

// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 4 (real Codex adversarial-
// review finding, the most serious of the round): round 3's `.corrected`
// override (in server/command-turn-target-correction.mjs) ORed
// correctedSwitchTarget's own result directly over isExplicitSwitchMessage,
// which bypassed EVERY OTHER guard, not just retraction -- "I said I
// meant Beta." (reported speech, not a directive) and "Did I say switch
// to Alpha -- no wait, I meant Beta?" (a genuine question) both wrongly
// moved focus, since correctedSwitchTarget itself has no guard awareness
// at all. A verified correction must still respect every OTHER guard
// (question/reported-speech/negation/hedge) -- it only ever excepts the
// ONE guard (retraction) it exists to except. Used by BOTH
// correctedTurnTargetIds below and the caller's own isExplicitSwitch
// override, so this is the ONE place either consumer's correction can
// ever come from.
export function verifiedCorrectionTarget(message, exactMatches) {
  if (isGuardedByNonRetraction(message, CAUSATIVE_IMPERATIVE_SHAPE_PATTERN)) {
    return null
  }
  return correctedSwitchTarget(message, exactMatches)
}

// Same correction as verifiedCorrectionTarget above, but returns the
// FULL turn-target id list a caller should use directly -- the single
// corrected id when found, otherwise exactMatches's own ids unchanged.
// Saves every caller from re-deriving the same fallback ternary.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 2 (real Codex adversarial-
// review finding): falling back to exactMatches unconditionally was
// unsafe when a genuine name-correction was ATTEMPTED but didn't resolve
// -- "switch to Alpha -- no wait, I meant TSF Orca" (a real project name
// the resolver's own co-occurrence rule drops from the exact-match list,
// so exactMatches here is only [alpha]) or "switch to Alpha-Two -- no
// wait, I meant Alpha" (the resolver's own longest-match rule drops
// "Alpha" once "Alpha-Two" is present). In both, verifiedCorrectionTarget
// correctly returns null (the corrected name isn't among exactMatches),
// but falling back to the RAW exactMatches would execute exactly the
// target the owner just retracted. When the message contains BOTH a
// retraction marker and ANY "I meant" occurrence at all (round 3: no
// longer restricted to a name-shaped one -- MEANT_CORRECTION_PATTERN is
// now the same bare detector correctedSwitchTarget's own anchor search
// uses), the pre-retraction exactMatches are never a safe fallback --
// refuse instead of guessing.
//
// Disclosed, not fixed (a real Codex review finding, but the SAME
// already-accepted, message-wide-vs-clause-scoped architectural residual
// this whole file's retraction/reported-speech/hedge guards have all
// shared since the original Directive Semantics Closure V1 mission): an
// UNRELATED earlier "actually, no, I meant the other file" followed by a
// genuinely separate LATER real directive ("switch to Alpha") in the
// SAME message can suppress that later directive too, because this
// (like isGuardedAgainst above) reasons about the whole message, not
// per-clause. A false NEGATIVE (a real directive doesn't execute), the
// safe direction this codebase is deliberately biased toward everywhere
// else -- not re-architected here for the same reason clause-splitting
// was rejected throughout the rest of this file's history.
export function correctedTurnTargetIds(message, exactMatches) {
  if (!Array.isArray(exactMatches)) {
    return []
  }
  const corrected = verifiedCorrectionTarget(message, exactMatches)
  if (corrected) {
    return [corrected]
  }
  if (MEANT_CORRECTION_PATTERN.test(message) && RETRACTION_MARKER_PATTERN.test(message)) {
    return []
  }
  return exactMatches.map((m) => m.project.id)
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
