// The autonomous wave-dispatch loop (M2's last major gap): drives a
// UI-started, ACTIVE Keep Going run through real Orca dispatch on its own,
// instead of a run sitting at 0 waves until someone manually calls
// planWave/recordWave. One `tickKeepGoingRun` call performs exactly one
// bounded step -- plan+dispatch the next wave, or check an already-dispatched
// wave for settlement -- so it is idempotent and safe to invoke repeatedly
// (a manual "Run now" button, or later an `orca automations create --trigger
// cron` job; registering that recurring trigger is a separate decision, not
// made by this module, since it has its own safety/interval tradeoffs).
//
// Deliberately NOT done here: independent verification. This tick only
// tracks real Orca task status (completed/failed) to settle a wave and feed
// the retry budget -- it never marks an acceptance criterion
// `verifiedSatisfied` from that alone, because Orca reporting a task
// "completed" is the worker's own claim, and program discipline (Section F)
// forbids treating a worker's self-report as done. Deciding a criterion is
// satisfied still requires a separate independent verifier pass; this
// module only makes the mechanical dispatch/settle loop real.
//
// Also NOT done here: deciding *what* candidate work items exist for the
// current gap. That is a planning judgment (today: the operator or a
// planner session), supplied by the caller -- this module refuses to
// fabricate a plan when none is given.
//
// Concurrency model: every tick claims exclusive ownership of the run
// (claimTick, tsf/domain/keep-going.mjs) via ONE synchronous compare-and-
// swap (tsf/server/keep-going-run-store.mjs, atomic because loadState/
// saveState are synchronous fs calls -- Node's single-threaded event loop
// only yields at an await) *before* doing any real Orca CLI work, then
// commits via a second synchronous CAS keyed on the revision the claim
// produced. This is what actually prevents two overlapping ticks from both
// starting real duplicate dispatch work (a plain "check revision once at
// the end" cannot: by the time either tick reaches its own commit, both
// may already have created real, duplicate Orca tasks). transitionRun
// itself rejects external state changes (operator pause/resume/etc.)
// while a tick holds the lock, so a pause request racing an in-flight tick
// is cleanly rejected (409-shaped, retryable) rather than silently
// dropped or silently overwritten by the tick's eventual commit --
// keep-going-http-routes.mjs's start/pause/resume routes now commit
// through this same primitive (not a stale opState captured before their
// own `await readBody`), so that guarantee holds end to end over HTTP too,
// not only for a caller that already goes through keep-going-run-store.mjs
// directly. Every commit path here is built on commitClaimed, which always
// threads the claim-time revision through the FIRST domain mutation --
// never a mutation's own self-consistent revision, which is a tautology
// that can never detect the lock was recovered by another tick since the
// claim (a real, confirmed review finding on an earlier version of this
// module's settle-side commits).
import path from 'node:path'
import {
  abandonOrchestrationWorker,
  bindOrchestrationRun,
  checkOrchestrationMessages,
  createDispatcherTerminal,
  createOrchestrationRun,
  createOrchestrationTask,
  listOrchestrationTasks,
  startOrchestrationWorker
} from '../adapters/orca-orchestration-bridge.mjs'
import { fetchCapacitySnapshot } from '../adapters/orca-capacity-bridge.mjs'
import { decideCapacityAction } from '../domain/capacity-policy.mjs'
import {
  DEFAULT_RESOURCE_PRESSURE,
  classifyDispatchAdmission,
  recordResourceRefusal
} from './keep-going-resource-pressure-gate.mjs'
import { readProjectExecutionHold } from './project-execution-hold-store.mjs'
import { isProjectExecutionHoldActive } from '../domain/project-execution-hold.mjs'
import {
  checkpointRun,
  dispatchWave,
  pauseRun,
  planWave,
  releaseTick,
  TICK_LOCK_TIMEOUT_MS
} from '../domain/keep-going.mjs'
import { readKeepGoingRun, withKeepGoingRun } from './keep-going-run-store.mjs'
import { placementsCollide } from './keep-going-placement-collision.mjs'
import { reclaimExpiredDispatchLock } from './keep-going-stale-dispatch-lock-reclaim.mjs'
import { claim, commitClaimed, lostLockResult } from './keep-going-tick-lock.mjs'
import { settleStep } from './keep-going-settle-step.mjs'

