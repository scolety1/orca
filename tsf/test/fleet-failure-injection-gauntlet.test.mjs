import { spawn, execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const WORKER_FLAG = '--fleet-failure-injection-worker'
const HERE = import.meta.dirname
const STUB_ORCA = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const VERIFICATION_WORK_ID = 'tsf-reconciliation-verification'
const HEALTHY_BYTES = 8 * 1024 ** 3
const CRITICAL_BYTES = 1 * 1024 ** 3
const TOTAL_BYTES = 16 * 1024 ** 3

const KILL = Object.freeze({
  research: 'mission:gauntlet-kill-research',
  node: 'node:gauntlet-kill-research',
  building: 'fixture:gauntlet-kill-building'
})

const MIXED = Object.freeze({
  research: 'mission:gauntlet-mixed-research',
  node: 'node:gauntlet-mixed-research',
  building: 'fixture:gauntlet-mixed-building',
  verification: 'fixture:gauntlet-mixed-verification',
  waiting: 'fixture:gauntlet-mixed-waiting',
  needsYou: 'fixture:gauntlet-mixed-needs-you',
  held: 'fixture:gauntlet-mixed-held'
})

const RESUME = Object.freeze({
  building: 'fixture:gauntlet-resume-building',
  waiting: 'fixture:gauntlet-resume-waiting',
  needsYou: 'fixture:gauntlet-resume-needs-you',
  held: 'fixture:gauntlet-resume-held'
})

function configureWorker(stateFile, freeBytes = HEALTHY_BYTES, taskStatus = 'running') {
  process.env.TSF_UI_STATE_FILE = stateFile
  process.env.TSF_DISPOSABLE_RUNTIME = '1'
  process.env.TSF_ORCA_CLI_COMMAND = STUB_ORCA
  process.env.STUB_ORCA_MODE = 'success'
  process.env.STUB_ORCA_REPOS = '[]'
  process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: taskStatus }])
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(TOTAL_BYTES)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(freeBytes)
  delete process.env.ORCA_TERMINAL_HANDLE
}

async function waitFor(predicate, timeoutMs = 30_000) {
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

function researchResult(nodeId, taskFingerprint, provider, value) {
  const sourceRef = `src:${value}`
  return {
    schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
    nodeId,
    taskFingerprint,
    provider,
    status: 'SUCCEEDED',
    observations: [
      {
        rawContent: value,
        extractedAt: new Date().toISOString(),
        providerConfidence: 0.9,
        providerReasoning: 'failure-injection fixture'
      }
    ],
    proposedClaims: [
      {
        fieldName: 'value',
        proposedValue: value,
        temporalScope: 'fixture-crash-test-period',
        providerConfidence: 0.9,
        providerReasoning: 'failure-injection fixture'
      }
    ],
    evidence: [{ claimFieldName: 'value', sourceRef, snippet: value, supportsClaim: true }],
    sourceReferences: [
      {
        sourceRef,
        url: `https://example.invalid/${value}`,
        publisher: 'fixture',
        retrievedAt: new Date().toISOString()
      }
    ],
    sourceSnapshotsOrSnapshotRefs: [
      { sourceRef, contentHash: `sha256:${value}`, rawContentRef: `fixture://${value}` }
    ],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 1, providerReportedCostUsd: 0 },
    failureDetails: null
  }
}

async function seedResearchDispatch(missionId, nodeId, value) {
  const { createResearchMissionDurable, dispatchResearchNodeDurable } =
    await import('../server/research-mission-driver.mjs')
  const { buildBoundedResearchRequest } = await import('../domain/research-node.mjs')
  const { buildGenericCrashFixtureMissionInput } =
    await import('./fixtures/generic-research-crash-fixture.mjs')
  const { WEB_TABLE_PROVIDER_ID } = await import('../adapters/web-table-research-worker.mjs')
  const clock = () => new Date()
  const mission = await createResearchMissionDurable(
    missionId,
    buildGenericCrashFixtureMissionInput(missionId, nodeId),
    clock
  )
  const request = buildBoundedResearchRequest(
    mission,
    mission.nodes[0],
    WEB_TABLE_PROVIDER_ID,
    clock
  )
  const dispatchedAt = new Date().toISOString()
  const result = researchResult(nodeId, request.taskFingerprint, WEB_TABLE_PROVIDER_ID, value)
  const workerRunRef = {
    provider: WEB_TABLE_PROVIDER_ID,
    providerRunId: JSON.stringify({ dispatchedAt, result }),
    dispatchedAt
  }
  const dispatched = await dispatchResearchNodeDurable(
    missionId,
    nodeId,
    WEB_TABLE_PROVIDER_ID,
    { dispatch: async () => ({ ok: true, workerRunRef }) },
    clock
  )
  if (!dispatched.ok) {
    throw new Error(JSON.stringify(dispatched))
  }
}

