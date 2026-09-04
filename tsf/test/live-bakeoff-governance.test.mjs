// §7 pre-money proof: the governed dispatcher's cost/request/retry gates,
// tested against a controllable fake worker -- no real network call.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createGovernedDispatcher, HQ_PRICING_POLICY, MAX_APPROVED_SPEND_USD, MAX_TOTAL_REQUESTS } from '../fixtures/live-bakeoff-runner.mjs'
import { PARALLEL_PROVIDER_ID } from '../adapters/parallel-research-worker.mjs'
import { EXA_PROVIDER_ID } from '../adapters/exa-research-worker.mjs'

function successWorker() {
  return {
    dispatch: async () => ({ ok: true, workerRunRef: { provider: 'X', providerRunId: 'r1', dispatchedAt: new Date().toISOString() } }),
    fetchResult: async () => ({
      ok: true,
      status: 'READY',
      result: { schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1', status: 'SUCCEEDED', usage: { providerReportedCostUsd: null }, failureDetails: null }
    })
  }
}

function req(nodeId = 'node:x') {
  return { nodeId, taskFingerprint: '0'.repeat(64) }
}

test('HQ pricing policy matches the exact approved rates', () => {
  assert.equal(HQ_PRICING_POLICY[PARALLEL_PROVIDER_ID].costPerRequestUsd, 0.025)
  assert.equal(HQ_PRICING_POLICY[EXA_PROVIDER_ID].costPerRequestUsd, 0.1)
  assert.equal(MAX_APPROVED_SPEND_USD, 5.0)
  assert.equal(MAX_TOTAL_REQUESTS, 8)
})

test('a successful dispatch is recorded with real list-price cost accounting', async () => {
  const dispatcher = createGovernedDispatcher()
  const outcome = await dispatcher.dispatchGoverned({ providerId: PARALLEL_PROVIDER_ID, worker: successWorker(), request: req() })
  assert.equal(outcome.ok, true)
  const state = dispatcher.getState()
  assert.equal(state.totalDispatched, 1)
  assert.ok(Math.abs(state.cumulativeSpendUsd - 0.025) < 1e-9)
})

test('the cost gate blocks a dispatch whose projected cumulative spend would exceed the ceiling -- STOP_FOR_HQ_COST_LIMIT, checked BEFORE any dispatch call', async () => {
  // Uses an injected (non-HQ) pricing policy + a small ceiling + a high
  // request cap so the COST gate is what's actually being isolated and
  // proven here, independent of the (always-binds-first-at-real-rates)
  // 8-request cap -- the real HQ rates are asserted separately above.
  const dispatcher = createGovernedDispatcher({ pricingPolicy: { [EXA_PROVIDER_ID]: { costPerRequestUsd: 2 } }, maxApprovedSpendUsd: 5, maxTotalRequests: 100 })
  const worker = successWorker()
  let dispatchCallCount = 0
  const countingWorker = { ...worker, dispatch: async (...args) => { dispatchCallCount += 1; return worker.dispatch(...args) } }
  await dispatcher.dispatchGoverned({ providerId: EXA_PROVIDER_ID, worker: countingWorker, request: req('node:1') }) // $2
  await dispatcher.dispatchGoverned({ providerId: EXA_PROVIDER_ID, worker: countingWorker, request: req('node:2') }) // $4
  const stateBefore = dispatcher.getState()
  assert.ok(Math.abs(stateBefore.cumulativeSpendUsd - 4) < 1e-9)
  // A 3rd $2 call would project to $6, over the $5 ceiling -- must refuse.
  await assert.rejects(
    dispatcher.dispatchGoverned({ providerId: EXA_PROVIDER_ID, worker: countingWorker, request: req('node:3') }),
    (error) => {
      assert.equal(error.code, 'STOP_FOR_HQ_COST_LIMIT')
      return true
    }
  )
  assert.equal(dispatchCallCount, 2, 'the refused 3rd call must never reach worker.dispatch() -- no real request sent past the ceiling')
  assert.equal(dispatcher.getState().totalDispatched, 2, 'the refused call must not be counted as dispatched')
})

test('max total dispatched requests (8) is enforced independent of cost', async () => {
  const dispatcher = createGovernedDispatcher()
  const worker = successWorker()
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await dispatcher.dispatchGoverned({ providerId: PARALLEL_PROVIDER_ID, worker, request: req(`node:${i}`) })
  }
  await assert.rejects(
    dispatcher.dispatchGoverned({ providerId: PARALLEL_PROVIDER_ID, worker, request: req('node:9') }),
    (error) => {
      assert.equal(error.code, 'STOP_FOR_HQ_REQUEST_LIMIT')
      return true
    }
  )
})

test('retry budget (2 max) is enforced -- a 3rd retry attempt is refused before dispatch', async () => {
  const dispatcher = createGovernedDispatcher()
  const worker = successWorker()
  await dispatcher.dispatchGoverned({ providerId: PARALLEL_PROVIDER_ID, worker, request: req(), isRetry: true })
  await dispatcher.dispatchGoverned({ providerId: PARALLEL_PROVIDER_ID, worker, request: req(), isRetry: true })
  await assert.rejects(
    dispatcher.dispatchGoverned({ providerId: PARALLEL_PROVIDER_ID, worker, request: req(), isRetry: true }),
    (error) => {
      assert.equal(error.code, 'RETRY_BUDGET_EXCEEDED')
      return true
    }
  )
})

test('a dispatch-time transport failure never bumps the request counter or cost -- only real successful dispatches count', async () => {
  const dispatcher = createGovernedDispatcher()
  const failingWorker = { dispatch: async () => ({ ok: false, reason: 'PARALLEL_CREATE_RUN_ERROR', detail: 'network unreachable' }), fetchResult: async () => ({ ok: false }) }
  const outcome = await dispatcher.dispatchGoverned({ providerId: PARALLEL_PROVIDER_ID, worker: failingWorker, request: req() })
  assert.equal(outcome.ok, false)
  const state = dispatcher.getState()
  assert.equal(state.totalDispatched, 0, 'a dispatch that never reached the provider (or was refused) must not count against the request/spend budget')
  assert.equal(state.cumulativeSpendUsd, 0)
})
