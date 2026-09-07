// Durable append-only store for TSF_SELF_IMPROVEMENT_RECEIPT_V1 chains,
// keyed by missionId. Mirrors self-improvement-finding-store.mjs's
// cross-process-file-lock + data-store.mjs opState convention exactly.
// No dedicated schema-version guard entry (research-schema-versioning.mjs)
// -- same precedent as cleanup-request-store.mjs's own nested receipts[]:
// an append-only audit trail, not an independently top-level-mutated
// record a caller could load expecting one fixed shape; each receipt
// self-labels its own schemaVersion already (self-improvement-receipt-
// chain.mjs's createSelfImprovementReceipt).
import { withFileLock } from './cross-process-file-lock.mjs'
import { appendSelfImprovementReceipt } from '../domain/self-improvement-receipt-chain.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.self-improvement-receipt.lock`
}

export function readReceipts(missionId) {
  return loadState().selfImprovementReceipts?.[missionId] ?? []
}

export async function recordSelfImprovementReceipt(missionId, input, clock) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = opState.selfImprovementReceipts?.[missionId] ?? []
    const next = appendSelfImprovementReceipt(current, input, clock)
    saveState({ ...opState, selfImprovementReceipts: { ...opState.selfImprovementReceipts, [missionId]: next } })
    return next
  })
}
