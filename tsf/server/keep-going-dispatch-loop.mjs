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
  createDispatcherTerminal,
  createOrchestrationRun,
  createOrchestrationTask,
  listOrchestrationTasks,
  startOrchestrationWorker
} from '../adapters/orca-orchestration-bridge.mjs'
import { fetchCapacitySnapshot } from '../adapters/orca-capacity-bridge.mjs'
import { isoNow } from '../domain/canonical.mjs'
import { decideCapacityAction } from '../domain/capacity-policy.mjs'
import { DEFAULT_RESOURCE_PRESSURE, classifyDispatchAdmission } from './keep-going-resource-pressure-gate.mjs'
import {
  checkpointRun,
  claimTick,
  dispatchWave,
  markStalled,
  pauseRun,
  planWave,
  raiseNeedsYou,
  recordTaskAttempt,
  releaseTick,
  settleInFlightWave,
  TICK_LOCK_TIMEOUT_MS
} from '../domain/keep-going.mjs'
import { abandonKeepGoingStalledWave } from './keep-going-controller.mjs'
import { readKeepGoingRun, withKeepGoingRun } from './keep-going-run-store.mjs'

const DEFAULT_ORCHESTRATION = Object.freeze({
  abandonOrchestrationWorker,
  bindOrchestrationRun,
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
async function resolveSenderTerminal(orchestration) {
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

const COMPLETED_STATUSES = new Set(['completed', 'succeeded'])
const FAILED_STATUSES = new Set(['failed', 'error'])

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

// Orca's --worktree grammar mixes case-sensitive selector forms
// (branch:<x>, name:<x>, id:<x>::<path>, issue:<n>) with plain filesystem
// paths and the bare 'current'/'active' keywords -- folding everything to
// lowercase (a real review finding) would falsely collide two distinct
// branches/names differing only in case. Only bare paths are
// slash/case-normalized; a recognized selector prefix is compared
// verbatim. Canonicalizing a selector form against a differently-shaped
// one naming the SAME place (e.g. id:repo::/path vs path:/path) would need
// Orca-side resolution -- a known, disclosed, not-yet-closed gap.
const SELECTOR_PREFIX_PATTERN = /^(branch|name|id|issue|path):/i
function normalizePlacementPath(p) {
  const raw = String(p)
  if (SELECTOR_PREFIX_PATTERN.test(raw)) {
    return raw
  }
  return raw.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// Two placements collide if worker-start would run two agents in the same
// place at once: both fresh in the same worktree, or both reusing the
// identical existing terminal. Checked across the whole wave in
// dispatchStep, not just one planWave batch (see the comment there).
// Known, disclosed gap: a fresh placement and a terminal-reuse placement
// are never cross-checked, since this module has no lookup from a
// terminal handle to the worktree it is currently parked in.
function placementsCollide(a, b) {
  if (a.terminal && b.terminal) {
    return normalizePlacementPath(a.terminal) === normalizePlacementPath(b.terminal)
  }
  if (!a.terminal && !b.terminal) {
    return normalizePlacementPath(a.worktree) === normalizePlacementPath(b.worktree)
  }
  return false
}

function runNotFoundError() {
  const error = new Error('no Keep Going run for this project')
  error.code = 'TSF_RUN_NOT_FOUND'
  return error
}

// Claims the tick lock via one CAS (async only in the cross-process lock
// acquire -- the actual read-mutate-write stays synchronous once held).
// Throws (never silently no-ops) on any conflict -- the caller turns that
// into a clean, no-CLI-work-attempted result.
//
// `kind` was decided by tickKeepGoingRun's own routing check
// (inFlightWave ? SETTLE : DISPATCH) against a read taken BEFORE this
// lock was ever acquired -- with the lock's acquire phase now async (the
// cross-process fix), real wall-clock time can pass between that stale
// read and this claim actually running, wide enough for another tick to
// fully claim+dispatch+commit in between. Re-validating kind against the
// FRESH, lock-protected read here -- rather than trusting the caller's
// now-possibly-stale routing decision -- is what closes that window: a
// real, confirmed review finding (two near-simultaneous ticks could each
// create a genuine duplicate Orca task before either reached its own
// commit, defeating this module's core "reject before touching
// orchestration" guarantee, which held only by coincidence when the old
// claim path was fully synchronous with no real await before it).
async function claim(projectId, kind, clock, store, timeoutMs = TICK_LOCK_TIMEOUT_MS) {
  return store.withRun(projectId, (current) => {
    if (!current) {
      throw runNotFoundError()
    }
    const actuallyInFlight = !!current.inFlightWave
    const expectedInFlight = kind === 'SETTLE'
    if (actuallyInFlight !== expectedInFlight) {
      const error = new Error(
        `stale routing decision: this ${kind} claim expected inFlightWave=${expectedInFlight}, but the current run has inFlightWave=${actuallyInFlight} -- another tick changed it first`
      )
      error.code = 'TSF_STALE_ROUTING_DECISION'
      throw error
    }
    return claimTick(current, kind, clock, current.revision, timeoutMs)
  })
}

// Commits the tick's real mutation via a second synchronous CAS. mutateFn
// is always handed `expectedRevision` (the exact revision the claim
// produced) explicitly, alongside the freshly-read current run, and MUST
// use it for its FIRST real domain mutation -- never a mutation's own
// self-consistent revision, which is a tautology (current.revision always
// equals current.revision) and can never detect that the lock was
// recovered by another tick since the claim (a real, confirmed review
// finding: two commit paths omitted this and used self-checks instead).
// Threading it through this one wrapper, rather than each call site
// improvising its own commit, makes that omission structurally harder to
// repeat. Subsequent mutations within the SAME closure may use the
// just-produced value's own revision safely (nothing else can run between
// them -- this whole closure is one synchronous unit).
async function commitClaimed(projectId, store, claimed, mutateFn) {
  return store.withRun(projectId, (current) => mutateFn(current, claimed.revision))
}

// A commit lost the CAS race (lock timed out and was recovered by another
// tick, or some other conflict) -- report it honestly rather than retrying
// unboundedly or silently discarding real Orca side effects already made.
// Known, disclosed limitation: an orchestrationRunId/dispatchRecords
// created by the losing tick are not automatically merged onto whatever
// the winning tick produced (that would risk clobbering the winner's own,
// already-persisted reference) -- they are surfaced here for an operator
// or a future reconciliation pass, not silently lost from observability.
function lostLockResult(action, error, orphaned) {
  return {
    action: `${action}_LOST_LOCK`,
    reason: error.code ?? 'CONCURRENT_MODIFICATION',
    detail: error.message,
    ...orphaned
  }
}

function trimPlanToDispatched(wavePlan, dispatchedWorkItemIds) {
  const dispatched = new Set(dispatchedWorkItemIds)
  const batches = wavePlan.batches
    .map((batch) => batch.filter((item) => dispatched.has(item.id)))
    .filter((batch) => batch.length > 0)
  return { ...wavePlan, batches }
}

async function dispatchStep(projectId, candidateWorkItems, clock, orchestration, store, capacity, resourcePressure) {
  if (!Array.isArray(candidateWorkItems) || candidateWorkItems.length === 0) {
    return { action: 'NOOP', reason: 'no candidate work items available to plan a wave' }
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
  const admission = classifyDispatchAdmission(resourcePressure)
  if (!admission.admitted) {
    return { action: 'DISPATCH_WAITING_FOR_RESOURCES', ...admission }
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
    return commitAbortedDispatch(projectId, store, claimed, clock, { reason: senderTerminal.reason ?? 'SENDER_TERMINAL_UNAVAILABLE', detail: senderTerminal.detail ?? 'could not resolve a sender-terminal identity for dispatch' })
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
      return commitAbortedDispatch(projectId, store, claimed, clock, { reason: runResult.reason, detail: runResult.detail })
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
      return commitAbortedDispatch(projectId, store, claimed, clock, { reason: bindResult.reason, detail: bindResult.detail })
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
        spec: item.spec ?? item.id,
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

async function settleStep(projectId, clock, orchestration, store) {
  let claimed
  try {
    claimed = await claim(projectId, 'SETTLE', clock, store)
  } catch (error) {
    return {
      action: 'SETTLE_CLAIM_FAILED',
      reason: error.code ?? 'CLAIM_FAILED',
      detail: error.message
    }
  }

  const { inFlightWave, orchestrationRunId } = claimed
  const tasksResult = await orchestration.listOrchestrationTasks({ run: orchestrationRunId })
  if (!tasksResult.ok) {
    return commitReleaseOnly(projectId, store, claimed, clock, 'SETTLE_CHECK_FAILED', undefined, {
      reason: tasksResult.reason,
      detail: tasksResult.detail
    })
  }
  const tasksById = new Map((tasksResult.result?.tasks ?? []).map((t) => [t.id, t]))

  // Disclosed, deliberately not modeled further this wave (found live
  // reconciling a real stalled smoke dispatch): PENDING here conflates two
  // genuinely different states -- "worker-start's CLI call succeeded and a
  // real worker was assigned" (DISPATCH_SUCCEEDED, confirmed the moment
  // dispatchStep records the dispatchId) versus "the underlying agent
  // process has actually finished ITS OWN startup and begun the real
  // task" (AGENT_STARTUP_READY -- an agent can sit in its own startup
  // phase, e.g. stalled on an unrelated MCP server login, for a long
  // time after a fully successful dispatch, with Orca's own worker.state
  // still reporting 'ready'/'running' throughout). Distinguishing them
  // precisely would need surfacing worker-show's stage/observation
  // fields into this outcome, a real enhancement judged out of scope for
  // this milestone; PENDING here should be read as DISPATCH_SUCCEEDED
  // only, never as evidence the agent is actively working.
  const outcomes = []
  let allTerminal = true
  for (const record of inFlightWave.dispatchRecords) {
    const task = tasksById.get(record.taskId)
    const status = task?.status ?? 'unknown'
    if (COMPLETED_STATUSES.has(status)) {
      outcomes.push({ ...record, outcome: 'COMPLETED', rawStatus: status })
    } else if (FAILED_STATUSES.has(status)) {
      outcomes.push({ ...record, outcome: 'FAILED', rawStatus: status })
    } else {
      allTerminal = false
      outcomes.push({ ...record, outcome: 'PENDING', rawStatus: status })
    }
  }
  if (!allTerminal) {
    // No real per-worker heartbeat timestamp exists to feed keep-going.mjs's
    // own detectStall (mapOrchestrationFacts always emits lastHeartbeatAt:
    // null -- a disclosed, still-open limitation, see wave 11 finding 4).
    // What IS real: how long this wave has been dispatched. Past
    // stallThresholdMs with nothing terminal, escalate to STALLED so an
    // operator sees it, rather than looping WAVE_STILL_IN_FLIGHT forever
    // with no way out.
    const silentForMs = Date.parse(isoNow(clock)) - Date.parse(inFlightWave.dispatchedAt)
    if (silentForMs > claimed.budget.stallThresholdMs) {
      try {
        const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
          const stalledWorkItemIds = inFlightWave.dispatchRecords
            .filter((r) =>
              outcomes.some((o) => o.workItemId === r.workItemId && o.outcome === 'PENDING')
            )
            .map((r) => r.taskId)
          let stalled = markStalled(
            current,
            inFlightWave.dispatchRecords.filter((r) =>
              outcomes.some((o) => o.workItemId === r.workItemId && o.outcome === 'PENDING')
            ),
            clock,
            true, // tickInternal -- this tick still holds the lock it is releasing
            expectedRevision
          )
          // A real, confirmed gap found live: this branch was the only run-
          // level phase transition in this module with no explicit
          // checkpoint of its own -- state.transitions correctly recorded
          // the STALLED transition, but summarizeRun/the UI's "last
          // checkpoint" display would keep showing the pre-stall phase
          // (still WAVE_DISPATCHED) with no durable record of *why* or
          // *when* the stall was actually detected.
          stalled = checkpointRun(
            stalled,
            {
              phase: 'WAVE_STALLED',
              note: `silent for ${silentForMs}ms`,
              evidence: stalledWorkItemIds
            },
            clock
          )
          return releaseTick(stalled, clock, stalled.revision)
        })
        return { action: 'WAVE_STALLED', run: next, outcomes }
      } catch (error) {
        return lostLockResult('WAVE_STALLED', error, {})
      }
    }
    return commitReleaseOnly(projectId, store, claimed, clock, 'WAVE_STILL_IN_FLIGHT', outcomes)
  }

  // Captured by the mutateFn closure below rather than stashed on the run
  // object itself -- the run returned from mutateFn is exactly what gets
  // persisted (JSON.stringify'd), so any out-of-band signal must live
  // outside it, not as a throwaway property that would otherwise leak into
  // the saved state.
  let retryBudgetExceededOut = []
  try {
    const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) => {
      let n = current
      const retryBudgetExceeded = []
      outcomes.forEach((outcome, index) => {
        try {
          n = recordTaskAttempt(
            n,
            outcome.workItemId,
            outcome.outcome === 'FAILED' ? 'RETRY' : 'COMPLETED',
            clock,
            // Only the FIRST mutation in this closure needs the real
            // claim-time check (index === 0 ? expectedRevision) -- a real,
            // confirmed review finding was that every mutation here
            // previously used `n.revision` (self-consistent, a tautology
            // that can never detect the lock was recovered by another
            // tick since the claim). Subsequent iterations reusing the
            // now-validated `n.revision` is safe: nothing else can run
            // between them inside this one synchronous closure.
            index === 0 ? expectedRevision : n.revision
          )
        } catch (error) {
          if (error.code === 'TSF_RETRY_BUDGET_EXCEEDED') {
            retryBudgetExceeded.push(outcome.workItemId)
          } else {
            throw error
          }
        }
      })

      const waveResult = {
        schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
        outcomes,
        settledAt: null
      }
      n = settleInFlightWave(n, { ...waveResult, settledAt: n.updatedAt }, clock, n.revision)
      n = checkpointRun(
        n,
        { phase: 'WAVE_SETTLED', evidence: outcomes.map((o) => o.taskId) },
        clock
      )

      if (retryBudgetExceeded.length > 0) {
        // Reporting the breach alone doesn't stop anything: nothing
        // prevents the caller from handing the same exhausted work item
        // back in on the very next tick, immediately re-triggering the
        // same breach forever. Escalate to a real NEEDS_YOU question so an
        // operator actually sees it and the run stops silently spinning.
        n = raiseNeedsYou(
          n,
          {
            question: `Retry budget exceeded for work item(s): ${retryBudgetExceeded.join(', ')}. How should I proceed?`,
            options: ['RETRY_ANYWAY', 'SKIP_AND_CONTINUE', 'BLOCK_RUN']
          },
          clock,
          n.revision,
          true // tickInternal
        )
        n = checkpointRun(
          n,
          { phase: 'RETRY_BUDGET_NEEDS_YOU', evidence: retryBudgetExceeded },
          clock
        )
      }
      retryBudgetExceededOut = retryBudgetExceeded
      return releaseTick(n, clock, n.revision)
    })
    return {
      action: retryBudgetExceededOut.length > 0 ? 'WAVE_SETTLED_NEEDS_YOU' : 'WAVE_SETTLED',
      run: next,
      outcomes,
      ...(retryBudgetExceededOut.length > 0 ? { retryBudgetExceeded: retryBudgetExceededOut } : {})
    }
  } catch (error) {
    return lostLockResult('WAVE_SETTLED', error, {})
  }
}

async function commitReleaseOnly(projectId, store, claimed, clock, action, outcomes, extra = {}) {
  try {
    const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) =>
      releaseTick(current, clock, expectedRevision)
    )
    return { action, run: next, ...(outcomes ? { outcomes } : {}), ...extra }
  } catch (error) {
    return lostLockResult(action, error, {})
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

  const before = store.readRun(projectId)
  if (!before) {
    return { action: 'NOOP', reason: 'no Keep Going run for this project' }
  }
  if (before.state !== 'ACTIVE') {
    return { action: 'NOOP', reason: `run state is ${before.state}, not ACTIVE` }
  }
  if (before.inFlightWave) {
    // Settling an already-in-flight wave is a cheap read/reconcile of a
    // worker that already exists -- never gated. Only a genuinely NEW
    // heavyweight worker spawn (dispatchStep, below) consults the governor.
    return settleStep(projectId, clock, orchestration, store)
  }
  return dispatchStep(projectId, candidateWorkItems, clock, orchestration, store, capacity, resourcePressure)
}

// Recovers a run whose in-flight wave stalled AND releases the real Orca
// resource(s) that wave held. abandonKeepGoingStalledWave (keep-going-
// controller.mjs) only fences TSF's own bookkeeping -- without also
// telling Orca the dispatch is done, its worktree resource stays marked
// owned there, which can silently block a later worker-start into the
// same worktree (a real, live-confirmed gap: a manual UI acceptance
// retest hit exactly this after using the abandon button -- the retry's
// task was created but never dispatched, with zero trace in Orca's own
// worker-list). Captures dispatchRecords from the SAME `current` value
// the atomic mutate below observes, INSIDE the store.withRun closure --
// not a separate, unlocked pre-read (an independent review finding: this
// module's own expectedRevision check is a documented no-op when the
// caller omits it, so a prior version's "nothing could have raced the
// read" claim was only true for callers that always supply it, not as a
// module-level guarantee; reading from the exact object the CAS itself
// observes closes the gap unconditionally instead).
// Best-effort past the commit: a failure reconciling one dispatch with
// Orca does not undo or block the TSF-side fencing that already
// succeeded -- TSF's own state consistency must not depend on Orca's
// cooperation, matching this module's existing dispatch-failure handling.
export async function abandonAndReconcileStalledWave(
  projectId,
  reason,
  clock,
  expectedRevision,
  deps = {}
) {
  const orchestration = deps.orchestration ?? DEFAULT_ORCHESTRATION
  const store = deps.store ?? DEFAULT_STORE

  let abandonedDispatchIds = []
  const next = await store.withRun(projectId, (current) => {
    abandonedDispatchIds = (current?.inFlightWave?.dispatchRecords ?? [])
      .map((record) => record.dispatchId)
      .filter(Boolean)
    const { run } = abandonKeepGoingStalledWave(
      { keepGoingRuns: { [projectId]: current } },
      projectId,
      reason,
      clock,
      expectedRevision
    )
    return run
  })

  const orchestrationReconciliation = []
  for (const dispatchId of abandonedDispatchIds) {
    try {
      const result = await orchestration.abandonOrchestrationWorker({ dispatch: dispatchId })
      orchestrationReconciliation.push({
        dispatchId,
        ok: result.ok,
        reason: result.ok ? null : (result.reason ?? null)
      })
    } catch (error) {
      orchestrationReconciliation.push({ dispatchId, ok: false, reason: error.message })
    }
  }

  return { run: next, orchestrationReconciliation }
}
