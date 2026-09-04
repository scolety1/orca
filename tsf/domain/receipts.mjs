import { canonicalJson, isoNow, sha256 } from './canonical.mjs'

export const TSF_RECEIPT_KINDS = Object.freeze([
  'MISSION_CREATED',
  'CANDIDATE_FINISHED',
  'VERIFIER_RESULT',
  'ADOPTION_DECISION',
  'RELEASE_PROMOTION',
  'HUMAN_CONSEQUENTIAL_APPROVAL',
  'PROJECT_ONBOARDED',
  // TSF DATASET + DEEP RESEARCH V0 Implementation Wave 1: wraps a research
  // mission's provenance/reproducibility export package in the same
  // hash-chained receipt mechanism used for every other TSF audit artifact
  // (research-provenance.mjs), rather than a second, parallel hash-chain
  // implementation.
  'RESEARCH_PROVENANCE_EXPORT'
])

export function createReceipt(input, { previousReceiptHash = null, clock } = {}) {
  if (!TSF_RECEIPT_KINDS.includes(input.kind)) throw new Error(`unsupported receipt kind: ${input.kind}`)
  if (!input.projectId || !input.missionId) throw new Error('receipt projectId and missionId are required')
  const body = {
    schemaVersion: 'TSF_RECEIPT_LITE_V1',
    kind: input.kind,
    projectId: input.projectId,
    missionId: input.missionId,
    orca: {
      sessionId: input.orca?.sessionId ?? null,
      worktreeId: input.orca?.worktreeId ?? null,
      worktreePath: input.orca?.worktreePath ?? null
    },
    execution: {
      role: input.execution?.role ?? null,
      providerId: input.execution?.providerId ?? null,
      agentId: input.execution?.agentId ?? null,
      modelObserved: input.execution?.modelObserved ?? null
    },
    result: input.result ?? null,
    tests: input.tests ?? [],
    decision: input.decision ?? null,
    identities: input.identities ?? {},
    previousReceiptHash,
    timestamp: isoNow(clock)
  }
  return { ...body, receiptHash: sha256(body) }
}

export function verifyReceipt(receipt) {
  const { receiptHash, ...body } = receipt
  return typeof receiptHash === 'string' && receiptHash === sha256(body)
}

export function receiptNdjson(receipts) {
  return receipts.map((receipt) => canonicalJson(receipt)).join('\n') + (receipts.length ? '\n' : '')
}
