// Native Self-Improvement Loop V1, Phase 7: the autonomous driver. ONE
// bounded action per tick (research-autonomy-policy.mjs's own discipline,
// REUSE_PATTERN) over ONE actionable finding, in stable declared order --
// never a whole-fleet pass in one tick. The interval/fire/inProgress/unref
// shape below mirrors keep-going-fleet-driver.mjs's startKeepGoingFleetDriver
// exactly (REUSE_PATTERN).
import { readAllFindings } from './self-improvement-finding-store.mjs'
import { computeRepairMissionId, originateRepairMission } from './self-improvement-mission-origination.mjs'
import { runRepairAttempt } from './self-improvement-repair-cycle.mjs'
import { attemptRepairAdoption } from './self-improvement-adoption.mjs'
import { runRedogfood } from './self-improvement-redogfood.mjs'
import { readPlannerMissionRecord } from './planner-mission-store.mjs'
import { recordVerifiedCorrectionLesson, recordVerifierFailureLesson } from './self-improvement-learning-ledger-wiring.mjs'

const ACTIONABLE_STATUSES = Object.freeze(['ELIGIBLE_FOR_AUTOFIX', 'FIX_MISSION_CREATED', 'FIX_IN_PROGRESS', 'READY_FOR_ADOPTION'])

// Stable declared order (findingId, content-addressed and thus already
// deterministic) -- never object-iteration-order-dependent, matching
// research-autonomy-policy.mjs's own "scanned in stable declared order"
// discipline.
export function pickOneActionableFinding(findingsById) {
  const candidates = Object.values(findingsById)
    .filter((f) => ACTIONABLE_STATUSES.includes(f.status))
    .sort((a, b) => a.findingId.localeCompare(b.findingId))
  return candidates[0] ?? null
}

function latestPassingVerification(checkpoint) {
  return (checkpoint?.verifierResults ?? []).toReversed().find((r) => r.verdict === 'VERIFIED_PASS') ?? null
}

// One bounded action for ONE finding -- the unit of work a tick performs.
export async function advanceOneFinding(finding, { canonicalRepoPath, clock = () => new Date(), deps = {} }) {
  if (finding.status === 'ELIGIBLE_FOR_AUTOFIX') {
    const origination = await (deps.originateRepairMission ?? originateRepairMission)(finding, { canonicalRepoPath, clock, deps: deps.originationDeps ?? {} })
    return { action: 'ORIGINATED', findingId: finding.findingId, missionId: origination.missionId, created: origination.created }
  }

  const missionId = computeRepairMissionId(finding.findingId)

  if (finding.status === 'FIX_MISSION_CREATED' || finding.status === 'FIX_IN_PROGRESS') {
    const attempt = await (deps.runRepairAttempt ?? runRepairAttempt)({ finding, missionId, canonicalRepoPath, clock, deps: deps.repairCycleDeps ?? {} })
    if (attempt.verification?.verdict === 'VERIFIED_FAIL') {
      await (deps.recordVerifierFailureLesson ?? recordVerifierFailureLesson)(finding, missionId, attempt.verification, clock, deps.learningLedgerDeps ?? {})
    }
    return { action: 'REPAIR_ATTEMPT', findingId: finding.findingId, missionId, outcome: attempt.outcome }
  }

  // READY_FOR_ADOPTION: attempt the gated adoption, then redogfood --
  // against canonical if adopted, against the candidate worktree
  // otherwise (Phase 6's "after adoption OR reaching READY_FOR_ADOPTION").
  const readRecord = deps.readPlannerMissionRecord ?? readPlannerMissionRecord
  const checkpoint = readRecord(missionId)?.checkpoint
  const passing = latestPassingVerification(checkpoint)
  if (!passing?.detail?.worktreePath) {
    return { action: 'NOTHING_TO_DO', findingId: finding.findingId, reason: 'READY_FOR_ADOPTION but no recorded passing verification worktree evidence found' }
  }

  const adoption = await (deps.attemptRepairAdoption ?? attemptRepairAdoption)({
    finding,
    missionId,
    worktreePath: passing.detail.worktreePath,
    branch: passing.detail.branch,
    canonicalRepoPath,
    verifierVerdict: passing.verdict,
    deps: deps.adoptionDeps ?? {}
  })

  const runRedogfood_ = deps.runRedogfood ?? runRedogfood
  const redogfood = adoption.adopted
    ? await runRedogfood_({ finding, missionId, targetPath: canonicalRepoPath, adoptedSha: adoption.adoptedHead, clock, deps: deps.redogfoodDeps ?? {} })
    : await runRedogfood_({ finding, missionId, targetPath: passing.detail.worktreePath, clock, deps: deps.redogfoodDeps ?? {} })

  if (redogfood.outcome === 'RESOLVED') {
    await (deps.recordVerifiedCorrectionLesson ?? recordVerifiedCorrectionLesson)(redogfood.finding ?? finding, missionId, clock, deps.learningLedgerDeps ?? {})
  }

  return { action: 'ADOPTION_ATTEMPTED', findingId: finding.findingId, missionId, adopted: adoption.adopted, adoptionReason: adoption.reason ?? null, redogfoodOutcome: redogfood.outcome }
}

const DEFAULT_TICK_INTERVAL_MS = 60 * 1000

// Same startX/fire/inProgress/unref shape as startKeepGoingFleetDriver --
// gated entirely by the caller (self-improvement-fleet-driver-
// bootstrap.mjs's TSF_SELF_IMPROVEMENT_LOOP_ENABLED check), never by this
// function itself.
export function startSelfImprovementFleetDriver({ canonicalRepoPath, readFindings = readAllFindings, clock = () => new Date(), intervalMs = DEFAULT_TICK_INTERVAL_MS, onCycle = () => {}, onError = () => {}, deps = {} }) {
  let stopped = false
  let inProgress = false
  async function fire() {
    if (stopped || inProgress) { return }
    inProgress = true
    try {
      const finding = pickOneActionableFinding(readFindings())
      const result = finding ? await advanceOneFinding(finding, { canonicalRepoPath, clock, deps }) : { action: 'NOTHING_TO_DO', reason: 'no actionable finding' }
      onCycle(result)
    } catch (error) {
      onError(error)
    } finally {
      inProgress = false
    }
  }
  const timer = setInterval(fire, intervalMs)
  timer.unref?.()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
    fireNow: fire
  }
}