const DEFAULT_ORCHESTRATION = Object.freeze({
  abandonOrchestrationWorker,
  bindOrchestrationRun,
  checkOrchestrationMessages,
  createDispatcherTerminal,
  createOrchestrationRun,
  createOrchestrationTask,
  listOrchestrationTasks,
  startOrchestrationWorker
})

// This module's own home repo, wherever it is actually checked out and
// running from -- never a hardcoded path (this process may be a dev
// worktree, an SSH host, or the production install). Two levels up from
// server/keep-going-dispatch-loop.mjs is the real repo root Orca already
// knows as a worktree.
const DISPATCHER_TERMINAL_WORKTREE = `path:${path.resolve(import.meta.dirname, '..', '..')}`

// Real V1 stabilization finding: every real Orca orchestration call needs a
// sender-terminal identity (`from`), and this module never supplied one --
// the production TSF server is a headless process with no terminal of its
// own, so every real dispatch attempt failed with no_active_sender_terminal
// (confirmed live against both WorldForge and NWR). `ORCA_TERMINAL_HANDLE`
// covers the case where this code IS running inside a live terminal
// (interactive/dev use); otherwise this creates one, fresh, per tick --
// deliberately NOT cached across ticks in this bounded fix (that would need
// persisted-run-state changes to this adversarially-hardened module, left
// as a disclosed follow-up rather than risked here). Never fabricates a
// handle on failure -- the caller aborts honestly instead.
// Exported: real adversarial-review finding -- command-run-action-bridge.mjs's
// resolveProjectNeedsYou relays an owner's answer back to a real worker via
// replyToOrchestrationMessage, subject to the EXACT same unbound-coordinator
// race dispatchStep/settleStep already defend against (this module's own
// SANDBOX_ESCALATION_NOTE/rebind comments tell the fuller story). Reused
// here rather than re-implemented so both real callers stay identical.
export async function resolveSenderTerminal(orchestration) {
  if (process.env.ORCA_TERMINAL_HANDLE) {
    return { ok: true, handle: process.env.ORCA_TERMINAL_HANDLE }
  }
  const result = await orchestration.createDispatcherTerminal({
    worktree: DISPATCHER_TERMINAL_WORKTREE,
    title: 'TSF Keep Going Dispatcher'
  })
  if (!result.ok) {
    return result
  }
  return { ok: true, handle: result.result.terminal.handle }
}

// M5: real capacity signal, checked once per dispatch attempt -- AFTER the
// tick lock is claimed (see the call site below), not before: the capacity
// check itself needs no lock, but an earlier before-claim placement broke
// the overlapping-ticks concurrency test's 'claim is the first async
// operation' ordering guarantee, so it runs post-claim like every other
// validate/act step in this module. DEFAULT_CAPACITY.provider is 'codex'
// because DEFAULT_WORKER_AGENT below is this module's own real dispatch
// target for every wave -- its capacity is what actually gates whether a
// new dispatch can succeed. A disclosed, real scope boundary:
// only the PAUSE_AND_CHECKPOINT action is wired here.
// REDUCE_CONCURRENCY/DOWNGRADE_WORKER are left for a real follow-up wave
// rather than risking a rushed change to this adversarially-hardened
// dispatch path -- planWave reads run.budget.maxConcurrentWorkers with no
// override hook today, and this module doesn't choose a work item's
// requested agent, it only dispatches what candidateWorkItems specify.
const DEFAULT_CAPACITY = Object.freeze({ fetchCapacitySnapshot, provider: 'codex' })

// Main TSF Resource Pressure Governor integration review finding: this is
// the ONE real choke point every heavyweight-worker dispatch caller
// funnels through (chat-dispatch-bridge.mjs, keep-going-http-routes.mjs's
// direct tick route, keep-going-fleet-driver.mjs's autonomous heartbeat --
// both its settle path, which never reaches dispatchStep, and its
// continuation-dispatch path, which does -- and settled-run-reconciler.mjs).
// Job 1's own bounded correction only gated chat-dispatch-bridge.mjs
// directly, which left every OTHER caller -- most importantly the
// autonomous fleet driver's own unattended heartbeat -- completely
// ungated. Gating here once, instead of at every call site, makes missing
// a future caller structurally impossible. See keep-going-resource-
// pressure-gate.mjs for the gate itself.

