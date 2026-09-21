// Planner Chat backend. Deterministic and project-state-grounded on purpose:
// no paid provider call is wired in without Tim's explicit authorization
// (money/paid API is a TIM_REQUIRED class per the decision model), so this
// answers from real recorded project state instead of inventing an LLM
// persona. The interface (classify + respond) is what a real PLANNER_DEEP
// route would sit behind later — the UI never hard-codes a vendor.
import { projectLiveWorkFeedState, describeLiveRunStatus } from '../domain/live-work-feed.mjs'
import { recentCheckpointTrail } from '../domain/keep-going.mjs'

// Command coverage check (spec Phase 12's explicit list: credentials, money,
// destructive actions, production, push/deploy/publication, consequential
// adoption): the delete-only pattern below was real-verified to be too
// narrow for "destructive actions" generally -- broadened to the same
// verb+target shape plus a couple of standalone destructive command forms,
// still gated by the exact same clause-level inquiry/prohibition logic
// below (so "don't force push" and "should I hard reset?" stay
// non-TIM_REQUIRED, same as "delete the repo" already was). "Source/data
// admission" and "major product direction" (also named in Phase 12) have no
// grounded, real vocabulary anywhere in this codebase to pattern-match
// safely (checked domain/onboarding.mjs directly) -- adding a speculative
// regex for either risks exactly the false-positive/false-negative problem
// this file's own header already warns against; left as a disclosed gap
// rather than a guessed pattern.
const TIM_REQUIRED_PATTERNS = [
  /\b(push|merge|deploy|publish|release to prod|production)\b/i,
  /\b(pay|payment|paid api|credit card|subscription|billing)\b/i,
  /\b(credential|secret|api key|password|token)\b/i,
  /\b(delete|drop|wipe|destroy) (the )?(repo|repository|branch|database|data|production)\b|\bforce[- ]push\b|\bhard reset\b|\brm -rf\b/i,
  /\b(adopt|approve).*(candidate|this)\b/i
]

// Real Planner Chat authority false positive (V1 stabilization finding): a
// bare keyword match against the WHOLE message forced TIM_REQUIRED even
// when Tim was asking ABOUT a consequential action (a read-only readiness
// question) or explicitly PROHIBITING it — not requesting it. Real
// reproduction: "...asked for an evidence-backed readiness assessment...
// even after the prompt explicitly prohibited: ... push/merge/deploy;
// credentials/money; destructive actions" was refused entirely, even
// though every consequential keyword in it was there to rule the action
// OUT, never to request it. Each match is now judged against its own
// clause: a clause that's a genuine inquiry (a question, or opens with an
// interrogative/hedging phrase) or an explicit prohibition (negated) does
// not, by itself, force TIM_REQUIRED — an unhedged, non-negated directive
// ("deploy it", "push this now") still does. "tell me whether to deploy"
// (inquiry) and "deploy it" (directive) must not classify identically.
// Split into two: BARE_OPENER alone is ambiguous -- a clause created purely
// by "and"-splitting a bare, no-punctuation directive ("...and will deploy
// after that", "...and should merge soon") also starts with an opener word,
// simply because that's how English states a future-tense action without a
// subject pronoun. It is gated on a real "?" existing somewhere in the
// clause's own sentence below (never on the clause alone -- a sibling
// clause's own directive must never borrow another clause's "?"). TELL_ME_
// WHETHER's "tell me/explain/assess ... whether" shape is unambiguously
// interrogative in structure regardless of punctuation, so it stays
// unconditional.
const BARE_OPENER = /^\s*(?:is|are|was|would|will|should|could|can|what|why|when|whether|how)\b/i
// DIRECTIVE SEMANTICS CLOSURE V1 (P0, real Codex adversarial-review
// finding): this previously required the literal word "whether" and only
// recognized 5 verbs -- "can you tell me IF we should pause it" (uses
// "if", not "whether") and "could you advise whether/can you check
// whether/will you say whether we should pause it" (advise/check/say
// aren't in the verb list) all fell through to POLITE_REQUEST_MARKER's
// own unconditional "can/could/would/will you" -> true, reaching a real
// PAUSE. "if" added alongside "whether" as an equally genuine information-
// request marker (still requires one of these verbs present too, so a
// genuine conditional directive like "deploy it if the tests pass" is
// unaffected -- no verb from this list appears there).
// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (P0, real Codex adversarial-
// review finding): "confirm"/"verify"/"find out" are the same genuine
// information-request verb family -- "could you confirm if we should
// pause NWR"/"can you verify whether..."/"will you find out if..." all
// still fell through to POLITE_REQUEST_MARKER -> true.
const TELL_ME_WHETHER =
  /\b(?:tell me|let me know|explain|assess|evaluate|prepare|recommend|advise|check|say|suggest|confirm|verify|find out)\b[\s\S]*\b(?:whether|if)\b/i
// DIRECTIVE SEMANTICS CLOSURE V1 (P0, real Codex adversarial-review
// finding): isGenuineDirective had ZERO reported-speech awareness --
// unlike domain/command-act-model.mjs's own separate, span-based
// provenance system (which command-act-model.mjs's OWN decomposition
// already excludes reported speech from), this function's clause/sentence
// shape has no position tracking, so "Claude suggested we pause it" /
// "The report recommends you pause it" reached a real PAUSE via this
// function's own `return true` default. A simple whole-clause check
// (not position-aware, unlike the span-based version) is the correct
// granularity here -- this function already judges one clause at a time.
// Same reporting-verb vocabulary as command-act-model-provenance.mjs's own
// REPORTED_SPEECH_OPENER (kept independently, not imported: that module is
// domain-layer and position/span-based, a different shape entirely from
// this server-layer, clause-string-based check -- see that file's own
// disclosed exclusion of "mentioned"/"noted", deliberately not repeated
// here either, for the identical reason).
// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (P0, real Codex adversarial-
// review finding): "My manager asked me to pause NWR"/"Tim told me to
// pause NWR" both still returned true -- neither "my manager"/"tim" (a
// real subject relaying someone else's instruction) nor "asked ... to"/
// "told ... to" (an equally unambiguous reporting-verb shape) were
// covered. "the team" added as a subject too, narrowly paired with these
// same two verbs (never with a bare declarative verb, to avoid ever
// matching "the team should pause NWR" -- genuine advice, not reported
// speech).
export const REPORTED_SPEECH_MARKER =
  /\b(?:i|you|claude|my\s+manager|tim|the\s+(?:plan|assistant|report|team))\s+(?:said|says|reported|reports|suggested|suggests|recommends?|recommended|advises?|advised|instructs?|instructed|calls?\s+for|called\s+for|asked(?:\s+\w+)?\s+to|told(?:\s+\w+)?\s+to)\b/i
