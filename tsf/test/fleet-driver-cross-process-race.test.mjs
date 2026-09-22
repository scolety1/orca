import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const WORKER_FLAG = '--cross-process-dispatch-worker'
const clock = () => new Date('2026-09-22T07:00:00.000Z')

function waitForFile(filePath, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (existsSync(filePath)) {
        return resolve()
      }
      if (Date.now() > deadline) {
        return reject(new Error(`timed out waiting for ${filePath}`))
      }
      setTimeout(poll, 10)
    }
    poll()
  })
}

async function runWorker() {
  const [, , , kind, subjectId, nodeId, readyPath, enteredPath, goPath, dispatchPath, resultPath] =
    process.argv
  writeFileSync(readyPath, String(Date.now()))
  await waitForFile(goPath)

  if (kind === 'keep-going') {
    const { driveOneCycle } = await import('../server/keep-going-fleet-driver.mjs')
    const orchestration = {
      createDispatcherTerminal: async () => ({
        ok: true,
        result: { terminal: { handle: `dispatcher-${process.pid}` } }
      }),
      createOrchestrationRun: async () => ({
        ok: true,
        result: { run: { id: `orchestration-${process.pid}` } }
      }),
      bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
      createOrchestrationTask: async () => {
        writeFileSync(dispatchPath, JSON.stringify({ pid: process.pid, at: Date.now() }))
        return { ok: true, result: { task: { id: `task-${process.pid}` } } }
      },
      startOrchestrationWorker: async ({ task }) => {
        await new Promise((resolve) => setTimeout(resolve, 150))
        return {
          ok: true,
          result: {
            taskId: task,
            dispatchId: `dispatch-${process.pid}`,
            state: 'ready',
            stage: 'input_accepted'
          }
        }
      },
      listOrchestrationTasks: async () => ({ ok: true, result: { tasks: [] } }),
      checkOrchestrationMessages: async () => ({ ok: true, result: { messages: [] } })
    }
    const cycle = driveOneCycle(
      [subjectId],
      clock,
      {
        readProjectExecutionHold: () => null,
        tickDeps: {
          orchestration,
          readProjectExecutionHold: () => null,
          capacity: {
            provider: 'codex',
            fetchCapacitySnapshot: async () => ({
              ok: true,
              result: { codex: { weeklyUsedPercent: 0, sessionUsedPercent: 0 } }
            })
          }
        }
      },
      1
    )
    writeFileSync(enteredPath, String(Date.now()))
    const result = await cycle
    writeFileSync(resultPath, JSON.stringify(result[0], null, 2))
    return
  }

  const { dispatchResearchNodeDurable } = await import('../server/research-mission-driver.mjs')
  const worker = {
    dispatch: async () => {
      writeFileSync(dispatchPath, JSON.stringify({ pid: process.pid, at: Date.now() }))
      await new Promise((resolve) => setTimeout(resolve, 150))
      return {
        ok: true,
        workerRunRef: { provider: 'FAKE', providerRunId: `research-run-${process.pid}` }
      }
    }
  }
  const dispatch = dispatchResearchNodeDurable(subjectId, nodeId, 'FAKE', worker, clock)
  writeFileSync(enteredPath, String(Date.now()))
  const result = await dispatch
  writeFileSync(resultPath, JSON.stringify(result, null, 2))
}

