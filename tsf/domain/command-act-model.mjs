// TSF Control Plane -- Command Act Model V1 (CASE-31/CASE-32 structural
// repair, Full Conversational Control Plane Exhaustive Gauntlet V1).
//
// Shared abstraction closing two real P0 classes that a phrase-list patch
// cannot: (CASE-31) negation/correction/quote scoring that only looked at
// a flat character span with no concept of provenance or "final statement
// wins"; (CASE-32) clause-boundary detection driven by an ever-growing,
// structurally-incomplete keyword list, causing a verb meant for one
// target to bleed onto an unrelated or explicitly-excluded target that
// merely shares a sentence.
//
// Design (see docs/tsf/TSF_CASE31_CASE32_CONTROL_SEMANTICS_DESIGN report
// for the full reproduced-failure/root-cause analysis this implements):
// punctuation and connective words are NOT semantically significant on
// their own -- they are tokenization aids. What actually determines an
// act boundary is CONTENT: does a different recognized verb appear, does
// a new target appear, does a correction marker amend the immediately-
// preceding act. A single left-to-right scan builds an ordered list of
// CommandAct records; existing per-verb trigger regexes (already
// hardened across many prior batches) are REUSED UNCHANGED as the
// "is this text this verb" building block -- only boundary/target-scoping
// and polarity/provenance resolution are new.
//
// Deliberately NOT a general NLP framework: no POS tagging, no dependency
// parser, no external library, no LLM call. One deterministic tokenizer +
// one linear associate-pass, in the same style/order-of-complexity as the
// splitClauses/segmentByProject machinery it replaces.

/**
 * @typedef {Object} CommandAct
 * @property {string} verbId - canonical verb id (see VERB_REGISTRY keys)
 * @property {string[]} targetIds - real project ids this act's verb applies to
 * @property {string[]} excludedTargetIds - project ids explicitly carved out ("except X"/"not X"/"excluding X")
 * @property {'POSITIVE'|'NEGATIVE'} polarity - final resolved polarity after negation/correction/quote resolution
 * @property {'CURRENT_OWNER_STATEMENT'|'QUOTED_OR_REPORTED'|'RETRACTED_HYPOTHETICAL'} provenance
 * @property {[number, number]} span - [startOffset, endOffset] in the original message
 * @property {string} rawClause - the act's own reconstructed source text (for existing rawClause compatibility + audit)
 */

function escapeRegExpToken(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// Negation vocabulary -- REUSED VERBATIM from domain/command-adoption-
// execution.mjs / domain/command-multi-action-decomposition.mjs (both
// already independently hardened across many prior batches: curly-quote
// tolerance, the full "-n't" contraction family, archaic forms). Not
// rebuilt here -- this module is the ONE place that vocabulary now lives;
// those two files import it from here (see their own updated headers).
// ============================================================================
export const NOT_CONTRACTION_SOURCE =
  "(?:do|does|did|is|are|was|were|has|have|had|would|should|could|must|might|need|ai|sha|ought|dare|am)n['’]?t"
export const NEGATION_TRIGGER_SOURCE = `(?:do not|${NOT_CONTRACTION_SOURCE}|never|won['’]?t|refuse(?:d|s)?\\s+to|avoid|reject(?:ed|ing|s)?|rather not|hold off(?:\\s+on)?|pass on|not(?!\\s+sure\\b)|no|can['’]?t|cannot)`

// ============================================================================
// Provenance pre-pass: quote / reported-speech / retracted-hypothetical
// span detection (CASE-31's core fix). Generalizes the golden-path eval's
// already-tested Property D ("a quoted command is not itself the owner's
// directive") into a reusable primitive instead of a test-only assertion.
// ============================================================================

// Double-quote pairs are unambiguous. Single-quote pairs are heuristic
// (English apostrophes in contractions/possessives vastly outnumber
// genuine quotation use) -- an opening single-quote is one preceded by
// start-of-string/whitespace/opening-punctuation and NOT immediately
// followed by whitespace; verified empirically against every contraction
// this codebase's own negation vocabulary already recognizes (don't,
// isn't, wouldn't, etc.) to confirm none are misread as quote-opens.
function findQuoteSpans(message) {
  const spans = []
  const doubleRe = /"([^"]*)"/g
  let m
  while ((m = doubleRe.exec(message))) {
    spans.push([m.index, m.index + m[0].length])
  }
  const singleOpenRe = /(^|[\s([{])'(\S[^']*)'/g
  while ((m = singleOpenRe.exec(message))) {
    const openAt = m.index + m[1].length
    spans.push([openAt, openAt + 1 + m[2].length + 1])
  }
  return spans
}

// Reported-speech WITHOUT quote marks ("Claude suggested to adopt A") --
// a narrower safety net beyond quote detection; bounded to the rest of
// the current sentence (next hard boundary or end of string) since this
// module has no sentence list yet at pre-pass time -- a conservative,
// generously-sized bound, tightened by the quote-span check above
// whenever quotes ARE present (the common case).
const REPORTED_SPEECH_OPENER = /\b(?:i|you|claude|the (?:plan|assistant))\s+said\b/gi
function findReportedSpeechSpans(message) {
  const spans = []
  let m
  REPORTED_SPEECH_OPENER.lastIndex = 0
  while ((m = REPORTED_SPEECH_OPENER.exec(message))) {
    const restStart = m.index + m[0].length
    const boundaryMatch = /[.!?;\n]/.exec(message.slice(restStart))
    const restEnd = boundaryMatch ? restStart + boundaryMatch.index : message.length
    spans.push([restStart, restEnd])
  }
  return spans
}

// "I was going to say X, but never mind" / "I was thinking of saying X" /
// "I almost said X" -- a retracted or merely-hypothetical statement of
// intent, never itself a current instruction. Bounded to the next
// correction marker or hard boundary (whichever comes first) -- so "I was
// going to say adopt it, but never mind" excludes "adopt it" (ends at
// "but"), matching the CORRECTION_MARKER_SOURCE below.
const RETRACTED_HYPOTHETICAL_OPENER =
  /\bi\s+(?:was\s+going\s+to\s+say|was\s+thinking\s+(?:of|about)\s+saying|almost\s+said)\b/gi
export const CORRECTION_MARKER_SOURCE =
  '(?:actually|wait|scratch that|i mean|on second thought|but never mind|never mind)'
function findRetractedHypotheticalSpans(message) {
  const spans = []
  let m
  RETRACTED_HYPOTHETICAL_OPENER.lastIndex = 0
  while ((m = RETRACTED_HYPOTHETICAL_OPENER.exec(message))) {
    const restStart = m.index + m[0].length
    const rest = message.slice(restStart)
    const correctionMatch = new RegExp(`[.!?;\\n]|\\b${CORRECTION_MARKER_SOURCE}\\b`, 'i').exec(
      rest
    )
    const restEnd = correctionMatch ? restStart + correctionMatch.index : message.length
    spans.push([restStart, restEnd])
  }
  return spans
}

