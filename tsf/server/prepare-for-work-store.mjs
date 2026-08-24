// Compare-and-swap over one Prepare-for-Work operation, same pattern and
// same lock file as keep-going-run-store.mjs (see that file's own header
// for the full concurrency argument). Reusing the identical lock path is
// deliberate: it serializes EVERY locked writer to operator-state.json
// against every other one, not just against other prepare-for-work writes
// -- once Prepare for Work runs its own async background work alongside
// normal request handling, a concurrent keep-going tick and a prepare-for-
// work phase update racing the same underlying file becomes a real,
// reachable case that wasn't possible when everything was one synchronous
// request.
import { randomUUID } from 'node:crypto'
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.lock`
}

export function newOperationId() {
  return `pfw-${randomUUID()}`
}

// Read-only snapshot -- safe to call freely, matches readKeepGoingRun's own
// no-lock-needed reasoning for a cheap upfront read.
export function readPrepareForWorkOperation(operationId) {
  return loadState().prepareForWorkOperations?.[operationId] ?? null
}

export function listPrepareForWorkOperations() {
  return Object.values(loadState().prepareForWorkOperations ?? {})
}

// mutateFn(current) must be synchronous and pure, same constraint as
// withKeepGoingRun's own mutateFn: given the just-loaded operation (or null
// if none exists yet), return the next operation. No `await` inside it or
// between the load and save, or the atomicity this exists for is lost.
export async function withPrepareForWorkOperation(operationId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = opState.prepareForWorkOperations?.[operationId] ?? null
    const next = mutateFn(current)
    const nextOpState = {
      ...opState,
      prepareForWorkOperations: { ...opState.prepareForWorkOperations, [operationId]: next }
    }
    saveState(nextOpState)
    return next
  })
}