async function createRun(projectId, stateMutator) {
  const { createOvernightRun } = await import('../domain/keep-going.mjs')
  const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const clock = () => new Date()
  let run = createOvernightRun(
    {
      id: `run:${projectId}`,
      projectId,
      originalGoal: `Preserve isolated state for ${projectId}.`,
      acceptanceCriteria: [`${projectId}:ACCEPTANCE`],
      constraints: [`${projectId}:CONSTRAINT`],
      stopConditions: [`${projectId}:STOP`],
      usageMode: 'BALANCED'
    },
    clock
  )
  if (stateMutator) {
    run = stateMutator(run, clock)
  }
  await withKeepGoingRun(projectId, () => run)
  return run
}

async function seedBuilding(projectId, worktree, itemId) {
  await createRun(projectId)
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  const result = await tickKeepGoingRun(
    projectId,
    [{ id: itemId, scope: ['**/*'], worktree, agent: 'codex' }],
    () => new Date()
  )
  if (result.action !== 'WAVE_DISPATCHED') {
    throw new Error(JSON.stringify(result))
  }
}

async function seedVerification(projectId, worktree) {
  await seedBuilding(projectId, worktree, `implementation:${projectId}`)
  process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'completed' }])
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  const settled = await tickKeepGoingRun(projectId, [], () => new Date())
  if (settled.action !== 'WAVE_SETTLED') {
    throw new Error(JSON.stringify(settled))
  }
  const { reconcileSettledRun } = await import('../server/settled-run-reconciler.mjs')
  const verification = await reconcileSettledRun(projectId, () => new Date())
  if (verification.action !== 'DISPATCH_VERIFICATION') {
    throw new Error(JSON.stringify(verification))
  }
  process.env.STUB_ORCA_TASKS = JSON.stringify([{ id: 'stub-task-id', status: 'running' }])
}

async function seedWaiting(projectId, worktree, itemId) {
  await createRun(projectId)
  const { readKeepGoingRun, withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const { recordResourceRefusal } = await import('../server/keep-going-resource-pressure-gate.mjs')
  await recordResourceRefusal(
    { readRun: readKeepGoingRun, withRun: withKeepGoingRun },
    projectId,
    [{ id: itemId, scope: ['**/*'], worktree, agent: 'codex' }],
    { admitted: false, tier: 'CRITICAL', reason: 'deliberate gauntlet pressure' },
    () => new Date()
  )
}

async function seedNeedsYou(projectId) {
  const { raiseNeedsYou } = await import('../domain/keep-going.mjs')
  await createRun(projectId, (run, clock) =>
    raiseNeedsYou(
      run,
      { question: `Unresolved owner decision for ${projectId}?`, options: ['ONE', 'TWO'] },
      clock,
      run.revision
    )
  )
}

async function seedHeld(projectId, worktree) {
  await seedWaiting(projectId, worktree, `held-work:${projectId}`)
  const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
  const { withProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
  const hold = createProjectExecutionHold(
    {
      projectId,
      reason: 'EXTERNAL_WORK_ACTIVE',
      setBy: 'FAILURE_INJECTION_GAUNTLET',
      note: 'Disposable NWR-shaped hold fixture; never dispatch.'
    },
    () => new Date()
  )
  await withProjectExecutionHold(projectId, () => hold)
}

async function seedKillPair(markerPath, worktree) {
  await seedResearchDispatch(KILL.research, KILL.node, 'kill-recovered')
  await seedBuilding(KILL.building, worktree, 'implementation:kill-pair')
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid }))
  setInterval(() => {}, 2 ** 31 - 1)
}

