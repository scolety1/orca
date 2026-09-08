// Durable CAS store for TSF_PROJECT_EXECUTION_HOLD_V1, keyed by projectId
// (one hold record per project -- release keeps the record, flips status,
// so history is never lost). Mirrors self-improvement-finding-store.mjs
// exactly (REUSE_PATTERN): same cross-process-file-lock.mjs mutex, same
// data-store.mjs opState collection convention, same synchronous-mutateFn
// constraint -- no second durability mechanism invented.
import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedProjectExecutionHoldSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.project-execution-hold.lock`
}

function versionCheckedHold(hold) {
  if (hold) { assertSupportedProjectExecutionHoldSchemaVersion(hold) }
  return hold
}

export function readProjectExecutionHold(projectId) {
  return versionCheckedHold(loadState().projectExecutionHolds?.[projectId] ?? null)
}

export function readAllProjectExecutionHolds() {
  const holds = loadState().projectExecutionHolds ?? {}
  for (const hold of Object.values(holds)) { versionCheckedHold(hold) }
  return holds
}

// mutateFn(current | null) -> next; synchronous, no `await` inside (same
// constraint every other withXxx in this codebase has).
export async function withProjectExecutionHold(projectId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = versionCheckedHold(opState.projectExecutionHolds?.[projectId] ?? null)
    const next = mutateFn(current)
    saveState({
      ...opState,
      projectExecutionHolds: { ...opState.projectExecutionHolds, [projectId]: next }
    })
    return next
  })
}
