// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 2. Unit coverage for the canonical
// action-execution boundary. executeAction reimplements nothing: it is a
// thin, typed dispatch layer over already-correct primitives --
// pauseProjectRun/resumeProjectRun/classifyContinueAction
// (command-run-action-bridge.mjs, Phase 1) and executeCommandAdoption
// (command-adoption-execution.mjs, Phase 2).
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
  const result = await executeAction({ type: 'HOLD', target: 'p1', clock })
  assert.deepEqual(result, {
    ok: false,
    reason: 'UNSUPPORTED_ACTION',
    detail: 'unsupported action type: HOLD'
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
