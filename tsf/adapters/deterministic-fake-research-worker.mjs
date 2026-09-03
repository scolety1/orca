// Wave 1's only concrete BoundedResearchWorker. Zero network I/O, $0 real
// cost always (usage.providerReportedCostUsd is a scripted, honest figure
// -- 0 because no real metered call happened, never a fabricated stand-in
// for a real provider's unknown cost). Fully deterministic and replayable:
// behavior is driven entirely by an injected `script` keyed by
// taskFingerprint, never by wall-clock time or randomness -- DELAYED_COMPLETION
// uses a poll counter, not a real timer.
import { isoNow } from '../domain/canonical.mjs'

export const FAKE_WORKER_BEHAVIORS = Object.freeze([
  'SUCCESS',
  'FAILURE',
  'TIMEOUT_SUSPENSION',
  'DELAYED_COMPLETION',
  'DUPLICATE_RESULT_DELIVERY',
  'CONFLICTING_RESULT',
  'MISSING_RESULT_FIELD',
  'IDENTITY_ALIAS_RESULT'
])

function defaultUsage() {
  return { requestCount: 1, tokensOrUnits: null, providerReportedCostUsd: 0 }
}

export function createDeterministicFakeResearchWorker({ provider = 'FAKE', script = new Map(), clock } = {}) {
  const runs = new Map()
  let seq = 0

  function buildResult(request, entry, status, workerRunRef) {
    // A script entry may override the instance's default provider label --
    // e.g. one DeterministicFakeResearchWorker standing in for two or three
    // distinct real-world providers, so a caller's multi-source or
    // conflict/retry scenario doesn't require a separate worker object
    // per label.
    const resultProvider = entry.provider ?? provider
    if (status === 'FAILED') {
      return {
        schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
        nodeId: request.nodeId,
        taskFingerprint: request.taskFingerprint,
        provider: resultProvider,
        providerRunRef: workerRunRef,
        status: 'FAILED',
        observations: [],
        proposedClaims: [],
        evidence: [],
        sourceReferences: [],
        sourceSnapshotsOrSnapshotRefs: [],
        newGapProposals: [],
        warnings: [],
        unresolvedQuestions: [],
        usage: entry.usage ?? defaultUsage(),
        failureDetails: entry.failureDetails ?? { reason: 'SCRIPTED_FAILURE', detail: null }
      }
    }
    return {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId: request.nodeId,
      taskFingerprint: request.taskFingerprint,
      provider: resultProvider,
      providerRunRef: workerRunRef,
      status: 'SUCCEEDED',
      observations: entry.observations ?? [],
      proposedClaims: entry.proposedClaims ?? [],
      evidence: entry.evidence ?? [],
      sourceReferences: entry.sourceReferences ?? [],
      sourceSnapshotsOrSnapshotRefs: entry.sourceSnapshotsOrSnapshotRefs ?? [],
      newGapProposals: entry.newGapProposals ?? [],
      warnings: entry.warnings ?? [],
      unresolvedQuestions: entry.unresolvedQuestions ?? [],
      usage: entry.usage ?? defaultUsage(),
      failureDetails: null
    }
  }

  async function dispatch(request) {
    const entry = script.get(request.taskFingerprint)
    if (!entry) {
      return { ok: false, reason: 'NO_SCRIPT_FOR_FINGERPRINT', detail: request.taskFingerprint }
    }
    seq += 1
    const providerRunId = `fake-run-${seq}`
    const workerRunRef = { provider: entry.provider ?? provider, providerRunId, dispatchedAt: isoNow(clock) }
    runs.set(providerRunId, { request, entry, workerRunRef, pollCount: 0 })
    return { ok: true, workerRunRef }
  }

  async function fetchResult(workerRunRef) {
    const run = runs.get(workerRunRef.providerRunId)
    if (!run) return { ok: false, reason: 'UNKNOWN_RUN_REF', detail: workerRunRef.providerRunId }
    run.pollCount += 1
    const { entry, request } = run
    if (entry.behavior === 'TIMEOUT_SUSPENSION') {
      return { ok: true, status: 'PENDING' }
    }
    if (entry.behavior === 'DELAYED_COMPLETION' && run.pollCount < (entry.readyAfterPolls ?? 2)) {
      return { ok: true, status: 'PENDING' }
    }
    const status = entry.behavior === 'FAILURE' ? 'FAILED' : 'SUCCEEDED'
    return { ok: true, status: 'READY', result: buildResult(request, entry, status, run.workerRunRef) }
  }

  return { provider, dispatch, fetchResult }
}
