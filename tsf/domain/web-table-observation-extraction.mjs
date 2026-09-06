// Generic mapper: an already-extracted web table ({headers, rows} -- see
// web-table-source-adapter.mjs's artifactRef) -> BoundedResearchResult-
// shaped proposedClaims/evidence/sourceReferences. No entity-specific or
// field-specific names are hardcoded: the target row is found by matching
// ANY cell against the request's own targetEntity, and each requested
// field is matched against a column HEADER by normalized string equality
// first, then a word-level subset check (real-network finding: a
// synthesized field name like "League Year" vs a real page's own "Year"
// header are common, honest naming variance, not a reason to miss the
// column entirely) -- still purely structural, never a semantic/synonym
// guess (e.g. "Salary Cap Amount" vs "Maximum team salary" shares no word
// overlap and is correctly left unmatched, disclosed as a real, generic
// limitation in the final report).
//
// Real, adversarially-found bug in an earlier version of this widening:
// plain character-substring containment let "Percent Change from Prior
// Year" match the "Year" column, since "year" is a coincidental substring
// of "prioryear" once spaces are stripped -- a genuine false claim, not
// mere imprecision. Fixed by matching on WHOLE WORDS only, and requiring
// the shorter phrase's word count to be a substantial fraction (>= half)
// of the longer's, so one incidental shared word buried in an otherwise
// unrelated, much longer phrase is correctly rejected.
function normalize(text) {
  return String(text ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function words(text) {
  return String(text ?? '').trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

const MIN_WORD_OVERLAP_RATIO = 0.5

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

// True only if the shorter word-list is ENTIRELY contained (every word
// present) in the longer one, AND is at least half its length -- a single
// common word (e.g. "year") inside an otherwise unrelated 5-word phrase
// fails the ratio check and is correctly rejected.
function isWordSubsetMatch(fieldWords, headerWords) {
  const [shorter, longer] = fieldWords.length <= headerWords.length ? [fieldWords, headerWords] : [headerWords, fieldWords]
  if (shorter.length === 0) {
    return false
  }
  if (shorter.length / longer.length < MIN_WORD_OVERLAP_RATIO) {
    return false
  }
  const longerSet = new Set(longer)
  return shorter.every((w) => longerSet.has(w))
}

function matchColumnIndex(headers, fieldName) {
  const target = normalize(fieldName)
  const exact = headers.findIndex((header) => normalize(header) === target)
  if (exact !== -1) {
    return exact
  }
  const fieldWords = words(fieldName)
  return headers.findIndex((header) => isWordSubsetMatch(fieldWords, words(header)))
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