async function seedMixedFleet(markerPath, worktree) {
  await seedResearchDispatch(MIXED.research, MIXED.node, 'mixed-recovered')
  await seedBuilding(MIXED.building, worktree, 'implementation:mixed-building')
  await seedVerification(MIXED.verification, worktree)
  await seedWaiting(MIXED.waiting, worktree, 'implementation:mixed-waiting')
  await seedNeedsYou(MIXED.needsYou)
  await seedHeld(MIXED.held, worktree)
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid }))
}

async function startProductionDrivers() {
  process.env.TSF_KEEP_GOING_FLEET_DRIVER = '1'
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER = '1'
  process.env.TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS = '100'
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS = '100'
  const { bootstrapKeepGoingFleetDriverIfEnabled } =
    await import('../server/keep-going-fleet-driver-bootstrap.mjs')
  const { bootstrapResearchMissionFleetDriverIfEnabled } =
    await import('../server/research-mission-fleet-driver-bootstrap.mjs')
  const server = new EventEmitter()
  bootstrapKeepGoingFleetDriverIfEnabled(server)
  bootstrapResearchMissionFleetDriverIfEnabled(server)
  return server
}

async function recoverKillPair(markerPath) {
  const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const { readResearchMission } = await import('../server/research-mission-store.mjs')
  const server = await startProductionDrivers()
  await waitFor(() => {
    const mission = readResearchMission(KILL.research)
    const run = readKeepGoingRun(KILL.building)
    return mission?.state === 'COMPLETE' && run?.waves.length >= 1
  })
  server.emit('close')
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid }))
}

async function recoverMixedFleet(markerPath) {
  const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const { readResearchMission } = await import('../server/research-mission-store.mjs')
  const waitingRevision = readKeepGoingRun(MIXED.waiting).revision
  const server = await startProductionDrivers()
  await waitFor(() => {
    const mission = readResearchMission(MIXED.research)
    const waiting = readKeepGoingRun(MIXED.waiting)
    return mission?.state === 'COMPLETE' && waiting?.revision > waitingRevision
  })
  server.emit('close')
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid }))
}

