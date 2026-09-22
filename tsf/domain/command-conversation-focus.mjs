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
// completion match, no trailing-continuation requirement) matches the
// LEADING shape only -- see hasSafeCausativeImperativeCorrectionShape
// right below for why the raw pattern is never used directly as a guard
// exception any more (round 5's own follow-up review found that doing so
// ignored ALL trailing content, not just a correction suffix).
const CAUSATIVE_IMPERATIVE_SHAPE_PATTERN = new RegExp(
  `^\\s*${CAUSATIVE_LEAD_IN}have\\s+${CAUSATIVE_SUBJECT_WORD}(?:\\s+${CAUSATIVE_SUBJECT_WORD}){0,1}\\s+(?:become|be)\\s+the\\s+(?:current\\s+)?(?:project|focus)\\b`,
  'iu'
)
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 (real Codex adversarial-
// review finding, on the FIRST attempt at using
// CAUSATIVE_IMPERATIVE_SHAPE_PATTERN as a guard exception): matching the
// shape alone says nothing about what follows it -- "Have Alpha be the
// focus OF THE QUARTERLY REPORT -- no wait, I meant Beta" (a message
// about a report's subject) and "Have API Docs become the project we
// focus on yet -- no wait, I meant Release Notes" (the disclosed
// punctuation-free-question residual, PLUS an unrelated correction) both
// wrongly resolved when the shape match alone was trusted. A genuine
// correction's retraction marker sits IMMEDIATELY after the shape match
// (only whitespace/punctuation in between, e.g. "the focus -- no wait,
// I meant..."); an unrelated clause between the shape and any later
// retraction marker elsewhere in the message means the shape was never
// actually completing a real directive. Reusing RETRACTION_MARKER_PATTERN
// itself (rather than a second, separately-maintained vocabulary copy)
// keeps this in sync with every other guard in this file that recognizes
// a retraction.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 6 (real Codex adversarial-
// review findings against the round-5 version of this function): (1) the
// leading-punctuation strip only covered ASCII punctuation, so an em
// dash/en dash/ellipsis right after the shape ("the focus—no wait,
// I meant Beta") never reached the `retraction.index === 0` check at
// all -- broadened to the same Unicode dash/ellipsis characters this
// file's own retraction/en-dash tests elsewhere already cover. (2) an
// immediately-adjacent retraction marker was trusted even when a SECOND,
// FULL retraction (e.g. "leave it unchanged") followed it, itself
// followed by an entirely separate sentence containing an unrelated "I
// meant X" ("...-- no wait, leave it unchanged. In the report, I meant
// Beta.") -- correctedSwitchTarget's own last-"I meant"-in-the-message
// search then picked up that unrelated later correction. Now also
// requires the "I meant" MEANT_CORRECTION_PATTERN itself finds to occur
// before the first real sentence boundary (a ".", "!", or "?" followed
// by whitespace or message-end) after the retraction marker -- "never
// mind, I meant Beta" (comma, no sentence break) still resolves; "no
// wait, leave it unchanged. In the report, I meant Beta." (a full
// sentence break before the unrelated "I meant") correctly refuses.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 7 (real Codex adversarial-
// review findings against the round-6 version of this function, now
// superseded by round 8 below): (1) this function's own
// MEANT_CORRECTION_PATTERN.exec() found only the FIRST "I meant" after
// the retraction, but correctedSwitchTarget always resolves against the
// LAST -- fixed by finding the last occurrence here too. (2) treating
// ANY ". "/"! "/"? " as a sentence boundary wrongly refused a genuine
// correction after an abbreviation period -- fixed with an uppercase-
// letter heuristic.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 8 (real Codex adversarial-
// review findings): round 7's whole "sentence boundary" MODEL was
// itself wrong, not just its heuristic -- "Have Alpha become the focus
// -- no wait, keep it unchanged. Actually, no -- I meant Beta." is a
// genuine, real correction (the owner retracts a FULL retraction with a
// SECOND retraction, then corrects), and it crosses a real sentence
// boundary between "unchanged." and "Actually" -- proving a genuine
// correction can legitimately be arbitrarily far from the shape's own
// adjacent retraction, chained through further retractions. Distance
// from the shape was never the right signal. What actually distinguishes
// this GENUINE case from the unrelated "...leave it unchanged. In the
// report, I meant Beta." case (round 6 finding 4) is much simpler: is
// the LAST "I meant" (the one correctedSwitchTarget will actually use)
// itself IMMEDIATELY preceded by SOME retraction marker (only
// whitespace/punctuation in between) -- ANY retraction marker anywhere
// in the message, not necessarily the SAME one already matched right
// after the shape? "Actually, no --" sits directly before "I meant
// Beta" (a real retraction marker, immediately adjacent) -- safe. "In
// the report, " sits directly before "I meant Beta" in the OTHER case --
// not a retraction marker at all -- unsafe. An EMPTY gap (nothing but
// punctuation/whitespace between the FIRST retraction and "I meant", the
// canonical shape) is its own always-safe case, same as before.
//
// This alone, though, reopened round 7's own abbreviation-period fix:
// "-- no wait, after checking the v. 2 notes, I meant Beta." has ORDINARY
// PROSE (no retraction marker at all) directly before "I meant" -- but
// unlike the round-6-finding-4 case, that prose never crosses a REAL
// sentence boundary (the only period is "v. 2", an abbreviation, not a
// sentence end) -- it's one single, uninterrupted correction clause. The
// "must end with a retraction marker" requirement is therefore only
// applied when a REAL sentence boundary occurs somewhere before "I
// meant" -- no real boundary at all means it's still one clause, and
// stays safe regardless of what the trailing text is (the same trust the
// canonical, no-boundary-at-all shape has always had).
//
// Round 7's own "uppercase letter after the punctuation" heuristic for
// telling a real sentence boundary from an abbreviation period was
// ITSELF too narrow -- a real sentence can continue in lowercase too
// (informal writing, a spoken transcript, a quote mark, a bullet/
// newline), and round 8's own adversarial review reproduced this exact
// gap ("-- no wait. in the report, I meant Beta." wrongly resolved,
// since lowercase "in" isn't `\p{Lu}`). What actually marks "v. 2" as an
// abbreviation rather than a sentence end is that the period is followed
// by a DIGIT, not by whether the following letter happens to be
// capitalized -- version/section-style abbreviations ("v. 2", "no. 5",
// "ch. 3") are a narrow, well-defined, common convention; capitalization
// is not a reliable signal for "did a new sentence start" at all.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 10: round 8 still reduced
// sentence structure to one punctuation regex. That both split common
// abbreviations and missed newlines/quoted endings, while its fallback
// accepted marker-shaped words at the end of ordinary prose. Segment the
// correction context into sentences instead. A boundary is safe only when
// its final segment starts with a fresh retraction and contains nothing but
// punctuation/disfluencies before the same last "I meant" the resolver uses.
const CORRECTION_SENTENCE_SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' })
const CORRECTION_DISFLUENCY_PATTERN = /^(?:uh|um|er|well)(?![\p{L}\p{N}_])[,\s]*/iu
const CORRECTION_BRIDGE_PUNCTUATION_PATTERN = /^[\s.,!;:?\u2026\u2014\u2013-]+/u
const NUMERIC_LABEL_ABBREVIATION_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:v|ver|ch|chap|fig|sec|sect|vol|pg|p|pp|para|eq|rev|pt)$/iu
// Preserve round 10's explicit label context without treating standalone no as an abbreviation.
const CONTEXTUAL_NUMBER_LABEL_PATTERN =
  /\b(?:check(?:ed|ing)?|review(?:ed|ing)?)\s+(?:the\s+)?no$/iu

