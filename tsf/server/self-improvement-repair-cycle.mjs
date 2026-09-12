// Native Self-Improvement Loop V1, Phase 4/5: one bounded repair ATTEMPT
// for an already-originated mission -- dispatch a real bounded worker
// (via PlannerSessionLifecycle.dispatchWorkerForTask, never a second
// dispatch-tracking mechanism), run the real independent verifier, and
// decide retry/escalate/ready-for-adoption. The retry budget bounds
// ATTEMPTS WITHIN one persistent mission (one finding = one mission,
// forever, per self-improvement-mission-origination.mjs's content-
// addressed missionId) rather than spawning a new mission per attempt.
import { PlannerSessionLifecycle } from './planner-session-lifecycle.mjs'
import { readPlannerMissionRecord, withPlannerMissionRecord } from './planner-mission-store.mjs'
import { recordResourceState } from '../domain/planner-mission-checkpoint.mjs'
import { transitionFinding } from '../domain/self-improvement-finding.mjs'
import { buildAuthorityEnvelope } from '../domain/self-improvement-authority-envelope.mjs'
import {
  DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET,
  decideRepairRetryOrEscalate
} from '../domain/self-improvement-retry-budget.mjs'
import {
  deriveRepairAttemptBranch,
  deriveRepairAttemptWorktreePath,
  dispatchRepairWorker
} from './self-improvement-worker-dispatch.mjs'
import { currentHeadSha } from './self-improvement-worktree.mjs'
import { runIndependentVerification } from './self-improvement-verifier-dispatch.mjs'
import { observeCanonicalRepoState } from './planner-mission-repo-state.mjs'
import { withFinding } from './self-improvement-finding-store.mjs'
import { recordSelfImprovementReceipt } from './self-improvement-receipt-store.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'
import { isProjectExecutionHoldActive } from '../domain/project-execution-hold.mjs'

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
    if (error.code !== 'TSF_PLANNER_LEASE_NOT_HELD') {
      throw error
    }
    const observeRepoState = deps.observeRepoState ?? observeCanonicalRepoState
    await lifecycle.acquireLeaseAndHydrate({
      observedRepoState: observeRepoState(canonicalRepoPath)
    })
    return fn()
  }
}

