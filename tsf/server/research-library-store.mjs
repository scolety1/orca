// Compare-and-swap over the single, durable cross-mission research library.
// Mirrors research-mission-store.mjs's withResearchMission exactly -- same
// cross-process file lock, same synchronous-critical-section constraint
// (mutateFn must be pure and synchronous, no `await` inside it or between
// the load and save). The library is a singleton (not keyed by missionId),
// but uses its OWN lock file so a busy research-mission write never blocks
// a library read/write or vice versa.
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.research-library.lock`
}

export function readResearchLibrary() {
  return loadState().researchLibrary
}

// mutateFn(current) must be synchronous and pure: given the just-loaded
// library (or null if it has never been used before -- the caller is
// responsible for calling createResearchLibrary(clock) in that case,
// exactly like withResearchMission's mutateFn(null) convention), return the
// next library, or throw to abort -- nothing is persisted if it throws.
export async function withResearchLibrary(mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const next = mutateFn(opState.researchLibrary)
    saveState({ ...opState, researchLibrary: next })
    return next
  })
}