function buildExcludedSpans(message) {
  const quoted = findQuoteSpans(message).map((s) => ({ span: s, provenance: 'QUOTED_OR_REPORTED' }))
  const reported = findReportedSpeechSpans(message).map((s) => ({
    span: s,
    provenance: 'QUOTED_OR_REPORTED'
  }))
  const hypothetical = findRetractedHypotheticalSpans(message).map((s) => ({
    span: s,
    provenance: 'RETRACTED_HYPOTHETICAL'
  }))
  return [...quoted, ...reported, ...hypothetical]
}

// A position is "excluded" (never counts as CURRENT_OWNER_STATEMENT) if it
// falls inside any provenance span. Returns the provenance label of the
// FIRST containing span, or null if the position is not excluded.
function provenanceAt(excludedSpans, index) {
  for (const { span, provenance } of excludedSpans) {
    if (index >= span[0] && index < span[1]) {
      return provenance
    }
  }
  return null
}

export {
  buildExcludedSpans,
  provenanceAt,
  findQuoteSpans,
  findReportedSpeechSpans,
  findRetractedHypotheticalSpans
}

// ============================================================================
// Adoption verb recognition -- MOVED here (canonical home) from domain/
// command-adoption-execution.mjs, which now imports and re-exports these
// for backward compatibility. Position-aware (returns anchors, not just a
// boolean) so the boundary/target-scoping scanner below can use the exact
// same allowlist logic that file's own hasAdoptionVerb already used.
// ============================================================================
export const ADOPTION_VERB_PATTERN = /\b(adopt(ed|ing|s)?|accept(ed|ing|s)?|approve[sd]?)\b/i
export const NON_ADOPTION_ACCEPT_APPROVE_OBJECT =
  /\b(?:accept(?:ed|ing|s)?|approve[sd]?)\b(?:\s+(?:the|a|an|my|your|his|her|our|their|its))?(?:\s+\S+){0,2}?\s+(?:apolog(?:y|ies)|request|offer|invitation|proposal|terms|feedback|blame|responsibility|pr\b|pull request|resignation|application|excuse)/i
export const ADOPTION_CANDIDATE_NOUN_SOURCE = 'candidate|run|mission|adoption'
export const ARTICLE_SOURCE = 'the|a|an|my|your|his|her|our|their|its'

function acceptApproveObjectMatchesAllowlist(after, projects) {
  if (
    new RegExp(
      `^(?:\\s+(?:${ARTICLE_SOURCE}))?(?:\\s+\\S+){0,2}?\\s+(?:${ADOPTION_CANDIDATE_NOUN_SOURCE})\\b`,
      'i'
    ).test(after)
  ) {
    return true
  }
  for (const project of projects) {
    if (!project) {
      continue
    }
    for (const name of [project.id, project.displayName]) {
      if (
        typeof name === 'string' &&
        name.trim() &&
        new RegExp(
          `^(?:\\s+(?:${ARTICLE_SOURCE}))?\\s+${escapeRegExpToken(name.trim())}\\b`,
          'i'
        ).test(after)
      ) {
        return true
      }
    }
  }
  return false
}

// Position-aware equivalent of the old hasAdoptionVerb's own occurrence
// scan. Bare "adopt*" is always a valid anchor; accept/approve occurrences
// go through the exact same allowlist check as before, per-occurrence when
// `projects` is supplied, or the original global-denylist fallback when it
// is not (mirrors the asymmetry the original code already had -- not a new
// one introduced here).
export function findAdoptVerbAnchors(text, projects) {
  const s = String(text ?? '')
  const anchors = []
  const bareAdoptRe = /\badopt(?:ed|ing|s)?\b/gi
  let m
  while ((m = bareAdoptRe.exec(s))) {
    anchors.push({ verbId: 'ADOPT', start: m.index, end: m.index + m[0].length })
  }
  const acceptApproveMatches = [...s.matchAll(/\b(?:accept(?:ed|ing|s)?|approve[sd]?)\b/gi)]
  if (acceptApproveMatches.length === 0) {
    return anchors.sort((a, b) => a.start - b.start)
  }
  if (projects === undefined) {
    if (!NON_ADOPTION_ACCEPT_APPROVE_OBJECT.test(s)) {
      for (const vm of acceptApproveMatches) {
        anchors.push({ verbId: 'ADOPT', start: vm.index, end: vm.index + vm[0].length })
      }
    }
    return anchors.sort((a, b) => a.start - b.start)
  }
  for (const vm of acceptApproveMatches) {
    const after = s.slice(vm.index + vm[0].length, vm.index + vm[0].length + 80)
    if (acceptApproveObjectMatchesAllowlist(after, projects)) {
      anchors.push({ verbId: 'ADOPT', start: vm.index, end: vm.index + vm[0].length })
    }
  }
  return anchors.sort((a, b) => a.start - b.start)
}

export function hasAdoptionVerb(text, projects) {
  return findAdoptVerbAnchors(text, projects).length > 0
}

const HEDGE_PATTERN =
  /\b(maybe|perhaps|not sure|unsure|should i|should we|might|could we|possibly|i think|i guess|wonder(ing)?|what if)\b/i
const TRAILING_QUESTION_PATTERN = /\?\s*$/
export { HEDGE_PATTERN, TRAILING_QUESTION_PATTERN }

// Legacy whole-text negation check -- KEPT for exact backward compatibility
// (domain/command-adoption-execution.mjs's own negatesAdoptionVerb is a
// clause-scoped export other modules already depend on with THIS flat,
// direction-asymmetric, provenance-blind shape). CASE-31's real fix lives
// in resolveAdoptionActs below, not in changing this function's contract.
const ADOPTION_NEGATION_PATTERN = new RegExp(
  `\\b(?:do not|${NOT_CONTRACTION_SOURCE}|never|won['’]?t|refuse(?:d|s)?\\s+to|avoid|reject(?:ed|ing|s)?|rather not|hold off(?:\\s+on)?|pass on|not(?!\\s+sure\\b)|no|can['’]?t|cannot)\\b[\\s\\S]{0,60}?\\b(?:adopt|accept|approve)\\w*\\b`,
  'i'
)
const IDIOMATIC_NON_NEGATION =
  /\bnever\s+mind\b|\bno\s+rush\b|\bnot\s+gonna\s+lie\b|\bno\s+worries\b|\bno\s+reason\s+not\s+to\b/gi
export function negatesAdoptionVerb(text) {
  const withoutIdioms = String(text ?? '').replace(IDIOMATIC_NON_NEGATION, ' ')
  return ADOPTION_NEGATION_PATTERN.test(withoutIdioms)
}

