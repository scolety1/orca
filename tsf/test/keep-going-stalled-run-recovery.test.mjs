import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'
import { createOvernightRun, dispatchWave, markStalled, planWave } from '../domain/keep-going.mjs'
import { recoverStaleStalledKeepGoingRuns } from '../server/keep-going-stalled-run-recovery.mjs'
import { abandonAndReconcileStalledWave } from '../server/keep-going-dispatch-loop.mjs'

const HERE = import.meta.dirname
const PROJECT_ID = 'fixture:stalled-recovery'

function baseRun(id, clock) {
  return createOvernightRun(
    { id, projectId: PROJECT_ID, originalGoal: 'Ship it.', acceptanceCriteria: ['A'], usageMode: 'BALANCED' },
    clock
  )
}

// Mirrors keep-going-dispatch-loop-abandon-reconcile.test.mjs's own real
// fixture pattern -- a genuinely STALLED run holding one in-flight dispatch,
// exactly as a real settleStep stall escalation would leave it.
function stalledRun(id, clock) {
  let run = baseRun(id, clock)
  const plan = planWave(run, [{ id: 't1', scope: ['src/a.mjs'] }], clock)
  run = dispatchWave(run, plan, [{ workItemId: 't1', scope: ['src/a.mjs'], taskId: 'task-1', dispatchId: 'ctx-1' }], clock, run.revision)
  run = markStalled(run, [{ dispatchId: 'ctx-1' }], clock)
  return run
}

test('a run stalled well past its own threshold is recovered; one still-fresh and never proceeds otherwise', async () => {
  const nowClock = () => new Date('2026-09-08T00:00:00.000Z')
  const staleStalled = stalledRun('run-stale', () => new Date('2026-09-01T00:00:00.000Z')) // days ago
  const freshStalled = stalledRun('run-fresh', () => new Date('2026-09-07T23:55:00.000Z')) // 5 min ago -- well under the 30 min default threshold
  const activeRun = baseRun('run-active', nowClock)

  const opState = {
    keepGoingRuns: {
      'proj-stale': staleStalled,
      'proj-fresh': freshStalled,
      'proj-active': activeRun
    }
  }
  const abandonCalls = []
  const recovered = await recoverStaleStalledKeepGoingRuns(nowClock, {
    readState: () => opState,
    abandonAndReconcileStalledWave: async (projectId, reason, c, expectedRevision) => {
      abandonCalls.push({ projectId, reason, expectedRevision })
      return { run: opState.keepGoingRuns[projectId], orchestrationReconciliation: [] }
    }
  })

  assert.deepEqual(recovered, ['proj-stale'])
  assert.equal(abandonCalls.length, 1)
  assert.equal(abandonCalls[0].projectId, 'proj-stale')
  assert.match(abandonCalls[0].reason, /STARTUP_RECONCILIATION/)
  assert.equal(abandonCalls[0].expectedRevision, staleStalled.revision)
})

test('no STALLED runs at all -> honestly empty, never calls abandon', async () => {
  const clock = () => new Date('2026-09-08T00:00:00.000Z')
  const opState = { keepGoingRuns: { 'proj-active': baseRun('run-1', clock) } }
  let called = false
  const recovered = await recoverStaleStalledKeepGoingRuns(clock, {
    readState: () => opState,
    abandonAndReconcileStalledWave: async () => { called = true }
  })
  assert.deepEqual(recovered, [])
  assert.equal(called, false)
})

test('a single project\'s recovery failure never throws and never blocks scanning the rest', async () => {
  const clock = () => new Date('2026-09-08T00:00:00.000Z')
  const oldClock = () => new Date('2026-09-01T00:00:00.000Z')
  const opState = {
    keepGoingRuns: {
      'proj-a': stalledRun('run-a', oldClock),
      'proj-b': stalledRun('run-b', oldClock)
    }
  }
  const attempted = []
  const recovered = await recoverStaleStalledKeepGoingRuns(clock, {
    readState: () => opState,
    abandonAndReconcileStalledWave: async (projectId) => {
      attempted.push(projectId)
      if (projectId === 'proj-a') { throw new Error('simulated real failure') }
      return { run: opState.keepGoingRuns[projectId], orchestrationReconciliation: [] }
    }
  })
  assert.deepEqual(attempted, ['proj-a', 'proj-b'])
  assert.deepEqual(recovered, ['proj-b'])
})

// Real, end-to-end proof (no injected abandon) -- the actual domain
// transition genuinely happens: STALLED -> ACTIVE (retry budget not yet
// exhausted for a single stall), via the real store + real
// abandonAndReconcileStalledWave, not a simulation.
test('REQUIRED PROOF: real end-to-end recovery genuinely transitions a stale STALLED run, not a simulation', async () => {
  const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-stalled-recovery-${process.pid}.json`)
  process.env.TSF_UI_STATE_FILE = STATE_FILE
  const cleanup = () => {
    for (const suffix of ['', '.tmp', '.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
  }
  cleanup()
  try {
    const oldClock = () => new Date('2026-09-01T00:00:00.000Z')
    const nowClock = () => new Date('2026-09-08T00:00:00.000Z')
    const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
    const stale = stalledRun('run-real', oldClock)
    await withKeepGoingRun('proj-real', () => stale)

    // Exercises the REAL abandonAndReconcileStalledWave (real domain
    // transition, real store) -- only the orchestration-side Orca CLI call
    // is stubbed, so this test never spawns a real process for a fixture
    // dispatchId that was never really dispatched.
    const recovered = await recoverStaleStalledKeepGoingRuns(nowClock, {
      abandonAndReconcileStalledWave: (projectId, reason, c, expectedRevision) =>
        abandonAndReconcileStalledWave(projectId, reason, c, expectedRevision, {
          orchestration: { abandonOrchestrationWorker: async () => ({ ok: true }) }
        })
    })
    assert.deepEqual(recovered, ['proj-real'])

    const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
    const after = readKeepGoingRun('proj-real')
    assert.notEqual(after.state, 'STALLED', 'the run must have really transitioned, not stayed STALLED')
    assert.ok(['ACTIVE', 'NEEDS_YOU'].includes(after.state), `expected ACTIVE (retry) or NEEDS_YOU (budget exceeded), got ${after.state}`)
  } finally {
    cleanup()
  }
})
