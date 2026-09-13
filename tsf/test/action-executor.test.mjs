// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 2. Unit coverage for the canonical
// action-execution boundary. executeAction reimplements nothing: it is a
// thin, typed dispatch layer over already-correct primitives --
// pauseProjectRun/resumeProjectRun/classifyContinueAction
// (command-run-action-bridge.mjs, Phase 1), executeCommandAdoption
// (command-adoption-execution.mjs, Phase 2), and
// createProjectExecutionHold/releaseProjectExecutionHold/
// withProjectExecutionHold (domain/project-execution-hold.mjs +
// project-execution-hold-store.mjs, Phase 3), and cancelResearchMissionDurable
// (research-mission-driver.mjs, Phase 4 -- the one real, wired cancel
// capability found on reconciliation; there is no generic project-level
// CANCEL anywhere in this codebase), and resolveProjectNeedsYou
// (command-run-action-bridge.mjs, Stage 4 -- the first real, wired
// resolution path for a Needs You question; keep-going.mjs's own
// resolveNeedsYou had zero real callers before this).
import assert from 'node:assert/strict'
import test from 'node:test'
import { executeAction } from '../server/action-executor.mjs'

const clock = () => new Date('2026-09-12T12:00:00.000Z')

test('PAUSE: success calls the real pauseProjectRun with the given target/reason and reports ok', async () => {
  const calls = []
  const result = await executeAction({
    type: 'PAUSE',
    target: 'p1',
    parameters: { reason: 'OPERATOR_CHAT_PAUSE' },
    clock,
    deps: {
      pauseProjectRun: async (target, reason, c) => {
        calls.push([target, reason, c])
      }
    }
  })
  assert.deepEqual(result, { ok: true, action: 'PAUSE' })
  assert.deepEqual(calls, [['p1', 'OPERATOR_CHAT_PAUSE', clock]])
})

test('PAUSE: a thrown error is caught and reported as a typed PAUSE_FAILED result, never thrown past this boundary', async () => {
  const result = await executeAction({
    type: 'PAUSE',
    target: 'p1',
    clock,
    deps: {
      pauseProjectRun: async () => {
        throw new Error('no Keep Going run exists for this project')
      }
    }
  })
  assert.deepEqual(result, {
    ok: false,
    reason: 'PAUSE_FAILED',
    detail: 'no Keep Going run exists for this project'
  })
})

test('RESUME: classifyContinueAction says RESUME -> calls the real resumeProjectRun and reports action RESUME', async () => {
  const calls = []
  const result = await executeAction({
    type: 'RESUME',
    target: 'p1',
    clock,
    deps: {
      classifyContinueAction: () => 'RESUME',
      resumeProjectRun: async (target, c) => {
        calls.push([target, c])
      }
    }
  })
  assert.deepEqual(result, { ok: true, action: 'RESUME' })
  assert.deepEqual(calls, [['p1', clock]])
})

test('RESUME: classifyContinueAction says DISPATCH (nothing durable to resume) -> reports action DISPATCH WITHOUT calling resumeProjectRun', async () => {
  let resumeCalled = false
  const result = await executeAction({
    type: 'RESUME',
    target: 'p1',
    clock,
    deps: {
      classifyContinueAction: () => 'DISPATCH',
      resumeProjectRun: async () => {
        resumeCalled = true
      }
    }
  })
  assert.deepEqual(result, { ok: true, action: 'DISPATCH' })
  assert.equal(
    resumeCalled,
    false,
    "a DISPATCH classification must never itself call resumeProjectRun -- the real dispatch happens through the caller's own separate path"
  )
})

test('RESUME: a thrown resumeProjectRun error is caught and reported as a typed RESUME_FAILED result', async () => {
  const result = await executeAction({
    type: 'RESUME',
    target: 'p1',
    clock,
    deps: {
      classifyContinueAction: () => 'RESUME',
      resumeProjectRun: async () => {
        throw new Error('resume refused')
      }
    }
  })
  assert.deepEqual(result, { ok: false, reason: 'RESUME_FAILED', detail: 'resume refused' })
})