// ============================================================================
// Polarity resolution -- CASE-31's real fix. Bounded-gap negation, capped so
// one negation trigger can never bleed across an EARLIER anchor's own zone
// (the historical Batch-2 clause-fragmentation bug, generalized: a shared
// bounded-character window is safe only when also bounded by the nearest
// preceding anchor of ANY verb, not just by a flat char count). A pre-verb
// window containing 2+ independent negation triggers is a genuine double
// negative -- fails safe to AMBIGUOUS rather than guessing which cancels
// which (invariant 8, "Don't not adopt it." / "I don't think we shouldn't
// adopt it.").
// ============================================================================
// Two negation triggers separated only by whitespace/commas ("no, do not
// adopt") are emphatic REINFORCEMENT of one single refusal, not two
// independently-scoped negations -- counted as one logical trigger. Two
// triggers with real words between them ("I don't think we shouldn't
// adopt it" -- "think we" sits between them, each governing a DIFFERENT
// verb) stay genuinely double, which is exactly invariant 8's own named
// example of when to fail safe to AMBIGUOUS rather than guess which
// cancels which.
function countNegationTriggers(windowText) {
  const withoutIdioms = String(windowText).replace(IDIOMATIC_NON_NEGATION, ' ')
  const re = new RegExp(`\\b${NEGATION_TRIGGER_SOURCE}\\b`, 'gi')
  const matches = [...withoutIdioms.matchAll(re)]
  let logical = 0
  let prevEnd = null
  for (const m of matches) {
    const gap = prevEnd === null ? null : withoutIdioms.slice(prevEnd, m.index)
    if (!(gap !== null && /^[\s,]*$/.test(gap))) {
      logical++
    }
    prevEnd = m.index + m[0].length
  }
  return logical
}

// Independent-review finding (BLOCKING, round 3, real, live-confirmed,
// same mission -- the most severe finding across all review rounds):
// this function's own POLARITY was always computed correctly, but every
// caller building a downstream `rawClause` (the ONLY thing
// server/command-multi-action-bridge.mjs's executeAdoptionCandidate
// hands to its own independent execution-time re-derivation,
// classifyAdoptionCommandIntent(rawClause, [project]) -- invariant 7's
// own "existing execution-time revalidation remains authoritative"
// safety net) sliced starting exactly AT the verb anchor, never at the
// negation trigger BEFORE it. "Don't adopt A, adopt B." produced A's own
// rawClause as literally "adopt A, " -- polarity NEGATIVE, intent
// correctly ADOPT_CANDIDATE_DECLINED, but the re-derivation on that
// truncated text saw only a bare, unnegated "adopt" and reclassified
// EXECUTE_ADOPTION, reaching a REAL git ff-only merge for an explicitly
// declined target. Now returns the actual window boundary it used so
// every caller can build a rawClause that genuinely CONTAINS whatever
// negation trigger made it negative, restoring the real safety net
// instead of merely computing a polarity field nothing downstream trusts.
function resolvePreVerbPolarity(text, anchorStart, precedingAnchorEnd, excludedSpans) {
  let windowStart = Math.max(0, anchorStart - 60, precedingAnchorEnd ?? 0)
  // Never let a negation trigger INSIDE a quoted/reported/hypothetical
  // span reach forward into a real, current-owner anchor that merely
  // follows it in the same message ("The plan said 'do not adopt this
  // candidate' but I want you to adopt EasyLifeHQ now." -- the quoted
  // "do not" has no authority over the later, real "adopt").
  if (Array.isArray(excludedSpans)) {
    for (const { span } of excludedSpans) {
      if (span[1] <= anchorStart && span[1] > windowStart) {
        windowStart = span[1]
      }
    }
  }
  const windowText = text.slice(windowStart, anchorStart)
  const count = countNegationTriggers(windowText)
  const polarity = count >= 2 ? 'AMBIGUOUS' : count === 1 ? 'NEGATIVE' : 'POSITIVE'
  return { polarity, windowStart }
}

const AFFIRMATION_MARKER_SOURCE = '(?:go\\s+ahead|do\\s+it|proceed|yes\\b|sure\\b)'
const AFFIRMATION_MARKER_RE = new RegExp(`\\b${AFFIRMATION_MARKER_SOURCE}\\b`, 'i')
const CORRECTION_MARKER_RE = new RegExp(`\\b${CORRECTION_MARKER_SOURCE}\\b`, 'gi')

function hasAnyVerbAnchorInText(text, projects) {
  if (findAdoptVerbAnchors(text, projects).length > 0) {
    return true
  }
  return VERB_REGISTRY.some((v) => new RegExp(`\\b${v.source}\\b`, 'i').test(text))
}

// Message-wide correction/amend pass -- "actually"/"wait"/"scratch that"/
// "I mean"/"on second thought"/"never mind" AMEND the nearest PRECEDING
// act in place when the text after the marker is a bare reversal/
// affirmation with no verb+target of its own ("Adopt A -- actually,
// don't."); when the amendment text carries its own full verb anchor
// ("Don't adopt A; actually adopt B.") it is left alone -- that's already
// its own independent act, not a mere polarity flip of the prior one.
// Genuinely ambiguous amendment text (both a negation and an affirmation
// marker, or 2+ negations) leaves the prior act's polarity untouched --
// fail-safe, never guessed.
//
// Independent-review finding (SHOULD-FIX, real, live-confirmed, same
// mission): the "nearest preceding act" search was bounded ONLY by
// character position, message-wide -- "Don't adopt A. Pause B. Actually
// go ahead." let the correction silently bind to the intervening,
// unrelated PAUSE(B) act (a no-op, since PAUSE polarity has no downstream
// effect) instead of A, silently dropping what a human reads as "actually,
// go ahead [with adopting A]" with no ambiguity signal at all. A
// correction marker's natural scope is "the thing I just said" -- bounded
// here to acts within the SAME hard segment as the marker itself (every
// CASE-31 required example is single-segment; none needs a correction to
// reach backward across a period/semicolon/`but`/`however`/`while`
// boundary). When `segments` is omitted (resolveAdoptionActs' own
// message-level, already clause-scoped call) the search stays unbounded,
// matching that function's own real call-site contract.
function applyCorrectionAmendments(acts, message, excludedSpans, projects, segments) {
  CORRECTION_MARKER_RE.lastIndex = 0
  let m
  while ((m = CORRECTION_MARKER_RE.exec(message))) {
    const markerStart = m.index
    if (provenanceAt(excludedSpans, markerStart)) {
      continue
    }
    const afterStart = markerStart + m[0].length
    const rest = message.slice(afterStart)
    // Independent-review finding (SHOULD-FIX, round 4, real, live-
    // confirmed): this boundary never recognized "but"/"however"/"while"
    // -- the SAME unconditional hard boundaries hardSegments already
    // treats with identical force to a period/semicolon. "Adopt A,
    // actually don't, but adopt B." let amendText reach straight through
    // "but" into "adopt B", so hasAnyVerbAnchorInText saw B's own verb
    // and this function wrongly bailed out, leaving A's polarity
    // un-flipped (still POSITIVE) even though "actually don't" is
    // unambiguously A's own reversal. Never reached a real wrongful
    // execution (rawClause still correctly scoped to A's own segment, and
    // the independent execution-time re-derivation still refused), but
    // produced a wrong decomposer-level intent and an under-dispatch of
    // the legitimately affirmed B via the multi-action gate.
    const boundaryMatch = new RegExp(
      `[.!?;\\n]|\\bbut\\b|\\bhowever\\b|\\bwhile\\b|\\b${CORRECTION_MARKER_SOURCE}\\b`,
      'i'
    ).exec(rest)
    const amendText = boundaryMatch ? rest.slice(0, boundaryMatch.index) : rest
    if (hasAnyVerbAnchorInText(amendText, projects)) {
      continue
    }
    const negCount = countNegationTriggers(amendText)
    const hasAffirmation = AFFIRMATION_MARKER_RE.test(amendText)
    if (negCount >= 1 && hasAffirmation) {
      continue
    } // genuinely ambiguous -- fail safe
    const lowerBound = segments
      ? (segments.find((s) => markerStart >= s.start && markerStart <= s.end)?.start ?? 0)
      : 0
    const target = acts
      .toReversed()
      .find((a) => a.span[1] <= markerStart && a.span[1] >= lowerBound)
    if (!target) {
      continue
    }
    if (negCount === 1) {
      target.polarity = 'NEGATIVE'
    } else if (negCount === 0 && hasAffirmation) {
      target.polarity = 'POSITIVE'
    }
    // negCount >= 2: genuinely ambiguous amendment -- leave prior polarity.
  }
}

