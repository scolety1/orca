// Phase 7/8 (minimal): source-first bulk acquisition. Mocked fetch only in
// this file -- the one real fetch (Wikipedia, license-clear) is exercised
// separately and disclosed as a real network call in the final report.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSourceSnapshot } from '../adapters/http-source-adapter.mjs'
import { admitSourceSnapshot } from '../domain/research-source-admission.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-09-03T12:00:00.000Z')

function mockFetch(handler) {
  return async (url, init) => handler(url, init)
}

function baseMission() {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  return mission
}

test('fetchSourceSnapshot returns a content-hashed snapshot on success', async () => {
  const fetchImpl = mockFetch(async () => ({ ok: true, status: 200, text: async () => 'hello world' }))
  const result = await fetchSourceSnapshot({ url: 'https://example.invalid/page', fetchImpl, clock })
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.rawContent, 'hello world')
  assert.ok(result.snapshot.contentHash.startsWith('sha256:'))
})

test('fetchSourceSnapshot maps a non-2xx response to an honest ok:false, never a fabricated snapshot', async () => {
  const fetchImpl = mockFetch(async () => ({ ok: false, status: 403 }))
  const result = await fetchSourceSnapshot({ url: 'https://example.invalid/blocked', fetchImpl, clock })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'HTTP_ERROR')
  assert.equal(result.httpStatus, 403)
})

test('fetchSourceSnapshot maps a network throw to an honest ok:false, never an uncaught exception', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED')
  }
  const result = await fetchSourceSnapshot({ url: 'https://example.invalid/down', fetchImpl, clock })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NETWORK_ERROR')
})

test('admitSourceSnapshot creates a durable SourceReference + SourceSnapshotReference', async () => {
  const mission = baseMission()
  const snapshot = { sourceRef: 'https://example.invalid/a', url: 'https://example.invalid/a', contentHash: 'sha256:abc', retrievedAt: clock().toISOString() }
  const next = admitSourceSnapshot(mission, 'node:x', snapshot, clock, mission.revision)
  assert.equal(next.nodes[0].sourceReferences.length, 1)
  assert.equal(next.nodes[0].sourceSnapshots.length, 1)
  assert.equal(next.nodes[0].sourceSnapshots[0].acquisitionMethod, 'BULK_SOURCE_FIRST_HTTP')
})

test('admitSourceSnapshot is idempotent by contentHash -- research-library dedup, no duplicate refetch admission', async () => {
  const mission = baseMission()
  const snapshot = { sourceRef: 'https://example.invalid/a', url: 'https://example.invalid/a', contentHash: 'sha256:abc', retrievedAt: clock().toISOString() }
  const once = admitSourceSnapshot(mission, 'node:x', snapshot, clock, mission.revision)
  const revisionAfterOnce = once.revision
  const twice = admitSourceSnapshot(once, 'node:x', snapshot, clock, once.revision)
  assert.equal(twice.revision, revisionAfterOnce, 'a true no-op refetch-admission must not bump revision')
  assert.equal(twice.nodes[0].sourceSnapshots.length, 1)
})

test('admitSourceSnapshot never creates an Observation or Claim -- bulk source admission is raw material only', async () => {
  const mission = baseMission()
  const snapshot = { sourceRef: 'https://example.invalid/a', url: 'https://example.invalid/a', contentHash: 'sha256:abc', retrievedAt: clock().toISOString() }
  const next = admitSourceSnapshot(mission, 'node:x', snapshot, clock, mission.revision)
  assert.equal(next.nodes[0].observations.length, 0)
  assert.equal(next.nodes[0].claims.length, 0)
})
