// Real V1 stabilization finding: a real "Cannot read properties of
// undefined (reading 'filter')" crash on the Projects page traced back to
// this module receiving a malformed/mismatched-version response and
// silently handing it to callers that assume a well-formed shape. No test
// runner exists for tsf/ui (see package.json) -- this uses Node's native
// TypeScript support directly against this plain, JSX-free module rather
// than adding a whole new frontend test framework for one file:
//   node --experimental-strip-types --test src/lib/prepare-for-work-polling.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareForWork, pollPrepareForWorkOperation } from './prepare-for-work-polling.ts'
import type { PrepareForWorkOperation } from './prepare-for-work-types.ts'

function op(overrides: Partial<PrepareForWorkOperation> = {}): PrepareForWorkOperation {
  return {
    schemaVersion: 'TSF_PREPARE_FOR_WORK_OPERATION_V1',
    operationId: 'pfw-1',
    projectIds: ['a'],
    status: 'COMPLETED',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    results: {
      a: {
        projectId: 'a',
        ok: true,
        readyForWork: true,
        stages: [],
        settled: true,
        phase: 'READY_FOR_WORK'
      }
    },
    ...overrides
  }
}

test('prepareForWork throws a clear, actionable error when start() returns no operationId (the real old-frontend/new-backend mismatch)', async () => {
  await assert.rejects(
    () =>
      prepareForWork(
        ['a'],
        async () => ({ ok: true, results: [] }) as never, // the OLD synchronous response shape
        async () => ({ ok: true, operation: op() })
      ),
    /did not return a usable operation id.*mismatched versions/s
  )
})

test('prepareForWork throws a clear error when get() returns a malformed operation (no projectIds/results)', async () => {
  await assert.rejects(
    () =>
      prepareForWork(
        ['a'],
        async () => ({ ok: true, operationId: 'pfw-1', operation: op() }),
        async () => ({ ok: true, operation: { status: 'RUNNING' } }) as never
      ),
    /unrecognized shape.*mismatched versions/s
  )
})

test('prepareForWork succeeds end to end with a well-formed operation and returns the flat results shape callers expect', async () => {
  const result = await prepareForWork(
    ['a'],
    async () => ({ ok: true, operationId: 'pfw-1', operation: op({ status: 'RUNNING' }) }),
    async () => ({ ok: true, operation: op() })
  )
  assert.equal(result.ok, true)
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].projectId, 'a')
  assert.equal(result.results[0].readyForWork, true)
})

test('pollPrepareForWorkOperation reports an unsettled project honestly rather than crashing if the operation completes without it', async () => {
  const operation = await pollPrepareForWorkOperation('pfw-1', async () => ({
    ok: true,
    operation: op({ status: 'COMPLETED', projectIds: ['a', 'b'] })
  }))
  // project "b" has no entry in results at all -- a real shape the server
  // can produce if it settles some but not all requested projects.
  assert.equal(operation.results.b, undefined)
})

test('prepareForWork degrades a settled entry with no stages array honestly instead of handing it to callers that call .stages.some() (independent review finding)', async () => {
  const malformedEntry = { projectId: 'a', ok: true, readyForWork: true, settled: true } as never // no .stages
  const result = await prepareForWork(
    ['a'],
    async () => ({ ok: true, operationId: 'pfw-1', operation: op({ status: 'RUNNING' }) }),
    async () => ({ ok: true, operation: op({ results: { a: malformedEntry } }) })
  )
  assert.deepEqual(result.results[0].stages, [])
  assert.equal(result.results[0].ok, false)
})

test('pollPrepareForWorkOperation times out with a clear message instead of spinning forever', async () => {
  await assert.rejects(
    () =>
      pollPrepareForWorkOperation(
        'pfw-1',
        async () => ({ ok: true, operation: op({ status: 'RUNNING', results: {} }) }),
        50
      ),
    /still running.*has not failed/s
  )
})
