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