// Fresh work items dispatch through a new agent terminal unless the item
// specifies an existing one to reuse (item.workerTerminal).
const DEFAULT_WORKER_AGENT = 'codex'

const DEFAULT_STORE = Object.freeze({
  readRun: readKeepGoingRun,
  withRun: withKeepGoingRun
})

// Real, live-observed environment note (TSF Research-Driven Development
// V1's own real pilot, both its CHALLENGE dispatch and settled-run-
// reconciler.mjs's own independent-verification dispatch hit this): a
// freshly-spawned worker's own exec sandbox can refuse to read Orca's
// runtime metadata (needed for every `orca orchestration ...` call,
// including the final, REQUIRED worker_done self-report this module's
// own wave-settle detection depends on) with a runtime_unavailable/"Orca
// is not running" error -- retrying the exact same command with escalated
// sandbox permissions resolved it every time observed live. Appended
// ONCE, HERE, to every real dispatched task's spec (not duplicated into
// each individual caller's own spec-building code, e.g.
// settled-run-reconciler.mjs's buildVerificationWorkItem) so no future
// caller can forget it and leave a worker stuck unable to ever report
// its own real, completed work.
const SANDBOX_ESCALATION_NOTE =
  'If any `orca` CLI command (including your final, required worker_done ' +
  'report) fails with a runtime_unavailable/"Orca is not running" or ' +
  'sandbox/permission error, immediately retry the exact same command with ' +
  'escalated sandbox permissions -- this is expected and normal in this ' +
  'environment, not a real outage.'

// Each dispatched work item costs up to two sequential CLI round-trips
// (task-create + worker-start, the latter composing worktree/terminal/
// readiness itself), each up to the orchestration bridge's own 15s
// timeout, plus a comfortable buffer -- a fixed lock timeout sized for a
// small wave would otherwise treat a legitimately still-working large-wave
// dispatch as abandoned (a real review finding). Settle only ever makes
// one listOrchestrationTasks call, so it keeps the base timeout.
const PER_ITEM_LOCK_TIMEOUT_MS = 45_000

// No silent worktree default (removed after a real, live-confirmed
// safety gap: 'current' resolved to the coordinator's own working
// directory, not the project's -- see hasExplicitPlacement). 'current'
// is still a legitimate value an operator types deliberately.
function resolveWorkerPlacement(item) {
  if (item.workerTerminal) {
    return { terminal: item.workerTerminal, ...(item.retryOf ? { retryOf: item.retryOf } : {}) }
  }
  return {
    worktree: item.worktree,
    agent: item.agent || DEFAULT_WORKER_AGENT,
    ...(item.retryOf ? { retryOf: item.retryOf } : {})
  }
}

// Shared with keep-going-http-routes.mjs's own validation (imported, not
// duplicated -- a real review finding was that two independently-typed
// copies of this same rule had already diverged in behavior). Type-safe:
// a non-string worktree (number/object/etc, reachable from untrusted
// HTTP input) must be treated as absent, not thrown on.
export function hasExplicitPlacement(item) {
  return (
    Boolean(item.workerTerminal) ||
    (typeof item.worktree === 'string' && item.worktree.trim() !== '')
  )
}

// A work item with neither an explicit worktree nor an existing terminal
// to reuse must be refused honestly before any CLI call, not silently
// defaulted.
function requireExplicitPlacement(candidateWorkItems) {
  return candidateWorkItems.find((item) => !hasExplicitPlacement(item))
}

function trimPlanToDispatched(wavePlan, dispatchedWorkItemIds) {
  const dispatched = new Set(dispatchedWorkItemIds)
  const batches = wavePlan.batches
    .map((batch) => batch.filter((item) => dispatched.has(item.id)))
    .filter((batch) => batch.length > 0)
  return { ...wavePlan, batches }
}

