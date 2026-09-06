// WEB_TABLE_SOURCE_ADAPTER V0 orchestrator: routes a source candidate, then
// (only if allowed) fetches it, discovers/selects a table with recorded
// evidence, infers its schema, fingerprints it for drift detection, and
// hands off a WEB_SOURCE_ACQUISITION_RECEIPT_V0. Domain-neutral -- nothing
// here knows about football, wine, or any other subject matter.
//
// Internal/test-facing building block, not the production entrypoint:
// `fetchOptions.fetchImpl` defaults to plain, unpinned global fetch when a
// caller omits it. Production callers extracting from a public web source
// must use public-web-source-acquisition.mjs's `acquirePublicWebTableSource`
// instead, which forces connection-time DNS-pinned transport and mandatory
// robots preflight non-bypassably. This function stays flexible for tests
// and for that wrapper's own internal use.

import { fetchBounded } from '../adapters/bounded-http-fetch.mjs'
import { extractTablesFromHtml, maskHtmlComments } from './html-table-tokenizer.mjs'
import { inferTableSchema } from './web-table-schema-inference.mjs'
import {
  computeTableSelectorFingerprint,
  detectTableDrift
} from './web-table-selector-fingerprint.mjs'
import { routeSourceCandidate } from './web-source-router.mjs'
import {
  buildRefusalReceipt,
  buildExtractionFailureReceipt,
  buildAcquisitionReceipt
} from './web-source-acquisition-receipt.mjs'
import {
  performRobotsPreflight,
  applyRobotsEvidenceToAccessInput
} from './web-source-robots-preflight.mjs'

