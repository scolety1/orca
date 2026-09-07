// Native Self-Improvement Loop V1, Phase 4/5: one bounded repair ATTEMPT
// for an already-originated mission -- dispatch a real bounded worker
// (via PlannerSessionLifecycle.dispatchWorkerForTask, never a second
// dispatch-tracking mechanism), run the real independent verifier, and
// decide retry/escalate/ready-for-adoption. The retry budget bounds
// ATTEMPTS WITHIN one persistent mission (one finding = one mission,
// forever, per self-improvement-mission-origination.mjs's content-
// addressed missionId) rather than spawning a new mission per attempt.
import { PlannerSessionLifecycle } from './planner-session-lifecycle.mjs'
import { readPlannerMissionRecord } from './planner-mission-store.mjs'
import { transitionFinding } from '../domain/self-improvement-finding.mjs'
import { buildAuthorityEnvelope } from '../domain/self-improvement-authority-envelope.mjs'
import { DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET, decideRepairRetryOrEscalate } from '../domain/self-improvement-retry-budget.mjs'
import { dispatchRepairWorker } from './self-improvement-worker-dispatch.mjs'
import { runIndependentVerification } from './self-improvement-verifier-dispatch.mjs'
import { observeCanonicalRepoState } from './planner-mission-repo-state.mjs'
import { withFinding } from './self-improvement-finding-store.mjs'
import { recordSelfImprovementReceipt } from './self-improvement-receipt-store.mjs'

function plannerSessionIdFor(missionId) {
  // Deterministic, stable across every tick of this mission's whole life
  // (REUSE_PATTERN: same "stable id per durable record" discipline the
  // rest of this program uses) -- lets a fresh PlannerSessionLifecycle
  // instance on every call keep mutating the SAME durable lease without
  // ever calling acquireLeaseAndHydrate again (see withLeaseRecovery
  // below for the one real exception: genuine lease expiry).
  return `self-improvement-loop:${missionId}`
}

// _mutate-based methods (recordDecision, dispatchWorkerForTask,
// recordVerifierResult, ...) only need the durable lease to still be live
// and held by this plannerSessionId -- they do NOT require a fresh
// acquireLeaseAndHydrate call, and deliberately avoid one on the common
// path: acquireLeaseAndHydrate re-checks repo-state continuity against
// canonical tsf/main's CURRENT head, which legitimately keeps moving for
// reasons unrelated to this one finding's repair mission over the mission's
// possibly-long life. Re-hydrating is reserved for the one real recovery
// case -- the lease genuinely expired (TTL elapsed between ticks) -- where
// a canonical repo-state drift is a real, surfaced signal an operator
// should see (TSF_PLANNER_REPO_STATE_DRIFT), not silently worked around.
async function withLeaseRecovery(lifecycle, canonicalRepoPath, deps, fn) {
  try {
    return await fn()
  } catch (error) {
    if (error.code !== 'TSF_PLANNER_LEASE_NOT_HELD') { throw error }
    const observeRepoState = deps.observeRepoState ?? observeCanonicalRepoState
    await lifecycle.acquireLeaseAndHydrate({ observedRepoState: observeRepoState(canonicalRepoPath) })
    return fn()
  }
}