// Message-level ADOPT act resolution -- used by classifyAdoptionCommandIntent
// (single-message classifier; its real call sites always pass text already
// attributed to one target's own rawClause, so "final act for this verb
// wins" is the correct policy here, not a multi-target hazard -- see this
// module's own header / the CASE-31 design report for why).
export function resolveAdoptionActs(message, projects) {
  const text = String(message ?? '')
  const excludedSpans = buildExcludedSpans(text)
  const rawAnchors = findAdoptVerbAnchors(text, projects).filter(
    (a) => !provenanceAt(excludedSpans, a.start)
  )
  // No preceding-anchor cap here (unlike the decomposer's per-mention
  // scoping below): this function's real call sites always receive text
  // already attributed to ONE target's own rawClause (see this module's
  // own header) -- e.g. "approved adopting this candidate" legitimately
  // produces two overlapping anchors (bare "adopting" + allowlisted
  // "approved") describing the SAME single adoption event, and capping
  // the second anchor's lookback at the first anchor's own end would
  // wrongly hide "hasn't" from the second, flipping it back to POSITIVE.
  const acts = rawAnchors.map((a) => ({
    verbId: 'ADOPT',
    span: [a.start, a.end],
    polarity: resolvePreVerbPolarity(text, a.start, undefined, excludedSpans).polarity
  }))
  applyCorrectionAmendments(acts, text, excludedSpans, projects)
  return acts
}

export function classifyAdoptionCommandIntent(message, projects) {
  const text = String(message ?? '')
  const acts = resolveAdoptionActs(text, projects)
  if (acts.length === 0) {
    return 'NOT_ADOPTION'
  }
  if (acts.some((a) => a.polarity === 'AMBIGUOUS')) {
    return 'AMBIGUOUS'
  }
  if (HEDGE_PATTERN.test(text) || TRAILING_QUESTION_PATTERN.test(text)) {
    return 'AMBIGUOUS'
  }
  return acts.at(-1).polarity === 'POSITIVE' ? 'EXECUTE_ADOPTION' : 'NOT_ADOPTION'
}

// ============================================================================
// CASE-32: boundary/target-scoping. Reuses each verb's own exact trigger
// vocabulary (already hardened, unchanged) purely as "is this text this
// verb" -- everything below is new: where one act ends and the next
// begins, and which of several targets sharing one sentence belongs to
// which act.
// ============================================================================
const KEEP_GOING_SOURCE = '(?:keep\\s+going|overnight)'
const ASSESS_SOURCE = '(?:needs?\\s+(?:serious\\s+)?work|get\\s+.+?\\s+up|upgrade|assess)'
const EXTERNAL_HOLD_SOURCE =
  '(?:(?:is\\s+)?being\\s+handled\\s+by\\s+(?:another|a\\s+different)\\s+(?:ai|agent|process)|leave\\s+(?:it|that|this|\\S+)\\s+alone|hold\\s+off(?:\\s+on)?)'
const STATUS_QUERY_SOURCE = "(?:status|what'?s\\s+(?:going\\s+on|happening)|how'?s\\s+it\\s+going)"

// Verbs with no existing multi-action execution intent yet (research/fix/
// cancel) still get full boundary/target-scoping
// protection (never bleed a neighboring verb's action onto their target,
// or vice versa) but map to GENERAL downstream -- a real, disclosed gap
// (server/command-multi-action-bridge.mjs's handleEntry safely no-ops/
// reports status for GENERAL), never a silently invented destructive
// intent.
const VERB_REGISTRY = [
  {
    id: 'EXTERNAL_WORK_HOLD',
    source: EXTERNAL_HOLD_SOURCE,
    existingMultiActionIntent: 'EXTERNAL_WORK_HOLD',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'KEEP_GOING',
    source: KEEP_GOING_SOURCE,
    existingMultiActionIntent: 'START_KEEP_GOING',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'ASSESS',
    source: ASSESS_SOURCE,
    existingMultiActionIntent: 'ASSESS_AND_UPGRADE',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'STATUS_QUERY',
    source: STATUS_QUERY_SOURCE,
    existingMultiActionIntent: 'STATUS_QUERY',
    negatedMultiActionIntent: 'STATUS_QUERY'
  },
  {
    id: 'PAUSE',
    source: 'pause\\w*',
    existingMultiActionIntent: 'PAUSE',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'RESUME',
    source: '(?:resume|continue)\\w*',
    existingMultiActionIntent: 'RESUME',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  },
  {
    id: 'RESEARCH',
    source: 'research\\w*',
    existingMultiActionIntent: 'GENERAL',
    negatedMultiActionIntent: 'GENERAL'
  },
  {
    id: 'FIX',
    source: 'fix\\w*',
    existingMultiActionIntent: 'GENERAL',
    negatedMultiActionIntent: 'GENERAL'
  },
  {
    id: 'CANCEL',
    source: '(?:cancel\\w*|reject(?:ed|ing|s)?)',
    existingMultiActionIntent: 'GENERAL',
    negatedMultiActionIntent: 'GENERAL'
  },
  // Pre-UI Productization V1, Priority 2: "release hold" was recognized
  // syntactically but wired to ZERO real execution anywhere in the
  // codebase (existingMultiActionIntent was GENERAL, a real, confirmed
  // gap -- see the disclosed-gap comment above). Broadened the source
  // pattern to also match "release the hold"/"release that hold" (a
  // bare, article-free "release hold" reads unnaturally to a real
  // operator) and wired to a real, distinct intent, mirroring
  // EXTERNAL_WORK_HOLD's own pattern exactly.
  {
    id: 'RELEASE_HOLD',
    source: 'release\\s+(?:the\\s+|that\\s+)?hold\\w*',
    existingMultiActionIntent: 'RELEASE_HOLD',
    negatedMultiActionIntent: 'MULTI_ACTION_DECLINED'
  }
]

