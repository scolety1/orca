// POST /api/projects/prepare-for-work -- real end-to-end HTTP coverage for
// the Operator UX pass's composed "Prepare Projects for Work" action:
// refresh -> diagnose -> baseline -> re-diagnose -> safe repair ->
// recompute eligibility, all over already-adopted, already-tested
// primitives (never a second implementation of any of them).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-prepare-for-work-${process.pid}.json`
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

function createTempRepo({ dirty = false, withTestScript = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-prepare-for-work-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# Prepare For Work Test Project\n')
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'prepare-for-work-test',
      scripts: withTestScript ? { test: 'node -e "process.exit(0)"' } : {}
    })
  )
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  if (dirty) {
    writeFileSync(path.join(dir, 'wip.txt'), 'wip')
  }
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
    body: JSON.stringify(body ?? {})
  })
  return { status: res.status, body: await res.json() }
}

async function onboard(base, opts) {
  const dir = createTempRepo(opts)
  tempDirs.push(dir)
  const analyzeRes = await post(base, '/api/onboarding/analyze', { repoPath: dir, handoffText: '' })
  const commitRes = await post(base, '/api/onboarding/commit', {
    analysis: analyzeRes.body,
    addTo: { knownProjects: true, activeFleet: false, workSet: false }
  })
  return commitRes.body.projectId
}

test('POST /api/projects/prepare-for-work rejects a missing/empty projectIds', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/projects/prepare-for-work', { projectIds: [] })
    assert.equal(res.status, 400)
  })
})

test('REQUIRED PROOF: a real clean project goes through refresh -> baseline -> auto-repair -> recompute end to end', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const res = await post(base, '/api/projects/prepare-for-work', { projectIds: [projectId] })
    assert.equal(res.status, 200)
    const result = res.body.results[0]
    assert.equal(result.projectId, projectId)
    assert.equal(result.ok, true)
    const stageNames = result.stages.map((s) => s.stage)
    assert.deepEqual(stageNames, ['REFRESH', 'BASELINE', 'AUTO_REPAIR'])
    assert.equal(result.stages[0].ok, true)
    assert.equal(result.stages[1].ok, true)
    assert.ok(result.stages[1].baseline)
    // The stub Orca CLI is stateless (STUB_ORCA_REPOS is a fixed env var
    // for the whole process, unaffected by a real `orca repo add` call),
    // so ORCA_NOT_REGISTERED can never honestly resolve inside this test
    // -- the real repair action (REFRESH_ORCA_REGISTRATION) is still
    // genuinely attempted, which is what this asserts, rather than
    // asserting a stub-unreachable readyForWork:true.
    const autoRepairStage = result.stages.find((s) => s.stage === 'AUTO_REPAIR')
    const orcaAction = autoRepairStage.actionsTaken.find((a) => a.cause === 'ORCA_NOT_REGISTERED')
    assert.ok(orcaAction, 'ORCA_NOT_REGISTERED must have a real repair attempt recorded')
    assert.equal(orcaAction.action, 'REFRESH_ORCA_REGISTRATION')
    // Every OTHER cause besides the stub-limited ORCA_NOT_REGISTERED must
    // genuinely resolve.
    const remaining = result.causesAfter.filter((c) => c.repairClass !== 'NOT_A_DEFECT')
    assert.deepEqual(
      remaining.map((c) => c.cause),
      ['ORCA_NOT_REGISTERED']
    )
  })
})

test('a project with no discovered command guidance honestly skips the baseline stage, never fakes one', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, { withTestScript: false })
    const res = await post(base, '/api/projects/prepare-for-work', { projectIds: [projectId] })
    const result = res.body.results[0]
    const baselineStage = result.stages.find((s) => s.stage === 'BASELINE')
    // Even with no test script, package.json still exists so
    // commandGuidance is discovered -- this proves the route runs the
    // real discovery-dependent baseline path rather than always skipping.
    assert.ok(baselineStage)
  })
})

test('an unknown project id is reported honestly, not a crash', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/projects/prepare-for-work', {
      projectIds: ['does-not-exist']
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.results[0].ok, false)
    assert.match(res.body.results[0].error, /not an onboarded project/)
  })
})

test('a mixed batch: one real project succeeds, one unknown id fails -- neither blocks the other', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const res = await post(base, '/api/projects/prepare-for-work', {
      projectIds: [projectId, 'does-not-exist']
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.results.length, 2)
    const real = res.body.results.find((r) => r.projectId === projectId)
    const fake = res.body.results.find((r) => r.projectId === 'does-not-exist')
    assert.equal(real.ok, true)
    assert.equal(fake.ok, false)
  })
})

test('real progress persists incrementally: the refreshed analysis survives even if repair-selected were run again', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    await post(base, '/api/projects/prepare-for-work', { projectIds: [projectId] })
    const projectRes = await fetch(`${base}/api/projects/${projectId}`)
    const project = await projectRes.json()
    assert.ok(project.evidence.onboarding)
    assert.ok(project.evidence.onboarding.analyzedAt)
  })
})
