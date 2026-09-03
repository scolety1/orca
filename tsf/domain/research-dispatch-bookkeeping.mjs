// Trust + Scale Hardening: durable real-provider dispatch bookkeeping.
//
// recordResearchNodeDispatch (research-node.mjs) already durably records a
// CONFIRMED dispatch idempotently by taskFingerprint -- that covers the
// "worker_run_ref persisted" half of the story. What it cannot see is the
// window BEFORE a provider call returns: if TSF crashes after actually
// calling a real, billable provider (Parallel/Exa) but before persisting
// the confirmed workerRunRef, TSF has no durable record the call was ever
// made -- blindly re-dispatching on resume (the crash/resume gauntlet's
// old scenario A behavior) can create a SECOND real, billable provider run
// with no way to detect it. This module makes that pre-flight moment
// durable (recordDispatchAttempt, called BEFORE worker.dispatch() ever
// touches the network) so every dispatch boundary can be classified
// honestly instead of assumed safe.
//
// SCOPE BOUNDARY (independent-verification finding): "durable" here means
// the attempt ledger lives on the SAME mission object every other
// research-*.mjs mutation does -- once that mission is routed through
// research-mission-store.mjs's withResearchMission (as the crash/resume
// gauntlet already proves for every other boundary), a real process crash
// is recoverable exactly like scenarios A-J. fixtures/live-bakeoff-runner.mjs
// wires these functions in today but still keeps `mission` purely in
// memory and only writes to disk once, at the very end -- a real crash of
// that specific script still loses everything, attempt ledger included,
// exactly as before this module existed. This module is the durable
// primitive; live-bakeoff-runner.mjs is a manual demo script, not yet the
// persisted call site.
import { deepClone, isoNow, sha256 } from './canonical.mjs'
import { withResearchNode } from './research-mission.mjs'

export const DELIVERY_GUARANTEES = Object.freeze([
  'EXACTLY_ONCE',
  'AT_MOST_ONCE',
  'AT_LEAST_ONCE',
  'AMBIGUOUS_REQUIRES_RECONCILIATION'
])

