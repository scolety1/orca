import assert from 'node:assert/strict'
import test from 'node:test'
import { decidePlannerHandoffTrigger } from '../domain/planner-handoff-trigger.mjs'

test('no signal -> no handoff', () => {
  assert.deepEqual(decidePlannerHandoffTrigger({}), { shouldHandoff: false, trigger: null })
})

test('explicit retirement always wins, regardless of other signals', () => {
  const result = decidePlannerHandoffTrigger({ explicitRetirement: true, staleLeaseDetected: true, transportTerminated: true })
  assert.equal(result.trigger, 'EXPLICIT_RETIREMENT')
})

test('stale lease beats transport termination and resource pressure', () => {
  const result = decidePlannerHandoffTrigger({ staleLeaseDetected: true, transportTerminated: true, hostMemoryAvailableBytes: 1 })
  assert.equal(result.trigger, 'STALE_LEASE_DETECTED')
})

test('transport termination beats resource pressure', () => {
  const result = decidePlannerHandoffTrigger({ transportTerminated: true, hostMemoryAvailableBytes: 1 })
  assert.equal(result.trigger, 'TRANSPORT_TERMINATED')
})

test('resource pressure only triggers at CRITICAL/EMERGENCY, not HEALTHY/PRESSURED -- no fake precision', () => {
  const GB = 1024 ** 3
  assert.equal(decidePlannerHandoffTrigger({ hostMemoryAvailableBytes: 8 * GB }).shouldHandoff, false)
  assert.equal(decidePlannerHandoffTrigger({ hostMemoryAvailableBytes: 3 * GB }).shouldHandoff, false, 'PRESSURED must not trigger a hard handoff')
  const critical = decidePlannerHandoffTrigger({ hostMemoryAvailableBytes: 2 * GB })
  assert.equal(critical.shouldHandoff, true)
  assert.equal(critical.trigger, 'RESOURCE_PRESSURE')
  assert.equal(critical.tier, 'CRITICAL')
})