test('an unsupported action type is honestly refused, never silently ignored or guessed at', async () => {
  const result = await executeAction({ type: 'RERUN_FAILED', target: 'p1', clock })
  assert.deepEqual(result, {
    ok: false,
    reason: 'UNSUPPORTED_ACTION',
    detail: 'unsupported action type: RERUN_FAILED'
  })
})

test('ADOPT: success calls the real executeCommandAdoption with {project: target, clock, deps} and returns its result verbatim, unreshaped', async () => {
  const calls = []
  const fakeResult = {
    ok: true,
    alreadyIncluded: false,
    priorCanonicalSha: 'a'.repeat(40),
    resultingCanonicalSha: 'b'.repeat(40),
    receipt: { receiptHash: 'c'.repeat(64) }
  }
  const project = { id: 'p1', displayName: 'P1' }
  const deps = {
    executeCommandAdoption: async (args) => {
      calls.push(args)
      return fakeResult
    }
  }
  const result = await executeAction({ type: 'ADOPT', target: project, clock, deps })
  assert.deepEqual(result, fakeResult)
  assert.deepEqual(calls, [{ project, clock, deps }])
})

test('ADOPT: an expected {ok:false} refusal (e.g. an active execution hold) passes through verbatim, never reshaped or swallowed', async () => {
  const refusal = {
    ok: false,
    reason: 'PROJECT_EXECUTION_HOLD_ACTIVE',
    detail: 'external work active'
  }
  const result = await executeAction({
    type: 'ADOPT',
    target: { id: 'p1', displayName: 'P1' },
    clock,
    deps: { executeCommandAdoption: async () => refusal }
  })
  assert.deepEqual(result, refusal)
})

test('ADOPT: a genuinely UNEXPECTED thrown error (not an expected {ok:false} refusal) is still caught into a typed ADOPT_FAILED result', async () => {
  const result = await executeAction({
    type: 'ADOPT',
    target: { id: 'p1', displayName: 'P1' },
    clock,
    deps: {
      executeCommandAdoption: async () => {
        throw new Error('git subprocess crashed')
      }
    }
  })
  assert.deepEqual(result, { ok: false, reason: 'ADOPT_FAILED', detail: 'git subprocess crashed' })
})

test('HOLD: creates a real hold via withProjectExecutionHold/createProjectExecutionHold when none is active', async () => {
  const writes = []
  const created = { status: 'ACTIVE', note: 'external work active' }
  const result = await executeAction({
    type: 'HOLD',
    target: 'p1',
    parameters: { note: 'external work active' },
    clock,
    deps: {
      withProjectExecutionHold: async (projectId, mutate) => {
        const next = mutate(null)
        writes.push([projectId, next])
        return next
      },
      createProjectExecutionHold: () => created
    }
  })
  assert.deepEqual(result, { ok: true, action: 'HOLD', hold: created })
  assert.deepEqual(writes, [['p1', created]])
})

test('HOLD: idempotent -- an already-ACTIVE hold is returned unchanged, never re-created', async () => {
  const existing = { status: 'ACTIVE', note: 'original reason' }
  let createCalled = false
  const result = await executeAction({
    type: 'HOLD',
    target: 'p1',
    clock,
    deps: {
      withProjectExecutionHold: async (projectId, mutate) => mutate(existing),
      createProjectExecutionHold: () => {
        createCalled = true
      }
    }
  })
  assert.deepEqual(result, { ok: true, action: 'HOLD', hold: existing })
  assert.equal(createCalled, false)
})

test('RELEASE_HOLD: releases a real active hold, reports releasedSomething true', async () => {
  const existing = { status: 'ACTIVE' }
  const released = { status: 'RELEASED' }
  const result = await executeAction({
    type: 'RELEASE_HOLD',
    target: 'p1',
    clock,
    deps: {
      withProjectExecutionHold: async (projectId, mutate) => mutate(existing),
      releaseProjectExecutionHold: () => released
    }
  })
  assert.deepEqual(result, { ok: true, action: 'RELEASE_HOLD', releasedSomething: true })
})

