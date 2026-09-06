import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { acquireWebSourceViaStaticTable, selectTableWithEvidence } from '../domain/web-table-source-adapter.mjs'

const fixturesDir = path.join(import.meta.dirname, '..', 'fixtures', 'web-table-source-acquisition')
const publicResolve = async () => [{ address: '93.184.216.34' }]

async function loadFixture(name) {
  return readFile(path.join(fixturesDir, name), 'utf-8')
}

function fetchImplFor(html) {
  return async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
}

const ALLOWED_ACCESS_INPUT = { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }

test('extracts the 1995 QB stats table (historical sports domain), with multi-row headers and source_as_of evidence', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const { receipt, routeDecision } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve }
  })
  assert.equal(routeDecision.decision, 'STATIC_TABLE_ADAPTER')
  assert.equal(receipt.decision, 'EXTRACTED')
  assert.equal(receipt.acquisitionMode, 'PUBLIC_WEB_SOURCE_EXTRACTION')
  assert.deepEqual(receipt.artifactRef.headers, [
    'Player',
    'Team',
    'Passing / Yards',
    'Passing / TD',
    'Passing / INT'
  ])
  assert.equal(receipt.rowCount, 3)
  assert.equal(receipt.sourceAsOf.extractionMethod, 'EXPLICIT_TIME_ELEMENT')
  assert.equal(receipt.sourceAsOf.value, '1996-01-15')
  assert.equal(receipt.artifactRef.rawHtml, null, 'raw retention is off by default')
  assert.ok(receipt.receiptHash)
})

test('extracts a restaurant wine list (unrelated domain), proving no sports-specific code path is required', async () => {
  const html = await loadFixture('restaurant-wine-list.html')
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/wine-list' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve }
  })
  assert.deepEqual(receipt.artifactRef.headers, ['Name', 'Region', 'Vintage', 'Price'])
  assert.equal(receipt.rowCount, 3)
  assert.equal(
    receipt.schema.find((c) => c.fieldName === 'Region').missingCount,
    2,
    'empty cell and em-dash both count as missing'
  )
  assert.equal(receipt.sourceAsOf.extractionMethod, 'EXPLICIT_TIME_ELEMENT')
})

test('selects the correct table by evidence when the page has multiple tables', async () => {
  const html = await loadFixture('qb-stats-1995-multi-table.html')
  const { receipt, selection, tablesConsidered } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve }
  })
  assert.equal(tablesConsidered, 3)
  assert.equal(selection.method, 'LARGEST_TABLE_WITH_HEADER')
  assert.deepEqual(receipt.artifactRef.headers, ['Player', 'Team', 'Yards', 'TD', 'INT'])
})

test('detects and warns on DOM drift against a stored selector fingerprint', async () => {
  const originalHtml = await loadFixture('qb-stats-1995-multi-table.html')
  const first = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor(originalHtml), resolveImpl: publicResolve }
  })

  const drifted = await loadFixture('qb-stats-1995-drifted.html')
  const second = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor(drifted), resolveImpl: publicResolve },
    previousSelectorFingerprint: first.receipt.tableIdentity
  })
  assert.equal(second.driftEvidence.drifted, true)
  assert.ok(second.receipt.warnings.some((w) => w.includes('changed since the prior acquisition')))
})

test('refuses extraction outright for PUBLIC_TERMS_UNCLEAR without ever fetching', async () => {
  let fetched = false
  const { receipt, routeDecision } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/unclear' },
    accessInput: {},
    fetchOptions: {
      fetchImpl: async () => {
        fetched = true
      },
      resolveImpl: publicResolve
    }
  })
  assert.equal(fetched, false)
  assert.equal(routeDecision.operatorReviewRequired, true)
  assert.equal(receipt.decision, 'REQUIRES_REVIEW')
  assert.equal(receipt.artifactRef, null)
})

for (const [name, accessInput] of [
  ['ROBOTS_DISALLOWED', { robotsDecision: 'DISALLOWED' }],
  ['TERMS_BLOCKED', { robotsDecision: 'ALLOWED', termsBlocked: true }],
  ['PAYWALL_ACCESS_CONTROL', { paywallDetected: true }],
  ['AUTHENTICATED_PAGE_NO_EXPORT', { authenticationRequired: true }],
  ['AUTHENTICATED_OFFICIAL_EXPORT', { authenticationRequired: true, officialExportAvailable: true }]
]) {
  test(`refuses extraction for access classification ${name}`, async () => {
    let fetched = false
    const { receipt } = await acquireWebSourceViaStaticTable({
      candidate: { url: 'https://example.com/x' },
      accessInput,
      fetchOptions: {
        fetchImpl: async () => {
          fetched = true
        },
        resolveImpl: publicResolve
      }
    })
    assert.equal(fetched, false)
    assert.equal(receipt.accessClassification, name)
    assert.notEqual(receipt.decision, 'EXTRACTED')
  })
}