async function dispatchStep(
  projectId,
  candidateWorkItems,
  clock,
  orchestration,
  store,
  capacity,
  resourcePressure,
  readHold,
  hadTickLockAtRead = false
) {
  if (!Array.isArray(candidateWorkItems) || candidateWorkItems.length === 0) {
    // Real, live-discovered bug (RDD V1 refinement pilot): this early NOOP
    // used to fire unconditionally, permanently wedging a run whose
    // DISPATCH lock outlived a crashed/interrupted attempt (see
    // keep-going-stale-dispatch-lock-reclaim.mjs's own header). Only pay
    // that reclaim attempt's I/O when a lock was actually held at read
    // time -- the common "nothing to dispatch, no lock held" tick stays a
    // single, zero-I/O NOOP.
    const reason = 'no candidate work items available to plan a wave'
    if (!hadTickLockAtRead) {
      return { action: 'NOOP', reason }
    }
    const reclaim = await reclaimExpiredDispatchLock(projectId, clock, store)
    return reclaim.reclaimed
      ? { action: 'NOOP', reason, run: reclaim.run }
      : { action: 'NOOP', reason, lockCheck: reclaim.code }
  }

  // Resource Pressure Governor gate -- checked BEFORE claim(), unlike the
  // capacity check below. Independent-review finding: this check is a
  // synchronous, lock-independent, host-wide read with no claim-freshness
  // race to protect against (unlike the capacity check, which genuinely
  // needs to run against a just-claimed, up-to-date lock) -- paying a full
  // claim/release round trip through the cross-process file-lock store
  // just to be told "no" here was pure wasted I/O under sustained
  // CRITICAL/EMERGENCY pressure, exactly when this host can least afford
  // it. Only CRITICAL/EMERGENCY refuse; PRESSURED still admits a single
  // dispatch here (the heavy-task lease, not this gate, is what throttles
  // concurrent full-suite/pilot/research-worker categories).
  //
  // Deliberately checked BEFORE the project-execution-hold gate below
  // (round-2 independent-review finding, real): checking hold FIRST would
  // mean a project that is BOTH held AND resource-refused never gets its
  // real DISPATCH_WAITING_FOR_RESOURCES pendingDispatch retry record
  // written at all -- live-reproduced by the reviewer: releasing the hold
  // later would then have nothing durable to auto-resume, silently
  // losing the resource-refusal's own retry opportunity, forcing a
  // manual re-trigger with zero trail a dispatch was ever attempted.
  // Resource-pressure first preserves that durable bookkeeping
  // unconditionally; the hold check right after still refuses the
  // ACTUAL dispatch either way -- if resources later recover while still
  // held, the SAME hold check (or keep-going-fleet-driver.mjs's own,
  // still-independent gate on its pendingDispatch resume path) refuses
  // the real dispatch attempt when it's retried, never silently
  // bypassing the hold, just at a later point in the sequence.
  const admission = classifyDispatchAdmission(resourcePressure)
  if (!admission.admitted) {
    // Phase 12 (category 8) + Resource-Wait Auto-Resume V1: durably records
    // the refusal and the pending first-wave dispatch a driver can later
    // retry -- see keep-going-resource-pressure-gate.mjs's own header.
    await recordResourceRefusal(store, projectId, candidateWorkItems, admission, clock)
    return { action: 'DISPATCH_WAITING_FOR_RESOURCES', ...admission }
  }

  // TSF Overnight Control-Plane Burn-In V2, real finding (not guessed),
  // likely the most severe of the whole mission: this is the ONE real
  // choke point every heavyweight-worker dispatch caller funnels through
  // (see the Resource Pressure Governor's own header comment on this same
  // function, just above, which already names this exact principle and
  // lists chat-dispatch-bridge.mjs, keep-going-http-routes.mjs, keep-
  // going-fleet-driver.mjs, AND settled-run-reconciler.mjs as real
  // callers) -- yet a project execution hold was never checked here at
  // all. Live-reproduced (independent red-team review, this same
  // finding's own investigation): settled-run-reconciler.mjs's own
  // DISPATCH_VERIFICATION branch -- fired on essentially every settled
  // run's FIRST reconciliation pass, arguably more common than the
  // continuation-dispatch path this finding originally gated at the
  // fleet-driver level -- called tickKeepGoingRun with zero hold
  // awareness anywhere in that call chain, dispatching a real wave into
  // a held project. keep-going-fleet-driver.mjs's own two gates (added
  // first, kept here as real, tested, friendlier-messaged defense-in-
  // depth for the two cases they cover) could not have closed this on
  // their own -- the reconciler's own dispatch never reaches them.
  // Gating HERE ONCE makes missing a future caller structurally
  // impossible, instead of relying on every call site remembering to
  // check. No durable pendingDispatch-style retry record is needed for
  // THIS refusal (unlike the resource-pressure case above): nothing
  // durable is consumed/mutated on this early return, so the driver's
  // own ordinary next tick naturally re-evaluates and proceeds the
  // moment the hold is released.
  const hold = (readHold ?? readProjectExecutionHold)(projectId)
  if (isProjectExecutionHoldActive(hold)) {
    return {
      action: 'DISPATCH_BLOCKED_BY_HOLD',
      reason: `project execution hold active -- ${hold.reason}${hold.note ? `: ${hold.note}` : ''} (set by ${hold.setBy})`
    }
  }

  // Sized to this wave's candidate count -- see PER_ITEM_LOCK_TIMEOUT_MS.
  const dispatchTimeoutMs =
    TICK_LOCK_TIMEOUT_MS + candidateWorkItems.length * PER_ITEM_LOCK_TIMEOUT_MS

  let claimed
  try {
    claimed = await claim(projectId, 'DISPATCH', clock, store, dispatchTimeoutMs)
  } catch (error) {
    // Another tick already holds the lock, or the run is no longer
    // ACTIVE/found -- no CLI work is attempted, so no duplicate dispatch.
    return {
      action: 'DISPATCH_CLAIM_FAILED',
      reason: error.code ?? 'CLAIM_FAILED',
      detail: error.message
    }
  }

  // M5: real capacity check now that this tick genuinely holds the lock --
  // still before any real Orca CLI dispatch work (planWave/task-create/
  // worker-start) happens, but deliberately AFTER claim() so this
  // module's own "claim is the first async operation" concurrency
  // guarantee (relied on by the overlapping-ticks test) is untouched --
  // matches the existing "claim first, then validate/act" pattern used
  // everywhere else in this function (placement checks, planWave's own
  // validation, etc. all happen post-claim too). fetchCapacitySnapshot's
  // own honest failure (never a fabricated snapshot) feeds
  // decideCapacityAction, which itself defaults to PROCEED with
  // assurance:'UNKNOWN' on no/failed signal -- no extra failure-handling
  // needed here.
  const snapshotResult = await capacity.fetchCapacitySnapshot()
  const capacityDecision = decideCapacityAction(
    snapshotResult.ok ? snapshotResult.result : null,
    capacity.provider
  )
  if (capacityDecision.action === 'PAUSE_AND_CHECKPOINT') {
    try {
      const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
        // The lock this tick holds must be released BEFORE pauseRun --
        // pauseRun (transitionRun) itself rejects any external transition
        // while a tick lock is active, and this pause IS that tick's own
        // in-progress mutation, not an external one. Matches every other
        // commit path in this module (commitAbortedDispatch etc.):
        // releaseTick first, then the real mutation.
        let n = releaseTick(current, clock, expectedRevision)
        n = pauseRun(n, 'LOW_PROVIDER_CAPACITY', clock, n.revision)
        n = checkpointRun(n, { phase: 'CAPACITY_PAUSED', note: capacityDecision.reason }, clock)
        return n
      })
      return { action: 'DISPATCH_SKIPPED_LOW_CAPACITY', reason: capacityDecision.reason, run: next }
    } catch (error) {
      return lostLockResult('DISPATCH_SKIPPED_LOW_CAPACITY', error, {})
    }
  }

  let wavePlan
  try {
    wavePlan = planWave(claimed, candidateWorkItems, clock)
  } catch (error) {
    // A malformed candidateWorkItem (missing id/scope) throws here, AFTER
    // the tick lock above was already claimed -- releasing it honestly
    // rather than leaving the run wedged in "tick in progress" for the
    // full dispatchTimeoutMs is what a real review finding caught: the
    // HTTP tick route now validates this shape itself, but this module is
    // also callable directly (scripts, tests) with no such guard in front.
    // Uses the real error.code (planWave's own TSF_INVALID_WORK_ITEM),
    // not a hardcoded label -- a real review finding was that hardcoding
    // it here would misreport an unrelated planWave bug as bad caller
    // input.
    return commitAbortedDispatch(projectId, store, claimed, clock, {
      reason: error.code ?? 'PLAN_WAVE_ERROR',
      detail: error.message
    })
  }

  const unplaced = requireExplicitPlacement(candidateWorkItems)
  if (unplaced) {
    return commitAbortedDispatch(projectId, store, claimed, clock, {
      reason: 'TSF_MISSING_PLACEMENT',
      detail: `work item ${unplaced.id} requires an explicit worktree or workerTerminal -- there is no safe default`
    })
  }

  const senderTerminal = await resolveSenderTerminal(orchestration)
  if (!senderTerminal.ok) {
    return commitAbortedDispatch(projectId, store, claimed, clock, {
      reason: senderTerminal.reason ?? 'SENDER_TERMINAL_UNAVAILABLE',
      detail: senderTerminal.detail ?? 'could not resolve a sender-terminal identity for dispatch'
    })
  }
  const from = senderTerminal.handle

  // Tracked separately from claimed.orchestrationRunId: a freshly-created
  // real Orca orchestration Run must be persisted even if every task-
  // create in this wave then fails, or it leaks -- forgotten by TSF but
  // still real in Orca -- and gets recreated on every retrying tick.
  let orchestrationRunId = claimed.orchestrationRunId
  const orchestrationRunFreshlyCreated = !orchestrationRunId
  if (!orchestrationRunId) {
    const runResult = await orchestration.createOrchestrationRun({
      objective: claimed.originalGoal.statement,
      from
    })
    if (!runResult.ok) {
      return commitAbortedDispatch(projectId, store, claimed, clock, {
        reason: runResult.reason,
        detail: runResult.detail
      })
    }
    orchestrationRunId = runResult.result.run.id
  } else {
    // Reusing a persisted Run from a possibly-fresh CLI invocation (a new
    // process/session, e.g. resuming a run after a restart) -- the calling
    // coordinator identity may currently be bound to a DIFFERENT Run (or
    // none), which fails task-create/worker-start with consumer_fenced
    // rather than silently misdirecting the call. Rebinding first is a
    // no-op when already correctly bound.
    const bindResult = await orchestration.bindOrchestrationRun({ id: orchestrationRunId, from })
    if (!bindResult.ok) {
      return commitAbortedDispatch(projectId, store, claimed, clock, {
        reason: bindResult.reason,
        detail: bindResult.detail
      })
    }
  }

  // Resolved once per item, positionally paired (never looked up again by
  // item.id afterward) -- a Map keyed by id would silently misroute a
  // dispatch if candidateWorkItems ever contained a duplicate id (a real
  // review finding against an earlier version of this function).
  const placedBatches = wavePlan.batches.map((batch) =>
    batch.map((item) => ({ item, placement: resolveWorkerPlacement(item) }))
  )

  // Checked across the whole wave (see placementsCollide), once up front
  // before any batch is touched, so a colliding wave is refused atomically
  // rather than after already dispatching an earlier, non-colliding batch.
  const allPlaced = placedBatches.flat()
  for (let i = 0; i < allPlaced.length; i += 1) {
    for (let j = i + 1; j < allPlaced.length; j += 1) {
      if (placementsCollide(allPlaced[i].placement, allPlaced[j].placement)) {
        return commitPartialOrAbortedDispatch(
          projectId,
          store,
          claimed,
          clock,
          wavePlan,
          [],
          orchestrationRunId,
          orchestrationRunFreshlyCreated,
          {
            failedItem: allPlaced[j].item.id,
            reason: 'UNSAFE_PLACEMENT_COLLISION',
            detail: `${allPlaced[i].item.id} and ${allPlaced[j].item.id} would land in the same place at the same time -- give each an explicit, distinct item.worktree or item.workerTerminal`
          }
        )
      }
    }
  }

  // Batches themselves must stay sequential (planWave puts conflicting
  // items in separate batches precisely so they don't overlap), but items
  // within one conflict-free batch are still dispatched one at a time here
  // rather than concurrently -- a real, disclosed gap against the module's
  // own "two independent workers beats five on one subsystem" design
  // intent (it costs wall-clock dispatch latency, not correctness).
  // Deliberately not fixed this wave: correctly handling partial failure
  // among concurrently-dispatched items needs more care than the current
  // sequential-with-early-return shape.
  const dispatchRecords = []
  for (const batch of placedBatches) {
    for (const { item, placement } of batch) {
      const taskResult = await orchestration.createOrchestrationTask({
        spec: `${item.spec ?? item.id}\n\n${SANDBOX_ESCALATION_NOTE}`,
        run: orchestrationRunId,
        taskTitle: item.id,
        // BUG-07 (bug-ledger.json): displayName was never populated --
        // createOrchestrationTask/the real Orca CLI already accept it as a
        // distinct --display-name flag from --task-title, but with only
        // taskTitle (a bare internal work-item id, e.g. "impl-1") ever
        // set, any Orca-side surface (task lists, terminal titles, and
        // transitively any Orca-owned notification whose label draws on
        // task identity) had nothing more human-readable to draw from.
        // Composed from real, already-available facts only -- the real
        // project id and the real file scope this work item touches --
        // never a fabricated "friendly project name" this call site
        // doesn't actually have.
        displayName: `${projectId}: ${item.scope.slice(0, 3).join(', ')}`,
        from
      })
      if (!taskResult.ok) {
        return commitPartialOrAbortedDispatch(
          projectId,
          store,
          claimed,
          clock,
          wavePlan,
          dispatchRecords,
          orchestrationRunId,
          orchestrationRunFreshlyCreated,
          { failedItem: item.id, reason: taskResult.reason, detail: taskResult.detail }
        )
      }
      const taskId = taskResult.result.task.id
      // worker-start (not the low-level dispatch --inject path) -- see
      // wave 19/20.
      const startResult = await orchestration.startOrchestrationWorker({
        task: taskId,
        run: orchestrationRunId,
        from,
        ...placement
      })
      if (!startResult.ok) {
        return commitPartialOrAbortedDispatch(
          projectId,
          store,
          claimed,
          clock,
          wavePlan,
          dispatchRecords,
          orchestrationRunId,
          orchestrationRunFreshlyCreated,
          { failedItem: item.id, reason: startResult.reason, detail: startResult.detail }
        )
      }
      dispatchRecords.push({
        workItemId: item.id,
        scope: item.scope,
        // Command Adoption V1 Part A: the candidate worktree, flows through settleStep's own `{...record}` spread into run.waves[] -- no second tracking store.
        worktree: item.worktree,
        taskId,
        dispatchId: startResult.result.dispatchId
      })
    }
  }

  return commitDispatchedWave(
    projectId,
    store,
    claimed,
    clock,
    wavePlan,
    dispatchRecords,
    orchestrationRunId,
    'WAVE_DISPATCHED'
  )
}