test('RELEASE_HOLD: no active hold -> honest no-op, releasedSomething false, never calls releaseProjectExecutionHold', async () => {
  let releaseCalled = false
  const result = await executeAction({
    type: 'RELEASE_HOLD',
    target: 'p1',
    clock,
    deps: {
      withProjectExecutionHold: async (projectId, mutate) => mutate(null),
      releaseProjectExecutionHold: () => {
        releaseCalled = true
      }
    }
  })
  assert.deepEqual(result, { ok: true, action: 'RELEASE_HOLD', releasedSomething: false })
  assert.equal(releaseCalled, false)
})

test('CANCEL_RESEARCH: success calls the real cancelResearchMissionDurable(missionId, reason, clock) and returns the mutated mission', async () => {
  const calls = []
  const cancelledMission = { id: 'mission:1', state: 'BLOCKED' }
  const result = await executeAction({
    type: 'CANCEL_RESEARCH',
    target: 'mission:1',
    parameters: { reason: 'OPERATOR_CHAT_CANCEL' },
    clock,
    deps: {
      cancelResearchMissionDurable: async (missionId, reason, c) => {
        calls.push([missionId, reason, c])
        return cancelledMission
      }
    }
  })
  assert.deepEqual(result, { ok: true, action: 'CANCEL_RESEARCH', mission: cancelledMission })
  assert.deepEqual(calls, [['mission:1', 'OPERATOR_CHAT_CANCEL', clock]])
})

test('CANCEL_RESEARCH: a thrown error (e.g. already-terminal mission) is caught into a typed CANCEL_RESEARCH_FAILED result', async () => {
  const result = await executeAction({
    type: 'CANCEL_RESEARCH',
    target: 'mission:1',
    clock,
    deps: {
      cancelResearchMissionDurable: async () => {
        throw new Error('illegal transition: COMPLETE -> BLOCKED')
      }
    }
  })
  assert.deepEqual(result, {
    ok: false,
    reason: 'CANCEL_RESEARCH_FAILED',
    detail: 'illegal transition: COMPLETE -> BLOCKED'
  })
})

test('RESOLVE_NEEDS_YOU: success calls the real resolveProjectNeedsYou(projectId, needsYouId, resolution, clock) and returns the real run', async () => {
  const calls = []
  const resolvedRun = { id: 'run:1', state: 'ACTIVE' }
  const result = await executeAction({
    type: 'RESOLVE_NEEDS_YOU',
    target: 'p1',
    parameters: { needsYouId: 'nq:1', resolution: 'use Exa' },
    clock,
    deps: {
      resolveProjectNeedsYou: async (projectId, needsYouId, resolution, c) => {
        calls.push([projectId, needsYouId, resolution, c])
        return resolvedRun
      }
    }
  })
  assert.deepEqual(result, { ok: true, action: 'RESOLVE_NEEDS_YOU', run: resolvedRun })
  assert.deepEqual(calls, [['p1', 'nq:1', 'use Exa', clock]])
})

test('RESOLVE_NEEDS_YOU: a thrown error (e.g. unknown question id) is caught into a typed RESOLVE_NEEDS_YOU_FAILED result', async () => {
  const result = await executeAction({
    type: 'RESOLVE_NEEDS_YOU',
    target: 'p1',
    parameters: { needsYouId: 'no-such-id' },
    clock,
    deps: {
      resolveProjectNeedsYou: async () => {
        throw new Error('unknown Needs You question: no-such-id')
      }
    }
  })
  assert.deepEqual(result, {
    ok: false,
    reason: 'RESOLVE_NEEDS_YOU_FAILED',
    detail: 'unknown Needs You question: no-such-id'
  })
})