// One bounded attempt: budget check -> (dispatch worker -> verify) OR
// escalate. Never loops internally -- a caller (the fleet driver, or a
// test) decides whether/when to call this again, exactly like
// research-autonomy-policy.mjs's "one action per tick" discipline.
export async function runRepairAttempt({
  finding,
  missionId,
  canonicalRepoPath,
  clock = () => new Date(),
  budget = DEFAULT_SELF_IMPROVEMENT_RETRY_BUDGET,
  deps = {}
}) {
  const readRecord = deps.readPlannerMissionRecord ?? readPlannerMissionRecord
  const checkpointBefore = readRecord(missionId)?.checkpoint
  if (!checkpointBefore) {
    throw new Error(
      `no checkpoint exists for mission ${missionId} -- call originateRepairMission first`
    )
  }

  // TSF Reconcile & Upgrade Protocol V1, Lane 4 self-dogfood fix: a real,
  // confirmed gap -- this was the one dispatch path in the whole program
  // with zero project-execution-hold awareness (keep-going-dispatch-
  // loop.mjs's dispatchStep and self-improvement-adoption.mjs's own
  // attemptRepairAdoption both already gate on it; this repair-attempt
  // path never did). Checked FIRST, before the retry/escalate decision --
  // a hold must block a fresh worker dispatch outright, never consume
  // retry budget or force an unwanted NEEDS_OWNER escalation. Mirrors
  // keep-going-dispatch-loop.mjs's own convention (`DISPATCH_BLOCKED_BY_
  // HOLD`, nothing durable mutated).
  //
  // Adversarial-review finding (P1, reproduced by tracing the real code):
  // this comment originally claimed a single early check was sufficient
  // because "nothing awaited happens between this read and the real
  // dispatch call below" -- that was wrong. `lifecycle.
  // dispatchWorkerForTask` (planner-session-lifecycle.mjs) itself awaits
  // a real cross-process file-lock + disk mutate (`recordDispatchAttempt`)
  // BEFORE it calls the real `dispatchWorker`, so a hold set during that
  // window would still be silently bypassed by a single early check. A
  // second, fresh check now runs immediately before that call too,
  // mirroring self-improvement-adoption.mjs's own established double-
  // check pattern (initial + fresh-right-before-the-real-action) --
  // narrowing the race to dispatchWorkerForTask's own internal mutate
  // window, the smallest window reachable without modifying that shared,
  // generic, multi-mission-type primitive itself (a bigger, riskier
  // change, already recorded as a separate architectural finding).
  async function refuseIfHoldActive() {
    if (!finding.projectId) {
      return null
    }
    const readHold = deps.readProjectExecutionHold ?? readProjectExecutionHold
    const hold = readHold(finding.projectId)
    if (!isProjectExecutionHoldActive(hold)) {
      return null
    }
    return {
      outcome: 'BLOCKED_BY_PROJECT_EXECUTION_HOLD',
      reason: `project execution hold active -- ${hold.reason}${hold.note ? `: ${hold.note}` : ''} (set by ${hold.setBy})`,
      finding
    }
  }
  const earlyHoldBlock = await refuseIfHoldActive()
  if (earlyHoldBlock) {
    return earlyHoldBlock
  }

  // Independent-adversarial-review finding (P1, real, reproduced with the
  // real planner store + lifecycle under a deliberately adversarial
  // interleaving): clearing a stale resourceState marker via a SEPARATE
  // "read current, check truthy, then write" pair -- rather than deciding
  // INSIDE the single lock-protected mutator callback -- left a real
  // window where a genuinely newer, real dispatch/verification write
  // could land, and THEN an older, slower in-flight resource-refusal
  // write (from a separate, concurrent runRepairAttempt call for the SAME
  // mission) could still land afterward, re-introducing a false marker
  // the newer progress had already superseded. A single atomic
  // read-decide-write, all inside one `withPlannerMissionRecord`
  // callback, closes that specific outer-read/inner-write gap. This does
  // NOT by itself make two genuinely concurrent runRepairAttempt calls
  // for the same mission perfectly race-free in every interleaving (an
  // older refusal's own write could still, in principle, commit AFTER a
  // newer real one under sufficiently adversarial timing) -- but the one
  // real production caller (self-improvement-fleet-driver.mjs's `fire()`)
  // already guards against exactly that with its own `inProgress` flag,
  // so two overlapping ticks for the same mission are not reachable
  // through the real, current production path today. Documented here,
  // not chased further, matching this mission's own established
  // "architectural finding for a future cycle, not fixed given broader
  // blast radius" precedent (see dispatchWorkerForTask's own hold-
  // awareness finding) -- a generation-counter or similar mechanism would
  // be needed to close it completely, and that's a bigger, riskier change
  // to the shared checkpoint schema than this bounded fix's own scope.
  async function clearStaleResourceMarker() {
    const writeRecord = deps.withPlannerMissionRecord ?? withPlannerMissionRecord
    await writeRecord(missionId, (current) => {
      if (!current.checkpoint?.resourceState) {
        return current
      }
      return { ...current, checkpoint: recordResourceState(current.checkpoint, null, clock) }
    })
  }

  const attemptsSoFar = checkpointBefore.verifierResults.filter(
    (r) => r.verdict === 'VERIFIED_FAIL'
  ).length
  const writeFinding = deps.withFinding ?? withFinding
  const recordReceipt = deps.recordSelfImprovementReceipt ?? recordSelfImprovementReceipt

  const decision = decideRepairRetryOrEscalate(
    attemptsSoFar,
    budget,
    `${attemptsSoFar} verified-fail attempt(s) already recorded`
  )
  if (decision.type === 'ESCALATE') {
    const nextFinding = await writeFinding(finding.findingId, (current) =>
      transitionFinding(
        current ?? finding,
        'NEEDS_OWNER',
        { reason: 'REPAIR_RETRY_BUDGET_EXCEEDED', evidence: [{ missionId, attemptsSoFar }] },
        clock
      )
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
  //
  // REAL BUG (Wave D golden-proof, first real end-to-end run): dispatchWorker's
  // full return value (worktreePath/branch/baseSha/siblingStatusesBefore) is
  // NEVER what dispatchWorkerForTask hands back -- registerDispatchedWorker
  // (planner-mission-checkpoint.mjs, a generic, domain-agnostic primitive
  // shared with every OTHER mission type) only persists a FIXED worker
  // schema (workerId/kind/taskFingerprint/providerId/agentId/status/...);
  // every self-improvement-specific extra field is silently dropped on the
  // round trip through the durable checkpoint. `dispatch.worker.worktreePath`
  // was therefore always undefined below -- Wave B/C's own tests never
  // caught this because every one of them injects a FAKE
  // deps.runIndependentVerification that ignores its worktreePath argument
  // entirely, never exercising the real default. Fixed WITHOUT touching the
  // shared generic checkpoint schema (used by other mission types too):
  // worktreePath/branch are DETERMINISTICALLY RE-DERIVED from
  // (canonicalRepoPath, missionId, attemptNumber) via the SAME exported
  // helper dispatchRepairWorker itself uses (single source of truth, safe
  // whether this is a live dispatch or a resumed/rolled-over one, since
  // attemptNumber is itself derived identically both times); baseSha is
  // re-read directly from the still-on-disk worktree. siblingStatusesBefore
  // is captured via this closure for the live-dispatch case only (it is a
  // point-in-time snapshot with no deterministic re-derivation) --
  // gracefully null on a resumed call, matching the verifier's own already-
  // documented "no before snapshot -> skip this check" degradation.
  const Lifecycle = deps.PlannerSessionLifecycle ?? PlannerSessionLifecycle
  const plannerSessionId = deps.plannerSessionId ?? plannerSessionIdFor(missionId)
  let liveDispatchSiblingSnapshot = null
  const dispatchWorkerImpl =
    deps.dispatchWorker ??
    (async () => {
      const result = await dispatchRepairWorker({
        finding,
        envelope,
        missionId,
        attemptNumber,
        canonicalRepoPath,
        clock,
        deps: deps.workerDeps ?? {}
      })
      liveDispatchSiblingSnapshot = result.siblingStatusesBefore ?? null
      return result
    })
  // Fresh re-check wrapped AROUND the real dispatch, not merely placed
  // before calling dispatchWorkerForTask (that would be separated from
  // the check above by only synchronous code -- zero real wall-clock
  // narrowing, since JS never yields to the event loop across
  // synchronous statements). `dispatchWorkerForTask` (planner-session-
  // lifecycle.mjs) awaits its own internal cross-process file-lock
  // mutate BEFORE calling this function -- this check runs immediately
  // after that real await, right before the real dispatch, genuinely
  // narrowing the race to the smallest window reachable without editing
  // that shared, generic, multi-mission-type primitive itself.
  const dispatchWorker = async (...args) => {
    const freshHoldBlock = await refuseIfHoldActive()
    if (freshHoldBlock) {
      const error = new Error(
        'project execution hold detected immediately before the real dispatch'
      )
      error.code = 'TSF_SELF_IMPROVEMENT_HOLD_DETECTED_AT_DISPATCH'
      error.holdBlock = freshHoldBlock
      throw error
    }
    return dispatchWorkerImpl(...args)
  }
  const lifecycle = new Lifecycle({
    missionId,
    plannerSessionId,
    deps: { clock, dispatchWorker, ...deps.lifecycleDeps }
  })

  let dispatch
  try {
    dispatch = await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () =>
      lifecycle.dispatchWorkerForTask({
        taskId: taskFingerprint,
        kind: 'SELF_IMPROVEMENT_REPAIR_WORKER',
        taskFingerprint
      })
    )
  } catch (error) {
    if (error.code === 'TSF_SELF_IMPROVEMENT_HOLD_DETECTED_AT_DISPATCH') {
      return error.holdBlock
    }
    if (error.code === 'TSF_SELF_IMPROVEMENT_DISPATCH_BLOCKED_BY_RESOURCE_PRESSURE') {
      // Archaeology found this refusal escaped uncaught, leaving no mission-
      // specific checkpoint or owner-facing explanation for the wait.
      //
      // Director review fix: the first draft built the new checkpoint from
      // the STALE `checkpointBefore` (read at the very top of this
      // function, before this attempt's own dispatch bookkeeping), not the
      // FRESH `current` this callback receives -- silently discarding the
      // two real, already-durably-written `_mutate` calls
      // dispatchWorkerForTask's own catch already made just before this
      // error reached here (recordDispatchAttempt's UNKNOWN, then
      // resolveDispatchAttempt's real FAILED_CLEAN resolution -- see that
      // method, planner-session-lifecycle.mjs). Reverting real, persisted
      // bookkeeping this way -- even bookkeeping this path doesn't itself
      // depend on for correctness -- violates this codebase's own
      // durable-record discipline (never silently erase real history).
      // Building on `current.checkpoint` instead preserves that real
      // dispatch-attempt entry while still recording the new resource
      // state on top of it.
      const writeRecord = deps.withPlannerMissionRecord ?? withPlannerMissionRecord
      const observedAt = clock().toISOString()
      await writeRecord(missionId, (current) => ({
        ...current,
        checkpoint: recordResourceState(
          current.checkpoint,
          { tier: error.tier, reason: error.reason, observedAt },
          clock
        )
      }))
      return {
        outcome: 'BLOCKED_BY_RESOURCE_PRESSURE',
        reason: `repair worker is waiting for resources at tier ${error.tier}: ${error.reason}`,
        tier: error.tier,
        finding
      }
    }
    // Independent-adversarial-review finding (P1, real, reproduced): a
    // stale resourceState marker from an earlier BLOCKED_BY_RESOURCE_
    // PRESSURE attempt was previously only cleared on the SUCCESS path
    // below -- any OTHER real dispatch error (provider resolution
    // failure, worktree creation failure, etc.) reaching THIS re-throw
    // still left the old marker in place, so a finding that had genuinely
    // moved past resource pressure (proven by reaching a completely
    // different error) kept showing a stale, false WAITING_FOR_RESOURCES
    // item. Clearing here too, right before the passthrough re-throw,
    // covers every real "we got past the resource check" path, not just
    // the success path.
    await clearStaleResourceMarker()
    throw error
  }
  const worker = dispatch.worker
  // Independent-adversarial-review finding (real, reproduced): a resource-
  // pressure marker recorded by an earlier BLOCKED_BY_RESOURCE_PRESSURE
  // attempt on this SAME attempt slot (resource refusals never consume
  // budget, so a retry reuses the same attemptNumber/taskFingerprint) was
  // never cleared once a later attempt genuinely proceeded past the
  // resource check -- so a finding that had since moved on to a real
  // dispatch, and even failed verification for a completely unrelated
  // reason, still showed a stale, false WAITING_FOR_RESOURCES attention
  // item. Reaching this point means resource pressure is NOT currently
  // blocking this mission (dispatch just succeeded, whether freshly or as
  // an already-registered resume) -- clear any stale marker so the
  // projection stays honest.
  await clearStaleResourceMarker()
  // Re-derived, not read off `worker` -- see the real-bug comment above.
  const worktreePath = deriveRepairAttemptWorktreePath({
    canonicalRepoPath,
    missionId,
    attemptNumber
  })
  const branch = deriveRepairAttemptBranch({ missionId, attemptNumber })
  if (!dispatch.alreadyDispatched) {
    await recordReceipt(
      missionId,
      {
        kind: 'WORKER_DISPATCHED',
        missionId,
        findingId: finding.findingId,
        detail: { attemptNumber, providerId: worker.providerId, worktreePath }
      },
      clock
    )
  }

  let currentFinding = finding
  if (attemptNumber === 1) {
    await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () =>
      lifecycle.advancePhase('FIX_IN_PROGRESS')
    )
    currentFinding = await writeFinding(finding.findingId, (current) =>
      transitionFinding(
        current,
        'FIX_IN_PROGRESS',
        { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED', evidence: [{ missionId }] },
        clock
      )
    )
  }

  await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () =>
    lifecycle.recordWorkerResult(worker.workerId, {
      status: worker.exitCode === 0 && !worker.timedOut ? 'COMPLETED' : 'FAILED',
      result: { exitCode: worker.exitCode, timedOut: worker.timedOut }
    })
  )
  await recordReceipt(
    missionId,
    {
      kind: 'WORKER_RESULT',
      missionId,
      findingId: finding.findingId,
      detail: { attemptNumber, exitCode: worker.exitCode, timedOut: worker.timedOut }
    },
    clock
  )

  const verify = deps.runIndependentVerification ?? runIndependentVerification
  // Real git read (injectable, like every other real side effect here) --
  // never `worker.baseSha` (always undefined, see the comment above).
  const readBaseSha = deps.currentHeadSha ?? currentHeadSha
  const baseSha = await readBaseSha(worktreePath)
  const verification = await verify({
    finding,
    envelope,
    worktreePath,
    branch,
    baseSha,
    canonicalRepoPath,
    workerProviderId: worker.providerId,
    siblingStatusesBefore: liveDispatchSiblingSnapshot,
    deps: deps.verifierDeps ?? {}
  })
  await withLeaseRecovery(lifecycle, canonicalRepoPath, deps, () =>
    lifecycle.recordVerifierResult({
      verifier: 'VERIFIER_INDEPENDENT',
      verdict: verification.verdict,
      detail: verification.detail
    })
  )
  await recordReceipt(
    missionId,
    {
      kind: 'VERIFIER_RESULT',
      missionId,
      findingId: finding.findingId,
      detail: { attemptNumber, verdict: verification.verdict, reasons: verification.reasons }
    },
    clock
  )

  if (verification.verdict === 'VERIFIED_PASS') {
    const nextFinding = await writeFinding(finding.findingId, (current) =>
      transitionFinding(
        current ?? currentFinding,
        'READY_FOR_ADOPTION',
        { reason: 'VERIFIER_PASSED', evidence: [{ missionId, attemptNumber }] },
        clock
      )
    )
    return { outcome: 'READY_FOR_ADOPTION', worker, verification, finding: nextFinding }
  }

  // VERIFIED_FAIL: stay FIX_IN_PROGRESS -- the NEXT call to
  // runRepairAttempt re-derives attemptsSoFar from this now-recorded
  // VERIFIED_FAIL and either retries (budget remaining) or escalates.
  return {
    outcome: 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK',
    worker,
    verification,
    finding: currentFinding
  }
}