const HEADING_PATTERN = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis
const TIME_ELEMENT_PATTERN = /<time[^>]*\bdatetime\s*=\s*["']([^"']+)["'][^>]*>([^<]*)<\/time>/i
const TEXTUAL_DATE_PATTERN = /\b([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/

function stripTagsLocal(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findNearestPrecedingHeadingText(html, beforeIndex) {
  let nearest = null
  for (const match of maskHtmlComments(html).matchAll(HEADING_PATTERN)) {
    if (match.index >= beforeIndex) {
      break
    }
    nearest = stripTagsLocal(match[1])
  }
  return nearest
}

function findSourceAsOfEvidence(html, table, precedingHeadingText) {
  const masked = maskHtmlComments(html)
  const scopeStart = Math.max(0, table.startIndex - 1000)
  const scope = masked.slice(scopeStart, table.endIndex)
  const timeMatch = scope.match(TIME_ELEMENT_PATTERN)
  if (timeMatch) {
    return {
      evidence: timeMatch[2].trim() || timeMatch[1],
      extractionMethod: 'EXPLICIT_TIME_ELEMENT',
      confidence: 'HIGH',
      value: timeMatch[1]
    }
  }
  const captionMatch = table.caption ? table.caption.match(TEXTUAL_DATE_PATTERN) : null
  if (captionMatch) {
    return {
      evidence: table.caption,
      extractionMethod: 'TEXTUAL_DATE_IN_CAPTION',
      confidence: 'MEDIUM',
      value: null
    }
  }
  const headingMatch = precedingHeadingText
    ? precedingHeadingText.match(TEXTUAL_DATE_PATTERN)
    : null
  if (headingMatch) {
    return {
      evidence: precedingHeadingText,
      extractionMethod: 'TEXTUAL_DATE_NEAR_TABLE',
      confidence: 'MEDIUM',
      value: null
    }
  }
  return { evidence: null, extractionMethod: 'NONE', confidence: 'NONE', value: null }
}

/**
 * Selects one table by explicit evidence: an explicit hint (by index or a
 * caption substring) wins; otherwise the largest table that has a header
 * row and at least one body row. Records every candidate considered.
 */
export function selectTableWithEvidence(tables, hint) {
  const candidates = tables.map((t) => ({
    index: t.index,
    caption: t.caption,
    rowCount: t.rowCount,
    columnCount: t.columnCount
  }))
  if (tables.length === 0) {
    return { selectedIndex: null, method: 'NONE_AVAILABLE', candidatesConsidered: candidates }
  }

  if (hint?.tableIndex !== undefined && tables[hint.tableIndex]) {
    return {
      selectedIndex: hint.tableIndex,
      method: 'EXPLICIT_INDEX_HINT',
      candidatesConsidered: candidates
    }
  }
  if (hint?.captionIncludes) {
    const match = tables.find(
      (t) => t.caption && t.caption.toLowerCase().includes(hint.captionIncludes.toLowerCase())
    )
    if (match) {
      return {
        selectedIndex: match.index,
        method: 'EXPLICIT_CAPTION_HINT',
        candidatesConsidered: candidates
      }
    }
  }
  const withHeader = tables.filter((t) => t.headers.length > 0 && t.rowCount > 0)
  const pool = withHeader.length > 0 ? withHeader : tables
  const largest = pool.reduce(
    (best, t) => (t.rowCount * t.columnCount > best.rowCount * best.columnCount ? t : best),
    pool[0]
  )
  return {
    selectedIndex: largest.index,
    method: 'LARGEST_TABLE_WITH_HEADER',
    candidatesConsidered: candidates
  }
}

/**
 * Full V0.5 pipeline. Does not fetch at all when routing refuses; never
 * bypasses the rights gate. `accessInput` feeds classifyWebSourceAccess via
 * the router; `retentionPolicy.allowRawRetention` must be explicitly true to
 * embed raw HTML in the receipt.
 *
 * `robotsPreflight.enabled: true` performs a live robots.txt retrieval
 * before routing (V0.5) and merges its evidence into accessInput via
 * applyRobotsEvidenceToAccessInput -- live evidence always wins over any
 * robotsDecision the caller tried to supply. Omitted/false preserves V0's
 * exact prior behavior (caller-supplied robotsDecision used as-is), so
 * Main TSF's existing V0 adoption is unaffected unless a caller opts in.
 */
export async function acquireWebSourceViaStaticTable({
  candidate,
  accessInput,
  fetchOptions = {},
  robotsPreflight,
  transportEvidence = null,
  tableSelectionHint,
  previousSelectorFingerprint = null,
  retentionPolicy = { allowRawRetention: false },
  clock = () => new Date()
}) {
  let effectiveAccessInput = accessInput
  let robotsEvidence = null
  if (robotsPreflight?.enabled) {
    robotsEvidence = await performRobotsPreflight({
      url: candidate.url,
      fetchOptions: robotsPreflight.fetchOptions ?? fetchOptions,
      retainRawRobotsContent: robotsPreflight.retainRawRobotsContent ?? false,
      clock
    })
    effectiveAccessInput = applyRobotsEvidenceToAccessInput(robotsEvidence, accessInput)
  }

  const routeDecision = routeSourceCandidate(candidate, effectiveAccessInput)
  if (routeDecision.decision !== 'STATIC_TABLE_ADAPTER') {
    return {
      receipt: buildRefusalReceipt({ routeDecision, robotsEvidence, transportEvidence, clock }),
      routeDecision
    }
  }

  const fetchResult = await fetchBounded({ url: candidate.url, ...fetchOptions })
  if (!fetchResult.ok) {
    return {
      receipt: buildExtractionFailureReceipt({
        routeDecision,
        failureReason: fetchResult.reason,
        failureDetail: fetchResult.detail,
        robotsEvidence,
        transportEvidence,
        clock
      }),
      routeDecision
    }
  }

  const tables = extractTablesFromHtml(fetchResult.bodyText)
  const selection = selectTableWithEvidence(tables, tableSelectionHint)
  if (selection.selectedIndex === null) {
    return {
      receipt: buildExtractionFailureReceipt({
        routeDecision,
        failureReason: 'NO_TABLES_FOUND',
        failureDetail: candidate.url,
        robotsEvidence,
        transportEvidence,
        clock
      }),
      routeDecision,
      selection
    }
  }

  const table = tables[selection.selectedIndex]
  const schema = inferTableSchema(table.headers, table.bodyRows)
  const precedingHeadingText = findNearestPrecedingHeadingText(
    fetchResult.bodyText,
    table.startIndex
  )
  const selectorFingerprint = computeTableSelectorFingerprint(table, { precedingHeadingText })
  const driftEvidence = detectTableDrift(previousSelectorFingerprint, selectorFingerprint)
  const sourceAsOf = findSourceAsOfEvidence(fetchResult.bodyText, table, precedingHeadingText)

  const receipt = buildAcquisitionReceipt({
    routeDecision,
    fetchResult,
    table,
    schema,
    selectorFingerprint,
    driftEvidence,
    sourceAsOf,
    robotsEvidence,
    transportEvidence,
    retentionPolicy,
    clock
  })
  return { receipt, routeDecision, selection, driftEvidence, tablesConsidered: tables.length }
}
