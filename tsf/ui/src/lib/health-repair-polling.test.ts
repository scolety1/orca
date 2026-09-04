// BUG-05 (bug-ledger.json): same real-shape-safety discipline as
// prepare-for-work-polling.test.ts's own header -- a malformed/mismatched-
// version response must degrade honestly, never crash a caller that
// assumes a well-formed shape.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  pollHealthRepairOperation,
  healthRepairBaselineDurable,
  healthRepairRepairDurable,
  healthRepairSelectedDurable
} from './health-repair-polling.ts'
import type { HealthRepairOperation } from './health-repair-types.ts'

function op(overrides: Partial<HealthRepairOperation> = {}): HealthRepairOperation {
  return {
    schemaVersion: 'TSF_HEALTH_REPAIR_OPERATION_V1',
    operationId: 'hr-1',
    kind: 'BASELINE',
    projectIds: ['a'],
    meta: {},
    status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    results: {
      a: {
        ok: true,
        baseline: { typecheck: 'PASS', test: 'PASS', build: 'NOT_APPLICABLE', lint: 'PASS' },
        causes: [],
        repairClass: 'NOT_A_DEFECT',
        readyForWork: true,
        priorCauses: [],
        settled: true,
        phase: 'SUCCEEDED'
      }
    },
    ...overrides
  }
}

test('healthRepairBaselineDurable throws a clear error when start() returns no operationId (old-frontend/new-backend mismatch)', async () => {
  await assert.rejects(
    () =>
      healthRepairBaselineDurable(
        'a',
        async () => ({ ok: true } as never), // the OLD synchronous response shape
        async () => ({ ok: true, operation: op() })
      ),
    /did not return a usable operation id.*mismatched versions/s
  )
})

test('pollHealthRepairOperation throws a clear error on a malformed operation (no projectIds/results)', async () => {
  await assert.rejects(
    () => pollHealthRepairOperation('hr-1', async () => ({ ok: true, operation: { status: 'RUNNING' } }) as never),
    /unrecognized shape.*mismatched versions/s
  )
})

test('healthRepairBaselineDurable succeeds end to end with a well-formed settled operation', async () => {
  const result = await healthRepairBaselineDurable(
    'a',
    async () => ({ ok: true, operationId: 'hr-1', operation: op({ status: 'RUNNING' }) }),
    async () => ({ ok: true, operation: op() })
  )
  assert.equal(result.ok, true)
  assert.equal(result.baseline.test, 'PASS')
})

test('healthRepairBaselineDurable throws honestly when the settled result is ok:false, never silently returns a fabricated success', async () => {
  await assert.rejects(
    () =>
      healthRepairBaselineDurable(
        'a',
        async () => ({ ok: true, operationId: 'hr-1', operation: op({ status: 'RUNNING' }) }),
        async () => ({
          ok: true,
          operation: op({ results: { a: { ok: false, error: 'not an onboarded project', settled: true, phase: 'FAILED' } } })
        })
      ),
    /not an onboarded project/
  )
})

test('healthRepairRepairDurable resolves a genuine ok:false action result (not a validation rejection, which throws instead) without throwing', async () => {
  const result = await healthRepairRepairDurable(
    'a',
    async () => ({ ok: true, operationId: 'hr-1', operation: op({ kind: 'REPAIR', status: 'RUNNING' }) }),
    async () => ({
      ok: true,
      operation: op({
        kind: 'REPAIR',
        results: {
          a: {
            ok: false,
            repairResult: { ok: false, action: 'INSTALL_DEPENDENCIES', reason: 'real npm failure' },
            causesBefore: [],
            causesAfter: [],
            readyForWork: false,
            settled: true,
            phase: 'FAILED'
          }
        }
      })
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.repairResult.reason, 'real npm failure')
})

// Independent-verification finding (real, reproduced): when the background
// runner throws a genuine exception (runHealthRepairOperation's own per-
// project try/catch), the settled result is honestly {ok:false, error} --
// NO repairResult field at all. healthRepairRepairDurable must resolve
// this (not throw), and callers must never unconditionally access
// result.repairResult.reason on it.
test('healthRepairRepairDurable resolves an exception-shaped ok:false result (no repairResult field at all) without throwing', async () => {
  const result = await healthRepairRepairDurable(
    'a',
    async () => ({ ok: true, operationId: 'hr-1', operation: op({ kind: 'REPAIR', status: 'RUNNING' }) }),
    async () => ({
      ok: true,
      operation: op({
        kind: 'REPAIR',
        results: { a: { ok: false, error: 'Cannot resolve path: 12345 is not a string', settled: true, phase: 'FAILED' } }
      })
    })
  )
  assert.equal(result.ok, false)
  assert.equal(result.repairResult, undefined)
  assert.equal(result.error, 'Cannot resolve path: 12345 is not a string')
})

test('healthRepairSelectedDurable reconstructs the flat results-array shape every existing caller expects, in projectIds order', async () => {
  const result = await healthRepairSelectedDurable(
    async () => ({
      ok: true,
      operationId: 'hr-1',
      operation: op({ kind: 'REPAIR_SELECTED', projectIds: ['a', 'b'], status: 'RUNNING' })
    }),
    async () => ({
      ok: true,
      operation: op({
        kind: 'REPAIR_SELECTED',
        projectIds: ['a', 'b'],
        results: {
          a: { ok: true, actionsTaken: [], readyForWork: true, remainingCauses: [], settled: true, phase: 'SUCCEEDED' },
          b: { ok: false, error: 'not an onboarded project', settled: true, phase: 'FAILED' }
        }
      })
    })
  )
  assert.deepEqual(
    result.results.map((r) => r.projectId),
    ['a', 'b']
  )
  assert.equal(result.results[0].ok, true)
  assert.equal(result.results[1].ok, false)
  assert.equal(result.results[1].error, 'not an onboarded project')
})

test('healthRepairSelectedDurable degrades an unsettled project honestly rather than crashing', async () => {
  const result = await healthRepairSelectedDurable(
    async () => ({
      ok: true,
      operationId: 'hr-1',
      operation: op({ kind: 'REPAIR_SELECTED', projectIds: ['a', 'b'], status: 'RUNNING' })
    }),
    async () => ({
      ok: true,
      operation: op({
        kind: 'REPAIR_SELECTED',
        projectIds: ['a', 'b'],
        status: 'COMPLETED',
        results: {
          a: { ok: true, actionsTaken: [], readyForWork: true, remainingCauses: [], settled: true, phase: 'SUCCEEDED' }
          // "b" has no entry at all -- a real shape the server can produce
          // if it settles some but not all requested projects.
        }
      })
    })
  )
  assert.equal(result.results[1].projectId, 'b')
  assert.equal(result.results[1].ok, false)
})

test('pollHealthRepairOperation times out with a clear message instead of spinning forever', async () => {
  await assert.rejects(
    () =>
      pollHealthRepairOperation(
        'hr-1',
        async () => ({ ok: true, operation: op({ status: 'RUNNING', results: {} }) }),
        50
      ),
    /still running.*has not failed/s
  )
})
