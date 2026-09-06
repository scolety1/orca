// Compare-and-swap over exactly one completion watch, keyed by watch id.
// Mirrors tsf/server/research-mission-store.mjs's withResearchMission
// exactly -- same cross-process file lock, same synchronous-critical-
// section constraint (mutateFn must be pure and synchronous, no `await`
// inside it or between the load and save), same lock-file-per-store-file
// isolation. No second scheduler/durability mechanism is introduced: this
// is the same data-store.mjs + cross-process-file-lock.mjs primitive TSF
// already uses for keepGoingRuns/researchMissions, applied to a new
// top-level collection.
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.completion-watch.lock`
}

export function readCompletionWatch(id) {
  return loadState().completionWatches?.[id] ?? null
}

export function listCompletionWatches() {
  return Object.values(loadState().completionWatches ?? {})
}

// The one real dedup check: never register a second watch for the same
// (kind, targetId) while an earlier one is still PENDING or FIRED_UNSEEN
// (not yet delivered) -- a repeated "let me know when it's done" must
// confirm the existing watch, never create a duplicate that could
// double-notify later.
export function findActiveCompletionWatch(kind, targetId) {
  return (
    listCompletionWatches().find(
      (w) => w.kind === kind && w.targetId === targetId && w.state !== 'DELIVERED'
    ) ?? null
  )
}

// mutateFn(current) must be synchronous and pure: given the just-loaded
// watch (or null if none exists), return the next watch, or throw to
// abort -- nothing is persisted if it throws.
export async function withCompletionWatch(id, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = opState.completionWatches?.[id] ?? null
    const next = mutateFn(current)
    const nextOpState = {
      ...opState,
      completionWatches: { ...opState.completionWatches, [id]: next }
    }
    saveState(nextOpState)
    return next
  })
}
