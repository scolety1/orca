// CAS-store-level proof, isolated state file (mirrors planner-mission-
// store.test.mjs's own pattern) -- real cross-process-file-lock atomicity,
// real opState persistence.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-request-store-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const {
  appendExecution,
  appendReceipts,
  latestExecution,
  putAuthorization,
  putPlan,
  putRecommendation,
  readAllCleanupRequestRecords,
  readCleanupRequestRecord,
  withCleanupRequestRecord
} = await import('../server/cleanup-request-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.cleanup-request.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const REQUEST_ID = 'req:cleanup-request-store-test'

test('cleanup request store', async (t) => {
  try {
    await t.test('readCleanupRequestRecord returns null before anything is written', () => {
      assert.equal(readCleanupRequestRecord(REQUEST_ID), null)
    })

    await t.test('putRecommendation creates the record and persists it durably', async () => {
      await putRecommendation(REQUEST_ID, { schemaVersion: 'TSF_CLEANUP_RECOMMENDATION_V1', requestId: REQUEST_ID })
      const record = readCleanupRequestRecord(REQUEST_ID)
      assert.equal(record.recommendation.requestId, REQUEST_ID)
      assert.equal(record.plan, null)
    })

    await t.test('putPlan/putAuthorization update only their own field, never clobbering siblings', async () => {
      await putPlan(REQUEST_ID, { schemaVersion: 'TSF_CLEANUP_PLAN_V1', requestId: REQUEST_ID })
      await putAuthorization(REQUEST_ID, { schemaVersion: 'TSF_CLEANUP_AUTHORIZATION_V1', requestId: REQUEST_ID })
      const record = readCleanupRequestRecord(REQUEST_ID)
      assert.ok(record.recommendation)
      assert.ok(record.plan)
      assert.ok(record.authorization)
    })

    await t.test('appendExecution appends, and latestExecution returns the most recent one', async () => {
      await appendExecution(REQUEST_ID, { executionId: 'exec-1', status: 'FAILED' })
      await appendExecution(REQUEST_ID, { executionId: 'exec-2', status: 'COMPLETED' })
      const record = readCleanupRequestRecord(REQUEST_ID)
      assert.equal(record.executions.length, 2)
      assert.equal(latestExecution(record).executionId, 'exec-2')
    })

    await t.test('appendExecution with the SAME executionId replaces (idempotent re-record), never duplicates', async () => {
      await appendExecution(REQUEST_ID, { executionId: 'exec-2', status: 'COMPLETED', result: { reRecorded: true } })
      const record = readCleanupRequestRecord(REQUEST_ID)
      assert.equal(record.executions.length, 2)
      assert.equal(latestExecution(record).result.reRecorded, true)
    })

    await t.test('appendReceipts appends without disturbing prior receipts', async () => {
      await appendReceipts(REQUEST_ID, [{ kind: 'RECOMMENDATION_ISSUED', receiptHash: 'h1' }])
      await appendReceipts(REQUEST_ID, [{ kind: 'PLAN_BUILT', receiptHash: 'h2' }])
      const record = readCleanupRequestRecord(REQUEST_ID)
      assert.deepEqual(record.receipts.map((r) => r.kind), ['RECOMMENDATION_ISSUED', 'PLAN_BUILT'])
    })

    await t.test('readAllCleanupRequestRecords includes this request among possibly others', () => {
      const all = readAllCleanupRequestRecords()
      assert.ok(all[REQUEST_ID])
    })

    await t.test('10-way concurrent withCleanupRequestRecord mutation: real cross-process file lock keeps every increment (no lost update)', async () => {
      const counterId = 'req:cleanup-request-store-concurrency-test'
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          withCleanupRequestRecord(counterId, (current) => ({
            recommendation: null,
            plan: null,
            authorization: null,
            executions: [],
            receipts: [...(current?.receipts ?? []), { kind: 'IDEMPOTENT_REPLAY', receiptHash: `h${i}` }]
          }))
        )
      )
      const record = readCleanupRequestRecord(counterId)
      assert.equal(record.receipts.length, 10, 'every one of 10 concurrent writers must land -- none silently lost')
    })
  } finally {
    cleanupStateFile()
  }
})
