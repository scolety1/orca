import assert from 'node:assert/strict'
import test from 'node:test'
import { planAndDispatchFromChat } from '../server/chat-dispatch-bridge.mjs'
import { pauseRun } from '../domain/keep-going.mjs'

const clock = () => new Date('2026-08-20T05:00:00.000Z')
const PROJECT = { id: 'fixture:proj', displayName: 'Fixture Project' }

// Mirrors keep-going-dispatch-loop.test.mjs's own makeFakeStore -- shared
// across the bridge's own run-creation (deps.readKeepGoingRun/
// withKeepGoingRun) and the real tickKeepGoingRun it calls into
// (deps.tickDeps.store), exactly like production shares one real store
// across keep-going-http-routes.mjs's mutateThroughStore and
// tickKeepGoingRun.
function makeFakeStore(initial = null) {
  let current = initial
  return {
    readRun: (_projectId) => current,
    withRun: (_projectId, mutateFn) => {
      current = mutateFn(current)
      return current
    }
  }
}

function okOrchestration(overrides = {}) {
  return {
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async ({ taskTitle }) => ({
      ok: true,
      result: { task: { id: `task-${taskTitle}` } }
    }),
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({ ok: true, result: { tasks: [] } }),
    ...overrides
  }
}

function workPlanResponse(overrides = {}) {
  return {
    ok: true,
    data: {
      schemaVersion: 'TSF_CHAT_WORK_PLAN_REQUEST_V1',
      objective: 'Add a one-line doc note.',
      decisions: [],
      allowedScope: ['docs/x.md'],
      constraints: [],
      prohibitedActions: [],
      relevantComponents: [],
      acceptanceCriteria: ['docs/x.md contains the note'],
      requiredTests: [],
      stopConditions: ['if the file already contains conflicting content'],
      ...overrides
    }
  }
}

function baseDeps(store, orchestration = okOrchestration()) {
  return {
    readKeepGoingRun: store.readRun,
    withKeepGoingRun: async (projectId, mutateFn) => store.withRun(projectId, mutateFn),
    tickDeps: { store, orchestration }
  }
}

const REAL_SHA = 'a'.repeat(40)
const identity = {
  repository: {
    root: 'C:/repo',
    worktree: 'C:/repo',
    branch: 'main',
    head: REAL_SHA,
    tree: REAL_SHA
  }
}
const placement = { worktree: 'C:/repo/wt1', agent: 'codex' }

test('rejects a missing placement before ever calling the planner', async () => {
  const store = makeFakeStore()
  let plannerCalled = false
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement: {},
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => {
        plannerCalled = true
        return workPlanResponse()
      }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'TSF_MISSING_PLACEMENT')
  assert.equal(plannerCalled, false, 'no live call attempted before the placement check')
})

test('rejects a missing repository identity before ever calling the planner', async () => {
  const store = makeFakeStore()
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity: {},
    clock,
    deps: baseDeps(store)
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'TSF_MISSING_REPOSITORY_IDENTITY')
})

test('a project with no Keep Going run yet: creates one and genuinely dispatches through the real tick path', async () => {
  const store = makeFakeStore(null)
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and add a one-line doc note',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => workPlanResponse()
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.tickResult.action, 'WAVE_DISPATCHED')
  assert.equal(result.tickResult.dispatchRecords[0].workItemId, result.candidateWorkItem.id)
  assert.equal(store.readRun().state, 'ACTIVE')
  assert.ok(store.readRun().inFlightWave, 'a real wave is genuinely in flight')
})

test('reuses an existing ACTIVE run rather than creating a second one', async () => {
  const store = makeFakeStore(null)
  await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: { ...baseDeps(store), invokeLiveStructuredAnalysis: async () => workPlanResponse() }
  })
  const runIdAfterFirst = store.readRun().id
  // Settle the first wave so the run is ACTIVE with no in-flight wave, then
  // dispatch a second request -- must reuse the SAME run, not start another.
  const orchestration = okOrchestration({
    listOrchestrationTasks: async () => ({
      ok: true,
      result: {
        tasks: [{ id: store.readRun().inFlightWave.dispatchRecords[0].taskId, status: 'completed' }]
      }
    })
  })
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  await tickKeepGoingRun(PROJECT.id, [], clock, { store, orchestration })
  assert.equal(store.readRun().inFlightWave, null, 'sanity: settled before the second request')

  const second = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and add another note',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store, orchestration),
      invokeLiveStructuredAnalysis: async () =>
        workPlanResponse({ objective: 'Add a second note.' })
    }
  })
  assert.equal(second.ok, true)
  assert.equal(second.tickResult.action, 'WAVE_DISPATCHED')
  assert.equal(
    store.readRun().id,
    runIdAfterFirst,
    'the same run was reused, not a duplicate created'
  )
  // Wave 1 already settled (waves.length === 1); wave 2 is now genuinely
  // in flight, not yet settled -- settling it is a separate tick, not part
  // of this dispatch call.
  assert.equal(store.readRun().waves.length, 1)
  assert.ok(store.readRun().inFlightWave, 'the second dispatch is genuinely in flight')
})

test('a STALLED run is reported honestly and reuses M2 recovery, not a new dispatch attempt', async () => {
  const store = makeFakeStore(null)
  await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: { ...baseDeps(store), invokeLiveStructuredAnalysis: async () => workPlanResponse() }
  })
  // Force the run into STALLED the same way settleStep's own stall
  // escalation would (markStalled), not a fabricated shortcut.
  const { markStalled } = await import('../domain/keep-going.mjs')
  const stalledDispatch = store.readRun().inFlightWave.dispatchRecords[0]
  store.withRun(PROJECT.id, (current) =>
    markStalled(current, [{ dispatchId: stalledDispatch.dispatchId }], clock)
  )
  assert.equal(store.readRun().state, 'STALLED')

  let plannerCalledAgain = false
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and do the next part',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => {
        plannerCalledAgain = true
        return workPlanResponse()
      }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'RUN_NOT_DISPATCHABLE')
  assert.match(result.detail, /STALLED/)
  assert.match(result.detail, /Abandon stalled wave/)
  assert.equal(plannerCalledAgain, false, 'no live planner call wasted on an undispatchable run')
})

test('a PAUSED run is reported honestly, matching the existing "Resume" affordance rather than a new mechanism', async () => {
  const store = makeFakeStore(null)
  await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: { ...baseDeps(store), invokeLiveStructuredAnalysis: async () => workPlanResponse() }
  })
  store.withRun(PROJECT.id, (current) =>
    pauseRun(current, 'operator pause', clock, current.revision)
  )
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: { ...baseDeps(store), invokeLiveStructuredAnalysis: async () => workPlanResponse() }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'RUN_NOT_DISPATCHABLE')
  assert.match(result.detail, /PAUSED/)
})

test('a provider failure from the live planner is surfaced honestly, not silently retried into a fabricated plan', async () => {
  const store = makeFakeStore(null)
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => ({
        ok: false,
        reason: 'TIMEOUT',
        detail: 'no response within 45000ms'
      })
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'TIMEOUT')
  assert.equal(store.readRun(), null, 'no run was created off the back of a failed plan call')
})

test('an invalid plan (missing acceptance criteria) is rejected before ever touching Keep Going', async () => {
  const store = makeFakeStore(null)
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => workPlanResponse({ acceptanceCriteria: [] })
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'TSF_INVALID_PLAN_CAPSULE')
  assert.equal(store.readRun(), null)
})
