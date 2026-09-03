// Compare-and-swap over exactly one research mission, keyed by missionId.
// Mirrors tsf/server/keep-going-run-store.mjs's withKeepGoingRun exactly --
// same cross-process file lock, same synchronous-critical-section
// constraint (mutateFn must be pure and synchronous, no `await` inside it
// or between the load and save), same lock-file-per-store-file isolation.
// No second scheduler/durability mechanism is introduced: this is the same
// data-store.mjs + cross-process-file-lock.mjs primitive TSF already uses
// for keepGoingRuns, applied to a new top-level collection.
import { withFileLock } from './cross-process-file-lock.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.research.lock`
}

export function researchMissionFor(opState, missionId) {
  return opState.researchMissions?.[missionId] ?? null
}

export function readResearchMission(missionId) {
  return researchMissionFor(loadState(), missionId)
}

// mutateFn(current) must be synchronous and pure: given the just-loaded
// mission (or null if none exists), return the next mission, or throw to
// abort -- nothing is persisted if it throws.
export async function withResearchMission(missionId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = researchMissionFor(opState, missionId)
    const next = mutateFn(current)
    const nextOpState = {
      ...opState,
      researchMissions: { ...opState.researchMissions, [missionId]: next }
    }
    saveState(nextOpState)
    return next
  })
}