// Call BEFORE worker.dispatch() ever touches the network. Always appends a
// NEW record, never deduped -- each real call attempt (including a retry
// of the same taskFingerprint) is a genuinely distinct event that may or
// may not have reached the provider.
export function recordDispatchAttempt(mission, nodeId, { taskFingerprint }, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const attempts = node.dispatchAttempts ?? []
      const id = sha256({ taskFingerprint, attemptSeq: attempts.length, kind: 'DispatchAttempt' })
      const next = deepClone(node)
      next.dispatchAttempts = [
        ...attempts,
        { id, taskFingerprint, outcome: 'UNKNOWN', workerRunRef: null, attemptedAt: isoNow(clock), resolvedAt: null }
      ]
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

// Call immediately after a provider call returns -- CONFIRMED (a
// workerRunRef came back) or FAILED_CLEAN (a synchronous, unambiguous
// rejection). Never call this for a crash: an attempt left UNKNOWN by
// construction is exactly the durable signal a crash produces. Resolves
// the OLDEST still-UNKNOWN attempt for this taskFingerprint so retries
// resolve in the order they were made.
export function resolveDispatchAttempt(mission, nodeId, { taskFingerprint, outcome, workerRunRef = null }, clock, expectedRevision) {
  if (outcome !== 'CONFIRMED' && outcome !== 'FAILED_CLEAN') {
    throw new Error(`unknown dispatch attempt outcome: ${outcome}`)
  }
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const attempts = node.dispatchAttempts ?? []
      const idx = attempts.findIndex((a) => a.taskFingerprint === taskFingerprint && a.outcome === 'UNKNOWN')
      if (idx === -1) return { next: node, changed: false }
      const next = deepClone(node)
      next.dispatchAttempts = deepClone(attempts)
      next.dispatchAttempts[idx] = { ...next.dispatchAttempts[idx], outcome, workerRunRef, resolvedAt: isoNow(clock) }
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

// Pure, no mutation: the honest classification of a taskFingerprint's
// dispatch boundary from TSF's OWN durable state alone. Never guesses what
// the provider actually did -- an unresolved attempt with no confirmed
// record is reported exactly as AMBIGUOUS, never optimistically treated as
// safe to blindly retry.
//
// Independent-verification finding: an earlier version of this function
// threw when confirmedRecordCount was 0 but a CONFIRMED-resolved attempt
// already existed -- a REACHABLE state (resolveDispatchAttempt(CONFIRMED)
// fires right after a real provider call returns; recordResearchNodeDispatch
// is only called afterward, once polling for the result completes), not
// the invariant violation the old comment assumed. Classification below is
// keyed off the attempt ledger's own resolved outcomes (never off
// confirmedRecordCount alone) precisely so that lag is never mistaken for
// ambiguity, and the one remaining truly-unreachable combination degrades
// to AMBIGUOUS_REQUIRES_RECONCILIATION rather than throwing -- a defensive
// throw inside the very feature meant to make crash recovery safer would
// itself become a new crash-adjacent failure mode.
export function classifyDispatchDeliveryGuarantee(node, taskFingerprint) {
  const attempts = (node.dispatchAttempts ?? []).filter((a) => a.taskFingerprint === taskFingerprint)
  const confirmedRecordCount = (node.dispatchRecords ?? []).filter((d) => d.taskFingerprint === taskFingerprint).length
  if (attempts.length === 0 && confirmedRecordCount === 0) return null // never attempted -- nothing to classify

  const unresolvedCount = attempts.filter((a) => a.outcome === 'UNKNOWN').length
  const confirmedAttemptCount = attempts.filter((a) => a.outcome === 'CONFIRMED').length
  const base = { taskFingerprint, unresolvedAttemptCount: unresolvedCount, confirmedDispatchRecordCount: confirmedRecordCount }

  if (unresolvedCount > 0) {
    return {
      ...base,
      guarantee: 'AMBIGUOUS_REQUIRES_RECONCILIATION',
      reason: `${unresolvedCount} dispatch attempt(s) for this task never durably resolved -- the provider may or may not have received them. A human must check the provider's own run history before redispatching.`
    }
  }
  if (confirmedAttemptCount > 1) {
    return {
      ...base,
      guarantee: 'AMBIGUOUS_REQUIRES_RECONCILIATION',
      reason: `${confirmedAttemptCount} separate dispatch attempts for this task were each independently confirmed by the provider -- a human must determine which real run is authoritative before continuing.`
    }
  }
  if (confirmedAttemptCount === 1 && attempts.length === 1) {
    return { ...base, guarantee: 'EXACTLY_ONCE', reason: 'a single dispatch attempt cleanly resolved to a single confirmed dispatch.' }
  }
  if (confirmedAttemptCount === 1 && attempts.length > 1) {
    return {
      ...base,
      guarantee: 'AT_LEAST_ONCE',
      reason: `${attempts.length} dispatch attempts were made for this task before one resolved as confirmed -- the provider itself may have received the call more than once even though TSF's own bookkeeping only ever acts on the one confirmed record.`
    }
  }
  if (attempts.length === 0 && confirmedRecordCount >= 1) {
    return {
      ...base,
      guarantee: 'EXACTLY_ONCE',
      reason: 'a confirmed dispatch record exists with no attempt-ledger history (a dispatch made before this bookkeeping was wired in for this call site) -- fully resolved, nothing ambiguous.'
    }
  }
  if (confirmedAttemptCount === 0 && attempts.length > 0) {
    // unresolvedCount === 0 and confirmedAttemptCount === 0 leaves only
    // FAILED_CLEAN by elimination (the outcome enum has no 4th value).
    return {
      ...base,
      guarantee: 'AT_MOST_ONCE',
      reason: 'every dispatch attempt for this task cleanly failed before reaching a confirmed state -- the provider never durably accepted any of them.'
    }
  }
  // Every real combination is covered above; this is reachable only if
  // something outside this module's own functions mutated dispatchAttempts
  // into a shape none of them produce. Surface it for a human rather than
  // crash the caller.
  return {
    ...base,
    guarantee: 'AMBIGUOUS_REQUIRES_RECONCILIATION',
    reason: `unrecognized dispatch boundary state (${confirmedAttemptCount} confirmed attempts, ${attempts.length} total attempts, ${confirmedRecordCount} confirmed dispatch records) -- inspect this node's dispatchAttempts/dispatchRecords directly.`
  }
}

// Node-wide operator surface: every taskFingerprint currently sitting in
// AMBIGUOUS_REQUIRES_RECONCILIATION, for a human to check against the
// provider's own dashboard before any further dispatch action is taken.
export function listUnresolvedDispatchAmbiguities(node) {
  const taskFingerprints = [...new Set((node.dispatchAttempts ?? []).map((a) => a.taskFingerprint))]
  return taskFingerprints.map((tf) => classifyDispatchDeliveryGuarantee(node, tf)).filter((c) => c?.guarantee === 'AMBIGUOUS_REQUIRES_RECONCILIATION')
}