function isAbbreviationSegmentBoundary(text, segmentStart, meantIndex) {
  const left = text.slice(0, segmentStart).trimEnd()
  const right = text.slice(segmentStart).trimStart()
  if (!left.endsWith('.')) {
    return false
  }
  if (/(?:\p{L}\.){2,}$/u.test(left)) {
    return segmentStart + text.slice(segmentStart).search(/\S/u) !== meantIndex
  }
  const tokenMatch = /(?:^|[^\p{L}\p{N}])(\p{Lu}\p{Ll}{0,2})\.$/u.exec(left)
  if (!tokenMatch) {
    return false
  }
  const tokenLength = [...tokenMatch[1]].length
  if (tokenLength <= 2 && /^\p{Lu}\p{Ll}+/u.test(right)) {
    return true
  }
  const precedingName = /\p{Lu}\p{Ll}+\s*$/u.test(left.slice(0, tokenMatch.index))
  return tokenLength === 3 && precedingName && /^\p{Ll}+/u.test(right)
}

function isNumericLabelPeriod(text, periodIndex) {
  const left = text.slice(0, periodIndex)
  return NUMERIC_LABEL_ABBREVIATION_PATTERN.test(left) || CONTEXTUAL_NUMBER_LABEL_PATTERN.test(left)
}

