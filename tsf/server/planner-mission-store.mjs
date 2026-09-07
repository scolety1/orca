// Durable CAS store for TSF_PLANNER_MISSION_RECORD_V0 { lease, checkpoint },
// keyed by missionId. Mirrors research-mission-store.mjs's withResearchMission
// exactly (REUSE_PATTERN): same cross-process file lock, same synchronous-
// mutateFn constraint, same opState-collection convention -- no second
// durability mechanism invented. Scoped per-worktree via data-store.mjs's
// opState (like researchMissions/keepGoingRuns), NOT host-wide like
// resource-pressure-lease-store.mjs: a planner mission belongs to one
// project/worktree's TSF server, so two planner sessions racing for it are
// two clients of that SAME server process's SAME opState file already --
// unlike heavy-task leases, there is no cross-worktree exclusivity need here.
import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedPlannerMissionCheckpointSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'
import {
  acquirePlannerMissionLease,
  relinquishPlannerMissionLease,
  renewPlannerMissionLease
} from '../domain/planner-mission-lease.mjs'

function lockPath() {
  return `${getStateFilePath()}.planner-mission.lock`
}

// Every read boundary asserts the checkpoint's own schema-version
// compatibility BEFORE the record reaches any caller -- mirrors
// research-mission-store.mjs's researchMissionFor. Fails closed on a
// checkpoint version this running code was never verified against, rather
// than silently operating on an unfamiliar shape. The lease half of the
// record carries no schemaVersion of its own (see
// research-schema-versioning.mjs's own note), so only checkpoint is checked.
function versionCheckedRecord(record) {
  if (record?.checkpoint) { assertSupportedPlannerMissionCheckpointSchemaVersion(record.checkpoint) }
  return record
}

export function readPlannerMissionRecord(missionId) {
  return versionCheckedRecord(loadState().plannerMissions?.[missionId] ?? null)
}

export function readAllPlannerMissionRecords() {
  const records = loadState().plannerMissions ?? {}
  for (const record of Object.values(records)) { versionCheckedRecord(record) }
  return records
}

// mutateFn(current | null) -> next; synchronous, no `await` inside (same
// constraint as withResearchMission's mutateFn).
export async function withPlannerMissionRecord(missionId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = versionCheckedRecord(opState.plannerMissions?.[missionId] ?? null)
    const next = mutateFn(current)
    saveState({ ...opState, plannerMissions: { ...opState.plannerMissions, [missionId]: next } })
    return next
  })
}

// --- Lease operations: thin wraps of the pure domain functions, applied
// atomically under the same lock the checkpoint mutations use, so a lease
// decision and a checkpoint read are never torn against each other.

export async function acquirePlannerLease(missionId, plannerSessionId, clock, { ttlMs, boundary } = {}) {
  let outcome
  await withPlannerMissionRecord(missionId, (current) => {
    const record = current ?? { lease: null, checkpoint: null }
    outcome = acquirePlannerMissionLease(record.lease, { plannerSessionId, ttlMs, boundary }, clock)
    return { ...record, lease: outcome.granted ? outcome.lease : record.lease }
  })
  return outcome
}

export async function renewPlannerLease(missionId, plannerSessionId, clock, { ttlMs } = {}) {
  let outcome
  let renewError = null
  await withPlannerMissionRecord(missionId, (current) => {
    const record = current ?? { lease: null, checkpoint: null }
    try {
      const lease = renewPlannerMissionLease(record.lease, { plannerSessionId, ttlMs }, clock)
      outcome = { renewed: true, lease }
      return { ...record, lease }
    } catch (error) {
      renewError = error
      return record
    }
  })
  if (renewError) { throw renewError }
  return outcome
}

export async function relinquishPlannerLease(missionId, plannerSessionId, clock) {
  let outcome
  await withPlannerMissionRecord(missionId, (current) => {
    const record = current ?? { lease: null, checkpoint: null }
    outcome = relinquishPlannerMissionLease(record.lease, { plannerSessionId }, clock)
    return { ...record, lease: outcome.released ? null : record.lease }
  })
  return outcome
}

// --- Checkpoint operations: apply a pure domain mutator (from
// planner-mission-checkpoint.mjs) to whatever checkpoint is currently
// durable, atomically. `checkpointMutator(currentCheckpointOrNull, clock)`.

export async function mutateCheckpoint(missionId, checkpointMutator, clock) {
  let nextCheckpoint
  await withPlannerMissionRecord(missionId, (current) => {
    const record = current ?? { lease: null, checkpoint: null }
    nextCheckpoint = checkpointMutator(record.checkpoint, clock)
    return { ...record, checkpoint: nextCheckpoint }
  })
  return nextCheckpoint
}
