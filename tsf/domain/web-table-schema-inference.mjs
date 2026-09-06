// Infers a per-column observed type from extracted table cells. Field names
// come verbatim from the page's own header text -- this module never renames
// a column to a domain concept (e.g. "Yards" is never remapped to a semantic
// stat ID). That mapping, if any, belongs to a downstream consumer.

const MISSING_TOKENS = new Set(['', '-', '—', '–', 'n/a', 'na', 'tbd', 'unknown'])

const NUMBER_PATTERN = /^-?\$?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?%?$/
const DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/

function isMissingCell(value) {
  return MISSING_TOKENS.has(value.trim().toLowerCase())
}

function classifyCell(value) {
  const trimmed = value.trim()
  if (isMissingCell(trimmed)) {
    return 'missing'
  }
  if (NUMBER_PATTERN.test(trimmed)) {
    return trimmed.endsWith('%') ? 'percentage' : 'number'
  }
  if (DATE_PATTERN.test(trimmed)) {
    return 'date'
  }
  return 'string'
}

/**
 * Given flattened `headers` and `bodyRows` (arrays of arrays, one entry per
 * header/column), returns per-column { fieldName, observedType, confidence,
 * missingCount } plus the total count of acquisition-side missing cells.
 */
export function inferTableSchema(headers, bodyRows) {
  const columnCount = headers.length
  const columns = headers.map((fieldName, columnIndex) => {
    const typeCounts = { number: 0, percentage: 0, date: 0, string: 0 }
    let missingCount = 0
    let observedCount = 0
    for (const row of bodyRows) {
      const raw = row[columnIndex] ?? ''
      const kind = classifyCell(raw)
      if (kind === 'missing') {
        missingCount += 1
        continue
      }
      typeCounts[kind] += 1
      observedCount += 1
    }
    const dominant = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]
    const observedType =
      observedCount === 0 ? 'unknown' : dominant[1] === 0 ? 'string' : dominant[0]
    const confidence = observedCount === 0 ? 0 : Number((dominant[1] / observedCount).toFixed(2))
    return { fieldName, columnIndex, observedType, confidence, missingCount, observedCount }
  })
  const totalMissingCells = columns.reduce((sum, column) => sum + column.missingCount, 0)
  return { columns, columnCount, totalMissingCells }
}