// Nothing was dispatched at all (createOrchestrationRun itself failed) --
// just release the lock; persist a freshly-created orchestrationRunId if
// there somehow is one (there shouldn't be on this path, but mirrors the
// partial-dispatch helper's own safety net for symmetry). Checkpoints the
// failure (a real, live-confirmed gap: a DISPATCH_FAILED reason previously
// only ever appeared in the transient tick HTTP response -- once that
// response was gone, there was no way to look up afterward why a real
// dispatch attempt had failed).
async function commitAbortedDispatch(projectId, store, claimed, clock, failure) {
  try {
    const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
      const released = releaseTick(current, clock, expectedRevision)
      return checkpointRun(
        released,
        { phase: 'DISPATCH_FAILED', note: `${failure.reason}: ${failure.detail}`, evidence: [] },
        clock
      )
    })
    return { action: 'DISPATCH_FAILED', run: next, ...failure }
  } catch (error) {
    return lostLockResult('DISPATCH_FAILED', error, {})
  }
}

// A dispatch failure partway through a wave still leaves already-dispatched
// real Orca tasks running -- silently dropping them would orphan live work
// with no TSF-side record. Records exactly what was actually dispatched
// (trimmed to only the successful items), not the full original plan.
async function commitPartialOrAbortedDispatch(
  projectId,
  store,
  claimed,
  clock,
  wavePlan,
  dispatchRecords,
  orchestrationRunId,
  orchestrationRunFreshlyCreated,
  failure
) {
  if (dispatchRecords.length === 0) {
    try {
      const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
        let n = current
        // Nothing dispatched, but if this tick just created a new real
        // Orca orchestration Run, persist it even on a total failure --
        // otherwise it leaks and gets recreated on every retrying tick.
        if (orchestrationRunFreshlyCreated) {
          n = { ...n, orchestrationRunId }
        }
        n = releaseTick(n, clock, expectedRevision)
        // Checkpointed for the same reason as commitAbortedDispatch above --
        // this is the exact path a real live acceptance test hit (a task
        // created successfully, then startOrchestrationWorker failing for
        // it), and the failure reason previously vanished the moment the
        // tick's own HTTP response was gone.
        return checkpointRun(
          n,
          {
            phase: 'DISPATCH_FAILED',
            note: `stopped after failure on ${failure.failedItem}: ${failure.reason}: ${failure.detail}`,
            evidence: []
          },
          clock
        )
      })
      return { action: 'DISPATCH_FAILED', run: next, ...failure }
    } catch (error) {
      return lostLockResult('DISPATCH_FAILED', error, { orchestrationRunId })
    }
  }
  const trimmedPlan = trimPlanToDispatched(
    wavePlan,
    dispatchRecords.map((r) => r.workItemId)
  )
  return commitDispatchedWave(
    projectId,
    store,
    claimed,
    clock,
    trimmedPlan,
    dispatchRecords,
    orchestrationRunId,
    'WAVE_DISPATCHED_PARTIAL',
    failure
  )
}