test('produces a structured failure receipt (not a thrown error) when the fetch itself fails', async () => {
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/down' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: {
      fetchImpl: async () => {
        throw new Error('ECONNRESET')
      },
      resolveImpl: publicResolve
    }
  })
  assert.equal(receipt.decision, 'EXTRACTION_FAILED')
  assert.match(receipt.decisionReason, /NETWORK_ERROR/)
})

test('produces a structured failure receipt when no table is found on the page', async () => {
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/no-tables' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor('<p>No tables here.</p>'), resolveImpl: publicResolve }
  })
  assert.equal(receipt.decision, 'EXTRACTION_FAILED')
  assert.match(receipt.decisionReason, /NO_TABLES_FOUND/)
})

test('embeds raw HTML only when retention is explicitly allowed', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve },
    retentionPolicy: { allowRawRetention: true }
  })
  assert.ok(receipt.artifactRef.rawHtml.includes('<table>'))
})

function dispatchFetch({ robotsBody, robotsStatus = 200, pageHtml }) {
  return async (url) =>
    url.includes('/robots.txt')
      ? new Response(robotsBody, {
          status: robotsStatus,
          headers: { 'content-type': 'text/plain' }
        })
      : new Response(pageHtml, { status: 200, headers: { 'content-type': 'text/html' } })
}

test('V0.5: live robots preflight (opt-in) extracts normally when robots explicitly allows and the caller affirms', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const { receipt, routeDecision } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: { explicitPublicAllowance: true },
    fetchOptions: {
      fetchImpl: dispatchFetch({ robotsBody: 'User-agent: *\nAllow: /', pageHtml: html }),
      resolveImpl: publicResolve
    },
    robotsPreflight: { enabled: true }
  })
  assert.equal(routeDecision.decision, 'STATIC_TABLE_ADAPTER')
  assert.equal(receipt.decision, 'EXTRACTED')
  assert.equal(receipt.robotsEvidence.outcome, 'ALLOWED')
  assert.equal(receipt.robotsEvidence.robotsContentRetained, false)
  assert.equal(receipt.robotsEvidence.robotsContent, undefined)
})

test('V0.5: live robots preflight refuses extraction when robots disallows the path, without ever fetching the page', async () => {
  let pageFetched = false
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/private/1995-qb-stats' },
    accessInput: { explicitPublicAllowance: true },
    fetchOptions: {
      fetchImpl: async (url) => {
        if (url.includes('/robots.txt')) {
          return new Response('User-agent: *\nDisallow: /private/', {
            headers: { 'content-type': 'text/plain' }
          })
        }
        pageFetched = true
        return new Response('<table></table>', { headers: { 'content-type': 'text/html' } })
      },
      resolveImpl: publicResolve
    },
    robotsPreflight: { enabled: true }
  })
  assert.equal(pageFetched, false)
  assert.equal(receipt.decision, 'BLOCKED')
  assert.equal(receipt.accessClassification, 'ROBOTS_DISALLOWED')
  assert.equal(receipt.robotsEvidence.outcome, 'DISALLOWED')
})

test('V0.5: a caller cannot override live robots evidence end to end through the full orchestrator', async () => {
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/private/page' },
    accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true }, // favorable claim, should be discarded
    fetchOptions: {
      fetchImpl: async (url) =>
        url.includes('/robots.txt')
          ? new Response('User-agent: *\nDisallow: /private/', {
              headers: { 'content-type': 'text/plain' }
            })
          : new Response('should never be reached', { headers: { 'content-type': 'text/html' } }),
      resolveImpl: publicResolve
    },
    robotsPreflight: { enabled: true }
  })
  assert.equal(receipt.accessClassification, 'ROBOTS_DISALLOWED')
})

test('V0.5: without robotsPreflight.enabled, V0 behavior is unchanged (caller-supplied robotsDecision used as-is)', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: ALLOWED_ACCESS_INPUT,
    fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve }
    // robotsPreflight omitted entirely
  })
  assert.equal(receipt.decision, 'EXTRACTED')
  assert.equal(receipt.robotsEvidence, null)
})

