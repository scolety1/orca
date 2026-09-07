// Active-mission protection: real evidence from Phase 2's durable planner-
// mission store, not a guess. A mission whose checkpoint.repoState
// references the candidate's branch or worktreePath BLOCKS the action --
// regardless of whether its lease is currently live -- because a stale/
// expired LEASE only means the planner session directing the mission went
// away; the MISSION itself (missionState) can still be ACTIVE, i.e.
// "sleeping", not complete. This is the concrete enforcement of the
// program's own mantra: "Sleep != complete."
import { readAllPlannerMissionRecords } from './planner-mission-store.mjs'

function normalize(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/\/+$/, '')
}

// Returns { referenced: true|false, referencingMissions: [...] } -- always
// resolvable (never null), because the durable store is always genuinely
// queryable; this is real evidence, unlike external session liveness.
export function checkActiveMissionReference({ branch, worktreePath }) {
  const records = readAllPlannerMissionRecords()
  const targetBranch = branch ? String(branch) : null
  const targetPath = worktreePath ? normalize(worktreePath).toLowerCase() : null
  const referencingMissions = []

  for (const [missionId, record] of Object.entries(records)) {
    const checkpoint = record?.checkpoint
    if (!checkpoint || checkpoint.missionState === 'COMPLETE') {
      continue
    }
    const repoState = checkpoint.repoState ?? {}
    const branchMatches = targetBranch && repoState.branch === targetBranch
    const pathMatches =
      targetPath && repoState.worktreePath && normalize(repoState.worktreePath).toLowerCase() === targetPath
    if (branchMatches || pathMatches) {
      referencingMissions.push({ missionId, missionState: checkpoint.missionState, matchedOn: branchMatches ? 'branch' : 'worktreePath' })
    }
  }

  return { referenced: referencingMissions.length > 0, referencingMissions }
}
