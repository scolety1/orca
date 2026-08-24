// Pure domain coverage for the durable Prepare-for-Work operation model
// (see domain/prepare-for-work-operation.mjs's own header for the full
// incident this exists to fix). http-prepare-for-work.test.mjs covers the
// real end-to-end HTTP/pipeline behavior; this covers the state machine in
// isolation.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPrepareForWorkOperation,
  withProjectPhase,
  withProjectResult,
  isOperationSettled,
  finalizeOperation,
  markInterrupted,
  unsettledProjectIds,
  isTerminalPhase
} from '../domain/prepare-for-work-operation.mjs'

const CLOCK = () => new Date('2026-08-23T23:00:00.000Z')

test('createPrepareForWorkOperation starts every project RECONCILING and unsettled', () => {
  const op = createPrepareForWorkOperation('op-1', ['a', 'b'], CLOCK)
  assert.equal(op.status, 'RUNNING')
  assert.deepEqual(op.projectIds, ['a', 'b'])
  assert.equal(op.results.a.phase, 'RECONCILING')
  assert.equal(op.results.a.settled, false)
  assert.equal(op.results.b.phase, 'RECONCILING')
  assert.equal(isOperationSettled(op), false)
  assert.deepEqual(unsettledProjectIds(op), ['a', 'b'])
})

test('withProjectPhase advances one project without touching the other or settling either', () => {
  const op = createPrepareForWorkOperation('op-1', ['a', 'b'], CLOCK)
  const next = withProjectPhase(op, 'a', 'RUNNING_BASELINE', CLOCK)
  assert.equal(next.results.a.phase, 'RUNNING_BASELINE')
  assert.equal(next.results.a.settled, false)
  assert.equal(next.results.b.phase, 'RECONCILING')
})

test('withProjectResult settles a project and derives an honest terminal phase from the real outcome', () => {
  const op = createPrepareForWorkOperation('op-1', ['a', 'b'], CLOCK)
  const ready = withProjectResult(
    op,
    'a',
    { projectId: 'a', ok: true, readyForWork: true, stages: [] },
    CLOCK
  )
  assert.equal(ready.results.a.phase, 'READY_FOR_WORK')
  assert.equal(ready.results.a.settled, true)

  const blocked = withProjectResult(
    op,
    'a',
    { projectId: 'a', ok: true, readyForWork: false, stages: [] },
    CLOCK
  )
  assert.equal(blocked.results.a.phase, 'BLOCKED')

  const needsYou = withProjectResult(
    op,
    'a',
    { projectId: 'a', ok: false, error: 'TIM_REQUIRED cause on record', stages: [] },
    CLOCK
  )
  assert.equal(needsYou.results.a.phase, 'NEEDS_YOU')

  const failed = withProjectResult(
    op,
    'a',
    { projectId: 'a', ok: false, error: 'not an onboarded project', stages: [] },
    CLOCK
  )
  assert.equal(failed.results.a.phase, 'FAILED')
})

test('withProjectResult never reports READY_FOR_WORK for a real DIRTY_PRESERVE project, even though the health domain marks it readyForWork (real acceptance-matrix finding)', () => {
  const op = createPrepareForWorkOperation('op-1', ['a'], CLOCK)
  const dirtyPreserveResult = {
    projectId: 'a',
    ok: true,
    readyForWork: true,
    repairClass: 'NOT_A_DEFECT',
    causesAfter: [
      { cause: 'DIRTY_PRESERVE', repairClass: 'NOT_A_DEFECT', summary: 'real uncommitted work' }
    ],
    stages: []
  }
  const next = withProjectResult(op, 'a', dirtyPreserveResult, CLOCK)
  assert.equal(next.results.a.phase, 'NEEDS_YOU')
})

test('the same NOT_A_DEFECT override applies generically -- covers PAUSED_BY_DESIGN too, not just DIRTY_PRESERVE by name (independent review finding)', () => {
  const op = createPrepareForWorkOperation('op-1', ['a'], CLOCK)
  const pausedResult = {
    projectId: 'a',
    ok: true,
    readyForWork: true,
    repairClass: 'NOT_A_DEFECT',
    causesAfter: [
      { cause: 'PAUSED_BY_DESIGN', repairClass: 'NOT_A_DEFECT', summary: 'read-only onboarding' }
    ],
    stages: []
  }
  assert.equal(withProjectResult(op, 'a', pausedResult, CLOCK).results.a.phase, 'NEEDS_YOU')
})

test('a genuinely clean project (zero remaining causes) still legitimately reaches READY_FOR_WORK -- the generic override never fires vacuously', () => {
  const op = createPrepareForWorkOperation('op-1', ['a'], CLOCK)
  const cleanResult = {
    projectId: 'a',
    ok: true,
    readyForWork: true,
    repairClass: 'NOT_A_DEFECT',
    causesAfter: [],
    stages: []
  }
  assert.equal(withProjectResult(op, 'a', cleanResult, CLOCK).results.a.phase, 'READY_FOR_WORK')
})

test('isOperationSettled/unsettledProjectIds/finalizeOperation reflect real per-project progress', () => {
  let op = createPrepareForWorkOperation('op-1', ['a', 'b'], CLOCK)
  op = withProjectResult(
    op,
    'a',
    { projectId: 'a', ok: true, readyForWork: true, stages: [] },
    CLOCK
  )
  assert.equal(isOperationSettled(op), false)
  assert.deepEqual(unsettledProjectIds(op), ['b'])

  op = withProjectResult(
    op,
    'b',
    { projectId: 'b', ok: true, readyForWork: true, stages: [] },
    CLOCK
  )
  assert.equal(isOperationSettled(op), true)
  assert.deepEqual(unsettledProjectIds(op), [])

  const finalized = finalizeOperation(op, CLOCK)
  assert.equal(finalized.status, 'COMPLETED')
})

test('markInterrupted flips status without discarding any per-project progress -- the exact recovery-scan use', () => {
  let op = createPrepareForWorkOperation('op-1', ['a', 'b'], CLOCK)
  op = withProjectResult(
    op,
    'a',
    { projectId: 'a', ok: true, readyForWork: true, stages: [] },
    CLOCK
  )
  const interrupted = markInterrupted(op, CLOCK)
  assert.equal(interrupted.status, 'INTERRUPTED')
  assert.equal(interrupted.results.a.settled, true)
  assert.equal(interrupted.results.b.settled, false)
})

test('isTerminalPhase distinguishes the four real terminal outcomes from every in-progress phase', () => {
  for (const phase of ['READY_FOR_WORK', 'NEEDS_YOU', 'BLOCKED', 'FAILED']) {
    assert.equal(isTerminalPhase(phase), true)
  }
  for (const phase of [
    'RECONCILING',
    'REGISTERING_ORCA',
    'DISCOVERING_BASELINE',
    'RUNNING_BASELINE',
    'DIAGNOSING_HEALTH',
    'REPAIRING_SAFE_CAUSES',
    'VERIFYING'
  ]) {
    assert.equal(isTerminalPhase(phase), false)
  }
})
