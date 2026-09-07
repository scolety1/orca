// Native Self-Improvement Loop V1, Phase 6: a hash-chained receipt linking
// finding -> repair mission -> implementation SHA -> verifier result ->
// adoption result -> redogfood result. Deliberately a NEW, small sibling
// module (same decision cleanup-receipt-chain.mjs's own header already
// made and documented) rather than reusing either existing receipt
// primitive directly:
//   - tsf/domain/receipts.mjs requires a non-null `projectId` (throws
//     otherwise) -- but Wave A's finding contract deliberately allows
//     projectId: null for a platform-wide finding (honest-null
//     discipline); forcing a fabricated projectId here would violate that.
//   - tsf/domain/cleanup-receipt-chain.mjs's `createCleanupReceipt`
//     hardcodes CLEANUP_RECEIPT_KINDS, a fixed destructive-action-specific
//     enum with no room for this mechanism's own kinds (MISSION_ORIGINATED,
//     WORKER_DISPATCHED, ...).
// Both share the identical proven algorithm this module reuses exactly:
// sha256(body-without-its-own-hash) chained via a previousReceiptHash
// field pointing at the prior receipt's own hash.
import { isoNow, sha256 } from './canonical.mjs'

export const SELF_IMPROVEMENT_RECEIPT_KINDS = Object.freeze([
  'MISSION_ORIGINATED',
  'WORKER_DISPATCHED',
  'WORKER_RESULT',
  'VERIFIER_RESULT',
  'ADOPTION_DECISION',
  'REDOGFOOD_RESULT',
  'LESSON_RECORDED'
])

export function createSelfImprovementReceipt(input, { previousReceiptHash = null, clock } = {}) {
  if (!SELF_IMPROVEMENT_RECEIPT_KINDS.includes(input?.kind)) {
    throw new Error(`unknown self-improvement receipt kind: ${input?.kind}`)
  }
  if (!input.missionId || !input.findingId) {
    throw new Error('a self-improvement receipt requires missionId and findingId')
  }
  const body = {
    schemaVersion: 'TSF_SELF_IMPROVEMENT_RECEIPT_V1',
    kind: input.kind,
    missionId: input.missionId,
    findingId: input.findingId,
    detail: input.detail ?? null,
    previousReceiptHash,
    timestamp: isoNow(clock)
  }
  return { ...body, receiptHash: sha256(body) }
}

export function verifySelfImprovementReceipt(receipt) {
  const { receiptHash, ...body } = receipt
  return sha256(body) === receiptHash
}

// Walks the chain, returns the index of the first break (bad hash OR a
// previousReceiptHash that doesn't match the prior entry's own hash), or
// -1 when the whole chain verifies clean -- never silently ignores a
// broken link, mirrors verifyCleanupReceiptChain exactly.
export function verifySelfImprovementReceiptChain(receipts) {
  let expectedPrevious = null
  for (let i = 0; i < receipts.length; i += 1) {
    const receipt = receipts[i]
    if (!verifySelfImprovementReceipt(receipt) || receipt.previousReceiptHash !== expectedPrevious) { return i }
    expectedPrevious = receipt.receiptHash
  }
  return -1
}

export function appendSelfImprovementReceipt(existingReceipts, input, clock) {
  const previousReceiptHash = existingReceipts.length > 0 ? existingReceipts.at(-1).receiptHash : null
  return [...existingReceipts, createSelfImprovementReceipt(input, { previousReceiptHash, clock })]
}