function findGenericVerbAnchors(text) {
  const anchors = []
  for (const entry of VERB_REGISTRY) {
    const re = new RegExp(`\\b${entry.source}\\b`, 'gi')
    let m
    while ((m = re.exec(text))) {
      anchors.push({
        verbId: entry.id,
        start: m.index,
        end: m.index + m[0].length,
        existingMultiActionIntent: entry.existingMultiActionIntent,
        negatedMultiActionIntent: entry.negatedMultiActionIntent
      })
    }
  }
  return anchors
}

function findAllVerbAnchors(text, projects) {
  const adoptAnchors = findAdoptVerbAnchors(text, projects).map((a) => ({
    ...a,
    existingMultiActionIntent: 'ADOPT_CANDIDATE_REPORT',
    negatedMultiActionIntent: 'ADOPT_CANDIDATE_DECLINED'
  }))
  return [...adoptAnchors, ...findGenericVerbAnchors(text)].sort((a, b) => a.start - b.start)
}

// AND_SPLIT_FILLER/lookahead -- unchanged convention from the original
// splitClauses (a bounded 0-2 filler-word tolerance before the verb).
const AND_SPLIT_FILLER = '(?:(?:please|just|simply)[,\\s]+){0,2}'

// Hard, position-preserving segmenter. Unlike the original splitClauses,
// this NEVER normalizes the em-dash to a period (that normalization was
// CASE-31's own root cause for "Adopt A -- actually, don't." -- it
// fragmented the sentence before the correction-amend pass could ever see
// both halves as one unit) and adds "however"/"while" as unconditional
// hard boundaries alongside the existing "but" (contrastive connectives
// that already behave like sentence breaks in practice). "and"/"then"
// stay ADDITIVE (verb-lookahead-gated, same mechanism the original used
// for "and" alone) -- a bare comma is never a hard boundary on its own;
// within-segment multi-target scoping is handled by groupMentionsIntoZones
// below instead of by fragmenting the sentence.
function hardSegments(message) {
  const text = String(message)
  const verbSources = VERB_REGISTRY.map((v) => v.source).join('|')
  const additiveLookahead = `${AND_SPLIT_FILLER}(?:adopt|accept|approve|${verbSources})\\w*\\b`
  const re = new RegExp(
    `[.!?\\n;]+|\\bbut\\b|\\bhowever\\b|\\bwhile\\b|\\b(?:and|then)\\b(?=\\s+${additiveLookahead})`,
    'gi'
  )
  const raw = []
  let cursor = 0
  let m
  while ((m = re.exec(text))) {
    raw.push({ text: text.slice(cursor, m.index), start: cursor })
    cursor = m.index + m[0].length
  }
  raw.push({ text: text.slice(cursor), start: cursor })
  return raw
    .map(({ text: t, start }) => {
      const leading = t.length - t.trimStart().length
      const trimmed = t.trim()
      return trimmed
        ? { text: trimmed, start: start + leading, end: start + leading + trimmed.length }
        : null
    })
    .filter(Boolean)
}

// Position-aware project-mention finder -- returns EVERY real occurrence
// (not just the first per project): a target legitimately named twice in
// one segment ("Adopt A and B, not B.") needs BOTH occurrences visible to
// groupMentionsIntoZones, or the second (the one that actually carries the
// exclusion) is invisible to it entirely.
//
// Independent-review finding (BLOCKING, real, live-confirmed, same
// mission): the original per-project-independent regex scan let a
// SHORTER project's id/name match as a plain substring-prefix of a
// LONGER, different project's own name ("foo" matching inside
// "foo-other", since a hyphen is a non-word char and satisfies \b on
// both sides) -- "foo-other needs serious work, adopt foo." wrongly
// mentioned BOTH "foo" and "foo-other" at the same text span, and BOTH
// received ADOPT_CANDIDATE_REPORT, reaching a real per-clause
// classifyAdoptionCommandIntent re-check that agreed. Fixed by scanning
// ALL name variants (every project's id/displayName/alias) as ONE single
// alternation, longest-first -- regex alternation tries earlier
// alternatives first at a given start position, so ordering the longer,
// more specific "foo-other" ahead of "foo" means it always wins whenever
// both could match at the same position, exactly the "longest match
// wins" a human reads instantly.
function projectMentionsWithPositions(text, projects, aliases) {
  const variants = []
  for (const project of projects) {
    for (const raw of [project.id, project.displayName]) {
      if (typeof raw === 'string' && raw.trim()) {
        variants.push({ raw: raw.trim(), projectId: project.id })
      }
    }
  }
  for (const [alias, canonicalId] of Object.entries(aliases)) {
    if (projects.some((p) => p.id === canonicalId)) {
      variants.push({ raw: alias, projectId: canonicalId })
    }
  }
  if (variants.length === 0) {
    return []
  }
  variants.sort((a, b) => b.raw.length - a.raw.length)
  const pattern = variants.map((v) => `(${escapeRegExpToken(v.raw)})`).join('|')
  const re = new RegExp(`\\b(?:${pattern})\\b`, 'gi')
  const found = []
  let m
  while ((m = re.exec(text))) {
    const groupIndex = m.slice(1).findIndex((g) => g !== undefined)
    found.push({
      projectId: variants[groupIndex].projectId,
      start: m.index,
      end: m.index + m[0].length
    })
  }
  return found
}

const EXCLUSION_MARKER_RE = /\b(?:except(?:\s+for)?|excluding|other\s+than|not)\b/i
const BARE_LIST_JOINER_RE = /^[\s,]*(?:and|or)?[\s,]*$/i

