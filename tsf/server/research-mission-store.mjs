// Compare-and-swap over exactly one research mission, keyed by missionId.
// Mirrors tsf/server/keep-going-run-store.mjs's withKeepGoingRun exactly --
// same cross-process file lock, same synchronous-critical-section
// constraint (mutateFn must be pure and synchronous, no `await` inside it
// or between the load and save), same lock-file-per-store-file isolation.
// No second scheduler/durability mechanism is introduced: this is the same
// data-store.mjs + cross-process-file-lock.mjs primitive TSF already uses
// for keepGoingRuns, applied to a new top-level collection.
import { withFileLock } from './cross-process-file-lock.mjs'
import { integrityCheckedMission } from '../domain/research-integrity.mjs'
import { assertSupportedResearchMissionSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.research.lock`
}

export function researchMissionFor(opState, missionId) {
  const mission = opState.researchMissions?.[missionId] ?? null
  // Every read boundary asserts schema-version compatibility BEFORE the
  // mission reaches any caller -- see research-schema-versioning.mjs.
  // Fails closed on a version this running code was never verified
  // against, rather than silently operating on an unfamiliar shape.
  if (mission) assertSupportedResearchMissionSchemaVersion(mission)
  return mission
}

export function readResearchMission(missionId) {
  return researchMissionFor(loadState(), missionId)
}

// The integrity-checked read: canonicalFacts lacking valid, consistent
// ReconciliationDecision lineage are excluded from what's treated as
// canonical (never silently deleted from the underlying store -- see
// research-integrity.mjs). Consumption-facing readers (a future UI/export
// endpoint) should call this, not readResearchMission, whenever
// canonicalFacts will be presented as trustworthy. Mutation logic
// (dispatch/admit/verify/reconcile) intentionally keeps using the raw
// readResearchMission/withResearchMission path -- those functions only
// ever construct new, valid CanonicalFacts through the real reconciliation
// path regardless, so filtering would be a no-op there and would need to
// diverge state seen by a mutateFn from state seen by a plain read.
export function readResearchMissionIntegrityChecked(missionId, clock) {
  const mission = readResearchMission(missionId)
  if (!mission) return { mission: null, integrityReport: null }
  return integrityCheckedMission(mission, clock)
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
