// Frozen, deterministic bake-off readiness harness (§4 Wave 5). Orchestrates
// a BoundedResearchWorker through the REAL engine pipeline (dispatch ->
// result -> admission -> verification) and instruments latency/usage/
// provider-failure -- it does NOT duplicate TSF's own admission/
// verification/conflict logic in a separate scoring engine; metrics are
// read back from the real resulting mission state via
// computeCompletenessMetrics plus a small set of bake-off-specific
// dimensions this module adds. No single opaque research-quality score is
// ever produced -- every dimension stays separate, per HQ's explicit
// instruction, repeated here because it is the one rule most tempting to
// violate for "convenience."
import { isoNow } from './canonical.mjs'
import { markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from './research-node.mjs'
import { admitBoundedResearchResult } from './research-admission.mjs'
import { computeCompletenessMetrics } from './research-completeness.mjs'

// Dispatches one request, polls until READY or maxPolls is exhausted
// (bounded -- never an infinite loop against a stuck/suspended run),
// measuring wall-clock latency from dispatch to a real terminal result.
// Both shipped adapters (parallel-research-worker.mjs, exa-research-
// worker.mjs) always return {ok:false,...} rather than throwing, but this
// harness must not assume every future BoundedResearchWorker honors that
// convention -- an independent-verification finding: an adapter that
// THROWS instead of returning ok:false previously propagated an uncaught
// exception out of this function. dispatch/fetchResult are now wrapped so
// a misbehaving worker degrades to an honest ok:false result instead.
export async function dispatchAndAwaitResult({ worker, request, clock, maxPolls = 50 }) {
  const dispatchStartedAt = Date.now()
  let dispatched
  try {
    dispatched = await worker.dispatch(request)
  } catch (error) {
    return { ok: false, reason: 'WORKER_DISPATCH_THREW', detail: error.message, latencyMs: Date.now() - dispatchStartedAt, pollCount: 0 }
  }
  if (!dispatched?.ok) {
    return { ok: false, reason: dispatched?.reason ?? 'MALFORMED_DISPATCH_RESPONSE', detail: dispatched?.detail, latencyMs: Date.now() - dispatchStartedAt, pollCount: 0 }
  }
  let pollCount = 0
  for (; pollCount < maxPolls; pollCount += 1) {
    let fetched
    try {
      fetched = await worker.fetchResult(dispatched.workerRunRef)
    } catch (error) {
      return { ok: false, reason: 'WORKER_FETCH_RESULT_THREW', detail: error.message, latencyMs: Date.now() - dispatchStartedAt, pollCount, workerRunRef: dispatched.workerRunRef }
    }
    if (!fetched?.ok) {
      return { ok: false, reason: fetched?.reason ?? 'MALFORMED_FETCH_RESPONSE', detail: fetched?.detail, latencyMs: Date.now() - dispatchStartedAt, pollCount, workerRunRef: dispatched.workerRunRef }
    }
    if (fetched.status === 'READY') {
      if (!fetched.result) {
        return { ok: false, reason: 'MALFORMED_FETCH_RESPONSE', detail: 'status READY but no result was provided', latencyMs: Date.now() - dispatchStartedAt, pollCount, workerRunRef: dispatched.workerRunRef }
      }
      return { ok: true, result: fetched.result, latencyMs: Date.now() - dispatchStartedAt, pollCount: pollCount + 1, workerRunRef: dispatched.workerRunRef }
    }
  }
  return { ok: false, reason: 'MAX_POLLS_EXHAUSTED', detail: `no terminal result after ${maxPolls} polls`, latencyMs: Date.now() - dispatchStartedAt, pollCount, workerRunRef: dispatched.workerRunRef }
}

// Runs one frozen request all the way through the REAL pipeline for one
// node, returning the updated mission plus this run's instrumentation.
// This is the same dispatch/record/admit sequence every other test in
// this codebase uses -- no bake-off-specific shortcut through admission.
export async function runBakeoffRequest({ mission, nodeId, worker, request, clock, maxPolls = 50 }) {
  let next = markResearchNodeReady(mission, nodeId, clock, mission.revision)
  const run = await dispatchAndAwaitResult({ worker, request, clock, maxPolls })
  if (!run.ok) {
    return { mission: next, providerFailed: true, failureReason: run.reason, latencyMs: run.latencyMs, pollCount: run.pollCount, requestCount: null, cost: null }
  }
  next = recordResearchNodeDispatch(next, nodeId, { taskFingerprint: request.taskFingerprint, workerRunRef: run.workerRunRef }, clock, next.revision)
  next = recordResearchNodeResult(next, nodeId, run.result, clock, next.revision)
  const digest = next.nodes.find((n) => n.id === nodeId).rawResults.at(-1).digest
  next = admitBoundedResearchResult(next, nodeId, digest, clock, next.revision)
  return {
    mission: next,
    providerFailed: run.result.status !== 'SUCCEEDED',
    failureReason: run.result.status !== 'SUCCEEDED' ? run.result.failureDetails?.reason : null,
    latencyMs: run.latencyMs,
    pollCount: run.pollCount,
    requestCount: run.result.usage?.requestCount ?? null,
    cost: run.result.usage?.providerReportedCostUsd ?? null
  }
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url ?? null
  }
}

