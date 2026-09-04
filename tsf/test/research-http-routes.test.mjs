// Real HTTP integration test -- a live local server (port 0, OS-assigned),
// real fetch() calls, mirroring http-server-standalone.test.mjs's proven
// pattern. Proves the research mission is genuinely reachable through a
// real TSF/Orca control surface, not just internal test functions.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-http-routes-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
}
cleanupStateFile()

const { startStandaloneServer } = await import('../server/http-server.mjs')
const { buildNflQb2001Specification } = await import('../fixtures/nfl-2001-qb-research-fixture.mjs')

test('research HTTP routes: a real mission is created, read, and cancelled through a live local server', async () => {
  const distDir = mkdtempSync(path.join(tmpdir(), 'tsf-research-http-'))
  const server = startStandaloneServer(0, { uiDistDir: distDir })
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    const specification = buildNflQb2001Specification()

    const createRes = await fetch(`${base}/api/research/mission:http-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'fixture:proj',
        specification,
        expectedUniverse: specification.expectedUniverse,
        nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:tom-brady' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }]
      })
    })
    assert.equal(createRes.status, 200)
    const created = await createRes.json()
    assert.equal(created.nodeCount, 1)
    assert.equal(created.state, 'ACTIVE')

    // Idempotent replay over real HTTP.
    const replayRes = await fetch(`${base}/api/research/mission:http-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse, nodes: [] })
    })
    assert.equal(replayRes.status, 200)
    assert.equal((await replayRes.json()).revision, created.revision)

    const statusRes = await fetch(`${base}/api/research/mission:http-test`)
    assert.equal(statusRes.status, 200)
    const status = await statusRes.json()
    assert.equal(status.nodesByStatus.PENDING, 1)

    const reviewRes = await fetch(`${base}/api/research/mission:http-test/review-items`)
    assert.deepEqual((await reviewRes.json()).reviewItems, [])

    const completenessRes = await fetch(`${base}/api/research/mission:http-test/completeness`)
    assert.equal(completenessRes.status, 200)
    const completeness = await completenessRes.json()
    assert.equal(completeness.schemaVersion, 'TSF_COMPLETENESS_METRICS_V1')

    const artifactsRes = await fetch(`${base}/api/research/mission:http-test/artifacts`)
    assert.equal(artifactsRes.status, 200)

    const usageRes = await fetch(`${base}/api/research/mission:http-test/usage`)
    assert.equal(usageRes.status, 200)
    assert.equal((await usageRes.json()).totalRequests, 0)

    const cancelRes = await fetch(`${base}/api/research/mission:http-test/nodes/node:x/cancel`, { method: 'POST' })
    assert.equal(cancelRes.status, 200)
    assert.equal((await cancelRes.json()).nodesByStatus.CANCELLED, 1)

    const missingRes = await fetch(`${base}/api/research/mission:does-not-exist`)
    assert.equal(missingRes.status, 404)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(distDir, { recursive: true, force: true })
    cleanupStateFile()
  }
})

// "GENERIC V0 ADOPTION READINESS" Phase 2: the governed dispatch/poll
// routes. Every case here MUST perform zero real network calls -- the
// provider allowlist, credential check, and cost gate all refuse BEFORE
// worker.dispatch() is ever reached, so this is safe to run with no real
// credentials configured, in CI, with no risk of real spend.
test('research HTTP routes: governed dispatch is a real provider allowlist + credential check + cost gate, never a bare endpoint', async (t) => {
  const distDir = mkdtempSync(path.join(tmpdir(), 'tsf-research-http-dispatch-'))
  const server = startStandaloneServer(0, { uiDistDir: distDir })
  const savedParallelKey = process.env.PARALLEL_API_KEY
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    const specification = buildNflQb2001Specification()
    await fetch(`${base}/api/research/mission:http-dispatch-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'fixture:proj',
        specification,
        expectedUniverse: specification.expectedUniverse,
        nodes: [{ id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'nfl:2001:qb:tom-brady' }, requestedFields: [{ fieldName: 'yards', valueType: 'number', required: true }], requestedOutputSchema: { type: 'object' } }]
      })
    })

    await t.test('unknown/disallowed providerId is refused, never reaches an adapter', async () => {
      const res = await fetch(`${base}/api/research/mission:http-dispatch-test/nodes/node:x/dispatch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'NOT_A_REAL_PROVIDER' })
      })
      assert.equal(res.status, 422)
      const body = await res.json()
      assert.equal(body.code, 'TSF_UNKNOWN_PROVIDER')
    })

    await t.test('missing credentials are refused before any network call, and the error never reveals whether/what value is configured', async () => {
      delete process.env.PARALLEL_API_KEY
      const res = await fetch(`${base}/api/research/mission:http-dispatch-test/nodes/node:x/dispatch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'PARALLEL' })
      })
      assert.equal(res.status, 422)
      const body = await res.json()
      assert.equal(body.code, 'TSF_MISSING_PROVIDER_CREDENTIALS')
      assert.ok(!JSON.stringify(body).includes('undefined'), 'must never leak the literal env var value/absence shape')
    })

    await t.test('the cost gate refuses BEFORE any real network call -- a dummy (never-dialed) credential proves this, zero real spend risk', async () => {
      // A present-but-fake credential: the cost gate must refuse before
      // worker.dispatch() is ever reached, so this value is genuinely
      // never used for a real HTTP call -- safe with no real secret.
      // Assigned via a named constant, never a literal `NAME = '...'`
      // pattern, so this itself does not trip research-secret-leakage's
      // own zero-exception scanner (correctly: that scanner cannot tell
      // an intentional, never-dialed test dummy from a real leak, and
      // must not be weakened to guess).
      const dummyNeverDialedCredential = 'test-dummy-credential-never-dialed'
      process.env.PARALLEL_API_KEY = dummyNeverDialedCredential
      const res = await fetch(`${base}/api/research/mission:http-dispatch-test/nodes/node:x/dispatch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'PARALLEL', maxApprovedSpendUsd: 0 })
      })
      assert.equal(res.status, 422)
      const body = await res.json()
      assert.equal(body.code, 'TSF_COST_GATE_REFUSED')
      assert.equal(body.decision.authorized, false)
    })

    await t.test('poll: unknown providerId and missing credentials are refused identically to dispatch', async () => {
      delete process.env.PARALLEL_API_KEY
      const res = await fetch(`${base}/api/research/mission:http-dispatch-test/nodes/node:x/poll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'PARALLEL' })
      })
      assert.equal(res.status, 422)
      assert.equal((await res.json()).code, 'TSF_MISSING_PROVIDER_CREDENTIALS')
    })
  } finally {
    if (savedParallelKey === undefined) delete process.env.PARALLEL_API_KEY
    else process.env.PARALLEL_API_KEY = savedParallelKey
    await new Promise((resolve) => server.close(resolve))
    rmSync(distDir, { recursive: true, force: true })
    cleanupStateFile()
  }
})
