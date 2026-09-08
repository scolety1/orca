import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { planAndDispatchFromChat } from '../server/chat-dispatch-bridge.mjs'
import { createOvernightRun, pauseRun } from '../domain/keep-going.mjs'

// M5: see keep-going-dispatch-loop.test.mjs's own identical comment --
// tickKeepGoingRun's new real capacity check shares orca-orchestration-
// bridge.mjs's TSF_ORCA_CLI_COMMAND resolution; pointing it at the stub
// CLI keeps every test here fast and hermetic. This file's own tickDeps
// never overrides deps.capacity, so it would otherwise hit the real
// binary.
process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
// Main TSF overnight review of Resource Pressure Governor V0: forced
// HEALTHY for every test in this file EXCEPT the two below that
// deliberately override deps.collectHostMemoryEvidence themselves (which
// takes precedence over this env var) -- keeps this file's other,
// unrelated dispatch assertions immune to a genuinely shared, loaded host.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

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

// REQUIRED PROOF (Main TSF overnight review of Resource Pressure Governor
// V0, bounded correction): this is the one real heavy-operation dispatch
// path TSF's server has today -- it must consult the governor before
// spawning a new heavyweight Claude/Codex worker, and refuse outright
// (never silently dispatch) under CRITICAL/EMERGENCY host memory.
test('CRITICAL host memory refuses dispatch before the planner is ever called -- never a silent heavyweight spawn', async () => {
  const store = makeFakeStore(null)
  let plannerCalled = false
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and add a one-line doc note',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => {
        plannerCalled = true
        return workPlanResponse()
      },
      collectHostMemoryEvidence: () => ({ availableBytes: 2 * 1024 ** 3 }) // 2 GB free -> CRITICAL
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'RESOURCE_PRESSURE_REFUSED')
  assert.equal(result.tier, 'CRITICAL')
  assert.equal(plannerCalled, false, 'refused before ever paying for a live planner call')
  assert.equal(store.readRun(), null, 'no run was created -- refused before ensureActiveRun too')
})

test('HEALTHY host memory dispatches normally through the resource-pressure gate', async () => {
  const store = makeFakeStore(null)
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and add a one-line doc note',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => workPlanResponse(),
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) // 8 GB free -> HEALTHY
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.tickResult.action, 'WAVE_DISPATCHED')
})

// REQUIRED PROOF (independent adversarial review finding): if the inner
// dispatchStep gate refuses AFTER this function's own upfront gate
// admitted (e.g. real memory fluctuated between the two reads, or a
// caller overrode only the upfront seam), the result must still be
// honestly RESOURCE_PRESSURE_REFUSED -- never the raw internal action
// name leaking through as a generic dispatch failure.
test('a resource refusal from the INNER dispatch-loop gate (after the upfront gate already admitted) is still reported as RESOURCE_PRESSURE_REFUSED, never a raw action-name leak', async () => {
  const store = makeFakeStore(null)
  let calls = 0
  // Simulates real memory fluctuating between the upfront read and the
  // inner dispatchStep read moments later -- HEALTHY first, CRITICAL by
  // the time dispatchStep's own gate reads it.
  const fluctuatingMemory = () => {
    calls += 1
    return { availableBytes: (calls === 1 ? 8 : 2) * 1024 ** 3 }
  }
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and add a one-line doc note',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => workPlanResponse(),
      collectHostMemoryEvidence: fluctuatingMemory
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'RESOURCE_PRESSURE_REFUSED')
  assert.notEqual(result.reason, 'DISPATCH_WAITING_FOR_RESOURCES', 'must never leak the raw internal action name as the reason')
  assert.equal(result.tier, 'CRITICAL')
})

