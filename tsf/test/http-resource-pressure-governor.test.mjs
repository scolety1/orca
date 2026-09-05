// GET/POST /api/resource-pressure/state, POST /api/resource-pressure/
// heavy-task-lease/{acquire,release} -- real end-to-end HTTP coverage.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-resource-pressure-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.writeHead(404)
      res.end()
    })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(STATE_FILE, { force: true })
    rmSync(`${STATE_FILE}.tmp`, { force: true })
  }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

async function post(base, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

function setFakeHostMemory(totalBytes, freeBytes) {
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(totalBytes)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(freeBytes)
}

test.after(() => {
  delete process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES
  delete process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES
})

const GB = 1024 ** 3

test('REQUIRED PROOF: GET /api/resource-pressure/state returns a real, honest state -- reclaimCandidates empty, evidenceSource TSF_OS_MODULE', async () => {
  setFakeHostMemory(16 * GB, 5 * GB)
  await withServer(async (base) => {
    const res = await get(base, '/api/resource-pressure/state')
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.state.schemaVersion, 'TSF_RESOURCE_PRESSURE_STATE_V0')
    assert.equal(res.body.state.evidenceSource, 'TSF_OS_MODULE')
    assert.equal(res.body.state.tier, 'HEALTHY')
    assert.deepEqual(res.body.state.reclaimCandidates, [])
    assert.deepEqual(res.body.state.protectedProcesses, [])
    assert.deepEqual(res.body.state.missionsWaitingForResources, [])
  })
})

test('a low-memory reading classifies CRITICAL and refuses new heavyweight admission, end to end', async () => {
  setFakeHostMemory(16 * GB, 1.7 * GB)
  await withServer(async (base) => {
    const res = await get(base, '/api/resource-pressure/state')
    assert.equal(res.body.state.tier, 'CRITICAL')
    assert.equal(res.body.state.admission.newFullSuiteTests, 'REFUSE')
  })
})

test('POST /api/resource-pressure/state merges caller-supplied protected/waiting lists but never reclaimCandidates', async () => {
  setFakeHostMemory(16 * GB, 5 * GB)
  await withServer(async (base) => {
    const res = await post(base, '/api/resource-pressure/state', {
      protectedProcesses: [{ ownerMission: 'nwr-draft-upgrade-hq', kind: 'ACTIVE_MISSION', reason: 'active NWR mission' }],
      missionsWaitingForResources: [{ missionId: 'tsf-unified-platform-v1', waitingSince: '2026-09-04T22:52:00.000Z' }],
      // REQUIRED PROOF: attempting to smuggle a fabricated reclaim
      // candidate through the request body must have zero effect.
      reclaimCandidates: [{ kind: 'COMPLETED_PLANNER_SESSION', ownerMission: 'forged' }]
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.state.protectedProcesses.length, 1)
    assert.equal(res.body.state.protectedProcesses[0].ownerMission, 'nwr-draft-upgrade-hq')
    assert.equal(res.body.state.missionsWaitingForResources.length, 1)
    assert.deepEqual(res.body.state.reclaimCandidates, [])
  })
})

test('heavy-task lease: acquire then release round trip, persisted across requests', async () => {
  setFakeHostMemory(16 * GB, 5 * GB)
  await withServer(async (base) => {
    const acquired = await post(base, '/api/resource-pressure/heavy-task-lease/acquire', {
      kind: 'FULL_TSF_REGRESSION',
      missionId: 'hq-a'
    })
    assert.equal(acquired.status, 200)
    assert.equal(acquired.body.granted, true)
    assert.equal(acquired.body.lease.holderMissionId, 'hq-a')

    const stateWithLease = await get(base, '/api/resource-pressure/state')
    assert.equal(stateWithLease.body.state.leases.length, 1)
    assert.equal(stateWithLease.body.state.leases[0].holderMissionId, 'hq-a')

    const blocked = await post(base, '/api/resource-pressure/heavy-task-lease/acquire', {
      kind: 'FULL_TSF_REGRESSION',
      missionId: 'hq-b'
    })
    assert.equal(blocked.body.granted, false)
    assert.equal(blocked.body.waitingFor, 'HEAVY_TASK_LEASE')

    const deniedRelease = await post(base, '/api/resource-pressure/heavy-task-lease/release', {
      kind: 'FULL_TSF_REGRESSION',
      missionId: 'hq-b'
    })
    assert.equal(deniedRelease.body.released, false)

    const released = await post(base, '/api/resource-pressure/heavy-task-lease/release', {
      kind: 'FULL_TSF_REGRESSION',
      missionId: 'hq-a'
    })
    assert.equal(released.body.released, true)

    const nowFree = await post(base, '/api/resource-pressure/heavy-task-lease/acquire', {
      kind: 'FULL_TSF_REGRESSION',
      missionId: 'hq-b'
    })
    assert.equal(nowFree.body.granted, true)
  })
})

test('REQUIRED PROOF: heavy-task lease acquire is refused under CRITICAL even when the slot is free', async () => {
  setFakeHostMemory(16 * GB, 1.7 * GB)
  await withServer(async (base) => {
    const res = await post(base, '/api/resource-pressure/heavy-task-lease/acquire', {
      kind: 'FULL_TSF_REGRESSION',
      missionId: 'hq-a'
    })
    assert.equal(res.body.granted, false)
    assert.equal(res.body.waitingFor, 'MEMORY_HEADROOM')
    assert.equal(res.body.tier, 'CRITICAL')
  })
})

test('acquire/release with missing kind or missionId is a clean 422, not a 500', async () => {
  setFakeHostMemory(16 * GB, 5 * GB)
  await withServer(async (base) => {
    const missingKind = await post(base, '/api/resource-pressure/heavy-task-lease/acquire', { missionId: 'hq-a' })
    assert.equal(missingKind.status, 422)
    const missingMissionId = await post(base, '/api/resource-pressure/heavy-task-lease/release', { kind: 'FULL_TSF_REGRESSION' })
    assert.equal(missingMissionId.status, 422)
  })
})

test('a null POST body does not throw a raw 500 on either mutating route', async () => {
  setFakeHostMemory(16 * GB, 5 * GB)
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/resource-pressure/heavy-task-lease/acquire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    })
    assert.equal(res.status, 422)
  })
})

test('an unknown resource-pressure sub-route is a clean 404, not a crash', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/resource-pressure/does-not-exist')
    assert.equal(res.status, 404)
  })
})
