// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 2 Phase 1. Unit coverage for the
// new, minimal canonical action-execution boundary -- PAUSE/RESUME only,
// the proof-of-concept slice. executeAction reimplements nothing: it is a
// thin, typed dispatch layer over the already-correct pauseProjectRun/
// resumeProjectRun/classifyContinueAction (command-run-action-bridge.mjs).
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
  const result = await executeAction({ type: 'ADOPT', target: 'p1', clock })
  assert.deepEqual(result, {
    ok: false,
    reason: 'UNSUPPORTED_ACTION',
    detail: 'unsupported action type: ADOPT'
  })
})
