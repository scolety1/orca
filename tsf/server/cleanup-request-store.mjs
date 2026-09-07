// Durable CAS store for TSF_CLEANUP_REQUEST_RECORD_V1, keyed by requestId
// (cleanup-lifecycle.mjs's computeCleanupRequestId -- deterministic from
// {actionClass, targetIdentity}, which is what makes a duplicate request
// collapse onto the SAME record instead of creating a second one).
// REUSE_PATTERN from planner-mission-store.mjs: identical withFileLock +
// data-store.mjs opState CAS shape, applied to the new `cleanupRequests`
// top-level collection.
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.cleanup-request.lock`
}

export function readCleanupRequestRecord(requestId) {
  return loadState().cleanupRequests?.[requestId] ?? null
}

export function readAllCleanupRequestRecords() {
  return loadState().cleanupRequests ?? {}
}

// mutateFn(current | null) -> next; synchronous, no `await` inside (same
// hard constraint as every other withFileLock-backed store in this
// codebase -- an await inside would let another process's read interleave
// with this one's not-yet-persisted write, breaking the atomicity the file
// lock exists to provide).
export async function withCleanupRequestRecord(requestId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = opState.cleanupRequests?.[requestId] ?? null
    const next = mutateFn(current)
    saveState({ ...opState, cleanupRequests: { ...opState.cleanupRequests, [requestId]: next } })
    return next
  })
}

function emptyRecord() {
  return { recommendation: null, plan: null, authorization: null, executions: [], receipts: [] }
}

export async function putRecommendation(requestId, recommendation) {
  return withCleanupRequestRecord(requestId, (current) => ({ ...(current ?? emptyRecord()), recommendation }))
}

export async function putPlan(requestId, plan) {
  return withCleanupRequestRecord(requestId, (current) => ({ ...(current ?? emptyRecord()), plan }))
}

export async function putAuthorization(requestId, authorization) {
  return withCleanupRequestRecord(requestId, (current) => ({ ...(current ?? emptyRecord()), authorization }))
}

// Appends (never replaces) -- a request's execution history is a full
// append-only log, including every retried/idempotent-replayed attempt, so
// a reviewer can see exactly what was tried and when, not just the latest.
export async function appendExecution(requestId, execution) {
  return withCleanupRequestRecord(requestId, (current) => {
    const record = current ?? emptyRecord()
    const others = record.executions.filter((e) => e.executionId !== execution.executionId)
    return { ...record, executions: [...others, execution] }
  })
}

export async function appendReceipts(requestId, receipts) {
  return withCleanupRequestRecord(requestId, (current) => {
    const record = current ?? emptyRecord()
    return { ...record, receipts: [...record.receipts, ...receipts] }
  })
}

// The most recent execution record for a request, or null -- what
// runGovernedCleanupAction consults to decide whether a new call is a
// genuine first attempt, a safe idempotent replay of an already-terminal
// execution, or a resumable recovery of one left IN_PROGRESS.
export function latestExecution(record) {
  if (!record?.executions?.length) {
    return null
  }
  return record.executions.at(-1)
}
