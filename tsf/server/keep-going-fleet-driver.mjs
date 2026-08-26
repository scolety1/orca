// Stage H: the missing autonomous "keep going" heartbeat --
// keep-going-dispatch-loop.mjs's own header comment already names this
// exact gap ("a manual 'Run now' button, or LATER an `orca automations
// create --trigger cron` job; registering that recurring trigger is a
// separate decision, not made by this module"). This is that decision,
// made real: a bounded, durable, in-process interval that periodically
// re-ticks every eligible ACTIVE Keep Going run using ONLY the existing
// real primitives --
//   - tickKeepGoingRun (keep-going-dispatch-loop.mjs): settle an in-flight
//     wave, or dispatch a fresh one -- the exact CAS-safe, no-duplicate-
//     dispatch mechanic that module already provides.
//   - reconcileSettledRun (Stage F, settled-run-reconciler.mjs): capture
//     real late commits, dispatch independent verification, complete, or
//     escalate to NEEDS_YOU -- for a run that settled with nothing left
//     driving it forward.
// No new scheduler, no new locking, no new persistence -- this module's
// only real job is deciding, once per cycle, which already-real function
// to call for each already-real run, and how many to run at once.
//
// Deliberately NOT this module's job (matches keep-going-dispatch-loop.mjs's
// own disclosed scope boundary): planning a run's FIRST wave. A brand-new
// run (waves.length === 0, still PLANNING) needs real judgment about what
// work to do -- that is Command/chat's job today (planAndDispatchFromChat/
// planAndDispatchFromCommand), invoked once at Start time. This driver only
// takes over from the moment a first real wave exists onward: settling it,
// verifying it, and dispatching further real waves toward the SAME
// already-declared goal/acceptance criteria -- never inventing a new goal.
import { isRunExecuting } from '../domain/live-work-feed.mjs'
import { tickKeepGoingRun } from './keep-going-dispatch-loop.mjs'
import {
  reconcileSettledRun,
  deriveWorktreePath,
  verificationVerdictPath
} from './settled-run-reconciler.mjs'
import { readKeepGoingRun } from './keep-going-run-store.mjs'

export const DEFAULT_TICK_INTERVAL_MS = 30_000
// Fleet-wide throttle -- distinct from a single run's own
// budget.maxConcurrentWorkers (which bounds workers WITHIN one run's wave).
// This bounds how many DIFFERENT projects this driver ticks at once, so a
// fleet of 20 active runs doesn't all hit real Orca dispatch in the same
// instant (spec: "uses Fleet/host capacity limits rather than spawning
// everything simultaneously"). Real per-tick capacity (provider rate
// limits) is still separately enforced inside tickKeepGoingRun itself
// (capacity-policy.mjs) -- this is an additional, coarser fleet-shape
// throttle on top of that, not a replacement for it.
export const DEFAULT_MAX_CONCURRENT_TICKS = 2

// A run that already has a real verdict finding a criterion unsatisfied
// (Stage F's NEEDS_DECISION, not yet retry-budget-exceeded) needs a REAL
// next implementation wave, not another reconciliation pass against the
// same stale verdict -- this mechanically constructs that wave's spec
// from the run's own real, already-declared goal and the real evidence
// Stage F's verification task itself produced (never invented judgment on
// this driver's part), and explicitly instructs the worker to remove the
// now-stale verdict file so the next reconciliation pass re-verifies
// fresh work rather than reading a stale prior answer.
export function buildContinuationWorkItem(run, worktreePath, failedCriteria) {
  const criteriaList = failedCriteria
    .map((f) => `- ${f.criterion} (last evidence: ${f.evidence})`)
    .join('\n')
  return {
    id: 'tsf-keep-going-continuation',
    scope: ['**/*'],
    worktree: worktreePath,
    agent: 'codex',
    spec: [
      "This is an autonomous continuation dispatch from TSF's Keep Going fleet driver --",
      'no human is watching this in real time; work strictly within the constraints below.',
      `Original goal: ${run.originalGoal.statement}`,
      'Independent verification just found the following acceptance criteria still unsatisfied:',
      criteriaList,
      'Continue toward the original goal, addressing exactly these gaps, within all',
      'originally-declared constraints and stop conditions for this run:',
      ...run.constraints.map((c) => `- ${c}`),
      'Stop conditions (if any of these is genuinely true, stop and make no further changes',
      'rather than proceeding):',
      ...run.stopConditions.map((s) => `- ${s}`),
      `Before finishing, delete the file at ${verificationVerdictPath(run.id)} if it exists --`,
      'it reflects the OLD, now-stale verification result and must not be read as current.'
    ].join('\n')
  }
}

// Whether this run is a candidate the driver can act on at all this
// cycle -- ACTIVE, no open Needs You (that's Tim's decision, never
// silently driven past), and not already mid-tick from a prior overlapping
// cycle (see the `inProgress` guard in driveOneCycle below).
function isDriverEligible(run) {
  return run && run.state === 'ACTIVE' && run.needsYou.every((entry) => entry.resolvedAt)
}

