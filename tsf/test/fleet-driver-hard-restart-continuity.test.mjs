import { spawn, execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const WORKER_FLAG = '--hard-restart-worker'
const KEEP_PROJECT_ID = 'fixture:hard-restart-keep-going'
const KEEP_RUN_ID = 'run:hard-restart-keep-going'
const RESEARCH_MISSION_ID = 'mission:hard-restart-research'
const RESEARCH_NODE_ID = 'node:hard-restart-research'
const VERIFICATION_WORK_ID = 'tsf-reconciliation-verification'
const HERE = import.meta.dirname
const STUB_ORCA = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')

function configureWorker(stateFile) {
  process.env.TSF_UI_STATE_FILE = stateFile
  process.env.TSF_DISPOSABLE_RUNTIME = '1'
  process.env.TSF_ORCA_CLI_COMMAND = STUB_ORCA
  process.env.STUB_ORCA_MODE = 'success'
  process.env.STUB_ORCA_REPOS = '[]'
  process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'completed' }])
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
  delete process.env.ORCA_TERMINAL_HANDLE
}

async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 20)) // eslint-disable-line no-await-in-loop
  }
}

function researchResult(nodeId, taskFingerprint, provider) {
  const sourceRef = 'src:hard-restart-fixture'
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId,
    taskFingerprint,
    provider,
    status: 'SUCCEEDED',
    observations: [
      {
        rawContent: 'durable restart observation',
        extractedAt: new Date().toISOString(),
        providerConfidence: 0.9,
        providerReasoning: 'restart fixture'
      }
    ],
    proposedClaims: [
      {
        fieldName: 'value',
        proposedValue: 'survived-restart',
        temporalScope: 'fixture-crash-test-period',
        providerConfidence: 0.9,
        providerReasoning: 'restart fixture'
      }
    ],
    evidence: [
      { claimFieldName: 'value', sourceRef, snippet: 'durable evidence', supportsClaim: true }
    ],
    sourceReferences: [
      {
        sourceRef,
        url: 'https://example.invalid/restart',
        publisher: 'fixture',
        retrievedAt: new Date().toISOString()
      }
    ],
    sourceSnapshotsOrSnapshotRefs: [
      { sourceRef, contentHash: 'sha256:hard-restart', rawContentRef: 'fixture://hard-restart' }
    ],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 0 },
    failureDetails: null
  }
}

async function seedKeepGoing(markerPath, worktree) {
  const { createOvernightRun } = await import('../domain/keep-going.mjs')
  const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  const clock = () => new Date()
  const run = createOvernightRun(
    {
      id: KEEP_RUN_ID,
      projectId: KEEP_PROJECT_ID,
      originalGoal: 'Survive a complete backend and conversation loss.',
      acceptanceCriteria: ['RECOVERY_BOOTSTRAP_RESELECTS', 'ORIGINAL_WORK_IS_NOT_DUPLICATED'],
      constraints: ['Use durable state only.'],
      stopConditions: ['Stop if durable state is corrupt.'],
      usageMode: 'BALANCED'
    },
    clock
  )
  await withKeepGoingRun(KEEP_PROJECT_ID, () => run)
  const result = await tickKeepGoingRun(
    KEEP_PROJECT_ID,
    [{ id: 'implementation-1', scope: ['**/*'], worktree, agent: 'codex' }],
    clock
  )
  if (result.action !== 'WAVE_DISPATCHED') {
    throw new Error(JSON.stringify(result))
  }
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid, action: result.action }))
  setInterval(() => {}, 2 ** 31 - 1)
}

async function recoverKeepGoing(markerPath) {
  process.env.TSF_KEEP_GOING_FLEET_DRIVER = '1'
  process.env.TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS = '100'
  const { bootstrapKeepGoingFleetDriverIfEnabled } =
    await import('../server/keep-going-fleet-driver-bootstrap.mjs')
  const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const server = new EventEmitter()
  const driver = bootstrapKeepGoingFleetDriverIfEnabled(server)
  const recovered = await waitFor(() => {
    const run = readKeepGoingRun(KEEP_PROJECT_ID)
    return run?.waves.length === 1 &&
      run.inFlightWave?.dispatchRecords.some((record) => record.workItemId === VERIFICATION_WORK_ID)
      ? run
      : null
  })
  // Overnight autonomous-improvement mission, real finding: server.emit
  // ('close') never awaits an EventEmitter listener's returned promise, so
  // it does NOT guarantee the driver has genuinely stopped -- an
  // already-in-flight cycle (started by an interval tick that fired right
  // around when waitFor's condition became true) could still be running
  // and could settle a SECOND wave after this line, before the process
  // actually exits. Awaiting the real driver handle's own stop() directly
  // closes that race for real (see keep-going-fleet-driver.mjs's own fix).
  server.emit('close')
  await driver?.stop()
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid, recovered }))
}