// Bake-off-specific dimensions not already covered by
// computeCompletenessMetrics. `preferredSourceHosts` and
// `expectedEntityIdByNodeId` are caller-supplied (frozen per bake-off
// package), never inferred.
export function computeBakeoffQualityDimensions(mission, { preferredSourceHosts = [], disallowedSourceHosts = [], expectedEntityIdByNodeId = {} } = {}) {
  // Bake-off "field completion" measures whether the WORKER answered
  // every requested field (a Claim or a TypedMissingness -- either is a
  // structural response, never a silent omission) -- deliberately
  // distinct from research-completeness.mjs's fieldCoverage, which
  // requires the field to already be TSF-reconciled into a CanonicalFact.
  // A bake-off measures the provider's output before TSF's own
  // reconciliation authority has necessarily run over it; conflating the
  // two understated this metric to 0 for any bake-off run that hadn't
  // also driven the full reconciliation step -- a real bug caught by this
  // module's own test.
  let requestedFieldTotal = 0
  let providerAnsweredFieldTotal = 0
  for (const node of mission.nodes) {
    for (const rf of node.requestedFields) {
      requestedFieldTotal += 1
      const hasClaim = node.claims.some((c) => c.fieldName === rf.fieldName)
      const hasMissing = node.typedMissingness.some((m) => m.fieldName === rf.fieldName)
      if (hasClaim || hasMissing) providerAnsweredFieldTotal += 1
    }
  }

  let citationSupportedClaims = 0
  let claimsWithEvidence = 0
  let primarySourceBackedFields = 0
  let fieldsWithAnySource = 0
  let independentSourceHostCount = 0
  let missingnessWithReason = 0
  let missingnessTotal = 0
  let temporalMatchedVerifications = 0
  let temporalCheckedVerifications = 0
  let retrievableSnapshots = 0
  let totalSnapshots = 0
  let identityCorrect = 0
  let identityChecked = 0
  // source quality: a categorical breakdown, distinct from
  // primarySourceCoverage (a ratio) and sourceIndependence (a host-count)
  // -- classifies each DISTINCT source reference across the mission, not
  // each citation occurrence, so a source cited 5 times still counts once.
  const seenSourceRefsForQuality = new Set()
  const sourceQualityCounts = { PRIMARY: 0, DISALLOWED: 0, UNCLASSIFIED: 0 }

  for (const node of mission.nodes) {
    for (const sourceReference of node.sourceReferences) {
      if (seenSourceRefsForQuality.has(sourceReference.id)) continue
      seenSourceRefsForQuality.add(sourceReference.id)
      const host = hostOf(sourceReference.url)
      if (host && disallowedSourceHosts.some((h) => host.includes(h))) {
        sourceQualityCounts.DISALLOWED += 1
      } else if (host && preferredSourceHosts.some((h) => host.includes(h))) {
        sourceQualityCounts.PRIMARY += 1
      } else {
        sourceQualityCounts.UNCLASSIFIED += 1
      }
    }
    const hostsForNode = new Set()
    for (const evidence of node.evidence) {
      claimsWithEvidence += 1
      if (evidence.supportsClaim) citationSupportedClaims += 1
      const sourceRef = node.sourceReferences.find((s) => s.id === evidence.sourceReferenceId)
      const host = hostOf(sourceRef?.url)
      if (host) hostsForNode.add(host)
      fieldsWithAnySource += 1
      if (host && preferredSourceHosts.some((h) => host.includes(h))) primarySourceBackedFields += 1
    }
    independentSourceHostCount += hostsForNode.size
    for (const m of node.typedMissingness) {
      missingnessTotal += 1
      if (m.reason?.trim()) missingnessWithReason += 1
    }
    for (const v of node.verifications) {
      const temporalAssertion = v.assertionResults.find((a) => a.path === 'temporalMatches')
      if (temporalAssertion) {
        temporalCheckedVerifications += 1
        if (temporalAssertion.passed) temporalMatchedVerifications += 1
      }
    }
    totalSnapshots += node.sourceSnapshots.length
    retrievableSnapshots += node.sourceSnapshots.filter((s) => s.retrievable).length
    // Identity correctness is only meaningful over nodes where TSF
    // actually attempted resolution -- a node the harness never ran
    // recordIdentityResolutionState against (e.g. a bake-off pass that
    // stopped at admission, before any identity-review step) contributes
    // nothing here, honestly, rather than counting as a checked-and-wrong
    // 0.
    const expectedEntityId = expectedEntityIdByNodeId[node.id]
    if (expectedEntityId && node.identityResolutionState) {
      identityChecked += 1
      if (node.identityResolutionState.resolvedEntityId === expectedEntityId) identityCorrect += 1
    }
  }

  const ratio = (n, d) => (d > 0 ? n / d : null)
  return {
    schemaVersion: 'TSF_BAKEOFF_QUALITY_DIMENSIONS_V1',
    fieldCompletion: ratio(providerAnsweredFieldTotal, requestedFieldTotal),
    sourceQuality: sourceQualityCounts,
    citationSupportCorrectness: ratio(citationSupportedClaims, claimsWithEvidence),
    sourceIndependenceAvgHostsPerNode: mission.nodes.length > 0 ? independentSourceHostCount / mission.nodes.length : null,
    primarySourceCoverage: ratio(primarySourceBackedFields, fieldsWithAnySource),
    missingnessHonesty: ratio(missingnessWithReason, missingnessTotal),
    temporalCorrectness: ratio(temporalMatchedVerifications, temporalCheckedVerifications),
    rawSourceRetrievability: ratio(retrievableSnapshots, totalSnapshots),
    identityCorrectness: ratio(identityCorrect, identityChecked)
  }
}

