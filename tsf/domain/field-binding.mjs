// TSF_FIELD_BINDING_V1 -- records HOW a canonical requested field was
// matched to a real source column, never the value itself (that always
// comes from the actual matched cell -- see web-table-observation-
// extraction.mjs). Domain-neutral: no field/topic names hardcoded here.
export function buildFieldBinding({ canonicalField, rawHeader, sourceIdentity, reconciliationMethod, confidence = null, reasoning = null }) {
  return {
    schemaVersion: 'TSF_FIELD_BINDING_V1',
    canonicalField,
    rawHeader,
    sourceIdentity,
    reconciliationMethod, // 'EXACT' | 'BOUNDED_SEMANTIC' | 'UNRESOLVED'
    confidence,
    reasoning
  }
}
