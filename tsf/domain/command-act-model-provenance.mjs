// Provenance pre-pass for domain/command-act-model.mjs: quote / reported-
// speech / retracted-hypothetical span detection (CASE-31's core fix).
// Generalizes the golden-path eval's already-tested Property D ("a quoted
// command is not itself the owner's directive") into a reusable primitive
// instead of a test-only assertion. Split into its own file purely to keep
// command-act-model.mjs under this repo's max-lines budget (that file was
// already well over budget before this closure pass touched it -- a
// pre-existing, disclosed gap, not something this extraction is trying to
// fully resolve) -- no logic changed by the move.

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
// DIRECTIVE SEMANTICS CLOSURE V1 (P0): only the literal verb "said" was
// recognized -- "The report says to pause NWR." (present tense) and
// "Claude reported that we should pause NWR." both produced a real,
// executable PAUSE act. Added "says"/"reports"/"reported" (unambiguously
// the SAME reporting-verb family as "said", never a genuine directive
// verb on their own) and "the report" as a subject. Deliberately did NOT
// add "mentioned"/"noted"/"suggested" -- "I mentioned earlier, pause NWR
// now." uses "mentioned" as a casual aside before a real, separate
// directive (no comma boundary exists in this pre-pass to separate them),
// so those verbs risk suppressing a genuine later directive rather than
// only ever excluding someone else's reported words -- a disclosed,
// narrower residual, not an oversight.
const REPORTED_SPEECH_OPENER =
  /\b(?:i|you|claude|the (?:plan|assistant|report))\s+(?:said|says|reported|reports)\b/gi
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
// "but"), matching CORRECTION_MARKER_SOURCE below.
const RETRACTED_HYPOTHETICAL_OPENER =
  /\bi\s+(?:was\s+going\s+to\s+say|was\s+thinking\s+(?:of|about)\s+saying|almost\s+said)\b/gi
export const CORRECTION_MARKER_SOURCE =
  '(?:actually|wait|scratch that|i mean|on second thought|but never mind|never mind|forget it|disregard that|strike that|take that back|no wait|cancel that)'
// DIRECTIVE SEMANTICS CLOSURE V1 (P0): "scratch that"/"never mind"/"but
// never mind" are themselves the FULL retraction signal -- unlike
// "actually"/"wait"/"i mean"/"on second thought" (which are openers that
// need the TEXT AFTER them inspected for a negation/affirmation), these
// three convey "cancel the preceding act" completely on their own, with
// nothing meaningful ever following them. Bare, self-contained subset of
// CORRECTION_MARKER_SOURCE, checked in command-act-model.mjs's own
// applyCorrectionAmendments.
// DIRECTIVE SEMANTICS CLOSURE V1, round 3 (P0, real Codex adversarial-
// review finding): this had drifted out of sync with server/chat-
// responder.mjs's own RETRACTION_MARKER_PATTERN, which already recognizes
// forget it/disregard that/strike that/take that back/no wait/cancel that
// as the identical class of bare, self-contained retraction -- "Pause
// NWR, cancel that" still executed a real PAUSE here. Brought up to the
// same vocabulary; kept as an independently-defined (not imported) but
// explicitly cross-referenced copy, matching this file's own established
// domain/server-layering precedent (see NOT_CONTRACTION_SOURCE in
// domain/command-act-model.mjs) -- this module needs a raw source-pattern
// STRING to interpolate into its own boundary-detection regex, not a
// compiled RegExp, so a direct import of the server-side constant isn't
// the right shape here.
export const BARE_RETRACTION_MARKER_SOURCE =
  '(?:scratch that|but never mind|never mind|forget it|disregard that|strike that|take that back|no wait|cancel that)'
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
