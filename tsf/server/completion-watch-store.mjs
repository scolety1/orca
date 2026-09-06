// Compare-and-swap over one completion watch, keyed by watch id. Mirrors
// research-mission-store.mjs's withResearchMission exactly (same file
// lock, same pure/synchronous mutateFn constraint).
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.completion-watch.lock`
}

export function listCompletionWatches() {
  return Object.values(loadState().completionWatches ?? {})
}

// Unlocked read -- fine for an advisory check, but NEVER a safe dedup
// gate on its own; see registerCompletionWatchIfAbsent below for that.
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

// Race-free dedup: the existence check and the create share one lock
// acquisition, so two near-simultaneous requests for the same
// (kind, targetId) can never both register -- the second sees the
// first's watch and reports created:false.
export async function registerCompletionWatchIfAbsent(kind, targetId, buildWatch) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const existing = Object.values(opState.completionWatches ?? {}).find(
      (w) => w.kind === kind && w.targetId === targetId && w.state !== 'DELIVERED'
    )
    if (existing) {
      return { watch: existing, created: false }
    }
    const watch = buildWatch()
    const nextOpState = {
      ...opState,
      completionWatches: { ...opState.completionWatches, [watch.id]: watch }
    }
    saveState(nextOpState)
    return { watch, created: true }
  })
}
