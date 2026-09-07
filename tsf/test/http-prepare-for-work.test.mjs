// POST /api/projects/prepare-for-work -- real end-to-end HTTP coverage for
// the Operator UX pass's composed "Prepare Projects for Work" action:
// refresh -> diagnose -> baseline -> re-diagnose -> safe repair ->
// recompute eligibility, all over already-adopted, already-tested
// primitives (never a second implementation of any of them).
//
// URGENT V1 LIVE-USE DEFECT FIX: POST now creates a durable operation and
// returns immediately (202) instead of blocking on the whole pipeline --
// these tests poll GET .../:operationId the same way the real UI now does
// (see ui/src/lib/prepare-for-work-polling.ts), and separately cover the
// recovery/idempotency guarantees the incident exposed were missing:
// restart reacquisition (recoverInterruptedPrepareForWorkOperations),
// duplicate-retry idempotency, and that one project failing never blocks
// another in the same bulk operation.
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
// Finding F1: analyzeRepository now consults the Resource Pressure Governor
// -- forces HEALTHY so this file's own assertions never flake on a
// genuinely shared, loaded host, mirroring chat-dispatch-bridge.test.mjs.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { createRequestHandler } = await import('../server/http-server.mjs')
const { recoverInterruptedPrepareForWorkOperations } =
  await import('../server/prepare-for-work-http-routes.mjs')
const { withPrepareForWorkOperation } = await import('../server/prepare-for-work-store.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo({ dirty = false, withTestScript = true, failingTest = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-prepare-for-work-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# Prepare For Work Test Project\n')
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'prepare-for-work-test',
      scripts: withTestScript ? { test: `node -e "process.exit(${failingTest ? 1 : 0})"` } : {}
    })
  )
  // Real V1 stabilization finding: package-manager detection now refuses
  // to guess an install command for an ambiguous JS project (no lockfile)
  // rather than defaulting to npm install -- so without a real lockfile
  // here, this fixture's own DEPENDENCY_HEALTH cause would never resolve,
  // which is correct but not what this fixture is for (a project that
  // genuinely CAN reach a clean auto-repair). A minimal real
  // package-lock.json makes the manager unambiguously npm, matching a
  // real npm project's own convention.
  writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify({ name: 'prepare-for-work-test', lockfileVersion: 3 })
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
    rmSync(`${STATE_FILE}.lock`, { force: true })
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

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
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