async function commitDispatchedWave(
  projectId,
  store,
  claimed,
  clock,
  wavePlan,
  dispatchRecords,
  orchestrationRunId,
  action,
  failure = null
) {
  try {
    const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
      let n = dispatchWave(current, wavePlan, dispatchRecords, clock, expectedRevision)
      n = { ...n, orchestrationRunId }
      n = checkpointRun(
        n,
        {
          phase: action,
          note: failure
            ? `stopped after failure on ${failure.failedItem}: ${failure.reason}`
            : null,
          evidence: dispatchRecords.map((r) => r.taskId)
        },
        clock
      )
      return releaseTick(n, clock, n.revision)
    })
    return { action, run: next, wavePlan, dispatchRecords, ...(failure ? { failure } : {}) }
  } catch (error) {
    return lostLockResult(action, error, { orchestrationRunId, dispatchRecords, wavePlan })
  }
}

// Performs exactly one bounded step for one project's run: dispatch the next
// wave, check an in-flight wave for settlement, or no-op. Never blocks
// waiting for a worker to finish -- callers (an HTTP route, a manual
// trigger, a future scheduled automation) invoke this repeatedly. Always
// operates on the CURRENT persisted run (via `store`, defaulting to the
// real synchronous data-store-backed one) rather than a caller-supplied
// snapshot -- see the module header for why that is what actually makes
// concurrent ticks/pauses safe.
export async function tickKeepGoingRun(projectId, candidateWorkItems, clock, deps = {}) {
  const orchestration = deps.orchestration ?? DEFAULT_ORCHESTRATION
  const store = deps.store ?? DEFAULT_STORE
  const capacity = deps.capacity ?? DEFAULT_CAPACITY
  const resourcePressure = deps.resourcePressure ?? DEFAULT_RESOURCE_PRESSURE
  const readHold = deps.readProjectExecutionHold ?? readProjectExecutionHold

  const before = store.readRun(projectId)
  if (!before) {
    return { action: 'NOOP', reason: 'no Keep Going run for this project' }
  }
  if (before.state !== 'ACTIVE') {
    return { action: 'NOOP', reason: `run state is ${before.state}, not ACTIVE` }
  }
  if (before.inFlightWave) {
    // Settling an already-in-flight wave is a cheap read/reconcile of a
    // worker that already exists -- never gated (by the resource governor
    // OR the project-execution-hold check below): a wave already
    // dispatched represents work already under way, possibly started
    // before the hold even existed; observing/reconciling its real
    // completion status is never itself a new action a hold is meant to
    // prevent. Only a genuinely NEW heavyweight worker spawn (dispatchStep,
    // below) consults either gate.
    return settleStep(projectId, clock, orchestration, store)
  }
  return dispatchStep(
    projectId,
    candidateWorkItems,
    clock,
    orchestration,
    store,
    capacity,
    resourcePressure,
    readHold,
    Boolean(before.tickLock)
  )
}

// abandonAndReconcileStalledWave (recovers a run whose in-flight wave
// stalled AND releases the real Orca resource(s) that wave held) moved to
// keep-going-stalled-wave-abandon.mjs (TSF_DOGFOOD_FINDING_1_EXECUTION_
// HOLD_SAFETY_V1) -- this file's own max-lines cap left no room to add its
// execution-hold gate in place. Its own design-decision comments moved
// with it.
export { abandonAndReconcileStalledWave } from './keep-going-stalled-wave-abandon.mjs'
