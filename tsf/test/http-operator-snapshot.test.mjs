// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 5. Real end-to-end HTTP coverage
// for GET /api/operator-snapshot, plus the required parity proof: for the
// SAME real durable state, the new coherent snapshot and the legacy
// /portfolio + /work endpoints never disagree (Stage 0's own Claim F is
// what this stage closes -- migrate HQ first, keep legacy routes, prove
// parity during the migration period).
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
  `operator-state.test-http-operator-snapshot-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

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
    rmSync(`${STATE_FILE}.lock`, { force: true })
  }
}

const PROJECT_ID = 'tsf-ui-capability-check'

test('GET /api/operator-snapshot returns a real, coherent shape (revision, generatedAt, projects, work, waiting, needsYou, recentlyDone, capacity, goals)', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/operator-snapshot`)
    assert.equal(res.status, 200)
    const snapshot = await res.json()
    for (const key of [
      'revision',
      'generatedAt',
      'projects',
      'goals',
      'work',
      'waiting',
      'needsYou',
      'recentlyDone',
      'capacity'
    ]) {
      assert.ok(key in snapshot, `snapshot must include "${key}"`)
    }
    assert.deepEqual(snapshot.goals, [])
    assert.ok(
      Array.isArray(snapshot.projects) && snapshot.projects.length > 0,
      'the always-present fixture project must appear'
    )
  })
})

test('PARITY: /api/operator-snapshot.projects and legacy /api/portfolio.knownProjects agree on the same real project for the same state', async () => {
  await withServer(async (base) => {
    const [snapshotRes, portfolioRes] = await Promise.all([
      fetch(`${base}/api/operator-snapshot`),
      fetch(`${base}/api/portfolio`)
    ])
    const snapshot = await snapshotRes.json()
    const portfolio = await portfolioRes.json()
    const snapshotProject = snapshot.projects.find((p) => p.id === PROJECT_ID)
    const portfolioProject = portfolio.knownProjects.find((p) => p.id === PROJECT_ID)
    assert.ok(snapshotProject)
    assert.ok(portfolioProject)
    assert.deepEqual(
      snapshotProject,
      portfolioProject,
      'the coherent snapshot must never describe a project differently than the legacy endpoint it is replacing'
    )
  })
})

test('PARITY: a real Keep Going run appears with the SAME owner-facing state in /api/operator-snapshot.work as legacy /api/work implies', async () => {
  await withServer(async (base) => {
    const startRes = await fetch(`${base}/api/keep-going/${PROJECT_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalGoal: 'Ship it.', acceptanceCriteria: ['X'] })
    })
    assert.equal(startRes.status, 200)

    const [snapshotRes, workRes] = await Promise.all([
      fetch(`${base}/api/operator-snapshot`),
      fetch(`${base}/api/work`)
    ])
    const snapshot = await snapshotRes.json()
    const work = await workRes.json()

    // The fresh run has no wave dispatched yet -- legacy /api/work buckets
    // it under `active` (RUN_FEED_SECTION.PLANNING === 'active'); the new
    // canonical owner model calls the SAME real fact PLANNING directly.
    assert.ok(work.active.some((p) => p.id === PROJECT_ID))
    const snapshotItem = snapshot.work.find(
      (i) => i.id === `run:${PROJECT_ID}` || i.projectId === PROJECT_ID
    )
    assert.ok(
      snapshotItem,
      'the new snapshot must surface the same real run the legacy endpoint does'
    )
    assert.equal(snapshotItem.state, 'PLANNING')
  })
})

// GET /api/operator-events itself (the real long-lived SSE stream: headers,
// the immediate-emit-on-connect behavior, revision-change dedup, and timer
// cleanup on disconnect) is covered in operator-snapshot-http-routes.test.mjs
// with an injected poll timer -- a real, indefinite connection here fought
// this test runner's own process-exit/socket-teardown timing too
// unreliably to be worth the real-HTTP round trip; the unit-level coverage
// already exercises the exact same code path with deterministic control
// over time, which is the harder and more valuable case anyway.
