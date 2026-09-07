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
import { classifyFetchedContentAccess } from './web-source-content-access-classifier.mjs'

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
  // Real-network finding (REAL FREE-PATH RESEARCH EXECUTION V1): a page
  // with many unrelated tables (Wikipedia's "Salary cap" article has 12 --
  // navboxes, cross-league comparisons, etc.) can have its ACTUAL matching
  // table lose to a larger, irrelevant one under the default size
  // heuristic below. Still domain-neutral: this hint is a plain list of
  // exact cell values to look for (a caller's own targetEntity id/name,
  // never a hardcoded topic keyword) -- the table containing the MOST of
  // them, among those containing at least one, wins.
  if (Array.isArray(hint?.preferTableContainingAnyOf) && hint.preferTableContainingAnyOf.length > 0) {
    const wanted = hint.preferTableContainingAnyOf.map((v) => String(v).trim().toLowerCase())
    const scored = tables
      .map((t) => {
        const cells = t.bodyRows.flat().map((c) => String(c ?? '').trim().toLowerCase())
        const hitCount = wanted.filter((w) => cells.includes(w)).length
        return { table: t, hitCount }
      })
      .filter((s) => s.hitCount > 0)
    if (scored.length > 0) {
      // Tie-break on hitCount by table size, not first-encountered (review
      // finding: strict `>` kept an arbitrary earlier table on an exact tie).
      const best = scored.reduce((top, s) => {
        if (s.hitCount !== top.hitCount) return s.hitCount > top.hitCount ? s : top
        return s.table.rowCount * s.table.columnCount > top.table.rowCount * top.table.columnCount ? s : top
      }, scored[0])
      return {
        selectedIndex: best.table.index,
        method: 'ENTITY_MATCH_HINT',
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

// Phase 3 Wave 2 (3C/3D REUSE_DIRECT): the same extract -> select -> infer
// sequence this pipeline already runs post-fetch, factored out so the
// owner-supplied-local-artifact and authenticated-official-download
// acquisition paths (which never call fetchBounded -- there is no network
// fetch to run) can drive genuinely identical table discovery instead of a
// second, parallel implementation. Returns table:null/schema:null (never
// throws) when no table is found, matching this file's own NO_TABLES_FOUND
// handling below.
export function extractAndSelectTable(rawHtml, tableSelectionHint) {
  const tables = extractTablesFromHtml(rawHtml)
  const selection = selectTableWithEvidence(tables, tableSelectionHint)
  if (selection.selectedIndex === null) {
    return { tables, selection, table: null, schema: null }
  }
  const table = tables[selection.selectedIndex]
  const schema = inferTableSchema(table.headers, table.bodyRows)
  return { tables, selection, table, schema }
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
    // Phase 3 Wave 2 (3E): fetchBounded never reads a body for a non-2xx
    // status (see bounded-http-fetch.mjs's fetchOnce), so only the HTTP
    // status itself is evidence here -- classifyFetchedContentAccess
    // degrades gracefully with bodyText:null. Only overrides accessClassification
    // when a REAL blocking signal fired (contentAccess.blocked); a network/
    // timeout/SSRF/size/content-type failure (no httpStatus rule matches)
    // stays exactly as before -- no behavior change for those.
    const contentAccess = classifyFetchedContentAccess({
      httpStatus: fetchResult.httpStatus ?? null,
      bodyText: null,
      finalUrl: fetchResult.finalUrl ?? null,
      requestedUrl: candidate.url
    })
    return {
      receipt: buildExtractionFailureReceipt({
        routeDecision,
        failureReason: fetchResult.reason,
        failureDetail: fetchResult.detail,
        robotsEvidence,
        transportEvidence,
        contentAccessEvidence: contentAccess.blocked ? contentAccess : null,
        clock
      }),
      routeDecision
    }
  }

  // Phase 3 Wave 2 (3E): a 200 status is not proof of real content -- a
  // login/paywall/anti-bot interstitial commonly returns 200. Fail closed:
  // classify BEFORE table extraction, never after, so a blocked page can
  // never accidentally yield a "real" table match from its own chrome.
  const contentAccess = classifyFetchedContentAccess({
    httpStatus: fetchResult.httpStatus,
    bodyText: fetchResult.bodyText,
    finalUrl: fetchResult.finalUrl,
    requestedUrl: candidate.url
  })
  if (contentAccess.blocked) {
    return {
      receipt: buildExtractionFailureReceipt({
        routeDecision,
        failureReason: 'CONTENT_ACCESS_BLOCKED',
        failureDetail: contentAccess.decisionReason,
        robotsEvidence,
        transportEvidence,
        contentAccessEvidence: contentAccess,
        clock
      }),
      routeDecision,
      contentAccess
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