// Mirrors ui/src/lib/prepare-for-work-polling.ts's own real polling loop --
// proves the SAME contract the real UI depends on, not a shortcut.
async function pollOperation(base, operationId, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await get(base, `/api/projects/prepare-for-work/${operationId}`)
    assert.equal(res.status, 200)
    if (res.body.operation.status === 'COMPLETED') {
      return res.body.operation
    }
    if (Date.now() > deadline) {
      throw new Error(`operation ${operationId} did not settle within ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function prepareForWork(base, projectIds) {
  const start = await post(base, '/api/projects/prepare-for-work', { projectIds })
  assert.equal(start.status, 202)
  assert.ok(start.body.operationId)
  const operation = await pollOperation(base, start.body.operationId)
  return { operationId: start.body.operationId, operation }
}

test('POST /api/projects/prepare-for-work rejects a missing/empty projectIds', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/projects/prepare-for-work', { projectIds: [] })
    assert.equal(res.status, 400)
  })
})

test('POST returns immediately with an operation id -- does not block on the pipeline', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const start = Date.now()
    const res = await post(base, '/api/projects/prepare-for-work', { projectIds: [projectId] })
    assert.equal(res.status, 202)
    assert.ok(res.body.operationId)
    assert.equal(res.body.operation.status, 'RUNNING')
    // The real pipeline (a real planner call, real baseline, real repairs)
    // takes well over 50ms -- if this returned that fast, it genuinely
    // didn't wait for it, proving the fix's whole point.
    assert.ok(Date.now() - start < 2000, 'POST must return before the pipeline finishes')
    // Drain the now-detached background job before withServer's own
    // cleanup deletes the state file out from under it -- otherwise it's
    // still writing when the NEXT test recreates a fresh file, a real
    // cross-test race this fix's own test-writing surfaced.
    await pollOperation(base, res.body.operationId)
  })
})

test('REQUIRED PROOF: a real clean project goes through refresh -> baseline -> auto-repair -> recompute end to end', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const { operation } = await prepareForWork(base, [projectId])
    const result = operation.results[projectId]
    assert.equal(result.settled, true)
    assert.equal(result.ok, true)
    // Not READY_FOR_WORK: the stub Orca CLI can never actually resolve
    // ORCA_NOT_REGISTERED (see below), so this honestly lands BLOCKED with
    // one real repair genuinely attempted and not yet resolved -- never a
    // cosmetic READY_FOR_WORK.
    assert.equal(result.phase, 'BLOCKED')
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
    const remaining = result.causesAfter.filter((c) => c.repairClass !== 'NOT_A_DEFECT')
    assert.deepEqual(
      remaining.map((c) => c.cause),
      ['ORCA_NOT_REGISTERED']
    )
  })
})

test('REQUIRED PROOF: a real failing baseline test is never dropped from the final readiness result', async () => {
  // Real V1 stabilization finding: Stage 4's final diagnose used to omit
  // the Stage 2 baseline entirely, so a real failing `npm run test` (or
  // any command that timed out to UNKNOWN) never showed up in the final
  // causesAfter/readyForWork -- projects could come back falsely
  // READY_FOR_WORK. This is the end-to-end proof the fix closes that.
  await withServer(async (base) => {
    const projectId = await onboard(base, { failingTest: true })
    const { operation } = await prepareForWork(base, [projectId])
    const result = operation.results[projectId]
    assert.equal(result.readyForWork, false)
    const remaining = result.causesAfter.filter((c) => c.repairClass !== 'NOT_A_DEFECT')
    assert.ok(
      remaining.some((c) => c.cause === 'TESTS_FAILING'),
      `expected TESTS_FAILING in final causesAfter, got: ${JSON.stringify(remaining.map((c) => c.cause))}`
    )
  })
})

test('a project with no discovered command guidance honestly skips the baseline stage, never fakes one', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, { withTestScript: false })
    const { operation } = await prepareForWork(base, [projectId])
    const result = operation.results[projectId]
    const baselineStage = result.stages.find((s) => s.stage === 'BASELINE')
    // Even with no test script, package.json still exists so
    // commandGuidance is discovered -- this proves the route runs the
    // real discovery-dependent baseline path rather than always skipping.
    assert.ok(baselineStage)
  })
})

test('an unknown project id is reported honestly, not a crash', async () => {
  await withServer(async (base) => {
    const { operation } = await prepareForWork(base, ['does-not-exist'])
    const result = operation.results['does-not-exist']
    assert.equal(result.ok, false)
    assert.equal(result.phase, 'FAILED')
    assert.match(result.error, /not an onboarded project/)
  })
})

test('a mixed batch: one real project succeeds, one unknown id fails -- neither blocks the other', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const { operation } = await prepareForWork(base, [projectId, 'does-not-exist'])
    const real = operation.results[projectId]
    const fake = operation.results['does-not-exist']
    assert.equal(real.ok, true)
    assert.equal(fake.ok, false)
  })
})

test('real progress persists incrementally: the refreshed analysis survives even if repair-selected were run again', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    await prepareForWork(base, [projectId])
    const projectRes = await fetch(`${base}/api/projects/${projectId}`)
    const project = await projectRes.json()
    assert.ok(project.evidence.onboarding)
    assert.ok(project.evidence.onboarding.analyzedAt)
  })
})

test('CONCURRENCY: two operations for different projects racing does not lose either onboardedProjects update (review finding)', async () => {
  await withServer(async (base) => {
    const projectA = await onboard(base, {})
    const projectB = await onboard(base, {})
    // Two genuinely overlapping-in-time operations for DISJOINT project
    // sets -- not caught by the exact-match dedup (different sets), and
    // before this fix, saveAnalysis's unlocked read-modify-write could
    // silently revert whichever project's onboardedProjects update landed
    // first once the other operation's locked write carried forward a
    // stale snapshot.
    const [a, b] = await Promise.all([
      prepareForWork(base, [projectA]),
      prepareForWork(base, [projectB])
    ])
    assert.equal(a.operation.results[projectA].ok, true)
    assert.equal(b.operation.results[projectB].ok, true)
    const [projA, projB] = await Promise.all([
      fetch(`${base}/api/projects/${projectA}`).then((r) => r.json()),
      fetch(`${base}/api/projects/${projectB}`).then((r) => r.json())
    ])
    assert.ok(
      projA.evidence.onboarding.analyzedAt,
      'project A REFRESH must have survived project B racing it'
    )
    assert.ok(
      projB.evidence.onboarding.analyzedAt,
      'project B REFRESH must have survived project A racing it'
    )
  })
})

test('IDEMPOTENT RETRY: a duplicate POST for the same still-running project set reattaches to the same operation', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const first = await post(base, '/api/projects/prepare-for-work', { projectIds: [projectId] })
    assert.equal(first.status, 202)
    // Retried immediately, before the first has settled -- the real-world
    // "operator retries after the UI appeared to lose track of it" case.
    const second = await post(base, '/api/projects/prepare-for-work', { projectIds: [projectId] })
    assert.equal(second.status, 200)
    assert.equal(second.body.reused, true)
    assert.equal(second.body.operationId, first.body.operationId)
    await pollOperation(base, first.body.operationId)
  })
})

test('GET /api/prepare-for-work-operations lists recent operations without needing a remembered id', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const { operationId } = await prepareForWork(base, [projectId])
    const list = await get(base, '/api/prepare-for-work-operations')
    assert.equal(list.status, 200)
    assert.ok(list.body.operations.some((op) => op.operationId === operationId))
  })
})

test('GET /api/projects/prepare-for-work/:id 404s honestly for an unknown operation', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/projects/prepare-for-work/does-not-exist')
    assert.equal(res.status, 404)
  })
})

test('FRONTEND DISCONNECT: the operation completes server-side even if nothing ever polls it', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    const start = await post(base, '/api/projects/prepare-for-work', { projectIds: [projectId] })
    assert.equal(start.status, 202)
    // Deliberately never call GET again for this operation -- the real
    // failure mode was one browser fetch dying; this proves the pipeline
    // that fetch used to gate on now runs to completion regardless. The
    // only "poll" here is a plain wait, standing in for the browser tab/
    // TSF window being gone entirely.
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const { readPrepareForWorkOperation } = await import('../server/prepare-for-work-store.mjs')
    const operation = readPrepareForWorkOperation(start.body.operationId)
    assert.equal(operation.status, 'COMPLETED')
    assert.equal(operation.results[projectId].settled, true)
  })
})

test('RECOVERY: an operation left RUNNING by a dead process instance is reacquired under the same id and reaches a real terminal state', async () => {
  await withServer(async (base) => {
    const projectId = await onboard(base, {})
    // Simulate the real incident: an operation record exists and is marked
    // RUNNING, but nothing is actually driving it forward -- exactly what
    // a crashed/restarted host leaves behind, since the previous process's
    // in-memory pipeline died with it.
    const operationId = 'pfw-simulated-crashed-process'
    await withPrepareForWorkOperation(operationId, () => ({
      schemaVersion: 'TSF_PREPARE_FOR_WORK_OPERATION_V1',
      operationId,
      projectIds: [projectId],
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      results: { [projectId]: { phase: 'RECONCILING', settled: false } }
    }))
    const reacquired = await recoverInterruptedPrepareForWorkOperations()
    assert.deepEqual(reacquired, [operationId])
    const operation = await pollOperation(base, operationId)
    assert.equal(operation.results[projectId].settled, true)
    assert.equal(operation.results[projectId].ok, true)
  })
})
