// Governed live bake-off runner -- executes HQ's authorized 6-call
// Parallel-vs-Exa NFL 2001 QB bake-off against REAL provider APIs. Not a
// test; an executable script, run once under explicit HQ + owner
// authorization with real credentials present.
//
// Governance enforced here, matching HQ's exact wave-6 mandate:
//   - only PARALLEL (processor=core) and EXA (effort=medium) are used;
//   - projected cumulative spend checked before EVERY dispatch, hard
//     fail-closed at $5.00;
//   - max 8 total dispatched requests, max 2 transport-level retries
//     (connection failure / 5xx / timeout-before-result ONLY);
//   - credentials read from process.env only, never logged/printed/
//     written to any artifact;
//   - every raw call is recorded (run id, latency, status) as a governed,
//     non-secret research artifact.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createParallelHttpTransport } from '../adapters/parallel-http-transport.mjs'
import { createExaHttpTransport } from '../adapters/exa-http-transport.mjs'
import { createParallelResearchWorker, PARALLEL_PROVIDER_ID } from '../adapters/parallel-research-worker.mjs'
import { createExaResearchWorker, EXA_PROVIDER_ID } from '../adapters/exa-research-worker.mjs'
import { authorizeMeteredExecution } from '../domain/research-cost-governance.mjs'
import { admitBoundedResearchResult } from '../domain/research-admission.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from '../domain/research-node.mjs'
import { buildNflQb2001Mission } from './nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date()

export const HQ_PRICING_POLICY = Object.freeze({
  [PARALLEL_PROVIDER_ID]: { costPerRequestUsd: 0.025 }, // core processor, $25/1000 requests
  [EXA_PROVIDER_ID]: { costPerRequestUsd: 0.1 } // medium effort, fixed rate
})
export const MAX_APPROVED_SPEND_USD = 5.0
export const MAX_TOTAL_REQUESTS = 8
export const MAX_TRANSPORT_RETRIES = 2
const RETRYABLE_REASONS = new Set(['PARALLEL_CREATE_RUN_ERROR', 'PARALLEL_GET_RUN_ERROR', 'EXA_CREATE_RUN_ERROR', 'EXA_GET_RUN_ERROR'])