// REQUIRED PROOF: overriding ONLY this function's own upfront
// collectHostMemoryEvidence seam (the one this file's other tests already
// use) now also covers the inner dispatchStep gate by default -- the two
// seams no longer silently disagree.
test('overriding only the upfront resource-pressure seam also covers the inner dispatch-loop gate -- the two seams no longer disagree by default', async () => {
  const store = makeFakeStore(null)
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and add a one-line doc note',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () => workPlanResponse(),
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) // HEALTHY, consistently
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.tickResult.action, 'WAVE_DISPATCHED')
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
  // BUG-06 (bug-ledger.json): freshlyCreated was computed by
  // ensureActiveRun but silently discarded before reaching the caller --
  // this is the exact real fact the operator-facing chat text now needs
  // to distinguish "new mission" from "added to the existing one."
  assert.equal(result.freshlyCreated, true)
})

test('the loser of a real concurrent run-creation race recovers gracefully instead of throwing uncaught (an independent-review-caught TOCTOU)', async () => {
  // Deterministically forces the exact race outcome rather than relying on
  // Promise.all/microtask timing to happen to interleave -- the fake
  // store's synchronous withRun has no internal yield point, so two
  // concurrent planAndDispatchFromChat calls never actually overlap at
  // ensureActiveRun's read/write in practice (confirmed: an earlier,
  // timing-based version of this test passed even against the unfixed
  // code, a false positive -- Promise.all does not guarantee genuine
  // interleaving when neither side's synchronous work actually yields
  // control at the right point). Simulating startKeepGoingRun itself
  // throwing TSF_RUN_ALREADY_ACTIVE -- exactly what the real domain
  // function does when a concurrent winner's run already exists at the
  // moment the atomic closure runs -- exercises ensureActiveRun's catch
  // path directly and deterministically. Every unlocked readRun call
  // (planAndDispatchFromChat's own upfront check, and ensureActiveRun's)
  // sees null until the atomic closure runs -- nobody has a run according
  // to any unlocked read -- faithfully simulating "someone else's run
  // landed between the last unlocked read and the moment this call's own
  // atomic closure actually acquired the lock."
  // A real, fully-initialized run (not a hand-crafted partial stub) --
  // dispatchWave/checkpointRun etc. all read fields (checkpoints, budget,
  // originalGoal, ...) a minimal object would be missing.
  const winnerRun = createOvernightRun(
    {
      id: 'winner-run',
      projectId: PROJECT.id,
      originalGoal: 'A different objective the race winner already started.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  const raceError = new Error('a Keep Going run is already active for this project')
  raceError.code = 'TSF_RUN_ALREADY_ACTIVE'
  let raceResolved = false
  let raceCurrent = null
  const raceStore = {
    readRun: () => (raceResolved ? raceCurrent : null),
    withRun: (_projectId, mutateFn) => {
      raceCurrent = winnerRun
      raceResolved = true
      return mutateFn(raceCurrent) // throws -- start() below always does
    }
  }
  // Separate, ordinary stateful store for tick() itself -- by the time it
  // runs, the race is already resolved; it just needs normal read/write
  // behavior against the winner's run, seeded directly (not via raceStore,
  // which exists only to exercise ensureActiveRun's one-time catch path).
  const tickStore = makeFakeStore(winnerRun)
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and add a note',
    placement,
    identity,
    clock,
    deps: {
      readKeepGoingRun: raceStore.readRun,
      withKeepGoingRun: async (projectId, mutateFn) => raceStore.withRun(projectId, mutateFn),
      tickDeps: { store: tickStore, orchestration: okOrchestration() },
      invokeLiveStructuredAnalysis: async () => workPlanResponse(),
      startKeepGoingRun: () => {
        throw raceError
      }
    }
  })
  assert.equal(
    result.ok,
    true,
    "recovered gracefully and proceeded to tick the winner's run, not an uncaught throw"
  )
  assert.equal(result.tickResult.action, 'WAVE_DISPATCHED')
})

