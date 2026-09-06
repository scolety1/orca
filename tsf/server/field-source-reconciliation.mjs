// Bounded semantic reconciliation for fields with no exact header match:
// asks the existing live-planner (same mechanism as spec synthesis) which
// real header represents the same concept, e.g. "Salary Cap" <-> "Maximum
// team salary". May only SELECT among given headers (verbatim-validated
// below) -- can misidentify a mapping, never fabricate one.
import { invokeLiveStructuredAnalysis } from './live-planner.mjs'
import { buildFieldBinding } from '../domain/field-binding.mjs'

const RECONCILIATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bindings'],
  properties: {
    bindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fieldName', 'matchedHeader', 'confidence', 'reasoning'],
        properties: {
          fieldName: { type: 'string' },
          matchedHeader: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          reasoning: { type: 'string' }
        }
      }
    }
  }
}

const SYSTEM_PROMPT = [
  'You are matching REQUESTED DATA FIELD NAMES to REAL COLUMN HEADERS from an actual, already-fetched data table. You identify which column holds an answer -- you never see or report the actual row values, and you do not know what any specific value is.',
  '',
  'For each requested field, decide whether ANY of the given real headers represents the SAME underlying concept (e.g. "Salary Cap" and "Maximum team salary" are the same concept; "Team Record" and "Record High Team Attendance" are NOT, despite sharing words).',
  '',
  'If a header clearly matches: set matchedHeader to that header, copied EXACTLY character-for-character from the given list, with a confidence between 0 and 1 and one sentence of reasoning.',
  'If no header confidently represents that concept, or you are unsure: set matchedHeader to null and explain why in reasoning. Never guess. Never invent a header that is not verbatim in the given list -- if you do, your answer will be discarded.'
].join('\n')

// Returns FieldBinding[], possibly shorter than unresolvedFieldNames -- an
// unaddressed or invalid-header field is simply absent, never guessed.
export async function reconcileFieldsToHeaders({ headers, unresolvedFieldNames, sourceIdentity }) {
  if (unresolvedFieldNames.length === 0) {
    return []
  }
  const prompt = JSON.stringify({ realColumnHeaders: headers, requestedFieldsNeedingAMatch: unresolvedFieldNames })
  const live = await invokeLiveStructuredAnalysis({
    systemPrompt: SYSTEM_PROMPT,
    prompt,
    jsonSchema: RECONCILIATION_SCHEMA,
    timeoutOverrideMs: 60000
  })
  if (!live.ok) {
    return []
  }
  const headerSet = new Set(headers)
  const bindings = []
  for (const entry of live.data?.bindings ?? []) {
    if (typeof entry?.fieldName !== 'string' || !unresolvedFieldNames.includes(entry.fieldName)) {
      continue
    }
    // Anti-hallucination gate: the matched header MUST be verbatim one of
    // the real headers given -- never trust an invented one, regardless
    // of how confident the response claims to be.
    if (entry.matchedHeader != null && !headerSet.has(entry.matchedHeader)) {
      continue
    }
    bindings.push(
      buildFieldBinding({
        canonicalField: entry.fieldName,
        rawHeader: entry.matchedHeader ?? null,
        sourceIdentity,
        reconciliationMethod: entry.matchedHeader != null ? 'BOUNDED_SEMANTIC' : 'UNRESOLVED',
        confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
        reasoning: typeof entry.reasoning === 'string' ? entry.reasoning : null
      })
    )
  }
  return bindings
}