// Partitions a segment's own mentions into per-anchor act records plus
// independent ("null-anchor") groups. The structural trigger for a NEW
// act is "a different recognized action begins" (the CASE-32 directive's
// own words) -- operationalized as: one or more verb anchors appear
// between the previous mention and this one (ALL of them apply -- "hold
// off on adopting X" is both a real hold AND a real adoption decline for
// the SAME target, never just the last-matched verb). A bare comma/and/or
// with no intervening words extends the CURRENTLY active anchor(s)' own
// target list ("Pause A, B, and C." -- one act, three targets). An
// exclusion marker (except/excluding/other than/", not ") carves this
// target OUT of the act it would otherwise have joined -- but ONLY when
// the marker's own position comes AFTER the governing anchor's start
// (distinguishes "Adopt everything except B" / "Adopt A, not B" -- a real
// exclusion -- from "Do not adopt X" / "Do not, under any circumstances,
// adopt X" -- ordinary PRE-verb negation of the target's own single
// mention, where "not" precedes the verb it negates, not a later target).
// Anything else (a genuinely unrelated word, e.g. "unless"/"however"/
// "also") starts a fresh, independent group with NO inherited verb -- it
// can only self-classify from its OWN local text (e.g. "also B needs
// serious work" -> B's own zone contains ASSESS's own trigger), never
// inherit the previous target's action (invariant 2/3: exclusion is
// first-class, context may resolve targets but never invent a verb).
function groupMentionsIntoZones(segmentText, mentions, anchors) {
  const anchorRecords = [] // { anchor, targetIds: [], excludedTargetIds: [] }, one per distinct anchor object
  const byAnchor = new Map()
  function recordFor(anchor) {
    if (!byAnchor.has(anchor)) {
      const rec = { anchor, targetIds: [], excludedTargetIds: [] }
      byAnchor.set(anchor, rec)
      anchorRecords.push(rec)
    }
    return byAnchor.get(anchor)
  }

  const nullGroups = []
  const claimedAnchors = new Set()
  let prevEnd = 0
  let activeAnchors = []
  // Independent-review finding (BLOCKING, real, live-confirmed, same
  // mission): an exclusion clause naming MORE THAN ONE target ("except B
  // and C") only carved out the FIRST one -- the bare "and" joining the
  // second target re-entered the ordinary positive-list-continuation
  // branch, silently making C a POSITIVE adopt target instead of also
  // excluded. `inExclusionMode` persists across a bare-list joiner the
  // same way `activeAnchors` does, so "except B and C" excludes both.
  let inExclusionMode = false
  for (const mention of mentions) {
    const between = segmentText.slice(prevEnd, mention.start)
    const anchorsInGap = anchors.filter((a) => a.start >= prevEnd && a.start < mention.start)
    const exclusionMatch = EXCLUSION_MARKER_RE.exec(between)
    let excluded = false
    let excludeFrom = null
    if (anchorsInGap.length > 0) {
      // Independent-review finding (real, live-confirmed, same mission):
      // when this is NOT the first mention in the segment, a gap can
      // legitimately contain an anchor that actually belongs to the
      // PREVIOUS mention's own trailing description ("foo-other needs
      // serious work, adopt foo" -- ASSESS sits right after foo-other,
      // ADOPT right before foo; both fell in foo's own gap and both got
      // wrongly claimed by foo). Only the LAST anchor in the gap -- the
      // one immediately preceding this mention, the "verb target" word
      // order -- claims a NON-FIRST mention; any earlier anchor(s) in the
      // same gap are left unclaimed here so they stay inside the PREVIOUS
      // mention's own null-group zone instead (selfClassifyZoneText finds
      // them there). The first mention in a segment has no "previous
      // mention" to compete with, so it still claims every anchor before
      // it (preserves "hold off on adopting X" -- both EXTERNAL_WORK_HOLD
      // and ADOPT genuinely describe that one, sole, first-mentioned target).
      //
      // Independent-review finding (BLOCKING, round 2, real, live-
      // confirmed): "only the LAST anchor" was too strict whenever the
      // current (non-first) mention's own gap holds a genuine CONTIGUOUS
      // compound verb phrase ("hold off on adopting B" -- HOLD and ADOPT
      // both truly describe B). Walking backward from the last anchor and
      // including each earlier anchor too, as long as nothing but a plain
      // connector (no comma) separates it from the next one, correctly
      // keeps a compound phrase together while still stopping at a real
      // separator ("foo-other needs serious work, adopt foo" -- the comma
      // between ASSESS and ADOPT means they describe DIFFERENT targets,
      // so ASSESS is correctly left for foo-other's own null-group zone).
      const isFirstMention = prevEnd === 0
      let claimableAnchors = anchorsInGap
      if (!isFirstMention) {
        claimableAnchors = [anchorsInGap.at(-1)]
        for (let i = anchorsInGap.length - 2; i >= 0; i--) {
          const between2 = segmentText.slice(anchorsInGap[i].end, anchorsInGap[i + 1].start)
          if (/,/.test(between2)) {
            break
          }
          claimableAnchors.unshift(anchorsInGap[i])
        }
      }
      const lastAnchor = claimableAnchors.at(-1)
      if (exclusionMatch && exclusionMatch.index > lastAnchor.start - prevEnd) {
        excluded = true
        excludeFrom = lastAnchor
        inExclusionMode = true
        for (const a of claimableAnchors) {
          claimedAnchors.add(a)
        }
      } else {
        activeAnchors = claimableAnchors
        inExclusionMode = false // a genuinely new anchor always resets exclusion mode
        for (const a of claimableAnchors) {
          claimedAnchors.add(a)
        }
      }
    } else if (exclusionMatch && activeAnchors.length > 0) {
      excluded = true
      excludeFrom = activeAnchors.at(-1)
      inExclusionMode = true
    } else if (inExclusionMode && BARE_LIST_JOINER_RE.test(between) && activeAnchors.length > 0) {
      // continuing a multi-target exclusion list ("except B and C" -- C is excluded too)
      excluded = true
      excludeFrom = activeAnchors.at(-1)
    } else if (BARE_LIST_JOINER_RE.test(between) && activeAnchors.length > 0) {
      // keep activeAnchors as-is -- bare list continuation
    } else {
      activeAnchors = []
      inExclusionMode = false
    }

    if (excluded) {
      if (excludeFrom) {
        recordFor(excludeFrom).excludedTargetIds.push(mention.projectId)
      }
    } else if (activeAnchors.length > 0) {
      for (const a of activeAnchors) {
        recordFor(a).targetIds.push(mention.projectId)
      }
    } else {
      // Independent-review finding (BLOCKING, round 2, real, live-
      // confirmed): consecutive independent (unclaimed) mentions used to
      // be MERGED into one shared null group -- "A is fine, B needs
      // serious work..." let A and B's own, genuinely DIFFERENT trailing
      // descriptions collapse into one zone, so whatever B's own text
      // matched (ASSESS) got wrongly applied to A too. Every independent
      // mention is now its OWN separate null group -- each project's own
      // self-classification only ever sees ITS OWN local text.
      nullGroups.push({ start: mention.start, mentions: [mention] })
    }
    prevEnd = mention.end
  }

  // Only CLAIMED anchors (ones a mention actually attached to) act as zone
  // boundaries -- an anchor no mention ever claimed (e.g. "niners-war-room
  // doesn't need work" -- the ASSESS trigger sits AFTER its own target's
  // mention, so no earlier mention's anchorsInGap check ever saw it) must
  // stay INSIDE whatever null-group zone it falls in, so that null group's
  // own self-classification (selfClassifyZoneText) can still find it.
  const boundaries = [...claimedAnchors]
    .map((a) => a.start)
    .concat(nullGroups.map((g) => g.start))
    .sort((x, y) => x - y)
  function zoneEndAfter(start) {
    const next = boundaries.find((b) => b > start)
    return next !== undefined ? next : segmentText.length
  }

  const groups = []
  for (const rec of anchorRecords) {
    // Independent-review finding (real, live-confirmed, same mission): a
    // target mentioned twice within one act's zone -- once as an
    // ordinary positive list member, once again after an exclusion
    // marker ("Adopt A and B, not B.") -- ended up in BOTH targetIds and
    // excludedTargetIds, and the positive membership still won downstream
    // (a real false adoption for the explicitly excluded target).
    // Exclusion always wins for the SAME act.
    const excludedSet = new Set(rec.excludedTargetIds)
    const positiveTargetIds = [...new Set(rec.targetIds)].filter((id) => !excludedSet.has(id))
    if (positiveTargetIds.length === 0 && rec.excludedTargetIds.length === 0) {
      continue
    }
    const end = zoneEndAfter(rec.anchor.start)
    groups.push({
      anchor: rec.anchor,
      mentions: positiveTargetIds.map((id) => ({ projectId: id })),
      excludedProjectIds: [...excludedSet],
      start: rec.anchor.start,
      end,
      text: segmentText.slice(rec.anchor.start, end)
    })
  }
  for (const g of nullGroups) {
    const end = zoneEndAfter(g.start)
    groups.push({
      anchor: null,
      mentions: g.mentions,
      excludedProjectIds: [],
      start: g.start,
      end,
      text: segmentText.slice(g.start, end)
    })
  }
  groups.sort((a, b) => a.start - b.start)
  return groups
}

