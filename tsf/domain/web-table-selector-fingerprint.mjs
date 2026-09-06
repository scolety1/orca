// Selector/locator identity and DOM-drift evidence for an acquired table.
// A future re-fetch compares its fingerprint against the one stored on the
// prior receipt to detect that the page's structure changed underneath the
// adapter, without running a full monitoring service.

import { createHash } from 'node:crypto'

export const TABLE_LOCATOR_VERSION = 'TSF_WEB_TABLE_LOCATOR_V1'

function sha256(text) {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

/**
 * `table` is one entry from extractTablesFromHtml. `precedingHeadingText` is
 * optional evidence (nearest <h1-h6> before the table) used only to make the
 * locator human-legible, not for structural comparison.
 */
export function computeTableSelectorFingerprint(table, { precedingHeadingText = null } = {}) {
  const headerSignature = table.headers.join('|')
  return {
    locatorVersion: TABLE_LOCATOR_VERSION,
    tableIndex: table.index,
    caption: table.caption,
    precedingHeadingText,
    columnCount: table.columnCount,
    headerSignatureHash: sha256(headerSignature),
    shapeFingerprintHash: sha256(`${table.columnCount}|${table.headerRowCount}|${headerSignature}`)
  }
}

/**
 * Compares a newly computed fingerprint against the one recorded on a prior
 * receipt for the same logical source. Returns drifted:false when there is
 * no prior fingerprint to compare against (first acquisition).
 */
export function detectTableDrift(previousFingerprint, currentFingerprint) {
  if (!previousFingerprint) {
    return { drifted: false, changedFields: [] }
  }
  const changedFields = []
  if (previousFingerprint.shapeFingerprintHash !== currentFingerprint.shapeFingerprintHash) {
    changedFields.push('shapeFingerprintHash')
  }
  if (previousFingerprint.headerSignatureHash !== currentFingerprint.headerSignatureHash) {
    changedFields.push('headerSignatureHash')
  }
  if (previousFingerprint.columnCount !== currentFingerprint.columnCount) {
    changedFields.push('columnCount')
  }
  return {
    drifted: changedFields.length > 0,
    changedFields,
    warning:
      changedFields.length > 0
        ? `Table structure changed since the prior acquisition: ${changedFields.join(', ')}`
        : null
  }
}