async function runAutomaticResourceResume(markerPath, worktree) {
  const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const { readProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
  await seedBuilding(RESUME.building, worktree, 'implementation:resume-building')
  await seedWaiting(RESUME.waiting, worktree, 'implementation:resume-waiting')
  await seedNeedsYou(RESUME.needsYou)
  await seedHeld(RESUME.held, worktree)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(CRITICAL_BYTES)
  const before = {
    building: readKeepGoingRun(RESUME.building),
    waiting: readKeepGoingRun(RESUME.waiting),
    needsYou: readKeepGoingRun(RESUME.needsYou),
    held: readKeepGoingRun(RESUME.held),
    hold: readProjectExecutionHold(RESUME.held)
  }
  process.env.TSF_KEEP_GOING_FLEET_DRIVER = '1'
  process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER = '0'
  process.env.TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS = '100'
  const { bootstrapKeepGoingFleetDriverIfEnabled } =
    await import('../server/keep-going-fleet-driver-bootstrap.mjs')
  const server = new EventEmitter()
  bootstrapKeepGoingFleetDriverIfEnabled(server)
  await waitFor(() => readKeepGoingRun(RESUME.waiting).revision > before.waiting.revision)
  const pressureChecked = readKeepGoingRun(RESUME.waiting)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(HEALTHY_BYTES)
  const resumed = await waitFor(() => readKeepGoingRun(RESUME.waiting).inFlightWave)
  server.emit('close')
  const after = {
    building: readKeepGoingRun(RESUME.building),
    waiting: readKeepGoingRun(RESUME.waiting),
    needsYou: readKeepGoingRun(RESUME.needsYou),
    held: readKeepGoingRun(RESUME.held),
    hold: readProjectExecutionHold(RESUME.held)
  }
  writeFileSync(
    markerPath,
    JSON.stringify({ pid: process.pid, before, pressureChecked, resumed, after })
  )
}

async function runWorker() {
  const [, , , mode, stateFile, markerPath, worktree] = process.argv
  const critical = mode === 'recover-mixed'
  configureWorker(
    stateFile,
    critical ? CRITICAL_BYTES : HEALTHY_BYTES,
    mode === 'recover-kill' ? 'completed' : 'running'
  )
  if (mode === 'seed-kill') {
    return seedKillPair(markerPath, worktree)
  }
  if (mode === 'recover-kill') {
    return recoverKillPair(markerPath)
  }
  if (mode === 'seed-mixed') {
    return seedMixedFleet(markerPath, worktree)
  }
  if (mode === 'recover-mixed') {
    return recoverMixedFleet(markerPath)
  }
  if (mode === 'resource-resume') {
    return runAutomaticResourceResume(markerPath, worktree)
  }
  throw new Error(`unknown worker mode: ${mode}`)
}

if (process.argv[2] === WORKER_FLAG) {
  await runWorker()
} else {
  const { default: assert } = await import('node:assert/strict')
  const { default: test } = await import('node:test')

  function initializeRepo(dir) {
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    writeFileSync(path.join(dir, 'README.md'), '# failure-injection fixture\n')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir })
  }

  function state(stateFile) {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  }

  function launch(mode, stateFile, markerPath, worktree) {
    const child = spawn(
      process.execPath,
      [import.meta.filename, WORKER_FLAG, mode, stateFile, markerPath, worktree],
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

  async function runToCompletion(mode, stateFile, markerPath, worktree) {
    const worker = launch(mode, stateFile, markerPath, worktree)
    const exit = await worker.exited
    assert.equal(exit.code, 0, `${mode} failed: ${exit.stderr || exit.stdout}`)
    return JSON.parse(readFileSync(markerPath, 'utf8'))
  }

  function newFixture(prefix) {
    const dir = mkdtempSync(path.join(tmpdir(), prefix))
    const worktree = path.join(dir, 'worktree')
    initializeRepo(worktree)
    return { dir, worktree, stateFile: path.join(dir, 'operator-state.json') }
  }

  test(
    'SIGKILL of one active research dispatch recovers exactly once while unrelated Keep Going work continues',
    { timeout: 45_000 },
    async () => {
      const fixture = newFixture('tsf-failure-injection-kill-')
      try {
        const seedMarker = path.join(fixture.dir, 'seed.json')
        const recoveryMarker = path.join(fixture.dir, 'recovered.json')
        const seeder = launch('seed-kill', fixture.stateFile, seedMarker, fixture.worktree)
        await waitFor(() => existsSync(seedMarker))
        const killed = JSON.parse(readFileSync(seedMarker, 'utf8'))
        const before = state(fixture.stateFile)
        assert.equal(seeder.child.exitCode, null)
        assert.equal(seeder.child.kill('SIGKILL'), true)
        await seeder.exited

        const recovered = await runToCompletion(
          'recover-kill',
          fixture.stateFile,
          recoveryMarker,
          fixture.worktree
        )
        const after = state(fixture.stateFile)
        const node = after.researchMissions[KILL.research].nodes[0]
        const building = after.keepGoingRuns[KILL.building]
        assert.notEqual(recovered.pid, killed.pid)
        assert.equal(after.researchMissions[KILL.research].state, 'COMPLETE')
        assert.equal(node.dispatchAttempts.length, 1)
        assert.equal(node.dispatchRecords.length, 1)
        assert.equal(node.canonicalFacts[0].value, 'kill-recovered')
        assert.deepEqual(building.originalGoal, before.keepGoingRuns[KILL.building].originalGoal)
        assert.equal(
          building.waves
            .flatMap((wave) => wave.wavePlan.batches.flat())
            .filter((item) => item.id === 'implementation:kill-pair').length,
          1,
          'the unrelated implementation unit may progress, but must never duplicate'
        )
        assert.equal(
          JSON.stringify(building).includes(KILL.research),
          false,
          'research recovery must never write into the unrelated project run'
        )
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true })
      }
    }
  )

  test(
    'fresh production bootstraps recover a mixed-state fleet without touching Needs You or held work',
    { timeout: 45_000 },
    async () => {
      const fixture = newFixture('tsf-failure-injection-restart-')
      try {
        await new Promise((resolve) => setTimeout(resolve, 1100))
        const seedMarker = path.join(fixture.dir, 'seed.json')
        const recoveryMarker = path.join(fixture.dir, 'recovered.json')
        const seeded = await runToCompletion(
          'seed-mixed',
          fixture.stateFile,
          seedMarker,
          fixture.worktree
        )
        const before = state(fixture.stateFile)
        const beforeResearchNode = before.researchMissions[MIXED.research].nodes[0]
        assert.equal(beforeResearchNode.status, 'DISPATCHED')
        assert.equal(
          before.keepGoingRuns[MIXED.building].inFlightWave.wavePlan.batches.flat()[0].id,
          'implementation:mixed-building'
        )
        assert.equal(
          before.keepGoingRuns[MIXED.verification].inFlightWave.wavePlan.batches.flat()[0].id,
          VERIFICATION_WORK_ID
        )
        assert.equal(
          before.keepGoingRuns[MIXED.waiting].checkpoints.at(-1).phase,
          'DISPATCH_WAITING_FOR_RESOURCES'
        )
        assert.equal(before.keepGoingRuns[MIXED.needsYou].state, 'NEEDS_YOU')
        assert.equal(before.projectExecutionHolds[MIXED.held].status, 'ACTIVE')

        const recovered = await runToCompletion(
          'recover-mixed',
          fixture.stateFile,
          recoveryMarker,
          fixture.worktree
        )
        const after = state(fixture.stateFile)
        const afterResearchNode = after.researchMissions[MIXED.research].nodes[0]
        assert.notEqual(recovered.pid, seeded.pid)
        assert.equal(after.researchMissions[MIXED.research].state, 'COMPLETE')
        assert.equal(afterResearchNode.dispatchAttempts.length, 1)
        assert.equal(afterResearchNode.dispatchRecords.length, 1)
        assert.equal(afterResearchNode.canonicalFacts[0].value, 'mixed-recovered')

        for (const projectId of [MIXED.building, MIXED.verification]) {
          assert.deepEqual(
            after.keepGoingRuns[projectId].originalGoal,
            before.keepGoingRuns[projectId].originalGoal
          )
          assert.deepEqual(
            after.keepGoingRuns[projectId].waves,
            before.keepGoingRuns[projectId].waves
          )
          assert.deepEqual(
            after.keepGoingRuns[projectId].inFlightWave,
            before.keepGoingRuns[projectId].inFlightWave
          )
        }
        const waiting = after.keepGoingRuns[MIXED.waiting]
        assert.equal(waiting.state, 'ACTIVE')
        assert.equal(waiting.inFlightWave, null)
        assert.equal(waiting.waves.length, 0)
        assert.deepEqual(
          waiting.pendingDispatch.candidateWorkItems,
          before.keepGoingRuns[MIXED.waiting].pendingDispatch.candidateWorkItems
        )
        assert.equal(waiting.checkpoints.at(-1).phase, 'DISPATCH_WAITING_FOR_RESOURCES')
        assert.deepEqual(after.keepGoingRuns[MIXED.needsYou], before.keepGoingRuns[MIXED.needsYou])
        assert.deepEqual(after.keepGoingRuns[MIXED.held], before.keepGoingRuns[MIXED.held])
        assert.deepEqual(
          after.projectExecutionHolds[MIXED.held],
          before.projectExecutionHolds[MIXED.held]
        )
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true })
      }
    }
  )

  test(
    'resource pressure clearing autonomously resumes only the waiting project; Needs You and held projects stay immutable',
    { timeout: 45_000 },
    async () => {
      const fixture = newFixture('tsf-failure-injection-resume-')
      try {
        const marker = path.join(fixture.dir, 'result.json')
        const result = await runToCompletion(
          'resource-resume',
          fixture.stateFile,
          marker,
          fixture.worktree
        )
        assert.ok(result.pressureChecked.revision > result.before.waiting.revision)
        assert.equal(result.pressureChecked.inFlightWave, null)
        assert.equal(
          result.pressureChecked.checkpoints.at(-1).phase,
          'DISPATCH_WAITING_FOR_RESOURCES'
        )
        assert.ok(
          result.resumed,
          'the interval driver must resume the pending dispatch without a manual fire'
        )
        assert.equal(result.after.waiting.pendingDispatch, null)
        assert.equal(result.after.waiting.inFlightWave.dispatchRecords.length, 1)
        assert.deepEqual(
          result.after.waiting.inFlightWave.wavePlan.batches.flat().map((item) => item.id),
          ['implementation:resume-waiting']
        )
        assert.deepEqual(result.after.needsYou, result.before.needsYou)
        assert.deepEqual(result.after.held, result.before.held)
        assert.deepEqual(result.after.hold, result.before.hold)
        assert.equal(result.after.held.inFlightWave, null)
        assert.ok(result.after.held.pendingDispatch)
        assert.equal(result.after.building.inFlightWave.dispatchRecords.length, 1)
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true })
      }
    }
  )
}