// One segment's own text can genuinely carry more than one distinct
// self-classified action (mirrors the original intentsForSegmentText's
// own "a segment can match more than one pattern" trait) -- used only for
// a null-anchor group's own local text.
// Independent-review finding (BLOCKING, real, live-confirmed, same
// mission): this function re-scans a null-group's own raw text for a verb
// with ZERO awareness of the quote/reported-speech/retracted-hypothetical
// provenance filtering the anchor-scan path already applies. A quoted
// span reading "‹target›, ‹verb›..." (mention BEFORE the verb -- the null-
// group path exists specifically for this word order) let the quoted verb
// still manufacture a real, current-owner-authority act, contradicting
// this module's own documented CASE-31 guarantee. `excludedSpans` +
// `absoluteZoneStart` let every match here be checked the same way the
// anchor-scan path already is.
function selfClassifyZoneText(zoneText, projects, excludedSpans, absoluteZoneStart) {
  const matched = []
  const adoptAnchors = findAdoptVerbAnchors(zoneText, projects).filter(
    (a) => !provenanceAt(excludedSpans, absoluteZoneStart + a.start)
  )
  if (adoptAnchors.length > 0) {
    matched.push({
      verbId: 'ADOPT',
      existingMultiActionIntent: 'ADOPT_CANDIDATE_REPORT',
      negatedMultiActionIntent: 'ADOPT_CANDIDATE_DECLINED'
    })
  }
  for (const entry of VERB_REGISTRY) {
    const m = new RegExp(`\\b${entry.source}\\b`, 'i').exec(zoneText)
    if (m && !provenanceAt(excludedSpans, absoluteZoneStart + m.index)) {
      matched.push({
        verbId: entry.id,
        source: entry.source,
        existingMultiActionIntent: entry.existingMultiActionIntent,
        negatedMultiActionIntent: entry.negatedMultiActionIntent
      })
    }
  }
  return matched
}