function nextContentIndex(text, punctuationIndex) {
  let cursor = punctuationIndex + 1
  while (cursor < text.length && /["'\u2019\u201d)\]}]/u.test(text[cursor])) {
    cursor += 1
  }
  const whitespaceStart = cursor
  while (cursor < text.length && /[^\S\r\n]/u.test(text[cursor])) {
    cursor += 1
  }
  return cursor > whitespaceStart ? cursor : -1
}

function lastCorrectionSentenceStart(text, meantIndex) {
  let lastStart = -1
  for (const segment of CORRECTION_SENTENCE_SEGMENTER.segment(text)) {
    if (
      segment.index > 0 &&
      segment.index <= meantIndex &&
      !isAbbreviationSegmentBoundary(text, segment.index, meantIndex)
    ) {
      lastStart = Math.max(lastStart, segment.index)
    }
  }
  for (let index = 0; index < meantIndex; index += 1) {
    if (text[index] === '\r' || text[index] === '\n') {
      if (text[index] === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      let contentIndex = index + 1
      while (contentIndex < text.length && /[^\S\r\n]/u.test(text[contentIndex])) {
        contentIndex += 1
      }
      lastStart = Math.max(lastStart, contentIndex)
      continue
    }
    if (text[index] !== '!' && text[index] !== '?' && text[index] !== '.') {
      continue
    }
    const contentIndex = nextContentIndex(text, index)
    if (contentIndex === -1 || contentIndex > meantIndex) {
      continue
    }
    if (text[index] === '!' || text[index] === '?') {
      lastStart = Math.max(lastStart, contentIndex)
      continue
    }
    if (contentIndex === meantIndex) {
      lastStart = Math.max(lastStart, contentIndex)
      continue
    }
    const followingRetraction = RETRACTION_MARKER_PATTERN.exec(text.slice(contentIndex, meantIndex))
    if (followingRetraction?.index === 0) {
      lastStart = Math.max(lastStart, contentIndex)
      continue
    }
    const hasClosingPunctuation =
      contentIndex > index + 1 && /["'\u2019\u201d)\]}]/u.test(text[index + 1])
    if (hasClosingPunctuation) {
      lastStart = Math.max(lastStart, contentIndex)
      continue
    }
    if (/\p{N}/u.test(text[contentIndex])) {
      if (isNumericLabelPeriod(text, index)) {
        continue
      }
      lastStart = Math.max(lastStart, contentIndex)
      continue
    }
    const boundarySpacing = text.slice(index + 1, contentIndex)
    if (/[^\S\r\n]{2,}$/u.test(boundarySpacing)) {
      lastStart = Math.max(lastStart, contentIndex)
      continue
    }
    if (!/[\p{L}\p{N}]/u.test(text.slice(0, index))) {
      lastStart = Math.max(lastStart, contentIndex)
    }
  }
  return lastStart
}

function isFreshRetractionBridge(text) {
  let rest = text.replace(CORRECTION_BRIDGE_PUNCTUATION_PATTERN, '')
  const retraction = RETRACTION_MARKER_PATTERN.exec(rest)
  if (retraction === null || retraction.index !== 0) {
    return false
  }
  rest = rest.slice(retraction[0].length)
  let atRetractionEnd = true
  for (;;) {
    const separator = CORRECTION_BRIDGE_PUNCTUATION_PATTERN.exec(rest)?.[0] ?? ''
    rest = rest.slice(separator.length)
    if (rest === '') {
      return true
    }
    const disfluency = CORRECTION_DISFLUENCY_PATTERN.exec(rest)
    if (!disfluency) {
      return false
    }
    if (atRetractionEnd && !/[.,!;:?\u2026\u2014\u2013-]/u.test(separator)) {
      return false
    }
    atRetractionEnd = false
    rest = rest.slice(disfluency[0].length)
  }
}

function hasSafeCausativeImperativeCorrectionShape(trimmed) {
  const match = CAUSATIVE_IMPERATIVE_SHAPE_PATTERN.exec(trimmed)
  if (!match) {
    return false
  }
  const tail = trimmed.slice(match[0].length)
  if (tail.trim() === '') {
    return true
  }
  const strippedTail = tail.replace(/^[\s.,!;:?…—–-]+/u, '')
  const retraction = RETRACTION_MARKER_PATTERN.exec(strippedTail)
  if (retraction === null || retraction.index !== 0) {
    return false
  }
  const afterRetraction = strippedTail.slice(retraction[0].length)
  const meantPattern = new RegExp(MEANT_CORRECTION_PATTERN.source, 'gi')
  let meantIndex = -1
  let meantLength = 0
  let found
  while ((found = meantPattern.exec(afterRetraction))) {
    meantIndex = found.index
    meantLength = found[0].length
  }
  if (meantIndex === -1) {
    return false
  }
  const beforeMeant = afterRetraction.slice(0, meantIndex)
  const correctionContext = afterRetraction.slice(0, meantIndex + meantLength)
  const sentenceStart = lastCorrectionSentenceStart(correctionContext, meantIndex)
  if (sentenceStart === -1) {
    return true
  }
  return isFreshRetractionBridge(beforeMeant.slice(sentenceStart))
}
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
// review finding, and two self-caught regressions while fixing it, found
// by round 5's own follow-up adversarial review):
//
// Attempt 1 (superseded): swap CAUSATIVE_IMPERATIVE_PATTERN for
// CAUSATIVE_IMPERATIVE_SHAPE_PATTERN (no trailing-continuation
// requirement) in this shared function, unconditionally. Fixed "Have
// Alpha become the focus -- no wait, I meant Beta" (previously wrongly
// refused) but reopened the P1-closure round-6 disclosed residual
// ("Have API Docs become the project we focus on yet", no "?", wrongly
// became a directive) for EVERY caller, not just correction.
//
// Attempt 2 (superseded): scope the SHAPE-only relaxation to
// verifiedCorrectionTarget alone, via a causativeImperativePattern
// parameter this function tests with `.test(trimmed)`. This assumed the
// relaxation was safe there because correctedSwitchTarget only ever
// returns non-null given a real "I meant X" anchor -- true, but the
// SHAPE pattern itself ignores ALL trailing content after "the
// project"/"the focus", not just a correction suffix. So "Have Alpha be
// the focus OF THE QUARTERLY REPORT -- no wait, I meant Beta" (an
// instruction about a report's subject, not Command focus) and "Have API
// Docs become the project we focus on yet -- no wait, I meant Release
// Notes" (the disclosed residual PLUS an unrelated correction) both
// wrongly resolved and moved focus -- exactly the P1-closure round-6
// danger this function exists to guard against, just reintroduced via a
// different entry point.
//
// This version (round 5, final): the causative-imperative check is now a
// PREDICATE FUNCTION over the trimmed message, not a bare RegExp. The
// default (used by isGuardedAgainst/isExplicitSwitchMessage/
// isGoBackMessage, unchanged from before round 5) tests the FULL,
// trailing-continuation-requiring CAUSATIVE_IMPERATIVE_PATTERN, exactly
// as conservative as ever. verifiedCorrectionTarget below passes
// hasSafeCausativeImperativeCorrectionShape instead: the SHAPE match is
// only trusted when what comes right after it is EITHER message-end OR a
// retraction marker beginning IMMEDIATELY there (only whitespace/
// punctuation in between, never an intervening clause) -- so "of the
// quarterly report -- no wait, I meant Beta" and "we focus on yet -- no
// wait, I meant Release Notes" both correctly stay unsafe (the retraction
// marker is present in the tail, but not immediately adjacent to the
// shape match), while "-- no wait, I meant Beta" directly after "the
// focus" stays correctly safe.
//
// Also fixes a separate, pre-existing (not introduced by this commit)
// real gap the same round-5 follow-up review found: the
// SUBJECT_INVERSION_QUESTION_OPENER guard's own polite-request exemption
// only covered POLITE_SWITCH_REQUEST_PATTERN's verb list and
// CAUSATIVE_TRIGGER_PATTERN (make/set), never the "have" causative
// pattern -- "Could you have Alpha become the focus -- no wait, I meant
// Beta" tripped this guard before ever reaching the causative-imperative
// exception below it, and stayed wrongly refused. The SAME
// causativeException predicate now exempts this guard too, exactly
// mirroring how CAUSATIVE_TRIGGER_PATTERN already does for make/set.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 6 (real Codex adversarial-
// review finding, superseded by round 7 below): NEGATION_GUARD_PATTERN
// had no exemption at all -- "never" is both part of its own vocabulary
// AND part of RETRACTION_MARKER_PATTERN's "never mind" retraction
// phrase, so "Have Alpha become the focus -- never mind, I meant Beta"
// (a genuine, immediately-adjacent correction) still tripped this
// separate, unconditional branch and stayed wrongly refused. Round 6's
// own fix exempted the WHOLE guard via causativeException, the same way
// as the other two causative-aware branches.
//
// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 7 (real Codex adversarial-
// review finding): that blanket exemption was unsafe -- unlike
// SUBJECT_INVERSION_QUESTION_OPENER/NAMED_SUBJECT_QUESTION_PATTERN
// (both anchored to how the message OPENS, so a prefix-shape validation
// is the right kind of exemption for them), NEGATION_GUARD_PATTERN
// searches the WHOLE, unanchored message. Exempting it entirely
// whenever the OPENING validated as a safe causative correction also
// hid a completely independent, later negation: "Have Alpha become the
// focus -- no wait, I meant Beta, but don't switch yet." wrongly
// resolved and could move focus, even though "don't switch yet" is a
// real, separate prohibition the guard exists to catch. The fix is
// narrower and doesn't need causativeException at all here: strip out
// just the RETRACTION_MARKER_PATTERN text itself (e.g. "never mind")
// before testing for negation, so the "never" that's part of a
// retraction phrase never reaches the negation test, while any
// OTHER, independent negation elsewhere in the message (like "don't
// switch yet") still does.
function isGuardedByNonRetraction(
  message,
  hasCausativeImperativeException = (trimmed) => CAUSATIVE_IMPERATIVE_PATTERN.test(trimmed)
) {
  const trimmed = message.trim()
  const causativeException = hasCausativeImperativeException(trimmed)
  const messageWithoutRetractionMarkers = message.replace(
    new RegExp(RETRACTION_MARKER_PATTERN.source, 'gi'),
    ' '
  )
  return (
    DELIBERATIVE_QUESTION_PATTERN.test(message) ||
    NEGATION_GUARD_PATTERN.test(messageWithoutRetractionMarkers) ||
    DELIBERATIVE_STATEMENT_OPENER.test(trimmed) ||
    COPULA_QUESTION_OPENER.test(trimmed) ||
    (!POLITE_SWITCH_REQUEST_PATTERN.test(trimmed) &&
      !CAUSATIVE_TRIGGER_PATTERN.test(trimmed) &&
      !causativeException &&
      SUBJECT_INVERSION_QUESTION_OPENER.test(trimmed)) ||
    ((!causativeException || trimmed.includes('?')) &&
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
// review finding, three more real bugs, plus two more from that same
// round's own follow-up adversarial pass): (1) the match boundary's
// hyphen exclusion made ANY hyphen name-continuing, including "--" used
// as ordinary sentence-pause punctuation elsewhere in this exact file
// ("I meant Alpha--that's the one" wrongly refused to match "Alpha") --
// a SINGLE hyphen not followed by another hyphen still continues a name
// (the genuine "Alpha-Two" case), but "--" (or more) no longer does,
// matching how this file's own retraction/trailing-continuation patterns
// already treat "--" as punctuation, not name text. (2) "and/or" wasn't
// recognized as a conjunction at all, so "I meant Beta and/or Gamma"
// wrongly resolved to Beta alone; added as an explicit alternative, and
// (follow-up pass) tolerant of internal spacing ("and / or", "and/ or")
// the same way real typed/spoken input naturally varies. (3) "I meant
// Well" (where "Well" is itself the intended, real corrected name)
// always had "Well" stripped as a disfluency first, even with nothing
// left over to disambiguate it from -- now tried WITHOUT any disfluency-
// stripping first, and only falls back to the disfluency-stripped
// interpretation if the literal, unstripped text doesn't already resolve
// to a real candidate; this also fixes "I meant Well-known" the same
// way. "er" added to the recognized disfluency list, and (follow-up
// pass) ANY NUMBER of stacked disfluencies ("I meant well, uh, Beta")
// are now stripped, not just one -- see the strippedRest comment below.
//
// Disclosed, not fixed (real Codex review findings, but genuinely
// unbounded to chase further, or a direct, irreducible trade-off against
// an already-fixed P0): a disfluency word that ALSO happens to be the
// exact name of a different real project ("I meant, like, Beta" where a
// project is literally named "Like") is irreducibly ambiguous without
// real semantic understanding -- resolves to the literal name match, the
// same defensible "prefer the literal reading" choice used for "Well"
// above. A possessive suffix on a real name ("I meant Alpha's project")
// is indistinguishable from a genuinely apostrophe'd compound name
// ("O'Brien") by this pattern -- both look identical to a bounded regex;
// refusing to guess (a false negative) is the safe direction this
// codebase is deliberately biased toward everywhere else. Ellipsis- or
// dash-joined conjunctions with no surrounding whitespace ("or...
// Gamma", "or—maybe—Gamma") remain unrecognized -- unusual typographic
// styles unlikely from real typed or voice input. A genuine compound
// name using TWO OR MORE literal hyphens ("Alpha--Two", vanishingly rare
// in practice) is indistinguishable from "--" used as ordinary sentence-
// pause punctuation (the fix in (1) above, itself a real P0) -- when
// only "Alpha" (not "Alpha--Two") is a real candidate, this now resolves
// to "Alpha" rather than refusing, the same direct trade-off already
// accepted for the single-hyphen "Alpha-Two" shape one directory up in
// this file's own history; treating "--" as punctuation is the far more
// common real case and the one a real P0 was already fixed for.
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
    `^(${alternation})${boundary}(?:\\s*,?\\s*(?:and\\s*\\/\\s*or|or|and)\\s+(?:\\S+\\s+){0,2}(${alternation})${boundary})?`,
    'iu'
  )
  const leadingStrip = message.slice(anchorEnd).match(/^[,\s]*/)[0]
  const rawRest = message.slice(anchorEnd + leadingStrip.length)
  // TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 5 (real Codex adversarial-
  // review finding, second follow-up pass, superseded by round 6 below):
  // only a SINGLE leading disfluency was ever stripped -- "I meant well,
  // uh, Beta" (two stacked, equally common fillers) left "uh, Beta"
  // behind, which never matches a bare "Beta" candidate.
  //
  // TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 6 (real Codex adversarial-
  // review finding): unconditionally stripping ALL repeating fillers in
  // one pass introduced a new regression -- "well"/"uh"/"um"/"er" are
  // BOTH the recognized filler vocabulary AND, per this function's own
  // literal-first design, potentially the real corrected name itself.
  // "I meant uh, Well" (only "Well" a real candidate) stripped "uh" AND
  // then "well" in the same pass, leaving nothing to match. Trying each
  // strip DEPTH in increasing order (0 strips, then 1, then 2, ...) and
  // taking the FIRST one that matches a real candidate generalizes the
  // existing literal-first preference to any number of leading fillers:
  // a real candidate is always matched before this ever strips it as a
  // filler too.
  let solo = null
  let restVariant = rawRest
  let restVariantOffset = anchorEnd + leadingStrip.length
  for (;;) {
    solo = restVariant.match(soloPattern)
    if (solo) {
      break
    }
    const stripped = CORRECTION_DISFLUENCY_PATTERN.exec(restVariant)
    if (!stripped) {
      break
    }
    restVariant = restVariant.slice(stripped[0].length)
    restVariantOffset += stripped[0].length
  }
  if (!solo || solo[2]) {
    return null
  }
  // TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 8 (real Codex adversarial-
  // review finding, P0): a correction that resolved cleanly could still
  // be retracted LATER in the same message with nothing to redeem it --
  // "switch to Alpha -- no wait, I meant Beta. Never mind." wrongly
  // resolved to Beta, ignoring the trailing "Never mind." that abandons
  // the whole thing. Reproduced with all 12 RETRACTION_MARKER_PATTERN
  // vocabulary words placed directly after the resolved name. This is
  // the ONE place that check can live for every caller of
  // correctedSwitchTarget, including the plain "switch to X" shape that
  // never goes through hasSafeCausativeImperativeCorrectionShape at all
  // -- a trailing retraction ANYWHERE after the resolved name refuses,
  // the same message-wide-not-clause-scoped bias this file's other
  // guards already use (a contrived, unrelated "never mind" about
  // something else much later in the same message would also refuse
  // here; a false negative, the safe direction this codebase prefers).
  if (RETRACTION_MARKER_PATTERN.test(message.slice(restVariantOffset + solo[0].length))) {
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
  if (isGuardedByNonRetraction(message, hasSafeCausativeImperativeCorrectionShape)) {
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