// pricingPolicy/maxApprovedSpendUsd/maxTotalRequests/maxRetries default to
// the exact HQ-approved values; overridable only for isolated testing of
// the gate mechanism itself (e.g. proving the cost ceiling triggers
// without needing 50 real-rate calls to reach it) -- the live runner
// below never overrides them.
export function createGovernedDispatcher({
  pricingPolicy = HQ_PRICING_POLICY,
  maxApprovedSpendUsd = MAX_APPROVED_SPEND_USD,
  maxTotalRequests = MAX_TOTAL_REQUESTS,
  maxRetries = MAX_TRANSPORT_RETRIES
} = {}) {
  let cumulativeSpendUsd = 0
  let totalDispatched = 0
  let retriesUsed = 0
  const callLog = []

  function checkCostGate(providerId) {
    const rate = pricingPolicy[providerId].costPerRequestUsd
    const projected = cumulativeSpendUsd + rate
    const decision = authorizeMeteredExecution(
      { providerId, pricingPolicy, plannedRequestCount: totalDispatched + 1, maxApprovedSpendUsd },
      clock
    )
    if (projected > maxApprovedSpendUsd || !decision.authorized) {
      return { ok: false, projected, decision }
    }
    return { ok: true, projected, decision }
  }

  async function dispatchGoverned({ providerId, worker, request, isRetry = false }) {
    if (totalDispatched >= maxTotalRequests) {
      const error = new Error(`STOP_FOR_HQ_COST_LIMIT: max total dispatched requests (${maxTotalRequests}) reached`)
      error.code = 'STOP_FOR_HQ_REQUEST_LIMIT'
      throw error
    }
    if (isRetry && retriesUsed >= maxRetries) {
      const error = new Error(`retry budget exhausted (${maxRetries} max)`)
      error.code = 'RETRY_BUDGET_EXCEEDED'
      throw error
    }
    const gate = checkCostGate(providerId)
    if (!gate.ok) {
      const error = new Error(`STOP_FOR_HQ_COST_LIMIT: projected cumulative spend $${gate.projected.toFixed(3)} would exceed $${maxApprovedSpendUsd} ceiling`)
      error.code = 'STOP_FOR_HQ_COST_LIMIT'
      throw error
    }
    const startedAt = Date.now()
    const dispatched = await worker.dispatch(request)
    if (!dispatched.ok) {
      callLog.push({ providerId, nodeId: request.nodeId, taskFingerprint: request.taskFingerprint, ok: false, reason: dispatched.reason, detail: dispatched.detail, isRetry, at: new Date().toISOString() })
      return { ok: false, dispatched }
    }
    totalDispatched += 1
    if (isRetry) retriesUsed += 1
    cumulativeSpendUsd = gate.projected
    let fetched
    let pollCount = 0
    const maxPolls = 30
    for (; pollCount < maxPolls; pollCount += 1) {
      fetched = await worker.fetchResult(dispatched.workerRunRef)
      if (!fetched.ok || fetched.status === 'READY') break
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    const latencyMs = Date.now() - startedAt
    const entry = {
      providerId,
      nodeId: request.nodeId,
      taskFingerprint: request.taskFingerprint,
      workerRunRef: dispatched.workerRunRef,
      ok: fetched?.ok === true,
      status: fetched?.result?.status ?? null,
      failureReason: fetched?.result?.failureDetails?.reason ?? fetched?.reason ?? null,
      pollCount,
      latencyMs,
      isRetry,
      listPriceCostUsd: pricingPolicy[providerId].costPerRequestUsd,
      providerReportedCostUsd: fetched?.result?.usage?.providerReportedCostUsd ?? null,
      at: new Date().toISOString()
    }
    callLog.push(entry)
    return { ok: fetched?.ok === true, fetched, entry }
  }

  return {
    dispatchGoverned,
    getState: () => ({ cumulativeSpendUsd, totalDispatched, retriesUsed, callLog: [...callLog] })
  }
}

function isRetryableFailure(entry) {
  return RETRYABLE_REASONS.has(entry.failureReason) || entry.failureReason === 'MAX_POLLS_EXHAUSTED'
}

export async function runLiveBakeoff({ parallelApiKey, exaApiKey, outDir }) {
  const parallelTransport = createParallelHttpTransport({ apiKey: parallelApiKey })
  const exaTransport = createExaHttpTransport({ apiKey: exaApiKey })
  const parallelWorker = createParallelResearchWorker({ transport: parallelTransport, clock })
  const exaWorker = createExaResearchWorker({ transport: exaTransport, clock })

  let mission = buildNflQb2001Mission(clock)
  const dispatcher = createGovernedDispatcher()
  const results = []

  for (const node of mission.nodes) {
    for (const [providerId, worker] of [
      [PARALLEL_PROVIDER_ID, parallelWorker],
      [EXA_PROVIDER_ID, exaWorker]
    ]) {
      mission = markResearchNodeReady(mission, node.id, clock, mission.revision)
      const request = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === node.id), providerId, clock)
      let outcome = await dispatcher.dispatchGoverned({ providerId, worker, request })
      if (outcome.ok && !outcome.fetched.ok) {
        // dispatch succeeded but polling never resolved to a real result --
        // not eligible for retry under HQ's policy unless it's a genuine
        // transient transport-level failure, not a research-outcome issue.
      }
      let finalFetched = outcome.fetched
      if (outcome.entry && isRetryableFailure(outcome.entry)) {
        outcome = await dispatcher.dispatchGoverned({ providerId, worker, request, isRetry: true })
        finalFetched = outcome.fetched
      }
      if (outcome.ok && finalFetched?.ok && finalFetched.status === 'READY') {
        mission = recordResearchNodeDispatch(mission, node.id, { taskFingerprint: request.taskFingerprint, workerRunRef: outcome.entry.workerRunRef }, clock, mission.revision)
        mission = recordResearchNodeResult(mission, node.id, finalFetched.result, clock, mission.revision)
        const digest = mission.nodes.find((n) => n.id === node.id).rawResults.at(-1).digest
        mission = admitBoundedResearchResult(mission, node.id, digest, clock, mission.revision)
      }
      results.push({ nodeId: node.id, providerId, outcome: outcome.entry ?? { ok: false, reason: outcome.dispatched?.reason } })
    }
  }

  const state = dispatcher.getState()
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(path.join(outDir, 'call-log.json'), JSON.stringify(state.callLog, null, 2))
    writeFileSync(path.join(outDir, 'mission.json'), JSON.stringify(mission, null, 2))
    writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ cumulativeSpendUsd: state.cumulativeSpendUsd, totalDispatched: state.totalDispatched, retriesUsed: state.retriesUsed }, null, 2))
  }
  return { mission, state }
}
