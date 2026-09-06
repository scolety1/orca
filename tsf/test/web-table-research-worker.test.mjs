// Deterministic, no-network proof of the full generic worker pipeline:
// BoundedResearchRequest -> real web-table acquisition (fixture-fed, same
// convention as web-table-source-adapter.test.mjs) -> extraction ->
// BoundedResearchResult. The real network path (acquirePublicWebTableSource,
// mandatory live robots preflight + DNS pinning) is proven separately by a
// disclosed real network call -- see the final report.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { acquireWebSourceViaStaticTable } from '../domain/web-table-source-adapter.mjs'
import { createWebTableResearchWorker, WEB_TABLE_PROVIDER_ID } from '../adapters/web-table-research-worker.mjs'

const fixturesDir = path.join(import.meta.dirname, '..', 'fixtures', 'web-table-source-acquisition')
const publicResolve = async () => [{ address: '93.184.216.34' }]
const clock = () => new Date('2026-09-06T12:00:00.000Z')

async function loadFixture(name) {
  return readFile(path.join(fixturesDir, name), 'utf-8')
}

function fetchImplFor(html) {
  return async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
}

// Injected acquireFn stands in for acquirePublicWebTableSource, feeding the
// SAME real acquireWebSourceViaStaticTable pipeline (routing, robots
// classification, table extraction, receipt-building) a fixture HTML body
// instead of a real network fetch -- same test-injection point every other
// worker in this codebase uses (createExaResearchWorker's `transport`).
function fixtureAcquireFn(html) {
  return ({ candidate }) =>
    acquireWebSourceViaStaticTable({
      candidate,
      accessInput: { robotsDecision: 'ALLOWED', explicitPublicAllowance: true },
      fetchOptions: { fetchImpl: fetchImplFor(html), resolveImpl: publicResolve },
      clock
    })
}

function baseRequest(overrides = {}) {
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_REQUEST_V1',
    nodeId: 'node:brett-favre',
    taskFingerprint: 'a'.repeat(64),
    nodeRole: 'PRIMARY_RESEARCH',
    researchQuestion: 'q',
    targetEntity: { entityId: 'Brett Favre', name: 'Brett Favre' },
    scope: ['node:brett-favre'],
    requestedOutputSchema: { properties: { 'Passing / Yards': {}, 'Passing / TD': {} } },
    temporalRequirements: { asOfDate: '2026-09-06', periodScope: '1995' },
    sourcePolicy: {},
    preferredSources: ['https://example.com/1995-qb-stats'],
    disallowedSources: [],
    licensingConstraints: [],
    freshnessPolicy: 'UNSPECIFIED',
    budget: {},
    toolPermissions: [],
    ...overrides
  }
}

test('dispatch+fetchResult produces a real SUCCEEDED result with genuine proposedClaims/evidence/sourceReferences from a matched row', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const dispatched = await worker.dispatch(baseRequest())
  assert.equal(dispatched.ok, true)
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(fetched.ok, true)
  assert.equal(fetched.status, 'READY')
  const { result } = fetched
  assert.equal(result.status, 'SUCCEEDED')
  assert.equal(result.provider, WEB_TABLE_PROVIDER_ID)
  const byField = Object.fromEntries(result.proposedClaims.map((c) => [c.fieldName, c.proposedValue]))
  assert.equal(byField['Passing / Yards'], '4413')
  assert.equal(byField['Passing / TD'], '38')
  assert.equal(result.evidence.length, 2)
  assert.equal(result.sourceReferences[0].url, 'https://example.com/1995-qb-stats')
  assert.equal(result.usage.providerReportedCostUsd, 0, 'genuinely $0 -- no paid provider involved')
})

test('restart-safety: a fresh call to fetchResult using only the durably-shaped workerRunRef (no in-memory state) returns the identical result', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const dispatched = await worker.dispatch(baseRequest())
  // Simulate a real process restart: a workerRunRef that has been through
  // JSON.stringify/parse (exactly what durable state persistence does),
  // fed to a BRAND NEW worker instance with no shared in-memory state.
  const rehydratedRunRef = JSON.parse(JSON.stringify(dispatched.workerRunRef))
  const freshWorker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const fetched = await freshWorker.fetchResult(rehydratedRunRef)
  assert.equal(fetched.ok, true)
  assert.equal(fetched.result.status, 'SUCCEEDED')
  assert.equal(fetched.result.proposedClaims.length, 2)
})

test('honest FAILED result (never a fabricated claim) when no row matches the requested entity', async () => {
  const html = await loadFixture('qb-stats-1995.html')
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn(html) })
  const request = baseRequest({ nodeId: 'node:someone-else', targetEntity: { entityId: 'Someone Else', name: 'Someone Else' } })
  const dispatched = await worker.dispatch(request)
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(fetched.result.status, 'FAILED')
  assert.equal(fetched.result.failureDetails.reason, 'NO_FREE_PUBLIC_MATCH_FOUND')
  assert.equal(fetched.result.proposedClaims.length, 0)
})

test('honest FAILED result when the mission specification names no preferredSources at all', async () => {
  const worker = createWebTableResearchWorker({ clock, acquireFn: fixtureAcquireFn('<html></html>') })
  const request = baseRequest({ preferredSources: [] })
  const dispatched = await worker.dispatch(request)
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(fetched.result.status, 'FAILED')
  assert.equal(fetched.result.failureDetails.reason, 'NO_CANDIDATE_SOURCE_CONFIGURED')
})

test('a genuinely refused/blocked source (e.g. robots disallow) is reported as a warning, never silently treated as a match', async () => {
  const worker = createWebTableResearchWorker({
    clock,
    acquireFn: () => Promise.resolve({ receipt: { decision: 'REFUSED', decisionReason: 'ROBOTS_DISALLOWED' } })
  })
  const dispatched = await worker.dispatch(baseRequest())
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(fetched.result.status, 'FAILED')
  assert.match(fetched.result.warnings[0], /ROBOTS_DISALLOWED/)
})
