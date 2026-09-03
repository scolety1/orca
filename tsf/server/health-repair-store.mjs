// Compare-and-swap over one Health Repair operation -- same pattern, same
// shared lock file, as prepare-for-work-store.mjs (see that file's own
// header for the full concurrency argument: sharing the lock path
// serializes EVERY locked writer to operator-state.json against every
// other one, not just against other health-repair writes). BUG-05
// (bug-ledger.json).
import { randomUUID } from 'node:crypto'
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.lock`
}

export function newHealthRepairOperationId() {
  return `hr-${randomUUID()}`
}

// Read-only snapshot -- safe to call freely, matches
// readPrepareForWorkOperation's own no-lock-needed reasoning for a cheap
// upfront read.
export function readHealthRepairOperation(operationId) {
  return loadState().healthRepairOperations?.[operationId] ?? null
}

export function listHealthRepairOperations() {
  return Object.values(loadState().healthRepairOperations ?? {})
}

// mutateFn(current) must be synchronous and pure, same constraint as
// withPrepareForWorkOperation's own mutateFn: given the just-loaded
// operation (or null if none exists yet), return the next operation. No
// `await` inside it or between the load and save, or the atomicity this
// exists for is lost.
export async function withHealthRepairOperation(operationId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = opState.healthRepairOperations?.[operationId] ?? null
    const next = mutateFn(current)
    const nextOpState = {
      ...opState,
      healthRepairOperations: { ...opState.healthRepairOperations, [operationId]: next }
    }
    saveState(nextOpState)
    return next
  })
}