async function advanceOneProject(projectId, clock, deps) {
  const store = deps.store ?? { readRun: readKeepGoingRun }
  const run = store.readRun(projectId)
  if (!isDriverEligible(run)) {
    return { projectId, action: 'SKIPPED', reason: run ? `run state is ${run.state}` : 'no run' }
  }

  if (isRunExecuting(run)) {
    // A real wave (implementation or verification -- both dispatch through
    // this same mechanic) is in flight: settle it. candidateWorkItems is
    // irrelevant on the settle path (tickKeepGoingRun routes on
    // inFlightWave alone), so an empty array is correct, not a shortcut.
    const result = await tickKeepGoingRun(projectId, [], clock, deps.tickDeps ?? {})
    return { projectId, action: 'TICKED', tickResult: result }
  }

  if (run.waves.length === 0) {
    // Genuinely PLANNING -- no first wave has ever been dispatched. Out of
    // this driver's scope by design; report it honestly rather than
    // silently skip with no trace.
    return {
      projectId,
      action: 'SKIPPED',
      reason: "awaiting an initial wave (planner/Command scope, not this driver's)"
    }
  }

  // Settled, unowned, at least one real wave recorded: Stage F's job.
  const reconciliation = await reconcileSettledRun(projectId, clock, deps)

  if (reconciliation.action === 'NEEDS_DECISION' && !reconciliation.retryBudgetExceeded) {
    // Stage F already checkpointed the finding and recorded the retry
    // attempt -- this driver's own, distinct job is dispatching the real
    // next wave toward those specific gaps, using the exact evidence Stage
    // F's own verification task produced.
    const worktreePath = deriveWorktreePath(store.readRun(projectId))
    if (!worktreePath) {
      return {
        projectId,
        action: 'RECONCILED',
        reconciliation,
        reason: 'no known worktree to continue in'
      }
    }
    const continuationResult = await tickKeepGoingRun(
      projectId,
      [buildContinuationWorkItem(store.readRun(projectId), worktreePath, reconciliation.failed)],
      clock,
      deps.tickDeps ?? {}
    )
    return { projectId, action: 'RECONCILED_AND_CONTINUED', reconciliation, continuationResult }
  }

  return { projectId, action: 'RECONCILED', reconciliation }
}

// One bounded pass over `projectIds` -- processes up to `maxConcurrentTicks`
// projects at once (a simple worker-pool, not Promise.all(unbounded)), and
// one project's failure never aborts the others (mirrors
// planAndDispatchFromCommand's own established "continue past failures"
// convention) -- caught and reported per-project instead.
export async function driveOneCycle(
  projectIds,
  clock,
  deps = {},
  maxConcurrentTicks = DEFAULT_MAX_CONCURRENT_TICKS
) {
  const results = Array.from({ length: projectIds.length })
  let cursor = 0
  async function worker() {
    while (cursor < projectIds.length) {
      const index = cursor
      cursor += 1
      const projectId = projectIds[index]
      try {
        results[index] = await advanceOneProject(projectId, clock, deps)
      } catch (error) {
        results[index] = { projectId, action: 'ERROR', reason: error.message }
      }
    }
  }
  const pool = Array.from(
    { length: Math.max(1, Math.min(maxConcurrentTicks, projectIds.length || 1)) },
    worker
  )
  await Promise.all(pool)
  return results
}

// Starts the durable heartbeat: every `intervalMs`, calls
// `listEligibleProjectIds()` (real caller wires this to the real project
// catalog + opState.keepGoingRuns, e.g. every project with an ACTIVE run)
// and drives one bounded cycle over the result. Survives UI
// navigation/disconnect and a TSF backend restart by construction -- all
// state this driver reads/writes is the same durable, file-locked Keep
// Going run store every other caller already uses; a fresh process calling
// this again simply resumes ticking whatever is still ACTIVE on disk, no
// separate recovery step needed (a stale tick lock left by a crashed
// process already self-heals via TICK_LOCK_TIMEOUT_MS, the same real
// mechanism an HTTP-triggered tick already relies on).
//
// `inProgress` guards against a cycle overlapping the next: if a cycle is
// still running when the interval fires again (a slow real dispatch), the
// new firing is skipped rather than starting a second concurrent pass over
// the same projects (tickKeepGoingRun's own CAS would reject a genuine
// double-dispatch anyway, but skipping avoids wasted, guaranteed-to-fail
// duplicate work and keeps `onCycle` results meaningful per real cycle).
export function startKeepGoingFleetDriver({
  listEligibleProjectIds,
  clock = () => new Date(),
  intervalMs = DEFAULT_TICK_INTERVAL_MS,
  maxConcurrentTicks = DEFAULT_MAX_CONCURRENT_TICKS,
  onCycle = () => {},
  onError = () => {},
  ...deps
} = {}) {
  let stopped = false
  let inProgress = false
  async function fire() {
    if (stopped || inProgress) {
      return
    }
    inProgress = true
    try {
      const projectIds = await listEligibleProjectIds()
      const results = await driveOneCycle(projectIds, clock, deps, maxConcurrentTicks)
      onCycle(results)
    } catch (error) {
      onError(error)
    } finally {
      inProgress = false
    }
  }
  const timer = setInterval(fire, intervalMs)
  // unref so this driver's own interval never keeps a real process alive
  // on its own -- the server process's real work (its HTTP listener) is
  // what should determine process lifetime, not this background loop.
  timer.unref?.()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
    // Exposed for tests and for a manual "tick the fleet now" trigger --
    // runs one real cycle immediately, outside the interval schedule.
    fireNow: fire
  }
}