// Compares two independently-produced results for the SAME request
// (same taskFingerprint) field-by-field. Used for the repeatability
// protocol -- run the same frozen request twice and compare.
export function evaluateRepeatability(resultA, resultB) {
  if (resultA.taskFingerprint !== resultB.taskFingerprint) {
    throw new Error('repeatability comparison requires two results for the identical taskFingerprint')
  }
  const fieldsA = new Map(resultA.proposedClaims.map((c) => [c.fieldName, c.proposedValue]))
  const fieldsB = new Map(resultB.proposedClaims.map((c) => [c.fieldName, c.proposedValue]))
  const allFields = new Set([...fieldsA.keys(), ...fieldsB.keys()])
  const mismatches = []
  for (const field of allFields) {
    if (JSON.stringify(fieldsA.get(field)) !== JSON.stringify(fieldsB.get(field))) {
      mismatches.push({ field, a: fieldsA.get(field), b: fieldsB.get(field) })
    }
  }
  return {
    schemaVersion: 'TSF_REPEATABILITY_RESULT_V1',
    fieldCount: allFields.size,
    matchingFieldCount: allFields.size - mismatches.length,
    matchRatio: allFields.size > 0 ? (allFields.size - mismatches.length) / allFields.size : null,
    mismatches
  }
}

// Assembles the full, non-collapsed metrics package for one provider's
// run of a frozen request set against one mission. Every named dimension
// stays separate -- there is deliberately no `.overallScore` field.
export function buildBakeoffReport(mission, { instrumentation, preferredSourceHosts, disallowedSourceHosts, expectedEntityIdByNodeId, clock } = {}) {
  const completeness = computeCompletenessMetrics(mission, clock)
  const quality = computeBakeoffQualityDimensions(mission, { preferredSourceHosts, disallowedSourceHosts, expectedEntityIdByNodeId })
  const totalRequests = instrumentation.reduce((sum, r) => sum + (r.requestCount ?? 0), 0)
  const knownCosts = instrumentation.filter((r) => r.cost != null)
  const totalLatencyMs = instrumentation.reduce((sum, r) => sum + r.latencyMs, 0)
  return {
    schemaVersion: 'TSF_BAKEOFF_REPORT_V1',
    missionId: mission.id,
    schemaConformanceFailures: instrumentation.filter((r) => r.providerFailed && r.failureReason === 'MALFORMED_PROVIDER_RESPONSE').length,
    fieldCompletion: quality.fieldCompletion,
    sourceQuality: quality.sourceQuality,
    // Reconciliation-dependent (only meaningful once TSF has also run its
    // own authority step over these results, separate from the worker's
    // raw output) -- included for context, kept honestly null/low if the
    // bake-off run stopped at admission as most will.
    canonicalFieldCoverage: completeness.fieldCoverage,
    evidenceCoverage: completeness.evidenceCoverage,
    citationSupportCorrectness: quality.citationSupportCorrectness,
    sourceIndependenceAvgHostsPerNode: quality.sourceIndependenceAvgHostsPerNode,
    primarySourceCoverage: quality.primarySourceCoverage,
    conflictDiscoveryCount: completeness.conflictCount,
    unresolvedConflictCount: completeness.unresolvedConflictCount,
    missingnessHonesty: quality.missingnessHonesty,
    identityCorrectness: quality.identityCorrectness,
    temporalCorrectness: quality.temporalCorrectness,
    rawSourceRetrievability: quality.rawSourceRetrievability,
    providerFailureCount: instrumentation.filter((r) => r.providerFailed).length,
    requestCount: instrumentation.some((r) => r.requestCount != null) ? totalRequests : null,
    totalLatencyMs,
    avgLatencyMs: instrumentation.length > 0 ? totalLatencyMs / instrumentation.length : null,
    totalCostUsd: knownCosts.length === instrumentation.length ? knownCosts.reduce((sum, r) => sum + r.cost, 0) : null,
    generatedAt: isoNow(clock)
  }
}
