// Native Self-Improvement Loop V1, Phase 3: mission origination from an
// ELIGIBLE_FOR_AUTOFIX finding. Reuses PlannerSessionLifecycle as the
// mission vehicle DIRECTLY (mission brief's own explicit, non-negotiable
// design decision) -- no second mission/lease/checkpoint system.
//
// Dedup: missionId is a DETERMINISTIC, content-addressed function of
// findingId (the exact same discipline self-improvement-finding.mjs's own
// findingIdFor already established for findings) -- the SAME finding
// always resolves to the SAME missionId, so a real 1:1 findingId ->
// missionId mapping falls out of construction rather than needing a
// second durable lookup table that could drift from the finding it
// describes. Calling origination twice for the same still-open finding
// reads the existing planner-mission-store record and returns it,
// idempotent by construction (never a second PlannerSessionLifecycle
// mission for one finding).
import { PlannerSessionLifecycle } from './planner-session-lifecycle.mjs'
import { readPlannerMissionRecord } from './planner-mission-store.mjs'
import { transitionFinding } from '../domain/self-improvement-finding.mjs'
import { assertScopeDoesNotOverlapForbidden, buildAuthorityEnvelope } from '../domain/self-improvement-authority-envelope.mjs'
import { observeCanonicalRepoState } from './planner-mission-repo-state.mjs'
import { withFinding } from './self-improvement-finding-store.mjs'
import { recordSelfImprovementReceipt } from './self-improvement-receipt-store.mjs'

export function computeRepairMissionId(findingId) {
  return `mission:selfimprove:${findingId.replace(/^finding:/, '')}`
}

// The authority envelope is deliberately NEVER persisted as its own
// artifact -- buildAuthorityEnvelope is a pure, deterministic function of
// the finding record + missionId, so any caller who holds the finding
// reconstructs the byte-identical envelope on demand. Persisting a second
// copy would risk it silently drifting from the finding it describes; this
// avoids that second source of truth entirely.
export async function originateRepairMission(finding, { canonicalRepoPath, clock = () => new Date(), deps = {} } = {}) {
  if (finding.status !== 'ELIGIBLE_FOR_AUTOFIX') {
    const error = new Error(`repair mission origination requires an ELIGIBLE_FOR_AUTOFIX finding, got ${finding.status}`)
    error.code = 'TSF_SELF_IMPROVEMENT_ORIGINATION_REQUIRES_ELIGIBLE'
    throw error
  }
  const missionId = computeRepairMissionId(finding.findingId)
  const readRecord = deps.readPlannerMissionRecord ?? readPlannerMissionRecord
  const existing = readRecord(missionId)
  if (existing?.checkpoint) {
    return { created: false, missionId, checkpoint: existing.checkpoint }
  }

  const envelope = buildAuthorityEnvelope(finding, missionId)
  assertScopeDoesNotOverlapForbidden(envelope)

  const observeRepoState = deps.observeRepoState ?? observeCanonicalRepoState
  const repoState = observeRepoState(canonicalRepoPath)
  if (!repoState) {
    const error = new Error(`cannot originate a repair mission: canonical repo state at ${canonicalRepoPath} is unobservable`)
    error.code = 'TSF_SELF_IMPROVEMENT_REPO_STATE_UNOBSERVABLE'
    throw error
  }

  const Lifecycle = deps.PlannerSessionLifecycle ?? PlannerSessionLifecycle
  const plannerSessionId = deps.plannerSessionId ?? `self-improvement-loop:${missionId}`
  const lifecycle = new Lifecycle({ missionId, plannerSessionId, deps: { clock, ...deps.lifecycleDeps } })
  try {
    await lifecycle.startMission({
      missionGoal: `Repair mission (auto-originated): ${finding.affectedSurface} -- ${finding.sourceDetector} finding ${finding.findingId}`,
      phase: 'REPAIR_DISPATCH',
      repoState
    })
  } catch (error) {
    // A genuine concurrent-origination race (proven: two real calls for the
    // identical finding) can lose the outer existing?.checkpoint pre-check
    // above and still reach here -- startMission's OWN atomic re-check
    // (planner-session-lifecycle.mjs) is what actually closes the race, so
    // the loser sees this specific, expected error rather than a second
    // mission. Handled the same idempotent way as the pre-check: read back
    // whichever checkpoint actually won and return it, never propagate a
    // confusing failure for what is really just "already originated".
    if (error.code === 'TSF_PLANNER_MISSION_ALREADY_STARTED') {
      const raced = readRecord(missionId)
      if (raced?.checkpoint) { return { created: false, missionId, checkpoint: raced.checkpoint } }
    }
    throw error
  }
  await lifecycle.recordDecision({
    summary: `repair mission auto-originated from ELIGIBLE_FOR_AUTOFIX finding ${finding.findingId} (${finding.affectedSurface})`,
    kind: 'ACCEPTED',
    by: 'SELF_IMPROVEMENT_LOOP'
  })

  const writeFinding = deps.withFinding ?? withFinding
  const nextFinding = await writeFinding(finding.findingId, (current) =>
    transitionFinding(current ?? finding, 'FIX_MISSION_CREATED', { reason: 'REPAIR_MISSION_ORIGINATED', evidence: [{ missionId }] }, clock)
  )

  // Real gap found by Wave D's own golden proof: this receipt kind existed
  // in the enum since Wave B but no code path ever wrote one -- the receipt
  // chain's own documented purpose ("links finding -> mission ->
  // implementation sha -> ...") started one hop short of the finding
  // without it.
  const recordReceipt = deps.recordSelfImprovementReceipt ?? recordSelfImprovementReceipt
  await recordReceipt(missionId, { kind: 'MISSION_ORIGINATED', missionId, findingId: finding.findingId, detail: { affectedSurface: finding.affectedSurface } }, clock)

  return { created: true, missionId, checkpoint: lifecycle.getCheckpoint(), envelope, finding: nextFinding }
}
