// Generic web-table -> BoundedResearchResult mapper: no entity/field names
// hardcoded. Exact header match only here (100% safe); anything unresolved
// goes to bounded semantic reconciliation (field-source-reconciliation.mjs)
// via caller-supplied FieldBindings -- fuzzy lexical matching was removed
// after it produced a false match on a word coincidence (e.g. "Team Record"
// vs "Record High Team Attendance").
// Phase 3 Wave 2 (3F): a version tag for THIS extraction algorithm itself,
// distinct from the acquisition adapter's own version (web-table-source-
// adapter.mjs's WEB_TABLE_SOURCE_ADAPTER_VERSION) -- the same raw snapshot
// could be re-processed by a future, different extraction algorithm and
// produce different claims; callers that admit a SourceSnapshotReference's
// transformationVersion can tell which version of THIS logic ran. Bump
// this only when the extraction algorithm's own semantics change.
export const WEB_TABLE_OBSERVATION_EXTRACTION_VERSION = '1.0.0'

function normalize(text) {
  return String(text ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// The row whose cells contain the target entity's id or name, checked
// against every column (never assumes which column identifies the row).
export function findEntityRow(headers, rows, targetEntity) {
  if (!targetEntity) {
    return null
  }
  const candidates = [targetEntity.entityId, targetEntity.name].filter(Boolean).map(normalize)
  if (candidates.length === 0) {
    return null
  }
  return rows.find((row) => row.some((cell) => candidates.includes(normalize(cell)))) ?? null
}

export function matchExactColumnIndex(headers, fieldName) {
  const target = normalize(fieldName)
  return headers.findIndex((header) => normalize(header) === target)
}

// `additionalBindings`: FieldBinding[] from a prior reconciliation pass;
// rawHeader is re-looked-up via indexOf (never trusted as an index), so the
// extracted VALUE always comes from the real matched cell.
export function extractObservationsFromWebTable({ headers, rows }, { requestedFieldNames, targetEntity, temporalScope, sourceRef, publisher, retrievedAt, additionalBindings = [] }) {
  const row = findEntityRow(headers, rows, targetEntity)
  if (!row) {
    return { matched: false, proposedClaims: [], evidence: [], sourceReferences: [], unresolvedFieldNames: [...requestedFieldNames] }
  }
  const proposedClaims = []
  const evidence = []
  const unresolvedFieldNames = []
  const fieldBindingsUsed = []
  for (const fieldName of requestedFieldNames) {
    let columnIndex = matchExactColumnIndex(headers, fieldName)
    let method = 'EXACT'
    if (columnIndex === -1) {
      const binding = additionalBindings.find((b) => b.canonicalField === fieldName && b.rawHeader != null)
      if (binding) {
        columnIndex = headers.indexOf(binding.rawHeader)
        method = binding.reconciliationMethod ?? 'BOUNDED_SEMANTIC'
      }
    }
    if (columnIndex === -1) {
      unresolvedFieldNames.push(fieldName)
      continue
    }
    const rawValue = row[columnIndex]
    if (rawValue == null || String(rawValue).trim() === '') {
      unresolvedFieldNames.push(fieldName)
      continue
    }
    proposedClaims.push({
      fieldName,
      proposedValue: rawValue,
      temporalScope,
      providerConfidence: null, // honest: a table cell carries no provider-reported confidence score
      providerReasoning: null
    })
    evidence.push({ claimFieldName: fieldName, sourceRef, snippet: `${headers[columnIndex]}: ${rawValue}`, supportsClaim: true })
    fieldBindingsUsed.push({ fieldName, rawHeader: headers[columnIndex], reconciliationMethod: method })
  }
  const sourceReferences = proposedClaims.length > 0 ? [{ sourceRef, url: sourceRef, publisher: publisher ?? null, retrievedAt }] : []
  return { matched: true, proposedClaims, evidence, sourceReferences, unresolvedFieldNames, fieldBindingsUsed }
}