test('V0.5: raw HTML never leaks into the receipt even when robots evidence retention is separately enabled', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const { receipt } = await acquireWebSourceViaStaticTable({
    candidate: { url: 'https://example.com/1995-qb-stats' },
    accessInput: { explicitPublicAllowance: true },
    fetchOptions: {
      fetchImpl: dispatchFetch({ robotsBody: 'User-agent: *\nAllow: /', pageHtml: html }),
      resolveImpl: publicResolve
    },
    robotsPreflight: { enabled: true, retainRawRobotsContent: true }
    // retentionPolicy.allowRawRetention intentionally omitted (defaults false)
  })
  assert.equal(receipt.artifactRef.rawHtml, null)
  assert.equal(receipt.robotsEvidence.robotsContentRetained, false)
  assert.equal(receipt.robotsEvidence.robotsContent, undefined)
  assert.ok(receipt.receiptHash)
  assert.ok(receipt.contentHash)
})

// Real-network finding (REAL FREE-PATH RESEARCH EXECUTION V1): a page with
// many unrelated tables can lose its actually-matching table to a larger,
// irrelevant one under the default size heuristic (Wikipedia's "Salary
// cap" article has 12 tables; the real year-by-year data table is small,
// a cross-league comparison table is larger). Still domain-neutral: the
// hint is a plain list of exact cell values (a caller's own targetEntity),
// never a hardcoded topic keyword.
test('selectTableWithEvidence: preferTableContainingAnyOf picks the table that actually contains the wanted value, even when a larger, unrelated table exists', () => {
  const irrelevantLargeTable = { index: 0, caption: null, headers: ['A', 'B', 'C'], bodyRows: [['x', 'y', 'z'], ['p', 'q', 'r'], ['s', 't', 'u']], rowCount: 3, columnCount: 3 }
  const realMatchingTable = { index: 1, caption: null, headers: ['Year', 'Amount'], bodyRows: [['2018', '$1'], ['2019', '$2']], rowCount: 2, columnCount: 2 }
  const result = selectTableWithEvidence([irrelevantLargeTable, realMatchingTable], { preferTableContainingAnyOf: ['2018'] })
  assert.equal(result.selectedIndex, 1)
  assert.equal(result.method, 'ENTITY_MATCH_HINT')
})

test('selectTableWithEvidence: preferTableContainingAnyOf with no match anywhere falls through to the existing size heuristic, never throws', () => {
  const only = { index: 0, caption: null, headers: ['A'], bodyRows: [['x']], rowCount: 1, columnCount: 1 }
  const result = selectTableWithEvidence([only], { preferTableContainingAnyOf: ['nothing-present-anywhere'] })
  assert.equal(result.selectedIndex, 0)
  assert.equal(result.method, 'LARGEST_TABLE_WITH_HEADER')
})

test('selectTableWithEvidence: an explicit tableIndex/captionIncludes hint still wins over preferTableContainingAnyOf when both are given (unchanged precedence)', () => {
  const t0 = { index: 0, caption: null, headers: ['Year'], bodyRows: [['2018']], rowCount: 1, columnCount: 1 }
  const t1 = { index: 1, caption: null, headers: ['Year'], bodyRows: [['2018']], rowCount: 1, columnCount: 1 }
  const result = selectTableWithEvidence([t0, t1], { tableIndex: 1, preferTableContainingAnyOf: ['2018'] })
  assert.equal(result.selectedIndex, 1)
  assert.equal(result.method, 'EXPLICIT_INDEX_HINT')
})

// Adversarial review finding: on an exact hitCount tie, strict `>` kept the
// FIRST-encountered table regardless of size/quality -- a smaller/sparser
// table could beat a larger, more complete one purely by coming first.
test('selectTableWithEvidence: preferTableContainingAnyOf breaks an exact hitCount tie by table size, not by encounter order', () => {
  const smallerFirst = { index: 0, caption: null, headers: ['Year'], bodyRows: [['2018']], rowCount: 1, columnCount: 1 }
  const largerSecond = { index: 1, caption: null, headers: ['Year', 'Amount', 'Note'], bodyRows: [['2018', '$1', 'a'], ['2019', '$2', 'b']], rowCount: 2, columnCount: 3 }
  const result = selectTableWithEvidence([smallerFirst, largerSecond], { preferTableContainingAnyOf: ['2018'] })
  assert.equal(result.selectedIndex, 1, 'both tables tie at hitCount 1 -- the larger, more complete table should win, not the first-encountered one')
})
