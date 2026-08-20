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
import {
  bindOrchestrationRun,
  createOrchestrationRun,
  createOrchestrationTask,
  listOrchestrationTasks,
  startOrchestrationWorker
} from '../adapters/orca-orchestration-bridge.mjs'
import { isoNow } from '../domain/canonical.mjs'
import {
  checkpointRun,
  claimTick,
  dispatchWave,
  markStalled,
  planWave,
  raiseNeedsYou,
  recordTaskAttempt,
  releaseTick,
  settleInFlightWave,
  TICK_LOCK_TIMEOUT_MS
} from '../domain/keep-going.mjs'
import { readKeepGoingRun, withKeepGoingRun } from './keep-going-run-store.mjs'

const DEFAULT_ORCHESTRATION = Object.freeze({
  bindOrchestrationRun,
  createOrchestrationRun,
  createOrchestrationTask,
  listOrchestrationTasks,
  startOrchestrationWorker
})

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

// Resolves one work item's worker-start placement: reuse an existing
// terminal verbatim, or launch fresh into item.worktree (default 'current')
// with item.agent (default codex). `||`, not `??`, so an explicit empty
// string still falls back rather than reaching startOrchestrationWorker's
// own INVALID_ARGS rejection.
function resolveWorkerPlacement(item) {
  if (item.workerTerminal) {
    return { terminal: item.workerTerminal, ...(item.retryOf ? { retryOf: item.retryOf } : {}) }
  }
  return {
    worktree: item.worktree || 'current',
    agent: item.agent || DEFAULT_WORKER_AGENT,
    ...(item.retryOf ? { retryOf: item.retryOf } : {})
  }
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

async function dispatchStep(projectId, candidateWorkItems, clock, orchestration, store) {
  if (!Array.isArray(candidateWorkItems) || candidateWorkItems.length === 0) {
    return { action: 'NOOP', reason: 'no candidate work items available to plan a wave' }
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

  // Tracked separately from claimed.orchestrationRunId: a freshly-created
  // real Orca orchestration Run must be persisted even if every task-
  // create in this wave then fails, or it leaks -- forgotten by TSF but
  // still real in Orca -- and gets recreated on every retrying tick.
  let orchestrationRunId = claimed.orchestrationRunId
  const orchestrationRunFreshlyCreated = !orchestrationRunId
  if (!orchestrationRunId) {
    const runResult = await orchestration.createOrchestrationRun({
      objective: claimed.originalGoal.statement
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
    const bindResult = await orchestration.bindOrchestrationRun({ id: orchestrationRunId })
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
        spec: item.spec ?? item.id,
        run: orchestrationRunId,
        taskTitle: item.id
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
// partial-dispatch helper's own safety net for symmetry).
async function commitAbortedDispatch(projectId, store, claimed, clock, failure) {
  try {
    const next = await commitClaimed(projectId, store, claimed, (current, expectedRevision) =>
      releaseTick(current, clock, expectedRevision)
    )
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
        return releaseTick(n, clock, expectedRevision)
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

  const before = store.readRun(projectId)
  if (!before) {
    return { action: 'NOOP', reason: 'no Keep Going run for this project' }
  }
  if (before.state !== 'ACTIVE') {
    return { action: 'NOOP', reason: `run state is ${before.state}, not ACTIVE` }
  }
  if (before.inFlightWave) {
    return settleStep(projectId, clock, orchestration, store)
  }
  return dispatchStep(projectId, candidateWorkItems, clock, orchestration, store)
}
