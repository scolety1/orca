// Generic mapper: an already-extracted web table ({headers, rows} -- see
// web-table-source-adapter.mjs's artifactRef) -> BoundedResearchResult-
// shaped proposedClaims/evidence/sourceReferences. No entity-specific or
// field-specific names are hardcoded: the target row is found by matching
// ANY cell against the request's own targetEntity, and each requested
// field is matched against a column HEADER by normalized string equality
// only -- never guessed, never fuzzy beyond that normalization.
function normalize(text) {
  return String(text ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// The row whose cells contain the target entity's id or name, checked
// against every column (never assumes which column identifies the row).
function findEntityRow(headers, rows, targetEntity) {
  if (!targetEntity) {
    return null
  }
  const candidates = [targetEntity.entityId, targetEntity.name].filter(Boolean).map(normalize)
  if (candidates.length === 0) {
    return null
  }
  return rows.find((row) => row.some((cell) => candidates.includes(normalize(cell)))) ?? null
}

function matchColumnIndex(headers, fieldName) {
  const target = normalize(fieldName)
  return headers.findIndex((header) => normalize(header) === target)
}

/**
 * Returns { proposedClaims, evidence, sourceReferences } -- proposedClaims
 * only for fields whose header matched AND whose cell is a real, non-missing
 * value; unmatched fields are simply absent (honest typed missingness via
 * the existing completeness machinery, never a fabricated null claim).
 */
export function extractObservationsFromWebTable({ headers, rows }, { requestedFieldNames, targetEntity, temporalScope, sourceRef, publisher, retrievedAt }) {
  const row = findEntityRow(headers, rows, targetEntity)
  if (!row) {
    return { matched: false, proposedClaims: [], evidence: [], sourceReferences: [] }
  }
  const proposedClaims = []
  const evidence = []
  for (const fieldName of requestedFieldNames) {
    const columnIndex = matchColumnIndex(headers, fieldName)
    if (columnIndex < 0) {
      continue
    }
    const rawValue = row[columnIndex]
    if (rawValue == null || String(rawValue).trim() === '') {
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
  }
  const sourceReferences = proposedClaims.length > 0 ? [{ sourceRef, url: sourceRef, publisher: publisher ?? null, retrievedAt }] : []
  return { matched: true, proposedClaims, evidence, sourceReferences }
}