async function seedResearch(markerPath) {
  const { createResearchMissionDurable, dispatchResearchNodeDurable } =
    await import('../server/research-mission-driver.mjs')
  const { buildBoundedResearchRequest } = await import('../domain/research-node.mjs')
  const { buildGenericCrashFixtureMissionInput } =
    await import('./fixtures/generic-research-crash-fixture.mjs')
  const { WEB_TABLE_PROVIDER_ID } = await import('../adapters/web-table-research-worker.mjs')
  const clock = () => new Date()
  const mission = await createResearchMissionDurable(
    RESEARCH_MISSION_ID,
    buildGenericCrashFixtureMissionInput(RESEARCH_MISSION_ID, RESEARCH_NODE_ID),
    clock
  )
  const request = buildBoundedResearchRequest(
    mission,
    mission.nodes[0],
    WEB_TABLE_PROVIDER_ID,
    clock
  )
  const dispatchedAt = new Date().toISOString()
  const result = researchResult(RESEARCH_NODE_ID, request.taskFingerprint, WEB_TABLE_PROVIDER_ID)
  const workerRunRef = {
    provider: WEB_TABLE_PROVIDER_ID,
    providerRunId: JSON.stringify({ dispatchedAt, result }),
    dispatchedAt
  }
  const dispatched = await dispatchResearchNodeDurable(
    RESEARCH_MISSION_ID,
    RESEARCH_NODE_ID,
    WEB_TABLE_PROVIDER_ID,
    { dispatch: async () => ({ ok: true, workerRunRef }) },
    clock
  )
  if (!dispatched.ok) {
    throw new Error(JSON.stringify(dispatched))
  }
  writeFileSync(
    markerPath,
    JSON.stringify({ pid: process.pid, taskFingerprint: request.taskFingerprint })
  )
  setInterval(() => {}, 2 ** 31 - 1)
}

async function recoverResearch(markerPath) {
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER = '1'
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS = '100'
  const { bootstrapResearchMissionFleetDriverIfEnabled } =
    await import('../server/research-mission-fleet-driver-bootstrap.mjs')
  const { readResearchMission } = await import('../server/research-mission-store.mjs')
  const server = new EventEmitter()
  const driver = bootstrapResearchMissionFleetDriverIfEnabled(server)
  const recovered = await waitFor(() => {
    const mission = readResearchMission(RESEARCH_MISSION_ID)
    return mission?.state === 'COMPLETE' ? mission : null
  })
  // Same real fix as recoverKeepGoing's own -- see that function's comment.
  server.emit('close')
  await driver?.stop()
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid, recovered }))
}

async function runWorker() {
  const [, , , mode, stateFile, markerPath, worktree] = process.argv
  configureWorker(stateFile)
  if (mode === 'seed-keep-going') {
    return seedKeepGoing(markerPath, worktree)
  }
  if (mode === 'recover-keep-going') {
    return recoverKeepGoing(markerPath)
  }
  if (mode === 'seed-research') {
    return seedResearch(markerPath)
  }
  if (mode === 'recover-research') {
    return recoverResearch(markerPath)
  }
  throw new Error(`unknown worker mode: ${mode}`)
}

