// Pure domain coverage for the durable Health Repair operation model
// (BUG-05, bug-ledger.json -- see domain/health-repair-operation.mjs's own
// header). http-health-repair-operations.test.mjs covers the real
// end-to-end HTTP behavior; this covers the state machine in isolation.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createHealthRepairOperation,
  withProjectPhase,
  withProjectResult,
  isOperationSettled,
  finalizeOperation,
  markInterrupted,
  unsettledProjectIds,
  isTerminalPhase,
  HEALTH_REPAIR_OPERATION_KINDS
} from '../domain/health-repair-operation.mjs'

const CLOCK = () => new Date('2026-09-03T23:00:00.000Z')

test('every real kind is accepted; an unknown kind is rejected honestly rather than silently accepted', () => {
  for (const kind of HEALTH_REPAIR_OPERATION_KINDS) {
    const op = createHealthRepairOperation('op-1', kind, ['a'], {}, CLOCK)
    assert.equal(op.kind, kind)
  }
  assert.throws(() => createHealthRepairOperation('op-1', 'NOT_A_REAL_KIND', ['a'], {}, CLOCK))
})

test('createHealthRepairOperation starts every project QUEUED and unsettled, carries meta through', () => {
  const op = createHealthRepairOperation('op-1', 'REPAIR', ['a', 'b'], { cause: 'DEPENDENCY_HEALTH' }, CLOCK)
  assert.equal(op.status, 'RUNNING')
  assert.deepEqual(op.projectIds, ['a', 'b'])
  assert.equal(op.meta.cause, 'DEPENDENCY_HEALTH')
  assert.equal(op.results.a.phase, 'QUEUED')
  assert.equal(op.results.a.settled, false)
  assert.equal(isOperationSettled(op), false)
  assert.deepEqual(unsettledProjectIds(op), ['a', 'b'])
})

test('withProjectPhase advances one project to RUNNING without touching the other or settling either', () => {
  const op = createHealthRepairOperation('op-1', 'BASELINE', ['a', 'b'], {}, CLOCK)
  const next = withProjectPhase(op, 'a', 'RUNNING', CLOCK)
  assert.equal(next.results.a.phase, 'RUNNING')
  assert.equal(next.results.a.settled, false)
  assert.equal(next.results.b.phase, 'QUEUED')
})

test('withProjectResult settles a project and derives an honest terminal phase from the real outcome', () => {
  const op = createHealthRepairOperation('op-1', 'REPAIR', ['a'], {}, CLOCK)

  const succeeded = withProjectResult(op, 'a', { ok: true, repairResult: { ok: true } }, CLOCK)
  assert.equal(succeeded.results.a.phase, 'SUCCEEDED')
  assert.equal(succeeded.results.a.settled, true)

  const needsYou = withProjectResult(
    op,
    'a',
    { ok: false, error: 'This project has a TIM_REQUIRED cause on record' },
    CLOCK
  )
  assert.equal(needsYou.results.a.phase, 'NEEDS_YOU')

  const failed = withProjectResult(op, 'a', { ok: false, error: 'not an onboarded project' }, CLOCK)
  assert.equal(failed.results.a.phase, 'FAILED')
})

test('isOperationSettled/unsettledProjectIds/finalizeOperation reflect real per-project progress across a repair-selected-shaped multi-project operation', () => {
  let op = createHealthRepairOperation('op-1', 'REPAIR_SELECTED', ['a', 'b'], {}, CLOCK)
  op = withProjectResult(op, 'a', { ok: true }, CLOCK)
  assert.equal(isOperationSettled(op), false)
  assert.deepEqual(unsettledProjectIds(op), ['b'])

  op = withProjectResult(op, 'b', { ok: true }, CLOCK)
  assert.equal(isOperationSettled(op), true)
  assert.deepEqual(unsettledProjectIds(op), [])

  const finalized = finalizeOperation(op, CLOCK)
  assert.equal(finalized.status, 'COMPLETED')
})

test('markInterrupted flips status without discarding any per-project progress -- the exact recovery-scan use', () => {
  let op = createHealthRepairOperation('op-1', 'REPAIR_SELECTED', ['a', 'b'], {}, CLOCK)
  op = withProjectResult(op, 'a', { ok: true }, CLOCK)
  const interrupted = markInterrupted(op, CLOCK)
  assert.equal(interrupted.status, 'INTERRUPTED')
  assert.equal(interrupted.results.a.settled, true)
  assert.equal(interrupted.results.b.settled, false)
})

test('isTerminalPhase distinguishes the real terminal outcomes from in-progress phases', () => {
  for (const phase of ['SUCCEEDED', 'FAILED', 'NEEDS_YOU']) {
    assert.equal(isTerminalPhase(phase), true)
  }
  for (const phase of ['QUEUED', 'RUNNING']) {
    assert.equal(isTerminalPhase(phase), false)
  }
})
