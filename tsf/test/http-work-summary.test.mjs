// Pins the exact "tsf-orca: Started." -> "No active missions" defect at the
// real HTTP layer: a freshly-onboarded project (mission.state 'ONBOARDED',
// which the original summarizeWork never bucketed anywhere) must show up in
// GET /api/work's active section the moment a Keep Going run is started for
// it -- and stay correctly bucketed as the run progresses. Uses an onboarded
// project, not the always-present fixture project (tsf/server/fixture-
// project.mjs hardcodes its mission.state to READY_FOR_ADOPTION, which would
// spuriously pass this test for the wrong reason).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-work-summary-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-work-summary-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# HTTP Work Summary Test Project\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

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

async function post(base, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

async function onboardTestProject(base) {
  const dir = createTempRepo()
  tempDirs.push(dir)
  const analyzeRes = await post(base, '/api/onboarding/analyze', { repoPath: dir })
  assert.equal(analyzeRes.status, 200)
  assert.equal(
    analyzeRes.body.migrationClassification.classification,
    'SAFE_TO_ONBOARD_NOW',
    'this fixture repo must classify as SAFE_TO_ONBOARD_NOW -- mission.state ONBOARDED, in no legacy Work bucket'
  )
  const commitRes = await post(base, '/api/onboarding/commit', {
    analysis: analyzeRes.body,
    addTo: { knownProjects: true, activeFleet: false, workSet: false }
  })
  assert.equal(commitRes.status, 200)
  return analyzeRes.body.projectId
}

test('a freshly-onboarded project with no Keep Going run appears in none of the Work sections (proves the legacy ONBOARDED classification is genuinely uncovered)', async () => {
  await withServer(async (base) => {
    const projectId = await onboardTestProject(base)
    const { body: work } = await get(base, '/api/work')
    for (const section of [
      'active',
      'queued',
      'verifying',
      'needsYou',
      'stalled',
      'blocked',
      'readyForAdoption'
    ]) {
      assert.ok(
        !work[section].some((p) => p.id === projectId),
        `unexpected: ${projectId} already appears in ${section} before any run exists`
      )
    }
  })
})

test('POST start really is durable, and GET /api/work now shows the project active (planning) -- the exact bug fix', async () => {
  await withServer(async (base) => {
    const projectId = await onboardTestProject(base)

    const startRes = await post(base, `/api/keep-going/${projectId}/start`, {
      originalGoal: 'Fix the harmless fixture bug.',
      acceptanceCriteria: ['TESTS_PASS'],
      usageMode: 'BALANCED'
    })
    assert.equal(startRes.status, 200)
    assert.equal(startRes.body.started, true)
    assert.equal(startRes.body.state, 'ACTIVE')

    // A durable run exists independent of this response -- a fresh GET (a
    // stand-in for "close the modal, navigate away, come back") sees it too.
    const freshGet = await get(base, `/api/keep-going/${projectId}`)
    assert.equal(freshGet.body.runId, startRes.body.runId)
    assert.equal(freshGet.body.state, 'ACTIVE')

    const { body: work } = await get(base, '/api/work')
    assert.ok(
      work.active.some((p) => p.id === projectId),
      "the project must appear in Work's active section now that a real Keep Going run exists"
    )
    const item = work.active.find((p) => p.id === projectId)
    assert.equal(item.liveWorkFeed.state, 'PLANNING')
    assert.equal(item.runId, startRes.body.runId)
    // Not fabricated into any other section at the same time.
    for (const section of ['needsYou', 'stalled', 'verifying', 'readyForAdoption']) {
      assert.ok(!work[section].some((p) => p.id === projectId))
    }
  })
})

test('a real dispatch tick moves the project from active/PLANNING to active/WORKING in Work', async () => {
  await withServer(async (base) => {
    const projectId = await onboardTestProject(base)
    await post(base, `/api/keep-going/${projectId}/start`, {
      originalGoal: 'Fix the harmless fixture bug.',
      acceptanceCriteria: ['TESTS_PASS']
    })
    const tickRes = await post(base, `/api/keep-going/${projectId}/tick`, {
      candidateWorkItems: [
        { id: 't1', scope: ['docs/x.md'], worktree: 'C:/repo/wt1', agent: 'codex' }
      ]
    })
    assert.equal(tickRes.status, 200)
    assert.equal(tickRes.body.action, 'WAVE_DISPATCHED')

    const { body: work } = await get(base, '/api/work')
    const item = work.active.find((p) => p.id === projectId)
    assert.ok(item, 'still in active while a wave is in flight')
    assert.equal(item.liveWorkFeed.state, 'WORKING')
  })
})

test('an unrelated project with no run and legacy mission.state ADOPTED still appears in recentlyCompleted, unchanged', async () => {
  await withServer(async (base) => {
    // Real regression coverage for "merge, don't replace": the fixture
    // project's own decision flow is the existing, unrelated ADOPTED path.
    const fixtureId = 'tsf-ui-capability-check'
    const decisionRes = await post(base, `/api/candidates/${fixtureId}/decision`, {
      decision: 'ADOPT',
      requestId: 'http-work-summary-regression',
      reason: 'regression fixture'
    })
    assert.equal(decisionRes.status, 200)
    const { body: work } = await get(base, '/api/work')
    assert.ok(work.recentlyCompleted.some((p) => p.id === fixtureId))
  })
})