test('a non-race error from startKeepGoingRun still propagates -- the catch is narrowly scoped to TSF_RUN_ALREADY_ACTIVE only', async () => {
  const store = makeFakeStore(null)
  const unrelatedError = new Error('a genuinely different failure')
  unrelatedError.code = 'TSF_SOMETHING_ELSE'
  await assert.rejects(
    () =>
      planAndDispatchFromChat({
        project: PROJECT,
        message: 'go ahead and add a note',
        placement,
        identity,
        clock,
        deps: {
          ...baseDeps(store),
          invokeLiveStructuredAnalysis: async () => workPlanResponse(),
          startKeepGoingRun: () => {
            throw unrelatedError
          }
        }
      }),
    (error) => error.code === 'TSF_SOMETHING_ELSE'
  )
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
  // BUG-06 (bug-ledger.json): the real distinguishing fact -- this
  // dispatch added a work item to the SAME already-active run, it did not
  // start a new mission, and the operator-facing text must say so.
  assert.equal(second.freshlyCreated, false)
  assert.ok(store.readRun().inFlightWave, 'the second dispatch is genuinely in flight')
})

test('a second dispatch while a real wave is already in flight is rejected honestly, never silently discarded -- adversarial-review finding', async () => {
  const store = makeFakeStore(null)
  const first = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: { ...baseDeps(store), invokeLiveStructuredAnalysis: async () => workPlanResponse() }
  })
  assert.equal(first.ok, true)
  assert.ok(store.readRun().inFlightWave, 'sanity: the first wave is genuinely still in flight')
  const revisionBeforeSecond = store.readRun().revision

  // Before this fix, this call would silently route to settleStep
  // (tickKeepGoingRun's own routing on inFlightWave), discarding the new
  // candidate work item entirely, while still returning ok:true -- the
  // operator-facing "Started work on X" text would have been a real lie.
  const second = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead and also fix something else',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async () =>
        workPlanResponse({ objective: 'A second, different objective.' })
    }
  })
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'RUN_NOT_DISPATCHABLE')
  assert.match(second.detail, /already in flight/)
  assert.equal(
    store.readRun().revision,
    revisionBeforeSecond,
    'the run was never mutated by the rejected second dispatch'
  )
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

// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part B:
// the ONE real admission choke point every new-dispatch caller funnels
// through -- an active project execution hold refuses honestly before ever
// calling the (costly, live) planner, same ordering discipline as the
// Resource Pressure Governor gate above.
test('an active project execution hold refuses dispatch before ever calling the planner', async () => {
  const store = makeFakeStore()
  let plannerCalled = false
  const activeHold = {
    schemaVersion: 'TSF_PROJECT_EXECUTION_HOLD_V1',
    projectId: PROJECT.id,
    status: 'ACTIVE',
    reason: 'EXTERNAL_WORK_ACTIVE',
    note: 'another AI is actively working this repo',
    setBy: 'OPERATOR_CHAT',
    setAt: clock().toISOString()
  }
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      readProjectExecutionHold: () => activeHold,
      invokeLiveStructuredAnalysis: async () => {
        plannerCalled = true
        return workPlanResponse()
      }
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'PROJECT_EXECUTION_HOLD_ACTIVE')
  assert.match(result.detail, /EXTERNAL_WORK_ACTIVE/)
  assert.match(result.detail, /another AI is actively working this repo/)
  assert.equal(plannerCalled, false, 'no live call attempted for a held project')
  assert.equal(store.readRun(), null, 'no run was created for a held project')
})

test('a RELEASED hold no longer refuses dispatch -- release is real, not cosmetic', async () => {
  const store = makeFakeStore()
  const releasedHold = {
    schemaVersion: 'TSF_PROJECT_EXECUTION_HOLD_V1',
    projectId: PROJECT.id,
    status: 'RELEASED',
    reason: 'EXTERNAL_WORK_ACTIVE',
    setBy: 'OPERATOR_CHAT',
    setAt: clock().toISOString(),
    releasedBy: 'OPERATOR_CHAT',
    releasedAt: clock().toISOString()
  }
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: 'go ahead',
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      readProjectExecutionHold: () => releasedHold,
      invokeLiveStructuredAnalysis: async () => workPlanResponse()
    }
  })
  assert.equal(result.ok, true)
})