// Real, tested entry point: message + real project catalog + aliases ->
// ordered CommandAct[] with real project-id targets/exclusions, resolved
// polarity (provenance/correction-aware) and legacy-intent mapping ready
// for the decomposer adapter below.
export function buildCommandActs(message, projects, aliases) {
  const text = String(message ?? '')
  const excludedSpans = buildExcludedSpans(text)
  const segments = hardSegments(text)
  const acts = []
  let currentTargets = []
  const allMentionedIds = new Set()
  // Accumulated per-project segment text (mirrors the original
  // segmentByProject's own textByProject join) -- used ONLY as the
  // rawClause for a mentioned project that matched no recognized verb at
  // all, so that fallback never leaks an UNRELATED project's own clause
  // text (the original bug: using the whole message as a stand-in).
  const mentionedSegmentText = new Map()
  function recordMentionedText(projectId, t) {
    const prev = mentionedSegmentText.get(projectId)
    if (!prev) {
      mentionedSegmentText.set(projectId, t)
    } else if (!prev.split('. ').includes(t)) {
      mentionedSegmentText.set(projectId, `${prev}. ${t}`)
    }
  }

  for (const segment of segments) {
    const mentions = projectMentionsWithPositions(segment.text, projects, aliases)
    for (const men of mentions) {
      allMentionedIds.add(men.projectId)
      recordMentionedText(men.projectId, segment.text)
    }

    if (mentions.length === 0) {
      // No project named in this segment -- inherits whichever project(s)
      // the most recent naming segment established (ordinary prose
      // doesn't repeat a project's name every sentence).
      if (currentTargets.length === 0) {
        continue
      }
      const localAnchors = findAllVerbAnchors(segment.text, projects).filter(
        (a) => !provenanceAt(excludedSpans, segment.start + a.start)
      )
      for (let i = 0; i < localAnchors.length; i++) {
        const a = localAnchors[i]
        const { polarity } = resolvePreVerbPolarity(segment.text, a.start, localAnchors[i - 1]?.end)
        acts.push({
          verbId: a.verbId,
          targetIds: [...currentTargets],
          excludedTargetIds: [],
          polarity,
          span: [segment.start + a.start, segment.start + a.end],
          rawClause: segment.text, // full segment text -- never truncated, so this branch never had the truncated-rawClause bug
          existingMultiActionIntent: a.existingMultiActionIntent,
          negatedMultiActionIntent: a.negatedMultiActionIntent
        })
      }
      continue
    }

    currentTargets = [...new Set(mentions.map((m) => m.projectId))]
    const localAnchors = findAllVerbAnchors(segment.text, projects).filter(
      (a) => !provenanceAt(excludedSpans, segment.start + a.start)
    )
    const groups = groupMentionsIntoZones(segment.text, mentions, localAnchors)

    for (const group of groups) {
      if (group.anchor) {
        const a = group.anchor
        const anchorIndexInSegment = localAnchors.indexOf(a)
        const prevAnchor = localAnchors[anchorIndexInSegment - 1]
        // Cap the pre-verb negation lookback at the PREVIOUS anchor's end
        // only when a real target mention was crossed in between (the
        // "Don't adopt A, adopt B." case -- A's own mention is the actual
        // boundary, not the mere fact that a different verb appeared
        // earlier). When no mention separates two anchors ("hold off on
        // adopting X" -- one target, two verbs in the same breath), do NOT
        // cap -- "hold off on" is legitimately both EXTERNAL_WORK_HOLD's
        // own trigger AND a real negation trigger for the adoption that
        // immediately follows it, exactly as the pre-existing, independently
        // hardened negation vocabulary already encodes.
        // Self-caught, real, live-confirmed finding (adversarial self-
        // review after independent review rounds 1-2, same mission):
        // capping at the previous ANCHOR's end was too loose -- "Adopt A
        // and B, not B, hold off on adopting C, ..." let the exclusion
        // marker "not" (from the UNRELATED ", not B," carve-out) still
        // sit inside HOLD's own pre-verb negation window, wrongly
        // negating a genuine "hold off on adopting C" into
        // MULTI_ACTION_DECLINED (a real, silent false decline -- the
        // requested durable hold never gets created). Cap at the END OF
        // THE LAST MENTION crossed instead of the previous anchor's own
        // end -- a strictly tighter, more precise boundary (a named
        // target is itself always a stronger "fresh subject" signal than
        // a previous verb) that still correctly isolates "Don't adopt A,
        // adopt B." (A's own end still the cap) while excluding
        // unrelated exclusion-marker text tied to an earlier target.
        const crossingMentions = prevAnchor
          ? mentions.filter((m) => m.start >= prevAnchor.end && m.start < a.start)
          : []
        const lastCrossedMentionEnd =
          crossingMentions.length > 0 ? Math.max(...crossingMentions.map((m) => m.end)) : undefined
        const { polarity, windowStart } = resolvePreVerbPolarity(
          segment.text,
          a.start,
          lastCrossedMentionEnd,
          excludedSpans.map((s) => ({
            span: [s.span[0] - segment.start, s.span[1] - segment.start]
          }))
        )
        // BLOCKING fix (round 3 independent review, real, live-confirmed):
        // rawClause must actually CONTAIN whatever negation trigger made
        // `polarity` NEGATIVE -- server/command-multi-action-bridge.mjs's
        // executeAdoptionCandidate hands ONLY rawClause to its own
        // independent execution-time re-derivation
        // (classifyAdoptionCommandIntent(rawClause, [project])), which is
        // this codebase's real, load-bearing safety net before a
        // consequential git merge. Slicing from `windowStart` (the exact
        // boundary resolvePreVerbPolarity itself used) instead of the
        // anchor's own start means a truncated "adopt A, " (previously
        // losing "Don't ") becomes "Don't adopt A, " -- the re-derivation
        // now sees the same text the polarity computation already did.
        // windowStart never reaches into another target's own act (it is
        // capped at the previous anchor/mention exactly the same way the
        // polarity window already is), so this can never reintroduce the
        // CASE-32 bleed this whole model exists to prevent.
        const rawClause = segment.text.slice(windowStart, group.end)
        acts.push({
          verbId: a.verbId,
          targetIds: group.mentions.map((m) => m.projectId),
          excludedTargetIds: [...group.excludedProjectIds],
          polarity,
          span: [segment.start + a.start, segment.start + a.end],
          rawClause,
          existingMultiActionIntent: a.existingMultiActionIntent,
          negatedMultiActionIntent: a.negatedMultiActionIntent
        })
      } else {
        const absoluteZoneStart = segment.start + group.start
        const matches = selfClassifyZoneText(group.text, projects, excludedSpans, absoluteZoneStart)
        for (const entry of matches) {
          const localAnchor =
            entry.verbId === 'ADOPT'
              ? findAdoptVerbAnchors(group.text, projects).find(
                  (a) => !provenanceAt(excludedSpans, absoluteZoneStart + a.start)
                )
              : new RegExp(`\\b${entry.source}\\b`, 'i').exec(group.text)
          const localStart = localAnchor ? (localAnchor.start ?? localAnchor.index) : 0
          acts.push({
            verbId: entry.verbId,
            targetIds: group.mentions.map((m) => m.projectId),
            excludedTargetIds: [],
            polarity: resolvePreVerbPolarity(group.text, localStart, 0).polarity,
            span: [
              segment.start + group.start + localStart,
              segment.start + group.start + localStart
            ],
            rawClause: group.text, // the full zone text, never truncated past its own start -- no rawClause-widening needed here
            existingMultiActionIntent: entry.existingMultiActionIntent,
            negatedMultiActionIntent: entry.negatedMultiActionIntent
          })
        }
      }
    }
  }

  applyCorrectionAmendments(acts, text, excludedSpans, projects, segments)

  // Provenance: an act whose own verb anchor fell inside an excluded span
  // was already dropped at the findAllVerbAnchors/findAdoptVerbAnchors
  // filter step above (anchors, not acts, are filtered by position) --
  // acts here already only ever come from CURRENT_OWNER_STATEMENT text.
  for (const act of acts) {
    act.provenance = 'CURRENT_OWNER_STATEMENT'
    delete act.__anchorRef
  }

  return { acts, allMentionedIds: [...allMentionedIds], mentionedSegmentText }
}

// ============================================================================
// Legacy adapter: buildCommandActs -> the exact { target, intent, rawClause }
// shape domain/command-multi-action-decomposition.mjs's own decomposeMultiAction
// has always returned, so every existing consumer (server/command-multi-
// action-bridge.mjs, server/command-adoption-command-bridge.mjs, and their
// tests) keeps working unchanged. Invariant 4 ("the final current-owner act
// for a target/action pair wins") is applied HERE, per (target, verbId) pair,
// across the WHOLE message -- not just within one segment -- since a
// correction can legitimately span segments ("Don't adopt A; actually adopt
// B." is two DIFFERENT targets, no conflict; a same-target cross-segment
// correction is rare but this dedup makes it safe either way).
// ============================================================================
export function decomposeMultiActionFromActs(message, projects, aliases) {
  const { acts, allMentionedIds, mentionedSegmentText } = buildCommandActs(
    message,
    projects,
    aliases
  )
  // Grouped BY PROJECT, in first-MENTION order (matching the original
  // segmentByProject-based ordering every existing consumer/test was
  // built against -- e.g. server/command-multi-action-bridge.mjs's own
  // grouped-by-project response section order) -- NOT by first-ACT order,
  // which can differ when an earlier-mentioned project's only clause
  // matches no verb at all (its real entries all come from the "every
  // mentioned project gets >=1 entry" fallback) while a later-mentioned
  // project's clause matches a real verb immediately.
  const byTarget = new Map() // targetId -> Map<verbId, act> (last act wins per verb, insertion order = first-seen-for-this-target order)
  for (const act of acts) {
    for (const targetId of act.targetIds) {
      if (!byTarget.has(targetId)) {
        byTarget.set(targetId, new Map())
      }
      byTarget.get(targetId).set(act.verbId, act) // Map.set on an existing key keeps its original insertion position but updates the value -- last act (by message order) wins per (target, verb)
    }
  }
  const entries = []
  for (const targetId of allMentionedIds) {
    const verbActs = byTarget.get(targetId)
    if (!verbActs || verbActs.size === 0) {
      // Every mentioned project gets at least one entry (never silently
      // dropped) -- covers exclusion-carve-out targets and any project
      // whose only mention matched no recognized verb at all.
      entries.push({
        target: targetId,
        intent: 'GENERAL',
        rawClause: mentionedSegmentText.get(targetId) ?? message
      })
      continue
    }
    for (const act of verbActs.values()) {
      const intent =
        act.polarity === 'POSITIVE' ? act.existingMultiActionIntent : act.negatedMultiActionIntent
      entries.push({ target: targetId, intent, rawClause: act.rawClause })
    }
  }
  return entries
}