// One bounded attempt: budget check -> (dispatch worker -> verify) OR
// escalate. Never loops internally -- a caller (the fleet driver, or a
// test) decides whether/when to call this again, exactly like
// research-autonomy-policy.mjs's "one action per tick" discipline.
export async function runRepairAttempt({ finding, missionId, canonicalRepoPath, clock = () => new Date(), budget = DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET, deps = {} }) {
  const readRecord = deps.readPlannerMissionRecord ?? readPlannerMissionRecord
  const checkpointBefore = readRecord(missionId)?.checkpoint
  if (!checkpointBefore) {
    throw new Error(`no checkpoint exists for mission ${missionId} -- call originateRepairMission first`)
  }

  const attemptsSoFar = checkpointBefore.verifierResults.filter((r) => r.verdict === 'VERIFIED_FAIL').length
  const writeFinding = deps.withFinding ?? withFinding
  const recordReceipt = deps.recordSelfImprovementReceipt ?? recordSelfImprovementReceipt

  const decision = decideRepairRetryOrEscalate(attemptsSoFar, budget, `${attemptsSoFar} verified-fail attempt(s) already recorded`)
  if (decision.type === 'ESCALATE') {
    const nextFinding = await writeFinding(finding.findingId, (current) =>
      transitionFinding(current ?? finding, 'NEEDS_OWNER', { reason: 'REPAIR_RETRY_BUDGET_EXCEEDED', evidence: [{ missionId, attemptsSoFar }] }, clock)
    )
    return { outcome: 'ESCALATED', reason: decision.question, finding: nextFinding }
  }

  const attemptNumber = decision.attemptNumber
  const envelope = buildAuthorityEnvelope(finding, missionId)
  const taskFingerprint = `${missionId}:attempt-${attemptNumber}`

  // dispatchWorker is wired HERE, per attempt, so dispatchRepairWorker
  // (the real bounded launcher) always receives the exact finding/envelope/
  // attemptNumber closed over by this call -- planner-session-lifecycle.mjs
  // itself stays generic and knows nothing about repair-specific args.
  const Lifecycle = deps.PlannerSessionLifecycle ?? PlannerSessionLifecycle
  const plannerSessionId = deps.plannerSessionId ?? plannerSessionIdFor(missionId)
  const dispatchWorker = deps.dispatchWorker ?? (() => dispatchRepairWorker({ finding, envelope, missionId, attemptNumber, canonicalRepoPath, clock, deps: deps.workerDeps ?? {} }))
  const lifecycle = new Lifecycle({ missionId, plannerSessionId, deps: { clock, dispatchWorker, ...deps.lifecycleDeps } })

  const dispatch = await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () =>
    lifecycle.dispatchWorkerForTask({
      taskId: taskFingerprint,
      kind: 'SELF_IMPROVEMENT_REPAIR_WORKER',
      taskFingerprint
    })
  )
  const worker = dispatch.worker
  if (!dispatch.alreadyDispatched) {
    await recordReceipt(missionId, { kind: 'WORKER_DISPATCHED', missionId, findingId: finding.findingId, detail: { attemptNumber, providerId: worker.providerId, worktreePath: worker.worktreePath } }, clock)
  }

  let currentFinding = finding
  if (attemptNumber === 1) {
    await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () => lifecycle.advancePhase('FIX_IN_PROGRESS'))
    currentFinding = await writeFinding(finding.findingId, (current) => transitionFinding(current, 'FIX_IN_PROGRESS', { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED', evidence: [{ missionId }] }, clock))
  }

  await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () =>
    lifecycle.recordWorkerResult(worker.workerId, { status: worker.exitCode === 0 && !worker.timedOut ? 'COMPLETED' : 'FAILED', result: { exitCode: worker.exitCode, timedOut: worker.timedOut } })
  )
  await recordReceipt(missionId, { kind: 'WORKER_RESULT', missionId, findingId: finding.findingId, detail: { attemptNumber, exitCode: worker.exitCode, timedOut: worker.timedOut } }, clock)

  const verify = deps.runIndependentVerification ?? runIndependentVerification
  const verification = await verify({
    finding,
    envelope,
    worktreePath: worker.worktreePath,
    branch: worker.branch,
    baseSha: worker.baseSha,
    canonicalRepoPath,
    workerProviderId: worker.providerId,
    siblingStatusesBefore: worker.siblingStatusesBefore ?? null,
    deps: deps.verifierDeps ?? {}
  })
  await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () =>
    lifecycle.recordVerifierResult({ verifier: 'VERIFIER_INDEPENDENT', verdict: verification.verdict, detail: verification.detail })
  )
  await recordReceipt(missionId, { kind: 'VERIFIER_RESULT', missionId, findingId: finding.findingId, detail: { attemptNumber, verdict: verification.verdict, reasons: verification.reasons } }, clock)

  if (verification.verdict === 'VERIFIED_PASS') {
    const nextFinding = await writeFinding(finding.findingId, (current) =>
      transitionFinding(current ?? currentFinding, 'READY_FOR_ADOPTION', { reason: 'VERIFIER_PASSED', evidence: [{ missionId, attemptNumber }] }, clock)
    )
    return { outcome: 'READY_FOR_ADOPTION', worker, verification, finding: nextFinding }
  }

  // VERIFIED_FAIL: stay FIX_IN_PROGRESS -- the NEXT call to
  // runRepairAttempt re-derives attemptsSoFar from this now-recorded
  // VERIFIED_FAIL and either retries (budget remaining) or escalates.
  return { outcome: 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK', worker, verification, finding: currentFinding }
}
