// Conversational Hands-Free V2, generic voice layer: plain-text shortening
// for SPOKEN output only -- the visible transcript always keeps the full,
// unmodified response text (never remove evidence), this only bounds what
// gets read aloud. Zero TSF/product knowledge -- a product with its own
// purpose-built spoken-summary field can bypass this entirely; this is the
// safe, always-available default for a plain-text response.
const MARKDOWN_EMPHASIS_PATTERN = /[*_`#]/g
const SENTENCE_BOUNDARY_PATTERN = /(?<=[.!?])\s+/

export function summarizeForSpeech(text: string, maxLength = 200): string {
  const plain = text.replace(MARKDOWN_EMPHASIS_PATTERN, '').trim()
  if (plain.length <= maxLength) {
    return plain
  }
  const sentences = plain.split(SENTENCE_BOUNDARY_PATTERN)
  let result = ''
  for (const sentence of sentences) {
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