if (process.argv[2] === WORKER_FLAG) {
  try {
    await runWorker()
  } catch (error) {
    const resultPath = process.argv.at(-1)
    writeFileSync(
      resultPath,
      JSON.stringify({ thrown: true, code: error.code ?? null, message: error.message }, null, 2)
    )
    process.exitCode = 1
  }
} else {
  const { default: test } = await import('node:test')
  const { default: assert } = await import('node:assert/strict')

  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-cross-process-dispatch-race-'))
  const stateFile = path.join(dir, 'operator-state.json')
  process.env.TSF_UI_STATE_FILE = stateFile
  process.env.TSF_DISPOSABLE_RUNTIME = '1'
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

  const { createOvernightRun } = await import('../domain/keep-going.mjs')
  const { readKeepGoingRun, withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  const { recordResourceRefusal } = await import('../server/keep-going-resource-pressure-gate.mjs')
  const { createResearchMissionDurable } = await import('../server/research-mission-driver.mjs')
  const { readResearchMission } = await import('../server/research-mission-store.mjs')
  const { classifyDispatchDeliveryGuarantee } =
    await import('../domain/research-dispatch-bookkeeping.mjs')
  const { buildBoundedResearchRequest } = await import('../domain/research-node.mjs')
  const { buildGenericCrashFixtureMissionInput } =
    await import('./fixtures/generic-research-crash-fixture.mjs')

  test.after(() => rmSync(dir, { recursive: true, force: true }))

  function launchWorker(kind, subjectId, nodeId, label, goPath) {
    const paths = {
      ready: path.join(dir, `${label}.ready`),
      entered: path.join(dir, `${label}.entered`),
      dispatch: path.join(dir, `${label}.dispatch`),
      result: path.join(dir, `${label}.result.json`)
    }
    const child = spawn(
      process.execPath,
      [
        import.meta.filename,
        WORKER_FLAG,
        kind,
        subjectId,
        nodeId,
        paths.ready,
        paths.entered,
        goPath,
        paths.dispatch,
        paths.result
      ],
      {
        env: {
          ...process.env,
          TSF_UI_STATE_FILE: stateFile,
          TSF_DISPOSABLE_RUNTIME: '1',
          TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES: String(16 * 1024 ** 3),
          TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES: String(8 * 1024 ** 3)
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
    })
    return { child, exited, paths }
  }

  async function raceWorkers(kind, subjectId, nodeId, lockSuffix) {
    const goPath = path.join(dir, `${kind}.go`)
    const workerA = launchWorker(kind, subjectId, nodeId, `${kind}-a`, goPath)
    const workerB = launchWorker(kind, subjectId, nodeId, `${kind}-b`, goPath)
    const workers = [workerA, workerB]
    await Promise.all(workers.map((worker) => waitForFile(worker.paths.ready)))

    const lockPath = `${stateFile}${lockSuffix}`
    writeFileSync(lockPath, `parent-race-gate:${process.pid}`)
    writeFileSync(goPath, String(Date.now()))
    await Promise.all(workers.map((worker) => waitForFile(worker.paths.entered)))
    unlinkSync(lockPath)

    const exits = await Promise.all(workers.map((worker) => worker.exited))
    for (const exit of exits) {
      assert.equal(
        exit.code,
        0,
        `race worker exited ${exit.code ?? exit.signal}: ${exit.stderr || exit.stdout}`
      )
    }
    return workers.map((worker) => ({
      result: JSON.parse(readFileSync(worker.paths.result, 'utf8')),
      dispatched: existsSync(worker.paths.dispatch),
      dispatchEvidence: existsSync(worker.paths.dispatch)
        ? JSON.parse(readFileSync(worker.paths.dispatch, 'utf8'))
        : null
    }))
  }

  test(
    'Keep Going: two OS processes racing the pending-dispatch auto-resume path create at most one external dispatch',
    { timeout: 30_000 },
    async () => {
      const projectId = 'fixture:keep-going-cross-process-race'
      const candidateWorkItems = [
        { id: 'work-1', scope: ['**/*'], worktree: path.join(dir, 'fixture-worktree') }
      ]
      const run = createOvernightRun(
        {
          id: 'run:keep-going-cross-process-race',
          projectId,
          originalGoal: 'Prove store-level dispatch exclusion.',
          acceptanceCriteria: ['Only one process may dispatch the pending work.'],
          usageMode: 'BALANCED'
        },
        clock
      )
      await withKeepGoingRun(projectId, () => run)
      const store = { readRun: readKeepGoingRun, withRun: withKeepGoingRun }
      await recordResourceRefusal(
        store,
        projectId,
        candidateWorkItems,
        { admitted: false, tier: 'CRITICAL', reason: 'disposable race fixture' },
        clock
      )
      const waiting = readKeepGoingRun(projectId)
      assert.equal(waiting.waves.length, 0)
      assert.deepEqual(waiting.pendingDispatch.candidateWorkItems, candidateWorkItems)
      assert.equal(waiting.checkpoints.at(-1).phase, 'DISPATCH_WAITING_FOR_RESOURCES')

      const outcomes = await raceWorkers('keep-going', projectId, '-', '.lock')
      const dispatchers = outcomes.filter((outcome) => outcome.dispatched)
      assert.equal(
        dispatchers.length,
        1,
        `expected one external dispatch, got ${JSON.stringify(outcomes)}`
      )

      const loser = outcomes.find((outcome) => !outcome.dispatched)
      assert.equal(loser.result.action, 'RESUMED_PENDING_DISPATCH')
      assert.equal(loser.result.tickResult.action, 'DISPATCH_CLAIM_FAILED')
      assert.ok(
        loser.result.tickResult.reason === 'TSF_TICK_IN_PROGRESS' ||
          loser.result.tickResult.reason === 'TSF_STALE_ROUTING_DECISION',
        `loser must be explicitly refused, got ${JSON.stringify(loser.result)}`
      )

      const persisted = readKeepGoingRun(projectId)
      assert.equal(persisted.inFlightWave.dispatchRecords.length, 1)
      assert.equal(persisted.dispatchAttempt, null)
      assert.equal(persisted.tickLock, null)
    }
  )

  test(
    'Research Mission: two OS processes racing the same dispatch claim create at most one external dispatch',
    { timeout: 30_000 },
    async () => {
      const missionId = 'mission:research-cross-process-race'
      const nodeId = 'node:research-cross-process-race'
      await createResearchMissionDurable(
        missionId,
        buildGenericCrashFixtureMissionInput(missionId, nodeId),
        clock
      )
      const before = readResearchMission(missionId)
      const request = buildBoundedResearchRequest(before, before.nodes[0], 'FAKE', clock)

      const outcomes = await raceWorkers('research', missionId, nodeId, '.research.lock')
      const dispatchers = outcomes.filter((outcome) => outcome.dispatched)
      const persisted = readResearchMission(missionId)
      const node = persisted.nodes.find((candidate) => candidate.id === nodeId)
      const classification = classifyDispatchDeliveryGuarantee(node, request.taskFingerprint)
      assert.equal(
        dispatchers.length,
        1,
        'store-level claim must allow exactly one external dispatch; ' +
          `observed=${dispatchers.length}, pids=${dispatchers.map((outcome) => outcome.dispatchEvidence.pid).join(',')}, ` +
          `attemptOutcomes=${node.dispatchAttempts.map((attempt) => attempt.outcome).join(',')}, ` +
          `dispatchRecords=${node.dispatchRecords.length}, classification=${classification.guarantee}`
      )

      const loser = outcomes.find((outcome) => !outcome.dispatched)
      assert.ok(
        loser,
        `one racer must be refused before worker.dispatch: ${JSON.stringify(outcomes)}`
      )
      assert.ok(
        loser.result.ambiguous === true || loser.result.code === 'TSF_RESEARCH_DISPATCH_AMBIGUOUS',
        `loser must see the durable ambiguous-attempt state: ${JSON.stringify(loser.result)}`
      )

      assert.equal(node.dispatchRecords.length, 1)
      assert.equal(classification.guarantee, 'EXACTLY_ONCE')
    }
  )
}
