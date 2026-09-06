import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDomainThrottleState,
  msUntilDomainSlot,
  recordDomainRequest,
  computeBackoffDelayMs
} from '../domain/web-source-domain-throttle.mjs'

test('a fresh domain needs no wait', () => {
  const state = createDomainThrottleState()
  assert.equal(msUntilDomainSlot(state, 'example.com', 1000, 0), 0)
})

test('a domain requested too recently must wait the remainder of the interval', () => {
  const state = createDomainThrottleState()
  recordDomainRequest(state, 'example.com', 1000)
  assert.equal(msUntilDomainSlot(state, 'example.com', 1000, 1400), 600)
})

test('two different domains do not throttle each other', () => {
  const state = createDomainThrottleState()
  recordDomainRequest(state, 'a.example.com', 1000)
  assert.equal(msUntilDomainSlot(state, 'b.example.com', 1000, 1001), 0)
})

test('backoff delay grows exponentially and stays within the configured cap', () => {
  const noJitter = () => 0
  assert.equal(computeBackoffDelayMs(1, 500, { jitterFn: noJitter }), 500)
  assert.equal(computeBackoffDelayMs(2, 500, { jitterFn: noJitter }), 1000)
  assert.equal(computeBackoffDelayMs(3, 500, { jitterFn: noJitter }), 2000)
  assert.equal(computeBackoffDelayMs(20, 500, { maxDelayMs: 5000, jitterFn: noJitter }), 5000)
})
