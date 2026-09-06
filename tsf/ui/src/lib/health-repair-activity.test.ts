import assert from 'node:assert/strict'
import test from 'node:test'
import {
  listHealthRepairActivities,
  startHealthRepairActivity,
  subscribeHealthRepairActivities
} from './health-repair-activity.ts'

test('a Health Repair request keeps running and a remounted page reacquires the same operation', async () => {
  let finish!: (value: { ok: true; results: [] }) => void
  const pending = new Promise<{ ok: true; results: [] }>((resolve) => {
    finish = resolve
  })
  const started = startHealthRepairActivity({
    kind: 'REPAIR_SELECTED',
    projectIds: ['alpha'],
    run: () => pending
  })
  assert.equal(listHealthRepairActivities()[0].status, 'RUNNING')

  let remounted = []
  const unsubscribe = subscribeHealthRepairActivities((activities) => {
    remounted = activities
  })
  assert.equal(remounted[0].operationId, started.operationId)
  assert.equal(remounted[0].status, 'RUNNING')

  finish({ ok: true, results: [] })
  await pending
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(remounted[0].operationId, started.operationId)
  assert.equal(remounted[0].status, 'COMPLETED')
  unsubscribe()
})