if (process.argv[2] === WORKER_FLAG) {
  await runWorker()
} else {
  const { default: assert } = await import('node:assert/strict')
  const { default: test } = await import('node:test')
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-hard-restart-continuity-'))
  const stateFile = path.join(dir, 'operator-state.json')
  const worktree = path.join(dir, 'keep-going-worktree')

  function git(args) {
    execFileSync('git', args, { cwd: worktree, stdio: 'ignore' })
  }

  function initializeWorktree() {
    execFileSync('git', ['init', '-q', worktree])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'Test'])
    writeFileSync(path.join(worktree, 'README.md'), '# hard restart fixture\n')
    git(['add', '-A'])
    git(['commit', '-q', '-m', 'initial'])
  }

  function state() {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  }

  function launch(mode, markerPath, extraArgs = []) {
    const child = spawn(
      process.execPath,
      [import.meta.filename, WORKER_FLAG, mode, stateFile, markerPath, ...extraArgs],
      { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
    )
    return { child, exited }
  }

  async function crashSeed(mode, markerPath, extraArgs = []) {
    const worker = launch(mode, markerPath, extraArgs)
    await waitFor(() => existsSync(markerPath))
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    assert.equal(worker.child.exitCode, null, 'the work process must still be alive before SIGKILL')
    assert.equal(worker.child.kill('SIGKILL'), true)
    await worker.exited
    return marker
  }

  async function recover(mode, markerPath) {
    const worker = launch(mode, markerPath)
    const exit = await worker.exited
    assert.equal(exit.code, 0, `recovery worker failed: ${exit.stderr || exit.stdout}`)
    return JSON.parse(readFileSync(markerPath, 'utf8'))
  }

  test.before(initializeWorktree)
  test.after(() => rmSync(dir, { recursive: true, force: true }))

  test(
    'Keep Going: SIGKILLed work is reselected by a fresh production bootstrap without duplicating the in-flight unit',
    { timeout: 30_000 },
    async () => {
      const seedMarker = path.join(dir, 'keep-seeded.json')
      const recoveryMarker = path.join(dir, 'keep-recovered.json')
      const crashed = await crashSeed('seed-keep-going', seedMarker, [worktree])
      const before = state().keepGoingRuns[KEEP_PROJECT_ID]
      assert.equal(before.state, 'ACTIVE')
      assert.equal(before.inFlightWave.dispatchRecords.length, 1)
      assert.ok(before.checkpoints.some((checkpoint) => checkpoint.phase === 'WAVE_DISPATCHED'))

      const recovered = await recover('recover-keep-going', recoveryMarker)
      const after = state().keepGoingRuns[KEEP_PROJECT_ID]
      assert.notEqual(recovered.pid, crashed.pid, 'recovery must run in a fresh OS process')
      assert.deepEqual(after.originalGoal, before.originalGoal)
      assert.deepEqual(after.constraints, before.constraints)
      assert.equal(after.waves.length, 1, 'the crashed implementation wave settles exactly once')
      assert.deepEqual(
        after.waves[0].wavePlan.batches.flat().map((item) => item.id),
        ['implementation-1']
      )
      assert.equal(after.waves[0].waveResult.outcomes.length, 1)
      assert.deepEqual(
        after.inFlightWave.wavePlan.batches.flat().map((item) => item.id),
        [VERIFICATION_WORK_ID]
      )
      assert.equal(
        after.inFlightWave.dispatchRecords.length,
        1,
        'only the correct fresh verification work is dispatched'
      )
    }
  )

  test(
    'ResearchMission: SIGKILLed dispatch is reselected by a fresh production bootstrap and resumed from its durable run reference',
    { timeout: 30_000 },
    async () => {
      const seedMarker = path.join(dir, 'research-seeded.json')
      const recoveryMarker = path.join(dir, 'research-recovered.json')
      const crashed = await crashSeed('seed-research', seedMarker)
      const before = state().researchMissions[RESEARCH_MISSION_ID]
      const beforeNode = before.nodes.find((node) => node.id === RESEARCH_NODE_ID)
      assert.equal(before.state, 'ACTIVE')
      assert.equal(beforeNode.status, 'DISPATCHED')
      assert.equal(beforeNode.dispatchAttempts.length, 1)
      assert.equal(beforeNode.dispatchRecords.length, 1)

      const recovered = await recover('recover-research', recoveryMarker)
      const after = state().researchMissions[RESEARCH_MISSION_ID]
      const afterNode = after.nodes.find((node) => node.id === RESEARCH_NODE_ID)
      assert.notEqual(recovered.pid, crashed.pid, 'recovery must run in a fresh OS process')
      assert.equal(after.state, 'COMPLETE')
      assert.deepEqual(after.specification, before.specification)
      assert.deepEqual(after.expectedUniverse, before.expectedUniverse)
      assert.equal(
        afterNode.dispatchAttempts.length,
        1,
        'the crashed dispatch is never attempted twice'
      )
      assert.equal(
        afterNode.dispatchRecords.length,
        1,
        'the crashed unit has exactly one external dispatch'
      )
      assert.equal(afterNode.rawResults.length, 1)
      assert.equal(afterNode.canonicalFacts.length, 1)
      assert.equal(afterNode.canonicalFacts[0].value, 'survived-restart')
    }
  )
}
