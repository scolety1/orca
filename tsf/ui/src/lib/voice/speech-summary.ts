// Conversational Hands-Free V2, generic voice layer: plain-text shortening
// for SPOKEN output only -- the visible transcript always keeps the full,
// unmodified response text (never remove evidence), this only bounds what
// gets read aloud. Zero TSF/product knowledge -- a product with its own
// purpose-built spoken-summary field can bypass this entirely; this is the
// safe, always-available default for a plain-text response.
const MARKDOWN_EMPHASIS_PATTERN = /[*_`#]/g
// REAL DOGFOOD FINDING (post-mission, P1): a real Command response is
// often a bullet list with no terminal sentence punctuation per line
// ("- **NWR** -- Execution hold\n- **TSF** -- ..."), pervasive across
// server/command-*-bridge.mjs's own response text. Splitting only on
// .!? treated the WHOLE list as one unsplittable "sentence" once it
// exceeded maxLength, degrading to a raw character-count truncation that
// could cut off mid-word/mid-item with no signal more content existed.
// A newline is exactly as natural a spoken pause as sentence punctuation.
const SENTENCE_BOUNDARY_PATTERN = /(?<=[.!?])\s+|\n+/

export function summarizeForSpeech(text: string, maxLength = 200): string {
  const plain = text.replace(MARKDOWN_EMPHASIS_PATTERN, '').trim()
  if (plain.length <= maxLength) {
    return plain
  }
  const sentences = plain.split(SENTENCE_BOUNDARY_PATTERN)
  let result = ''
  for (const sentence of sentences) {
    // REAL CODEX ADVERSARIAL-REVIEW FINDING (P1, fixed): this overflow
    // check only ever broke when `result` was already non-empty, so a
    // single FIRST sentence longer than maxLength on its own was accepted
    // in full -- the cap was not actually a cap. A pure 500-character
    // one-sentence probe returned all 500 characters against the default
    // 200 limit.
    if (!result && sentence.length > maxLength) {
      return sentence.slice(0, maxLength).trim()
    }
    const next = result ? `${result} ${sentence}` : sentence
    if (next.length > maxLength && result) {
      break
    }
    result = next
    if (result.length >= maxLength) {
      break
    }
  }
  return result || plain.slice(0, maxLength).trim()
}