// DIRECTIVE SEMANTICS CLOSURE V1 (P0, real Codex adversarial-review
// finding): a retraction/correction marker ANYWHERE in a whole message,
// for the classifiers below that (unlike domain/command-act-model.mjs's
// own span-based provenance system) judge one flat message/clause string
// with no position tracking -- "Pause NWR -- forget it"/"...disregard
// that"/"...strike that"/"...I take that back"/"...no wait" all reached a
// real mutation via server/command-run-action-bridge.mjs's own,
// completely separate classifyRunActionVerb (which command-act-model.mjs's
// own newly-fixed retraction handling never reaches for an ordinary
// single-project message -- command-responder.mjs's single-project path
// uses classifyRunActionVerb directly, not the multi-action decomposer).
// Exported for that file (and the Needs-You-answer/focus-switch/paid-
// grant classifiers, which have the identical architecture) to reuse
// rather than each maintaining an independent copy.
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 2 (real Codex
// adversarial-review finding): "wait, no" (reversed word order from the
// existing "no wait"), "actually, no", and "leave it unchanged"/"leave it
// as is"/"keep it as is" were real retraction phrasings this pattern
// didn't cover yet -- found via command-conversation-focus.mjs's new
// causative-imperative triggers, which (unlike this file's older trigger
// phrasings) are common enough to naturally invite a quick spoken
// correction right after them.
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 3 (now superseded, see
// round 4 below): the naive "wait, no" addition above overmatched --
// "Please wait no longer.", "We can wait no more." both wrongly read as
// retractions (a plain \b after "no" is satisfied by the following space,
// same as it would be before "longer"/"more"). A negative lookahead
// excluding "longer"/"more" fixed those two cases, but a real Codex
// review found the same overmatch under different continuation words
// ("wait no further", "wait, no one else is coming", "actually, no more
// waiting" -- the last one because the lookahead was only ever added to
// the "wait, no" alternative, never to "actually, no").
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 4 (now superseded, see
// round 5 below): a word-by-word blocklist can never be complete --
// there's an unbounded set of words that can follow "wait, no"/
// "actually, no" without it being a retraction ("further", "one",
// "problem", "doubt", ...). The real, structural difference is what
// FOLLOWS "no": a genuine retraction is followed by a pause; a continuing
// clause ("no longer", "no one else...") is followed directly by more
// words with just a space. Requiring "no" to be followed IMMEDIATELY by
// punctuation or the end of the message replaced the blocklist with that
// rule -- but a real Codex review found it too strict in the other
// direction: "Wait, no -- reconsider." (a SPACE before the dash, the
// conventional way to type this) and "Switch to NWR (wait, no)" (a
// closing paren) both wrongly failed to match, since the lookahead
// required punctuation immediately after "no" with no space allowed.
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 5 (real Codex
// adversarial-review finding): the fix isn't "require punctuation right
// after no" OR "allow whitespace then anything" (the latter reopens
// "wait, no one else..." via the space before "one"). It's two separate
// rules for two separate typing conventions: (1) with a space before it,
// ANY punctuation (including a single "-") is a real pause -- nobody
// types "no -one" as a hyphenated word; (2) with NO space (punctuation
// touching "no" directly), a single "-" is ambiguous with a hyphenated
// continuation word ("no-one", "no-good") and is excluded, but a genuine
// terminal mark, a double-dash "--", an em dash, or an ellipsis is not
// (nobody hyphenates "one" as "no--one" or "no…one"). This closes the
// spaced-dash/parenthetical gap without reopening "no-one".
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 6 (real Codex
// adversarial-review finding): round 5's punctuation set was an
// incomplete allowlist, not the "any punctuation" it was meant to be --
// an en dash ("–", U+2013, distinct from the em dash "—" already
// covered) and an opening parenthesis were both missing, so "Wait, no –
// reconsider." and "Switch to NWR (wait, no)" still wrongly failed to
// retract. Both added to the spaced and (where unambiguous, i.e. the en
// dash) unspaced punctuation sets.
//
// DIRECTIVE SEMANTICS CLOSURE V1, P1 closure round 7 (real Codex
// adversarial-review finding): round 6's additions each overmatched a
// real, unrelated English construction:
// (1) an unconditional opening paren ANYWHERE after "no" mistook an
//     ordinary parenthetical aside for a retraction -- "Actually, no
//     (new) blockers remain; switch to NWR." wrongly retracted the LATER
//     real "switch to NWR" instruction, even though "no (new) blockers"
//     is a plain negative-quantifier sentence, not a retraction at all.
//     The genuine "no (SHORT ASIDE)" retraction shape ("Wait, no
//     (reconsider).") is only ever safely distinguishable from this by
//     requiring the WHOLE parenthetical to reach the actual end of the
//     message -- exactly the same "does it reach the end, or does more
//     unrelated content follow" structural test this file's own
//     CAUSATIVE_TRAILING_CONTINUATION already uses. A bare "(" is
//     removed from the general spaced/unspaced sets and replaced with
//     this one, narrowly-scoped, end-anchored alternative.
// (2) an unconditional unspaced en dash reopened the exact "no-one"-style
//     hyphenated-compound-word collision the ASCII-hyphen exclusion was
//     designed to prevent, just spelled with an en dash instead ("Wait,
//     no–one objected..."). The unspaced en dash is removed; a SPACED en
//     dash (nobody hyphenates a compound word with a space before it)
//     remains accepted via the existing spaced-punctuation rule.
export const RETRACTION_MARKER_PATTERN =
  /\b(?:never\s*mind|scratch\s+that|forget\s+it|disregard\s+that|strike\s+that|take\s+that\s+back|no\s+wait|(?:wait\s*,?\s*no|actually,?\s*no)(?=\s+[.,!?;:)\-–—]|\s*(?:[.,!?;:)]|--+|—|…|\.\.\.)|\s*\([^)]*\)[.!]?\s*$|\s*$)|cancel\s+that|leave\s+it\s+(?:unchanged|as\s+is|alone)|keep\s+it\s+(?:unchanged|as\s+is))\b/i
// DIRECTIVE SEMANTICS CLOSURE V1, round 2 (P0, real Codex adversarial-
// review finding): DELIBERATIVE_STATEMENT_OPENER is message/clause-START
// anchored, so a hedge phrased mid-sentence ("We may want to switch to
// NWR", "As for NWR I think we should switch to it") or with different
// vocabulary than its own bounded opener list ("It seems like we should
// focus on NWR", "My hunch is we should talk about NWR", "If it were up
// to me we'd switch to NWR", "We should probably discuss NWR") evaded it
// entirely on server/command-needs-you-answer-bridge.mjs and domain/
// command-conversation-focus.mjs (both whole-message classifiers with no
// clause-splitting of their own, unlike isGenuineDirective below). A
// small, disclosed, bounded set of the specific hedge shapes actually
// demonstrated to reach a real mutation -- same "narrow, easily-audited
// list, not a general hedge parser" discipline as DELIBERATIVE_STATEMENT_
// OPENER itself.
export const MID_SENTENCE_HEDGE_MARKER =
  /\bmay want to\b|\bit seems(?:\s+like)?\b|\bmy hunch\b|\bif it were up to me\b|\bshould probably\b|\bi think we should\b/i
// Fuzzing finding (Full Conversational Control Plane Exhaustive Gauntlet
// V1, Batch 5): the hand-picked negator list here had the exact same
// "-n't" contraction-family gap as domain/command-adoption-execution.mjs's
// ADOPTION_NEGATION_PATTERN and domain/command-multi-action-
// decomposition.mjs's NEGATION_TRIGGER_SOURCE (found in the same pass) --
// missing doesn't/didn't/hasn't/haven't/hadn't/wasn't/weren't/mustn't/
// mightn't/needn't/ain't. Lower severity here since PROHIBITION_MARKERS
// only ever narrows isGenuineDirective toward false (non-consequential),
// so a missed negator biases toward the safe direction (TIM_REQUIRED),
// never toward a false auto-execute -- fixed anyway for defense-in-depth
// and so all three negation checks in this codebase share one vocabulary
// instead of three independently-drifting ones. Also adds the archaic/
// dialectal forms (shan't/oughtn't/daren't/amn't) found in the same
// adversarial-review pass that caught this file's sibling copies still
// missing curly/"smart"-quote (U+2019) tolerance -- this file's own
// pattern already had that (see won'?t/can'?t below), the gap here was
// only ever vocabulary breadth, never quote style.
const NOT_CONTRACTION_SOURCE =
  "(?:do|does|did|is|are|was|were|has|have|had|would|should|could|must|might|need|ai|sha|ought|dare|am)n['’]?t"
const PROHIBITION_MARKERS = new RegExp(
  `\\b(?:no|not|never|do not|${NOT_CONTRACTION_SOURCE}|won['’]?t|without|can['’]?t|cannot|none of)\\b`,
  'i'
)
// Second-independent-verification-pass finding (real, reproduced, pre-
// existing -- surfaced while re-checking the "and" clause-split fix,
// unrelated to it): PROHIBITION_MARKERS matches a bare "not"/"no" anywhere
// in a clause with no idiom awareness -- "whether ... or not" and "no
// matter" are standard English idioms that mean "regardless," never a
// negation of the directive they attach to, but the same clause's own
// "not"/"no" wrongly suppressed a genuine, unhedged directive: "deploy it
// whether tim likes it or not" / "push this to production whether you
// approve or not" / "deploy this no matter what" all classified AUTO_DECIDE
// instead of TIM_REQUIRED. Stripped before the prohibition test, not added
// as a separate branch, so a clause whose ONLY negation-looking text is one
// of these idioms correctly falls through to the real directive check.
// "not only" added alongside the existing idioms (DIRECTIVE SEMANTICS
// CLOSURE V1, P1, real Codex adversarial-review finding) -- same fix
// applied to domain/command-act-model.mjs's own independent copy.
const IDIOMATIC_NON_NEGATION = /\bor not\b|\bno matter\b|\bnot only\b/gi
// "Can/could/would/will YOU ...?" is English's own standard polite-request
// form ("can you push this to production?" means "please push this"), not
// a genuine inquiry about the action's safety/advisability — independent-
// review-equivalent regression found: it must stay a directive even though
// it's phrased as a question and opens with a modal verb otherwise treated
// as an inquiry opener. Checked first so it always wins over the "?"/
// opener rules below.
const POLITE_REQUEST_MARKER = /\b(?:can|could|would|will)\s+you\b/i
// REAL DOGFOOD FINDING (post-mission, P0, same bug class already fixed in
// server/command-run-action-bridge.mjs's classifyRunActionVerb and
// domain/command-conversation-focus.mjs's isExplicitSwitchMessage/
// isGoBackMessage): every guard above requires either a genuine "?" or an
// explicit negation -- a musing STATEMENT phrased as neither ("Maybe we
// should pause NWR", "I guess we should put NWR on hold") fell through
// every check to the final `return true`. Live-confirmed end to end via
// domain/command-act-model.mjs's own finalIntentFor (this function's real
// consumer for PAUSE/RESUME/EXTERNAL_WORK_HOLD/RELEASE_HOLD/KEEP_GOING/
// ASSESS): "Maybe we should pause NWR" decomposed to a real, mutating
// PAUSE intent, identical to the unambiguous "Pause NWR". Clause-scoped
// (same convention as BARE_OPENER/TELL_ME_WHETHER below -- a musing
// opener is a per-clause phenomenon, never borrowed from a sibling
// clause) and checked early, alongside TELL_ME_WHETHER, so it wins even
// over a polite "you" marker later in the same musing sentence ("I
// wonder if you could pause NWR" reads as genuine uncertainty, not a real
// request, matching this file's own stated bias toward a false NEGATIVE
// over a false POSITIVE).
// DIRECTIVE SEMANTICS CLOSURE V1: exported so it's the ONE canonical
// musing/deliberative-opener vocabulary every consequential classifier in
// this codebase shares, instead of the 3 independently-maintained copies
// that already existed before this pass (server/command-run-action-
// bridge.mjs's classifyRunActionVerb, domain/command-conversation-focus.mjs's
// isExplicitSwitchMessage/isGoBackMessage, and this function itself) --
// same reasoning already applied to PROHIBITION_MARKERS/
// NOT_CONTRACTION_SOURCE's own negation vocabulary above ("so all three
// negation checks in this codebase share one vocabulary instead of three
// independently-drifting ones").
export const DELIBERATIVE_STATEMENT_OPENER =
  /^(?:i wonder if|i'?m not sure if|i am not sure if|i don'?t know if|i guess|i think|maybe|perhaps|possibly)\b/i
// See the SUBJECT_INVERSION_QUESTION_OPENER call site (below, inside
// isGenuineDirective) for why this exists and what it fixes. Split into
// two tiers by how safely each can be recognized without a "?":
// COPULA_QUESTION_OPENER (is/are/was/were) is unconditional -- English
// structurally cannot form an imperative directive starting with a bare
// copula ("Is deploy the app" is not a valid command in any register), so
// there is no possible false-positive direction to guard against, unlike
// the modal openers below. Real gap this closes: VERB_REGISTRY's own
// PAUSE entry (domain/command-act-model.mjs) matches "pause\w*", which
// matches "paused" too -- "is nwr paused" (spoken, no punctuation)
// reached this function as a bare clause with no recognized pronoun
// subject and fell through to `return true` before this addition.
// Exported alongside SUBJECT_INVERSION_QUESTION_OPENER: domain/command-
// conversation-focus.mjs's own DELIBERATIVE_QUESTION_PATTERN had the exact
// same "?"-required gap for focus-switch phrasing ("should we switch to
// NWR", spoken, no punctuation) -- same fix, same shared constants.
export const COPULA_QUESTION_OPENER = /^\s*(?:is|are|was|were)\b/i
// The remaining modal auxiliaries (do/does/did/should/could/would/can/
// will/may/might/has/have/had) CAN legitimately open a subjectless,
// elided-subject directive continuation from an "and"-split (the BUG-08
// danger case, "...and will deploy after that") -- unlike the copula
// above, these are safe to treat as a punctuation-free question ONLY when
// immediately followed by an actual subject pronoun (never bare).
export const SUBJECT_INVERSION_QUESTION_OPENER =
  /^\s*(?:do|does|did|should|could|would|can|will|may|might|has|have|had)\s+(?:i|we|you|it|this|that|they|he|she)\b/i

// Independent-review finding (dangerous-direction regression, caught before
// adoption): splitting only on `.!?;\n` let an inquiry/prohibition earlier
// in a comma- or "but"/em-dash-joined RUN-ON sentence exempt a genuine,
// unrelated directive later in the SAME loose clause — e.g. "how do I check
// status, and go ahead and delete the repo" wrongly waved a real destructive
// delete through as AUTO_DECIDE, because the leading "how" opener covered
// the whole sentence. Normalizing these coordinating joins into hard clause
// boundaries first (so each independent thought is judged on its own) closes
// that gap: "no rush, but please merge this to main" now correctly separates
// the hedge from the actual directive instead of letting "no" (30+ characters
// away) suppress it.
function splitIntoSentences(message) {
  return message.split(/(?<=[.!?;\n])/)
}

// Comma/"but"/em-dash/"and" normalization happens WITHIN a sentence, one
// level below the sentence split — kept separate so the polite-request
// check below can look at the whole sentence a clause came from, not just
// the clause fragment itself.
//
// BUG-08 (bug-ledger.json): real, reproduced gap -- "and" was not a clause
// boundary here, so a negation and a genuine, separate directive joined by
// a bare "and" (no comma) stayed one clause, and PROHIBITION_MARKERS
// matching anywhere in that whole clause silently suppressed the real
// directive too: "do not deploy this and push it now" classified
// AUTO_DECIDE; "please do not deploy and go ahead and merge this"
// classified RECOMMEND_AND_PROCEED. Same class of dangerous-direction
// regression as the comma/"but"/em-dash fix above, just not extended to
// "and" — closing it the same way, by the same reasoning.
function splitIntoClauses(sentence) {
  return sentence.replace(/,|--|—|\bbut\b|\band\b/gi, '.').split(/(?<=[.!?;\n])/)
}

// Independent-review finding (dangerous-direction regression, caught before
// adoption, 2nd pass): checking POLITE_REQUEST_MARKER against the clause
// alone let a mid-sentence interjection ("Can you, if you have a moment,
// push this to production?") split the "can you" clause away from the
// verb+keyword clause, so the verb clause was judged on its own trailing
// "?" and misread as a bare inquiry. The marker is judged against the
// whole SENTENCE the clause came from instead — "can/could/would/will you"
// anywhere in the same sentence still means the same request, however many
// commas interrupt it — while sentence-level (not whole-message) scope
// keeps an unrelated later sentence's own prohibition ("Also, don't push to
// production.") from being swept up by an earlier sentence's polite marker.
// TSF UI FINDINGS #2-#16 CLOSURE, Gate 2: exported so domain/command-act-
// model.mjs's multi-action decomposer can reuse this SAME judgment for its
// own generic-verb acts (hold/pause/resume/keep-going/assess) -- see that
// file's own call site for why. Unchanged behavior for every existing
// caller in this file.
export function isGenuineDirective(clause, sentence) {
  // TSF UI FINDINGS #2-#16 CLOSURE, Gate 1 (real Codex adversarial-review
  // finding, independently reproduced): TELL_ME_WHETHER must be checked
  // BEFORE POLITE_REQUEST_MARKER, not after -- "Could you tell me whether
  // I should pause X?" previously matched POLITE_REQUEST_MARKER's own
  // "could you" first and returned true immediately, never reaching the
  // TELL_ME_WHETHER check below at all. "Can/could/would/will you TELL ME
  // WHETHER ..." is unambiguously an information request regardless of its
  // polite modal verb -- pre-existing in this file (affected
  // isConsequentialDirective's own TIM_REQUIRED gating too, harmlessly
  // there since a wrongly-TIM_REQUIRED inquiry still only asks for
  // confirmation), but newly reachable as a REAL mutation trigger via
  // command-act-model.mjs's own reuse of this function (finalIntentFor),
  // where the same false positive would have actually executed PAUSE/
  // EXTERNAL_WORK_HOLD/etc. from a bare question.
  if (TELL_ME_WHETHER.test(clause)) {
    return false
  }
  if (DELIBERATIVE_STATEMENT_OPENER.test(clause.trimStart())) {
    return false
  }
  if (REPORTED_SPEECH_MARKER.test(clause)) {
    return false
  }
  if (POLITE_REQUEST_MARKER.test(sentence)) {
    return true
  }
  if (/\?/.test(clause)) {
    return false
  }
  // DIRECTIVE SEMANTICS CLOSURE V1 (P0, real, voice-critical): every check
  // above (and BARE_OPENER just below) ultimately requires a literal "?"
  // somewhere -- but a real voice transcript (Web Speech API and similar)
  // routinely contains NO punctuation at all. "should we resume tsf"/"is
  // nwr paused"/"did you pause it" fell through every guard to the final
  // `return true`, live-confirmed via command-act-model.mjs's real
  // decomposition path exactly like the DELIBERATIVE_STATEMENT_OPENER gap
  // above. Fixed with the one unambiguous, punctuation-independent signal
  // of a genuine question in English: subject-AUXILIARY INVERSION -- the
  // opener is immediately followed by a subject pronoun (is/are/was/were/
  // do/does/did/should/could/would/can/will/may/might/has/have/had + i/we/
  // you/it/this/that/they/he/she). This is deliberately narrower than
  // BARE_OPENER below (which also fires on "why"/"what"/"when"/"how" with
  // no pronoun requirement, but only when a "?" exists elsewhere in the
  // sentence): a declarative, subject-elided directive fragment from an
  // "and"-split ("...and will deploy after that", the exact BUG-08 danger
  // case just above) is NEVER followed by one of these pronouns -- "will"
  // is followed by the verb "deploy", not "we"/"it"/etc -- so this can
  // never reintroduce that regression. Checked unconditionally (no "?"
  // dependency at all), same clause-scoped, punctuation-independent
  // discipline as DELIBERATIVE_STATEMENT_OPENER above.
  if (
    COPULA_QUESTION_OPENER.test(clause.trimStart()) ||
    SUBJECT_INVERSION_QUESTION_OPENER.test(clause.trimStart())
  ) {
    return false
  }
  // BUG-08 independent-verification finding (real, reproduced): a bare
  // opener word alone must additionally require the clause's own sentence
  // to actually contain a "?" -- without this, "and"-splitting a message
  // like "run the tests and will deploy after that" isolates "will deploy
  // after that" as its own clause, which starts with "will" and was being
  // misread as a genuine inquiry even though nothing here is a question at
  // all, silently waving a real deploy directive through as AUTO_DECIDE.
  if (BARE_OPENER.test(clause.trimStart()) && /\?/.test(sentence)) {
    return false
  }
  if (PROHIBITION_MARKERS.test(clause.replace(IDIOMATIC_NON_NEGATION, ''))) {
    return false
  }
  return true
}

// TSF UI FINDINGS #2-#16 CLOSURE, Gate 2: position-anchored variant for
// domain/command-act-model.mjs's own reuse. That module's own segment/
// clause boundaries (hardSegments) are the wrong input here for two real
// reasons, live-confirmed: (1) hardSegments STRIPS its own delimiter
// characters when forming a segment (a trailing "?" is structurally
// absent from segment.text), defeating this function's own "?" check --
// "Should I put X on hold?" produced a segment reading "Should I put X on
// hold" with no "?" at all; (2) hardSegments' own boundaries are coarser
// than a genuine clause break (comma/em-dash/"but"/"and" are NOT hard-
// segment breaks there), so "X ... leave it alone -- do not touch it."
// stayed one segment, wrongly letting trailing reinforcing text look like
// it negates an earlier, real directive. Re-splits on this file's own
// clause-boundary delimiter set instead, but WITHOUT splitIntoClauses' own
// comma/dash-to-period content substitution (which shrinks the string and
// would break position alignment) -- a pure lookbehind split, so every
// piece stays a genuine, unmutated substring of the original message.
function splitIntoClausesPreservingOffsets(sentence) {
  return sentence.split(/(?<=,|--|—|\bbut\b|\band\b|[.!?;\n])/gi)
}

export function isGenuineDirectiveAt(message, position) {
  let offset = 0
  for (const sentence of splitIntoSentences(message)) {
    const sentenceEnd = offset + sentence.length
    if (position >= offset && position < sentenceEnd) {
      let clauseOffset = offset
      for (const clause of splitIntoClausesPreservingOffsets(sentence)) {
        const clauseEnd = clauseOffset + clause.length
        if (position >= clauseOffset && position < clauseEnd) {
          return isGenuineDirective(clause, sentence)
        }
        clauseOffset = clauseEnd
      }
    }
    offset = sentenceEnd
  }
  // position outside every real sentence span (should not happen for a
  // real in-bounds verb-anchor position) -- default to the whole message
  // as both clause and sentence rather than silently skipping the check.
  return isGenuineDirective(message, message)
}

// TSF UI FINDINGS #2-#16, Finding #4: generalized out of isConsequentialDirective
// below (unchanged behavior there) so command-responder.mjs's own action-shaped-
// ambiguity fallback can reuse the exact same genuine-directive judgment
// (never a question, never negated/hedged, never merely quoted) against its
// own bounded verb vocabulary -- never a second parser.
export function messageContainsGenuineDirectiveFor(message, verbPatterns) {
  const patterns = Array.isArray(verbPatterns) ? verbPatterns : [verbPatterns]
  for (const sentence of splitIntoSentences(message)) {
    for (const clause of splitIntoClauses(sentence)) {
      if (
        patterns.some((pattern) => pattern.test(clause)) &&
        isGenuineDirective(clause, sentence)
      ) {
        return true
      }
    }
  }
  return false
}

function isConsequentialDirective(message) {
  return messageContainsGenuineDirectiveFor(message, TIM_REQUIRED_PATTERNS)
}

// See the ACKNOWLEDGEMENT entry in INTENTS below for the full rationale.
// Segment-based rather than one combined regex, since a real acknowledgement
// message often chains multiple shapes ("awesome! this is so great!" is a
// bare word THEN a praise-verb phrase) -- a single anchored alternation
// cannot express "the whole string is made of N independently-matching
// pieces" without this kind of decomposition.
// Adversarial-review finding: "amazing" was only recognized inside the
// praise-verb phrase ("this is amazing"), not as a bare word ("amazing" on
// its own fell through to GENERAL) -- the two word lists had silently
// diverged. Kept in sync now.
const ACK_WORD =
  '(?:awesome|great|perfect|nice|sweet|cool|sick|exactly|amazing|love it|hell yeah|thanks?|thank you|sounds good)'
const ACK_BARE_PATTERN = new RegExp(`^${ACK_WORD}(?:\\s+${ACK_WORD})*$`, 'i')
const ACK_EXACT_PHRASE_PATTERN = /^that'?s exactly what i (?:wanted|was looking for|needed)$/i
const ACK_PRAISE_VERB_PATTERN =
  /^[\w' -]{0,40}?\b(?:looks (?:good|great|awesome|perfect)|is (?:so )?(?:great|awesome|perfect|amazing))\b$/i
// Real emoji this fires on, kept separate from ACK_EMOJI_STRIP_PATTERN below
// (that one is used to remove emoji from a segment BEFORE word-matching, so
// it must match a bare emoji character, not require the whole segment).
const ACK_EMOJI_PATTERN = /^[👍🔥]+$/u
// Adversarial-review finding: "👍 thanks!" (emoji directly adjacent to a
// word, no punctuation between them) stayed one un-matchable segment --
// neither the bare-word list nor the whole-segment emoji pattern covers an
// emoji+word mix, so it fell through to GENERAL (the exact no-guardrail
// live-LLM path this fix exists to close) for an extremely natural way to
// type acknowledgement. Emoji are stripped from each segment before the
// word-shaped checks run, so "👍 thanks" and "thanks 👍" both reduce to
// "thanks" and match ACK_BARE_PATTERN the same way a punctuation-separated
// "👍! thanks!" already did.
const ACK_EMOJI_STRIP_PATTERN = /[👍🔥]/gu

function isAcknowledgementSegment(segment) {
  const withoutEmoji = segment.replace(ACK_EMOJI_STRIP_PATTERN, ' ').trim()
  if (!withoutEmoji) {
    // The segment WAS only emoji (already stripped to nothing) -- confirm
    // against the original so an empty-after-strip segment still counts.
    return ACK_EMOJI_PATTERN.test(segment)
  }
  return (
    ACK_BARE_PATTERN.test(withoutEmoji) ||
    ACK_EXACT_PHRASE_PATTERN.test(withoutEmoji) ||
    ACK_PRAISE_VERB_PATTERN.test(withoutEmoji)
  )
}

// Duck-typed like a RegExp (classifyIntent below only ever calls
// `pattern.test(message)`) -- a plain object is clearer here than forcing
// this decomposition through RegExp.prototype.test's single-string contract.
const ACKNOWLEDGEMENT_PATTERN = {
  test(message) {
    // Adversarial-review finding: ":" was not a segment delimiter
    // ("great; thanks" matched, "great: thanks" didn't) -- added alongside
    // the existing sentence-punctuation set.
    const segments = String(message)
      .split(/[!.,;:]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (segments.length === 0) {
      return false
    }
    return segments.every(isAcknowledgementSegment)
  }
}

// TSF REAL-PILOT READINESS -- FINAL P1 CLOSURE, Finding #22: the narrower
// subset of STATUS-shaped questions with a real, precise, canonical-fact
// answer (hold/pause/working/blocked state, "why is X waiting", "can TSF
// work on X", "what is X doing", "what's the status of X") -- these must
// ALWAYS ground in project.primaryState/primaryReasonLabel, whether or not
// a live Keep Going run exists (a run-less held project has a real,
// canonical hold fact too). Deliberately narrower than all of STATUS:
// the open-ended "what's going on/where are we/catch me up/what's running"
// phrasings keep their existing, unchanged, run-dependent behavior
// (isLiveRunRelevantFor) -- those are genuinely open-ended catch-up
// requests the live planner can still add real value to when no run
// exists, not the precise, binary-ish factual questions this pattern
// targets. Exported so chat-http-routes.mjs's own groundedResponseWorthy
// gate can reuse this EXACT pattern rather than re-deriving which STATUS
// sub-shape it is.
//
// The is/why/what-doing gaps are wide (.{0,80}?/.{1,80}?) because what
// precedes their predicate is the TARGET (a project name, which can be
// long AND multi-word -- see the 44-char real project name cited below,
// and real fleet projects with multi-word display names like "Weird
// Talent Marketplace"/"Colety Labs Sales Engine"). what-doing originally
// used \S+ (a single token) for that target, which missed every
// multi-word real project name -- found via the same audit that produced
// the 44-char single-token case, widened identically. The can-branch gap
// is different in kind: what precedes "work on" there is the CAPACITY
// QUESTION'S SUBJECT (who/what can do the work -- TSF, we, the fleet,
// someone), which is always a short, closed set of words, never an
// arbitrary verb phrase. A final Codex adversarial review (session
// 01a0abf8-3229-7132-a655-6abfb7098c35) found that reusing the wide
// .{0,80}? gap here let unrelated intervening verb phrases sneak in, e.g.
// "Can you fix the wording work on NWR?" (a genuine FIX_REQUEST)
// misclassified as STATUS purely because "work on" appeared somewhere in
// the following 80 characters. Enumerating the real subject vocabulary
// and requiring it immediately before "work on" closes this without
// reopening the same whack-a-mole the wide gap was meant to solve (that
// gap solves a different, real problem for the target-name branches).
//
// All three target-name gaps use [^.!?]{0,80}?/[^.!?]{1,80}?, not a bare
// `.`, because `.` also matches "." and "?" -- a bare `.{0,80}?` let the
// gap cross into a LATER, unrelated sentence and pick up a stray "doing"/
// "on hold"/etc there (e.g. "What is the deal with this feature? ... what
// is going on with the doing of tasks." matched purely because "doing"
// eventually appeared within 80 characters, in a different sentence
// entirely). Excluding sentence terminators keeps the target confined to
// the SAME sentence as its predicate, which is the only shape any of
// these questions ever legitimately take.
export const CANONICAL_STATUS_FACT_PATTERN =
  /\bstatus\b|(?:^|[.!?]\s+)(?:what(?:'?s| is) [^.!?]{1,80}? doing\b|is\s+[^.!?]{0,80}?\b(?:on hold|held|paused|working|active|blocked)\b|why\s+[^.!?]{0,80}?\b(?:waiting|on hold|paused|held|stuck|blocked)\b|can\s+(?:tsf|we|you|it|someone|anyone|anybody|i|the team|the fleet)\s+work on\b)/i

const INTENTS = [
  // Hands-Free Command + Project Manager V1: a routing signal only -- does
  // this message look like an owner answering an open Needs You/approval
  // item at all? Never a resolver itself (domain/command-needs-you-answer-
  // targeting.mjs owns which real item, if any, it actually targets).
  // Checked FIRST, before any broader pattern below could otherwise claim
  // an answer-shaped message (e.g. DISPATCH_REQUEST's own "go ahead"-style
  // phrasing). Deliberately conservative: requires an explicit "answer ...
  // question" framing, an explicit "yes, authorize/approve" (never a bare
  // "yes" alone -- too common a word to trust on its own, same discipline
  // command-responder.mjs's own BACK_REFERENCE_PATTERN already applies), or
  // an explicit "option <word/number>" reference.
  {
    id: 'NEEDS_YOU_ANSWER',
    pattern:
      /\banswer (the )?[\s\S]*?question\b|\byes,?\s*(authorize|approve) it\b|\boption\s*(one|two|three|four|five|\d+)\b/i
  },
  {
    id: 'STATUS',
    // "what is it doing?" is Tim's own exact north-star follow-up phrasing
    // (M3 requirements) -- must be recognized, not fall through to GENERAL.
    // "what's running (right now)?" is Command's own exact phrasing (spec
    // Phase 7) -- a real gap found live: it did not match any pattern here
    // and fell through to a "couldn't tell which project" reply even for a
    // deliberately project-less, fleet-wide question.
    // Phase 7 dogfood finding: "what's" above required an apostrophe or
    // "is" -- Tim's own uncontracted phrasing ("What is running?", straight
    // off this phase's own command list) fell through the exact same way
    // "what's running" originally did, for the exact same reason (a
    // vocabulary gap, not a design decision to exclude it). `what(?:'?s|
    // is)` covers "what's"/"whats"/"what is" all three, preserving the
    // original apostrophe-optional "whats running" match this file's own
    // test suite already pins.
    // TSF UI FINDINGS #2-#16, Finding #3: "what is everyone doing right
    // now?"/"what's everyone working on?"/"what's the fleet up to?" are the
    // same GLOBAL_STATUS question in different words, but none matched --
    // kept in sync with command-scope-classifier.mjs's own deterministic
    // fallback gaining the identical alternative for the same root cause.
    //
    // TSF REAL-PILOT READINESS -- FINAL P1 CLOSURE, Finding #22: a genuine,
    // non-imperative status question naming a real predicate ("is X on
    // hold?", "why is X waiting?", "can TSF work on X right now?", "what is
    // X doing?" with the project's own name rather than only the literal
    // word "it") previously matched none of these alternatives, fell
    // through to the generic QUESTION intent, and (chat-http-routes.mjs's
    // own groundedResponseWorthy gate) escalated to a live LLM call whose
    // prompt never included the project's real execution-hold record or
    // canonical primaryState -- the model could then confidently deny a
    // real, active hold. These predicates are intentionally subject-
    // agnostic (no literal "it"/project-name requirement) since this
    // classifier only ever sees one already-resolved project's message.
    // Never matches a genuine imperative ("put X on hold", "pause X") --
    // those have no "is"/"why is"/"can ... work on" lead-in, and (defense
    // in depth) chat-http-routes.mjs's own hold-setting/run-action branches
    // are checked before this classification ever decides the response
    // shape anyway. The subject gap (`.{0,80}?`, widened from an initial
    // `.{0,30}?` after a real Codex adversarial-review finding: a real,
    // already-onboarded project's own display name --
    // "Worldforge-Sablewake-Live-Runtime-Repair-V3" -- is 44 characters,
    // longer than the original bound) between the lead word and the real
    // predicate is deliberately loose -- the subject may be "it", "this",
    // or the project's own real (arbitrarily-shaped) name/id, and
    // trying to enumerate every real project name here would be exactly
    // the "hardcode only the literal phrase" mistake this finding's own
    // fix explicitly rules out. The `is`/`why`/`can` lead-ins are anchored
    // to a real clause start (start of message, or right after sentence
    // punctuation) via a lookbehind -- a genuine question opens with these
    // words; a declarative sentence that merely CONTAINS "is ... working"
    // deep inside a bug report ("this project is broken and not working
    // right, please fix it") must never be swept in here instead of
    // FIX_REQUEST/FEEDBACK_BUG.
    pattern: new RegExp(
      `\\b(what(?:'?s| is) going on|where are we|update me|catch me up|what(?:'?s| is) running|(everyone|the fleet|all projects)\\s+(?:is\\s+|are\\s+)?(doing|working on|up to))\\b|${CANONICAL_STATUS_FACT_PATTERN.source}`,
      'i'
    )
  },
  // Phase 7 dogfood finding: "What finished?" (this phase's own command
  // list, and a natural fleet-wide phrasing) matched none of the alternatives
  // above -- fell through to QUESTION's generic non-answer instead of the
  // real fleet status these `what...` forms are for. "what finished" is its
  // own grammatical shape (finished as the main verb, "what [x] finished"),
  // distinct from "what's/what is done" (predicate-adjective form) -- both
  // added as separate alternatives rather than forcing one regex fragment to
  // cover two different sentence shapes.
  // Phase 16 residual-gap fix: the predicate-adjective alternative only
  // covered "done", not "finished" itself -- "what's finished"/"what is
  // finished" (this file's own test suite had pinned this as a disclosed,
  // not-yet-fixed gap) fell through to GENERAL for the identical missing-
  // synonym reason "what finished" originally did. `(done|finished)` closes
  // that gap the same way STATUS's `what(?:'?s| is)` prefix already does.
  {
    id: 'FINISHED',
    pattern:
      /\b(is (this|it) (actually )?(done|finished|ready)|are we done|what finished|what(?:'?s| is) (done|finished))\b/i
  },
  // M3: the affirmative "go do real work" phrasings Tim's own north star
  // names ("go ahead," "build that," "do the recommended next step") --
  // deliberately a SEPARATE intent from FIX_REQUEST (which stays scoped to
  // "something is wrong, correct it") rather than folded into it, since the
  // two read differently even though both currently route to the same
  // RECOMMEND_AND_PROCEED dispatch path below. Checked BEFORE NEXT_ACTION:
  // "do the recommended next step" is an imperative dispatch request, not
  // the question "what's the next step?" that NEXT_ACTION's own pattern
  // means to catch -- ordering (first match wins) is what keeps these two
  // correctly distinguished rather than the "next step" substring colliding.
  {
    id: 'DISPATCH_REQUEST',
    // Command Authority repair: "proceed with (it|that|this)" only matched a
    // pronoun -- an explicit, named-project confirmation ("yes, proceed with
    // niners-war-room"), which is exactly the phrasing the TIM_REQUIRED
    // refusal itself asks for ("name exactly which project(s)"), fell
    // through to GENERAL and never dispatched, forcing a repeated ask
    // instead of consuming the explicit authorization once. Broadened to
    // any following word/id-shaped token, not just the three pronouns.
    //
    // Command final hands-on hardening: bare imperatives ("Run Nytheria",
    // "Start WorldForge", "Run Nytheria overnight") are Command's own stated
    // main-surface vocabulary but were not recognized at all -- disclosed as
    // a usability gap, not a regression, but a real one for the surface
    // meant to be the primary conversational control plane. BARE_IMPERATIVE
    // is deliberately ANCHORED to the start of its own clause (after
    // matchesAsGenuineDirective's own per-clause split), not a bare \brun\b/
    // \bstart\b anywhere -- a clause has to actually OPEN with the verb to
    // count. That alone is what keeps every non-dispatch "run"/"start"
    // sentence in ordinary use out of this pattern without needing a second
    // negation/question check: "what's running right now?" (already its own
    // earlier-checked STATUS intent), "is the test still running?", "how do
    // I run the migration?", and "the CI run failed" all have "run" only as
    // a noun/gerund or mid-sentence, never as the clause's own opening verb,
    // so the anchor alone excludes them -- reusing isGenuineDirective (via
    // directiveOnly below) is what then separately rejects a genuine
    // question ("Run Nytheria?") or negated form ("Don't run Nytheria" does
    // not even reach isGenuineDirective -- "don't" is the clause's own first
    // word, so the anchor itself never matches). "run into" (a common
    // encounter-idiom, "ran into an issue") is the one disclosed, explicitly
    // reproduced false-positive shape and is excluded here directly; "start
    // over" (restart-from-scratch idiom) is a narrower, disclosed residual
    // gap left unhandled rather than guessed at, matching this file's own
    // stated convention (see PROHIBITION_MARKERS's own header) -- extend
    // this exclusion, not the anchor shape, if another such idiom is found.
    pattern:
      /\b(go ahead|go for it|please proceed|proceed with [\w-]+|build (that|this|it)|do (the recommended( next)? step|it|that)|sounds good,? (go ahead|do it))\b|^\s*(?:please\s+)?(?:run(?!\s*into\b)|start)\b/i,
    // Adversarial-review finding (2nd pass): a first fix here only guarded
    // the "proceed" alternative, only against negation words immediately
    // adjacent, and against the WHOLE message rather than per-clause --
    // "don't go ahead with tsf-orca" (a different alternative), "please do
    // not just proceed" (word inserted), and "don't proceed with X. go
    // ahead and proceed with Y instead." (an unrelated LATER genuine
    // request wrongly suppressed by an EARLIER negation) all still slipped
    // through or wrongly withheld the wrong one. Replaced with
    // `directiveOnly`, reusing this file's own proven, adversarial-review-
    // hardened clause/negation judgment (isGenuineDirective) instead of a
    // second, narrower, ad hoc regex.
    directiveOnly: true
  },
  { id: 'NEXT_ACTION', pattern: /\b(what should we do next|next step|what'?s next|what now)\b/i },
  { id: 'RATIONALE', pattern: /\b(why (did you|was)|what'?s the reasoning|why choose)\b/i },
  {
    id: 'CRITIQUE',
    pattern: /\b(looks like (shit|garbage|crap)|don'?t like|ugly|ugh|ew|hate this|sucks)\b/i
  },
  {
    id: 'FIX_REQUEST',
    pattern: /\b(fix (this|it)|change (this|it)|redo|make it)\b/i,
    // Adversarial-review finding (2nd pass): FIX_REQUEST is dispatch-worthy
    // (command-responder.mjs's DISPATCH_WORTHY_INTENTS) exactly like
    // DISPATCH_REQUEST, but had no negation awareness of its own -- "don't
    // fix this" reached the same real dispatch path as an affirmative fix
    // request. Same `directiveOnly` gate as DISPATCH_REQUEST.
    directiveOnly: true
  },
  { id: 'RESEARCH', pattern: /\b(research|look into|compare|investigate|explore options)\b/i },
  { id: 'HEALTH', pattern: /\b(health|is it healthy|any (issues|problems|blockers))\b/i },
  { id: 'ADOPTION', pattern: /\b(adopt|ready for adoption|candidate)\b/i },
  // Recovered from a stranded uncommitted worktree (command-tsf-orca-
  // 1788395222325): a plain question ("Why does this sidebar jump?") and a
  // bug report ("The save button is broken") both used to fall through to
  // GENERAL's "that phrasing didn't match" non-answer -- checked last,
  // after every more specific intent above, so a message like "is this
  // actually finished?" (FINISHED) or "why did you choose that?"
  // (RATIONALE) still matches its own more specific pattern first.
  {
    id: 'QUESTION',
    pattern:
      /^\s*(what|why|how|when|where|who|which|is|are|do|does|did|can|could|would|should|will)\b.*\?\s*$/i
  },
  // Pre-existing (not this mission's regression -- reproduced identically
  // at face3a5ab3, before any of this mission's own work; this file's own
  // DISPATCH_REQUEST comment above already discloses "run into" as a
  // common encounter-idiom needing exclusion, but that disclosure only
  // ever reached the BARE_IMPERATIVE pattern's own anchor, never this
  // pattern's bare "issue" keyword): "Run into an issue with WorldForge"
  // -- a casual encounter-idiom, not a deliberate bug report -- durably
  // recorded a spurious FEEDBACK_BUG entry against whatever project it
  // named. The lookbehind below excludes "issue" only in that specific
  // idiomatic shape (run/ran/running into a/an issue) -- a real, unhedged
  // report ("there's an issue with the login button") still matches
  // normally.
  {
    id: 'FEEDBACK_BUG',
    pattern:
      /\b(bug|broken|doesn['’]?t work|not working|jumps? around|regression|(?<!(?:run|ran|running) into an? )issue)\b/i
  },
  // FIXED (real, live-reproduced -- Full Conversational Control Plane
  // Exhaustive Gauntlet V1): plain enthusiasm/acknowledgement ("awesome!
  // this is so great!") right after an adoption-readiness discussion used
  // to fall all the way through to GENERAL, which chat-http-routes.mjs
  // routes to a live, free-text LLM call with no deterministic guardrail of
  // its own -- a real risk that the model's own text narrates or implies a
  // consequential action (adopt/push/merge/deploy) was taken from mere
  // enthusiasm. CORE INVARIANT: context may resolve WHAT is being discussed,
  // but the CURRENT TURN must supply the verb before any action is implied.
  // Checked LAST, after every intent above with its own real action verb
  // (ADOPTION/DISPATCH_REQUEST/FIX_REQUEST/RESEARCH/etc.) -- "awesome,
  // adopt it" still matches ADOPTION first (checked earlier in this same
  // list) and is completely unaffected; only a message with NO action verb
  // anywhere reaches this fallback. The response itself (respondAcknowledgement
  // below) is a grounded, deterministic, zero-LLM-call answer -- this
  // removes the hallucination risk structurally, not just via a prompt
  // instruction the model could still ignore.
  {
    id: 'ACKNOWLEDGEMENT',
    // Segment-based, not one giant regex (real messages chain multiple
    // acknowledgement shapes -- "awesome! this is so great!" is a bare word
    // THEN a praise-verb phrase). Splits on sentence punctuation and
    // requires EVERY resulting segment to independently match one of:
    // (1) one or more bare acknowledgement words, space-separated
    // ("awesome", "cool thanks"); (2) an exact fixed phrase ("that's
    // exactly what I wanted"); (3) an optional short leading subject (a
    // project/candidate name, up to 40 chars, matched lazily so it never
    // eats the verb) followed by a praise-verb phrase ("Landing Page looks
    // awesome", "this is so great"); (4) thumbs-up/fire emoji alone. Every
    // segment must match -- a message that ALSO carries real content
    // anywhere (e.g. "awesome, adopt it", "cool thanks, but fix the login
    // bug too") never matches here, exactly the CORE INVARIANT:
    // acknowledging does not, by itself, ever supply a verb.
    pattern: ACKNOWLEDGEMENT_PATTERN
  }
]

// Command Authority repair: a dispatch-worthy intent (DISPATCH_REQUEST,
// FIX_REQUEST) must only be recognized from a clause that is a genuine,
// non-negated, non-inquiry directive -- reuses isGenuineDirective/
// splitIntoSentences/splitIntoClauses directly rather than a second,
// independently-maintained negation check, so a fix to the shared
// vocabulary/rules here (already adversarial-review-hardened for
// TIM_REQUIRED) applies to both without having to be re-applied by hand.
function matchesAsGenuineDirective(message, pattern) {
  for (const sentence of splitIntoSentences(message)) {
    for (const clause of splitIntoClauses(sentence)) {
      if (pattern.test(clause) && isGenuineDirective(clause, sentence)) {
        return true
      }
    }
  }
  return false
}

export function classifyIntent(message) {
  for (const { id, pattern, directiveOnly } of INTENTS) {
    if (directiveOnly) {
      if (matchesAsGenuineDirective(message, pattern)) {
        return id
      }
      continue
    }
    if (pattern.test(message)) {
      return id
    }
  }
  return 'GENERAL'
}

export function classifyDecision(message, intent) {
  if (isConsequentialDirective(message)) {
    return 'TIM_REQUIRED'
  }
  if (['FIX_REQUEST', 'DISPATCH_REQUEST', 'RESEARCH', 'CRITIQUE'].includes(intent)) {
    return 'RECOMMEND_AND_PROCEED'
  }
  return 'AUTO_DECIDE'
}

function fmtTests(testsRun) {
  if (!testsRun?.length) {
    return 'no recorded test run'
  }
  return testsRun
    .map((t) =>
      t.command
        ? `${t.command}: ${t.passed ?? '?'}/${(t.passed ?? 0) + (t.failed ?? 0)}`
        : JSON.stringify(t)
    )
    .join('; ')
}

// M3: "what is it doing?" (STATUS/NEXT_ACTION) must answer from the real,
// live Keep Going run once one exists for this project -- the old mission/
// candidate/release model below predates M2 entirely and has no
// relationship to a project's actual dispatch state. `gap` is optional
// (compareStateToGoal's own output, or null) -- see
// projectLiveWorkFeedState's own honesty guarantee for what happens
// without it.
// Only STATUS/NEXT_ACTION/FINISHED are ever answered from the live run,
// and only while it is genuinely still the primary story -- a
// COMPLETE/BLOCKED run stays that way forever with nothing to clear it
// (an independent review finding: an earlier version let ANY run --
// including one long finished and since forgotten -- permanently shadow
// every future question about this project, even when the old, richer
// mission/candidate/release model held separately-relevant, more current
// information). Exported so http-server.mjs can decide whether to skip
// the live conversational planner call using the exact same rule
// respond() itself applies, rather than two independently-drifting checks.
const LIVE_RUN_INTENTS = new Set(['STATUS', 'NEXT_ACTION', 'FINISHED'])
const LIVE_RUN_TERMINAL_STATES = new Set(['COMPLETE', 'BLOCKED'])
export function isLiveRunRelevantFor(intent, run) {
  return !!run && LIVE_RUN_INTENTS.has(intent) && !LIVE_RUN_TERMINAL_STATES.has(run.state)
}

function recentHistoryLine(run) {
  const phases = recentCheckpointTrail(run).map((c) => c.phase)
  return `Recent history: ${phases.join(' -> ')}.`
}

// TSF REAL-PILOT READINESS -- FINAL P1 CLOSURE, Finding #22: the ONE
// canonical primaryState/primaryReasonLabel fact -- already present on
// every project object this whole route already resolves
// (project-catalog.mjs's withPrimaryState, hold-aware, never re-derived
// here) -- is now always the FIRST fact any grounded status answer
// states, never omitted. The exact same field HQ/Work/Projects/Command's
// own sidebar/Project Overview all already read, so a grounded chat
// answer can never contradict them -- most concretely, an active
// execution hold (primaryState WAITING, reasonLabel "Execution hold")
// is now always stated, closing the real false-denial gap a live LLM
// call (never given this fact at all) could otherwise fall into.
function canonicalStatusClause(project) {
  return `${project.primaryState}${project.primaryReasonLabel ? ` (${project.primaryReasonLabel})` : ''}`
}

function respondStatusOrNextActionFromRun(intent, project, run, gap) {
  const feed = projectLiveWorkFeedState(run, gap)
  const base = `**${project.displayName}** is **${canonicalStatusClause(project)}** — Keep Going run \`${run.id}\` is **${feed.state}**: ${feed.reason}.`
  if (intent === 'FINISHED') {
    return `No, not yet — ${base}`
  }
  if (intent === 'STATUS') {
    // M4: "recovery summary after restart" -- 'catch me up' already routes
    // here (STATUS's own pattern includes it). Appending a short,
    // chronological read of the durable checkpoint trail is what actually
    // answers "what happened while this was down/paused?" -- grounded in
    // the exact same persisted state a fresh, restarted process reads,
    // never a separate in-memory "since you last looked" tracker. Skipped
    // when there is nothing yet to recap (a run that just started has
    // only its own RUN_STARTED checkpoint).
    return run.checkpoints.length > 1 ? `${base} ${recentHistoryLine(run)}` : base
  }
  // NEXT_ACTION: point at the real, existing affordance for each state --
  // never a fictional one (an independent review finding elsewhere in M3
  // caught exactly this failure mode in a different message).
  if (feed.state === 'NEEDS_YOU') {
    const openQuestion = run.needsYou.find((entry) => !entry.resolvedAt)
    return openQuestion
      ? `${base} Open question: ${openQuestion.question}`
      : `${base} Check the Keep Going panel for the open question.`
  }
  if (feed.state === 'STALLED') {
    return `${base} Use the "Abandon stalled wave" action to recover it.`
  }
  if (feed.state === 'PAUSED' || feed.state === 'WAITING') {
    return `${base} Click Resume to continue it.`
  }
  if (feed.state === 'READY_FOR_ADOPTION') {
    return `${base} Review it on the Adoption surface and decide Adopt / Request Revision / Reject.`
  }
  return `${base} No action needed from you right now.`
}

function respondStatus(project) {
  const m = project.mission
  const r = project.release
  const reason = m.blockedReason?.replace(/\.+$/, '')
  return `**${project.displayName}** is **${canonicalStatusClause(project)}** — mission \`${m.id ?? 'none'}\` is **${m.state}**. Health: **${project.health.status}**${reason ? ` — ${reason}.` : '.'} Stable at \`${(r.stable.head ?? 'unknown').slice(0, 10)}\`, Testing: ${r.testing}, Adoption: ${r.adoption}.`
}

function respondFinished(project) {
  const adopted = project.release.adoption?.startsWith('ADOPTED')
  if (adopted) {
    return `Yes — this candidate is **ADOPTED**. Verifier verdict GREEN, tests: ${fmtTests(project.candidate?.testsRun)}. Stable is at \`${(project.release.stable.head ?? '').slice(0, 10)}\`.`
  }
  if (
    project.mission.state === 'BLOCKED' ||
    project.mission.state === 'BLOCKED_ARCHITECTURAL_CONFLICT'
  ) {
    return `No — it's **blocked**: ${project.mission.blockedReason ?? project.health.findings?.[0]?.summary ?? 'see Health for details'}. Not safe to resume without a decision from you.`
  }
  if (project.candidate?.state === 'READY_FOR_ADOPTION') {
    return `The candidate is verifier-GREEN and **ready for your adoption decision** — it isn't adopted yet.`
  }
  return `Not yet — current mission state is **${project.mission.state}**.`
}

function respondNextAction(project) {
  switch (project.mission.state) {
    case 'BLOCKED':
    case 'BLOCKED_ARCHITECTURAL_CONFLICT':
      return `This needs a decision from you: ${project.mission.blockedReason ?? 'an architectural conflict is blocking safe progress'}. I won't guess past that boundary.`
    case 'ADOPTED':
      return `Nothing pending — Stable is settled at the adopted candidate. Next mission would need a new objective from you or the planner.`
    default:
      if (project.candidate?.state === 'READY_FOR_ADOPTION') {
        return `Review the candidate on the Adoption surface and decide Adopt / Request Revision / Reject.`
      }
      return `No active work item recorded for this project right now.`
  }
}

function respondRationale(project) {
  const sm = project.evidence?.selectedMission
  if (sm?.rationale) {
    return `**${sm.title ?? 'Selected mission'}** — ${sm.rationale}`
  }
  const summary = project.evidence?.resultCapsules?.at(-1)?.implementationSummary
  if (summary) {
    return summary
  }
  return `No recorded rationale for this project yet.`
}

// Full Conversational Control Plane Exhaustive Gauntlet V1, Batch 10 (real
// response-truthfulness audit, 2nd finding of the same class as Batch 9's
// respondFeedback fix): "I've logged this as feedback on X" claimed a
// durable write that never happened -- respond() is a pure function with
// no I/O anywhere in its own call chain, and no feedback-store module
// exists anywhere in this codebase (confirmed via the same codebase-wide
// search Batch 9 already ran). Fixed the same way: remove the false
// claim, keep the real, working next step.
function respondCritiqueOrFix(project, intent) {
  const verb = intent === 'CRITIQUE' ? 'Noted' : 'Got it'
  return `${verb}. I can't dispatch a live Orca worker from this chat yet — that path (Wave 5 Run/task/dispatch integration) is still pending, and there's no durable feedback log to file this in either. The concrete next step is to turn it into a bounded mission the planner can hand to a worker, for **${project.displayName}**. Want me to draft that mission?`
}

function respondResearch(project) {
  return `Research routing isn't wired into chat yet — today this only reads recorded project state. For real research, route through the planner's normal research/mission flow outside this UI for now. I can still summarize what's already known about **${project.displayName}** if that helps.`
}

function respondHealth(project) {
  if (!project.health.findings?.length) {
    return `**${project.displayName}** is healthy — no findings.`
  }
  const findings = project.health.findings.map((f) => `${f.code}: ${f.summary}`).join(' ')
  return `**${project.displayName}** health: ${project.health.status}. ${findings}`
}

function respondAdoption(project) {
  if (!project.candidate) {
    return `No candidate recorded for ${project.displayName}.`
  }
  return `Candidate \`${(project.candidate.head ?? '').slice(0, 10)}\` is **${project.candidate.state}**. ${project.candidate.implementationSummary ?? ''}`.trim()
}

// FIXED (real, live-reproduced -- Full Conversational Control Plane
// Exhaustive Gauntlet V1): grounded, deterministic, zero-LLM-call answer
// for a bare acknowledgement/praise turn -- NEVER claims any action was
// taken, always restates real current state, and explicitly names what
// phrase would authorize a real next step (mirrors respondAdoption's own
// real-state grounding). This is what actually closes the "TSF responded
// as though the user had made a consequential decision" bug: the response
// text itself is now impossible to hallucinate into a false confirmation,
// because it's never generated by a live model at all for this intent.
function respondAcknowledgement(project) {
  if (project.candidate?.state === 'READY_FOR_ADOPTION') {
    return `Glad to hear it! No action was taken -- the candidate for **${project.displayName}** is still **READY_FOR_ADOPTION**, waiting on your decision. Say "adopt it" (or "adopt the candidate") when you want me to move forward with it.`
  }
  if (
    project.mission.state === 'BLOCKED' ||
    project.mission.state === 'BLOCKED_ARCHITECTURAL_CONFLICT'
  ) {
    return `Thanks! No action was taken -- **${project.displayName}** is still **blocked**: ${project.mission.blockedReason ?? 'see Health for details'}.`
  }
  return `Thanks! No action was taken -- **${project.displayName}** is currently **${project.mission.state}**. Tell me explicitly what you'd like next (e.g. "adopt it", "fix X", "keep going") and I'll act on that.`
}

function respondGeneral(project) {
  return `I have recorded state for **${project.displayName}** (mission ${project.mission.state}, health ${project.health.status}) but that phrasing didn't match a specific question I can ground an answer in. Try asking about status, whether it's finished, what's next, why a choice was made, or its health.`
}

// M3's real dispatch bridge (chat-dispatch-bridge.mjs, still being built)
// intercepts DISPATCH_REQUEST before it ever reaches this fallback --
// this stays as the honest degraded answer for when that bridge itself is
// unavailable or hasn't decided to act, matching respondCritiqueOrFix's own
// "not wired yet" honesty rather than fabricating a dispatch that didn't
// happen.
//
// TSF Overnight Control-Plane Burn-In V2, Lane G (real, live-confirmed,
// previously undiscovered): "I've logged this as a request on X" claimed
// a durable write that never happened -- respond() is a pure function (no
// I/O anywhere in its own call chain), and no dispatch-request store
// exists anywhere in this codebase (confirmed via grep, same method
// respondFeedback's own Batch-9 fix used directly below). This is the
// exact same false-claim class Batch 9 already fixed for respondFeedback
// in this same file, just missed for this sibling responder. Fixed the
// same way: removed the false claim, kept the real, working next step.
function respondDispatchRequest(project) {
  return `Got it — I can't dispatch a live Orca worker from this reply path yet (the chat-dispatch bridge is still being built), and there's no durable request log to file this in either. The concrete next step is to turn it into a bounded mission the planner can hand to a worker, for **${project.displayName}**. Want me to draft that mission?`
}

// Recovered from a stranded uncommitted worktree -- honest, in-project
// acknowledgement rather than routing a bug report anywhere else; matches
// respondCritiqueOrFix's own "not wired yet" disclosure style.
function respondQuestion(project) {
  return `I understand this as a question about **${project.displayName}**. I can answer from its recorded project state or the configured planner.`
}

// Full Conversational Control Plane Exhaustive Gauntlet V1, Batch 9 (real
// response-truthfulness audit): "Recorded on X" claimed a durable write
// that never happened -- respond() is a pure function (no I/O anywhere in
// its own call chain, confirmed via grep: no feedback-store module exists
// anywhere in this codebase), and chat-http-routes.mjs's own
// groundedResponseWorthy branch calls respond() directly with no
// persistence step around it either. This violated the exact "never a
// promise with no backing durable record" invariant this codebase
// enforces elsewhere (see applyExternalWorkHold's own A6 comment in
// server/command-multi-action-bridge.mjs). Fixed by removing the false
// claim rather than inventing a new persistence subsystem (a real feature,
// not a bounded reliability fix) -- still names the project and still
// gives the real, working next step ("ask me to fix it").
function respondFeedback(project) {
  return `I understand this as project feedback or a bug report about **${project.displayName}** -- there's no durable feedback log to file it in yet; ask me to fix it when you want a governed implementation mission started.`
}

const RESPONDERS = {
  STATUS: respondStatus,
  FINISHED: respondFinished,
  NEXT_ACTION: respondNextAction,
  RATIONALE: respondRationale,
  CRITIQUE: (p) => respondCritiqueOrFix(p, 'CRITIQUE'),
  FIX_REQUEST: (p) => respondCritiqueOrFix(p, 'FIX_REQUEST'),
  DISPATCH_REQUEST: respondDispatchRequest,
  RESEARCH: respondResearch,
  HEALTH: respondHealth,
  ADOPTION: respondAdoption,
  QUESTION: respondQuestion,
  FEEDBACK_BUG: respondFeedback,
  ACKNOWLEDGEMENT: respondAcknowledgement,
  GENERAL: respondGeneral
}

// BUG-08 (bug-ledger.json) real, reproduced honesty gap: this previously
// said "tell me explicitly to proceed and I'll surface exactly what would
// change ... before anything happens" -- a preview/reconfirm flow that
// does not exist anywhere in this codebase (checked: no approval-tracking
// state, no such route). Restating the request just re-triggers this exact
// same refusal every time (isConsequentialDirective has no notion of a
// prior turn), so the old wording promised an escape hatch that could
// never actually open -- a real dead-end loop, not merely unbuilt UI.
// Chat itself is structurally incapable of this class of action regardless
// of any confirmation: live-planner.mjs's own system prompt runs it
// zero-tool (--tools ""), and chat-dispatch-bridge.mjs's generated plans
// are hard-forbidden from including push/merge/deploy/publish/credentials/
// money/adoption. So the honest, correct answer is not "tell me again" --
// it's naming the real surface where that decision is actually made.
function respondTimRequired(project) {
  return `That's a **consequential decision** (money, credentials, push/merge/deploy/publish, or adoption authority) — chat has no tools and can't act on it, no matter how you phrase it. Make that call on the real surface for it instead: the Adoption tab for an adopt/reject decision on **${project?.displayName ?? 'this project'}**, or your own terminal/CLI for push/merge/deploy.`
}

// BUG-13 (bug-ledger.json): only STATUS/NEXT_ACTION/FINISHED ever grounded
// an answer in the live run (respondStatusOrNextActionFromRun above) --
// every other intent (HEALTH/ADOPTION/RATIONALE/GENERAL/CRITIQUE/
// FIX_REQUEST/RESEARCH/DISPATCH_REQUEST) answered purely from the old
// mission/candidate/release model, blind to a real Keep Going run even
// while it was actively running/stalled/needing a decision. Appended,
// never replacing those responders' own text, and only while the run is
// still the live story (same LIVE_RUN_TERMINAL_STATES rule
// isLiveRunRelevantFor already applies, so a long-finished run doesn't
// permanently shadow every future answer).
function liveRunFooter(run, gap) {
  if (!run || LIVE_RUN_TERMINAL_STATES.has(run.state)) {
    return ''
  }
  return ` (${describeLiveRunStatus(run, gap)})`
}

// Hands-Free Command + Project Manager V1: a small, additive footer
// grounding the answer in the SAME canonical project awareness the mission
// spec's Project Manager section asks for (research/holds/Needs You),
// composed by domain/project-manager-snapshot.mjs -- never a second,
// independently-derived summary. Optional and additive: a caller with no
// snapshot (every existing caller before this) gets identical text to
// before, unchanged.
function projectManagerFooter(snapshot) {
  if (!snapshot) {
    return ''
  }
  const notes = []
  if (snapshot.projectExecutionHold) {
    notes.push('an active execution hold')
  }
  if (snapshot.openNeedsYou.length > 0) {
    notes.push(
      `${snapshot.openNeedsYou.length} open Needs You item${snapshot.openNeedsYou.length === 1 ? '' : 's'}`
    )
  }
  if (snapshot.openResearchMissions.length > 0) {
    notes.push(
      `${snapshot.openResearchMissions.length} research mission${snapshot.openResearchMissions.length === 1 ? '' : 's'}`
    )
  }
  return notes.length > 0 ? ` [also: ${notes.join(', ')}]` : ''
}

// `run` (a real Keep Going domain run, or null) and `gap` (compareStateToGoal's
// output, or null) are both optional -- callers with no live run for this
// project (or that haven't wired the lookup) get the exact prior
// behavior, unchanged. `snapshot` (domain/project-manager-snapshot.mjs's
// buildProjectManagerSnapshot output, or null) is likewise optional and
// purely additive -- see projectManagerFooter above.
export function respond(project, message, run = null, gap = null, snapshot = null) {
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  const text = !project
    ? `No project selected — pick one first.`
    : decisionClass === 'TIM_REQUIRED'
      ? respondTimRequired(project)
      : isLiveRunRelevantFor(intent, run)
        ? respondStatusOrNextActionFromRun(intent, project, run, gap) +
          projectManagerFooter(snapshot)
        : RESPONDERS[intent](project) + liveRunFooter(run, gap) + projectManagerFooter(snapshot)
  return {
    intent,
    decisionClass,
    text,
    plannerRole: 'PLANNER_DEEP',
    providerLabel:
      'No live provider configured — rule-based fallback grounded in recorded project state'
  }
}
