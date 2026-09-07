// Hash-chained receipts for the cleanup lifecycle. REUSE_PATTERN from
// domain/receipts.mjs (same canonicalJson + sha256 + previousReceiptHash
// chain shape) but deliberately NOT built on createReceipt/TSF_RECEIPT_KINDS
// directly: that module's shape is keyed by {projectId, missionId} and its
// kind list is a closed enum for TSF mission events -- a cleanup request has
// no missionId of its own (it may reference zero or one active mission, as
// a BLOCKER, not an owner) and needs kinds (PLAN_BLOCKED, QUARANTINED,
// RESTORED, PARTIAL_FAILURE_RECOVERED) that don't belong in that enum.
// Reusing it directly would mean fabricating a fake missionId for every
// cleanup receipt or widening a shared enum for a different domain -- a
// small, clearly-scoped sibling using the same proven chain algorithm is
// the smaller reuse, matching the precedent set by planner-mission-
// lease.mjs's own reasoning for not reusing resource-pressure-governor.mjs's
// lease.
import { isoNow, sha256 } from './canonical.mjs'

export const CLEANUP_RECEIPT_KINDS = Object.freeze([
  'RECOMMENDATION_ISSUED',
  'PLAN_BUILT',
  'PLAN_BLOCKED',
  'AUTHORIZATION_GRANTED',
  'AUTHORIZATION_REFUSED',
  'EXECUTION_STARTED',
  'EXECUTION_STEP',
  'EXECUTION_COMPLETED',
  'EXECUTION_FAILED',
  'PARTIAL_FAILURE_RECOVERED',
  'ARTIFACT_QUARANTINED',
  'ARTIFACT_RESTORED',
  'IDEMPOTENT_REPLAY'
])

export function createCleanupReceipt(input, { previousReceiptHash = null, clock } = {}) {
  if (!CLEANUP_RECEIPT_KINDS.includes(input.kind)) {
    throw new Error(`unsupported cleanup receipt kind: ${input.kind}`)
  }
  if (!input.requestId) {
    throw new Error('cleanup receipt requires requestId')
  }
  const body = {
    schemaVersion: 'TSF_CLEANUP_RECEIPT_V1',
    kind: input.kind,
    requestId: input.requestId,
    actionClass: input.actionClass ?? null,
    stageId: input.stageId ?? null, // recommendationId | planId | authorizationId | executionId
    detail: input.detail ?? null,
    previousReceiptHash,
    timestamp: isoNow(clock)
  }
  return { ...body, receiptHash: sha256(body) }
}

export function verifyCleanupReceipt(receipt) {
  const { receiptHash, ...body } = receipt
  return typeof receiptHash === 'string' && receiptHash === sha256(body)
}

// Verifies an entire chain is internally consistent: each entry's own hash
// is correct AND its previousReceiptHash matches the prior entry's hash
// (or null for the first). Returns the index of the first break, or -1 if
// the whole chain verifies clean -- never silently ignores a broken link.
export function verifyCleanupReceiptChain(receipts) {
  let expectedPrevious = null
  for (let i = 0; i < receipts.length; i += 1) {
    const receipt = receipts[i]
    if (!verifyCleanupReceipt(receipt) || receipt.previousReceiptHash !== expectedPrevious) {
      return i
    }
    expectedPrevious = receipt.receiptHash
  }
  return -1
}

export function appendCleanupReceipt(existingReceipts, input, clock) {
  const previousReceiptHash = existingReceipts.length ? existingReceipts.at(-1).receiptHash : null
  const receipt = createCleanupReceipt(input, { previousReceiptHash, clock })
  return [...existingReceipts, receipt]
}
