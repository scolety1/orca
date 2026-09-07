// ResearchMission Autonomy Driver V0 -- the missing autonomous heartbeat
// for Dataset Research, mirroring keep-going-fleet-driver.mjs's own proven
// architecture exactly (same setInterval+unref+inProgress-guard shape, same
// bounded worker-pool driveOneCycle, same restraint: no new scheduler, no
// new locking, no new persistence -- this module's only real job is
// deciding, once per cycle, which already-real durable primitive to call
// for each already-real mission).
//
// Claude/PLANNER_DEEP is the research director in the sense that already
// matters here: the POLICY this driver mechanically executes (verify then
// detect-conflicts then auto-accept a single verified claim or escalate a
// genuine conflict; retry a failed dispatch up to a small bounded budget
// then escalate) was decided once, durably, in domain/research-autonomy-
// policy.mjs and server/research-mission-driver.mjs's already-proven
// verifyAndReconcileResearchNodeFieldDurable -- this driver never calls a
// live planner per tick and never invents new research judgment, exactly
// like keep-going-fleet-driver.mjs never invents a new goal.
import {
  decideNextMissionAction,
  DEFAULT_RESEARCH_RETRY_BUDGET
} from '../domain/research-autonomy-policy.mjs'
import { findResearchNode, escalateResearchNodeToNeedsYou, completeResearchMission } from '../domain/research-mission.mjs'
import { recordResearchNodeAttempt } from '../domain/research-node.mjs'
import { computeCompletenessMetrics } from '../domain/research-completeness.mjs'
import { classifyDispatchAdmission } from '../domain/resource-pressure-governor.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'
import {
  attemptFreeResearchProgressDurable,
  dispatchResearchNodeDurable,
  dispatchResearchNodeWithApprovalDurable,
  pollAndAdmitResearchNodeDurable,
  verifyAndReconcileResearchNodeFieldDurable
} from './research-mission-driver.mjs'
import { readResearchMission, withResearchMission } from './research-mission-store.mjs'
import { emptyPlatformLearningLedger, recordLessonsFromCompletedMission } from '../domain/platform-learning-ledger.mjs'
import { withPlatformLearningLedger } from './platform-learning-ledger-store.mjs'

export const DEFAULT_TICK_INTERVAL_MS = 30_000
// Same fleet-shape throttle keep-going-fleet-driver.mjs applies, for the
// same reason: bounds how many DIFFERENT missions this driver ticks at
// once, distinct from any one mission's own per-node concurrency.
export const DEFAULT_MAX_CONCURRENT_TICKS = 2

// Resource Pressure Governor gate, checked BEFORE any real dispatch (new or
// retry) -- never before POLL/VERIFY_AND_RECONCILE_FIELD/ESCALATE, which
// are cheap local reads/durable-record writes, not new heavyweight workers.
// Mirrors chat-dispatch-bridge.mjs's own gate exactly: only hard-refuses at
// CRITICAL/EMERGENCY, reads real os.freemem()/totalmem() by default,
// test-overridable via deps.collectHostMemoryEvidence or the collector's
// own TSF_RESOURCE_PRESSURE_TEST_*_BYTES env-var seam. Delegates the
// actual classification to the one shared domain-level implementation
// (independent-review finding: this pattern was independently
// re-implemented in three places across this codebase).
function isDispatchAdmitted(deps) {
  const readHostMemory = deps.collectHostMemoryEvidence ?? collectHostMemoryEvidence
  return classifyDispatchAdmission(readHostMemory(), 'newResearchWorkers')
}

async function executeDispatchAction(missionId, nodeId, isRetry, clock, deps) {
  const { admitted, tier } = isDispatchAdmitted(deps)
  if (!admitted) {
    // Represents the wait honestly -- the node stays exactly as it is
    // (READY or FAILED-with-budget-remaining); the next cycle tries again.
    // Never FAILED/STALLED merely because the HOST, not the research
    // itself, was not ready.
    return { missionId, nodeId, action: 'WAITING_FOR_RESOURCES', tier }
  }

  if (isRetry) {
    try {
      await withResearchMission(missionId, (m) =>
        recordResearchNodeAttempt(m, nodeId, 'RETRY', clock, m.revision, deps.retryBudget ?? DEFAULT_RESEARCH_RETRY_BUDGET)
      )
    } catch (error) {
      if (error.code !== 'TSF_RESEARCH_RETRY_BUDGET_EXCEEDED') {
        throw error
      }
      // Defensive: decideNextNodeAction already checks the budget before
      // ever returning RETRY_DISPATCH, so this only fires if a concurrent
      // tick advanced retryCount in the window between decide and here --
      // still handled honestly, never left as an uncaught rejection.
      await withResearchMission(missionId, (m) =>
        escalateResearchNodeToNeedsYou(m, nodeId, { question: error.message, category: 'SOURCE_UNAVAILABLE' }, clock, m.revision)
      )
      return { missionId, nodeId, action: 'ESCALATED', reason: error.message }
    }
  }

  // Real, free, $0 progress first -- always attempted regardless of
  // whether a real provider is configured for new paid/metered dispatch.
  // "Lack of paid authority is not a reason to stop free independent
  // work" -- this is that free work, every tick, before ever considering
  // spend.
  const freeProgress = await attemptFreeResearchProgressDurable(missionId, clock)

  // A node this driver is trying to dispatch starts PENDING or READY, not
  // ADMITTED/COMPLETED -- attemptFreeResearchProgressDurable only ever
  // advances a node to ADMITTED (never merely to READY, which
  // dispatchResearchNodeDurable itself sets as ITS OWN first step below).
  // Checking for that specific real-resolution status, not "not READY",
  // is what correctly distinguishes "reuse actually resolved this" from
  // "reuse ran and found nothing, still needs a real dispatch."
  const node = findResearchNode(readResearchMission(missionId), nodeId)
  if (node.status === 'ADMITTED' || node.status === 'COMPLETED') {
    // Free-path library reuse alone resolved this node this tick -- real
    // progress, zero network calls, zero cost.
    return { missionId, nodeId, action: 'FREE_PATH_PROGRESS', freeProgress }
  }

  if (!deps.worker) {
    // No real provider/worker configured for this mission -- free-path
    // progress was still attempted above; this driver never guesses at a
    // provider to call, matching chat-dispatch-bridge.mjs's own "no safe
    // default" discipline for placement/identity.
    return { missionId, nodeId, action: 'SKIPPED_NO_PROVIDER_CONFIGURED', freeProgress }
  }

  // Real constraint of the durable dispatch primitive (by design, not a
  // bug): buildBoundedResearchRequest's taskFingerprint depends only on
  // (nodeId, researchQuestion, requestedOutputSchema, provider) -- none of
  // which change between attempts -- so redispatching the SAME provider
  // after a bad/failed result would be classified AT_LEAST_ONCE/
  // EXACTLY_ONCE and short-circuit as alreadyDispatched, never actually
  // asking again. A genuine correction retry therefore uses a DIFFERENT
  // provider when one is configured -- "automatic continuation to
  // independent work when one node/source is blocked," exactly as the
  // governing directive requires -- falling back to the same provider
  // (still safe, just a no-op re-ask) only if no distinct retry provider
  // was configured.
  // NOTE: providerId is a cost/bookkeeping label only -- dispatch always
  // runs deps.worker. Never set retryProviderId to a label naming a
  // DIFFERENT provider than deps.worker actually is (currently unreachable:
  // no bootstrap configures retryProviderId today).
  const providerId = node.retryCount > 0 && deps.retryProviderId ? deps.retryProviderId : deps.providerId ?? 'DEFAULT'
  // Paid providers remain default-OFF: dispatchResearchNodeWithApprovalDurable
  // itself refuses cleanly (NO_PAID_APPROVAL) with no dispatch attempted at
  // all when no scoped approval is currently active -- this driver never
  // grants one, only consumes an already-existing, already-scoped grant.
  const dispatchResult = deps.requiresPaidApproval
    ? await dispatchResearchNodeWithApprovalDurable(missionId, nodeId, providerId, deps.worker, clock, {
        pricingPolicy: deps.pricingPolicy
      })
    : await dispatchResearchNodeDurable(missionId, nodeId, providerId, deps.worker, clock)
  return { missionId, nodeId, action: 'DISPATCHED', dispatchResult }
}

// Whether this mission is a candidate the driver can act on at all this
// cycle -- ACTIVE with no open Needs You is already checked inside
// decideNextMissionAction; this is the cheaper pre-filter for
// listEligibleMissionIds callers (mirrors isDriverEligible in
// keep-going-fleet-driver.mjs).
export function isDriverEligible(mission) {
  return Boolean(mission) && mission.state === 'ACTIVE' && mission.needsYou.every((entry) => entry.resolvedAt)
}

export async function advanceOneMission(missionId, clock, deps = {}) {
  const mission = readResearchMission(missionId)
  if (!mission) {
    return { missionId, action: 'SKIPPED', reason: 'unknown mission' }
  }
  const budget = deps.retryBudget ?? DEFAULT_RESEARCH_RETRY_BUDGET
  const decision = decideNextMissionAction(mission, budget)

  if (decision.type === 'NOTHING_TO_DO') {
    return { missionId, action: 'SKIPPED', reason: decision.reason }
  }
  if (decision.type === 'POLL') {
    if (!deps.worker) {
      return { missionId, nodeId: decision.nodeId, action: 'SKIPPED_NO_PROVIDER_CONFIGURED' }
    }
    const result = await pollAndAdmitResearchNodeDurable(missionId, decision.nodeId, deps.worker, clock)
    return { missionId, nodeId: decision.nodeId, action: 'POLLED', result }
  }
  if (decision.type === 'DISPATCH') {
    return executeDispatchAction(missionId, decision.nodeId, false, clock, deps)
  }
  if (decision.type === 'RETRY_DISPATCH') {
    return executeDispatchAction(missionId, decision.nodeId, true, clock, deps)
  }
  if (decision.type === 'VERIFY_AND_RECONCILE_FIELD') {
    const result = await verifyAndReconcileResearchNodeFieldDurable(
      missionId,
      decision.nodeId,
      decision.fieldName,
      'RESEARCH_AUTONOMY_DRIVER_V0',
      clock
    )
    return { missionId, nodeId: decision.nodeId, action: 'VERIFIED_AND_RECONCILED', result }
  }
  if (decision.type === 'ESCALATE') {
    await withResearchMission(missionId, (m) =>
      escalateResearchNodeToNeedsYou(m, decision.nodeId, { question: decision.question, category: decision.category }, clock, m.revision)
    )
    return { missionId, nodeId: decision.nodeId, action: 'ESCALATED', reason: decision.question }
  }
  // CHECK_COMPLETE -- every node is terminal (COMPLETED/ADMITTED/CANCELLED/
  // BLOCKED); only actually completes the mission when completeness itself
  // (canonicalFacts/typedMissingness/conflicts -- never node.status alone,
  // matching computeCompletenessMetrics' own established discipline) says
  // there is nothing left outstanding.
  const completeness = computeCompletenessMetrics(mission, clock)
  // Gates on requiredFieldCoverage, not fieldCoverage: an unresolved
  // OPTIONAL_ENRICHMENT field must never block COMPLETE (real free-path
  // research execution finding -- see research-completeness.mjs).
  const fieldsResolved = completeness.requiredFieldCoverage === null || completeness.requiredFieldCoverage === 1
  if (fieldsResolved && completeness.unresolvedConflictCount === 0) {
    const completedMission = await withResearchMission(missionId, (m) => completeResearchMission(m, clock, m.revision))
    // REQ-002: the real wiring point -- every mission that actually reaches
    // COMPLETE here durably feeds the cross-mission Platform Learning
    // Ledger. A ledger-extraction failure must never un-complete an
    // already-durably-completed mission, but nothing here is expected to
    // throw under normal conditions: extraction reads only already-admitted,
    // already-validated mission state.
    let lessonsRecorded = 0
    await withPlatformLearningLedger((current) => {
      const result = recordLessonsFromCompletedMission(current ?? emptyPlatformLearningLedger(), completedMission, clock)
      lessonsRecorded = result.lessonsRecorded
      return result.ledger
    })
    return { missionId, action: 'COMPLETED', completeness, lessonsRecorded }
  }
  return {
    missionId,
    action: 'SKIPPED',
    reason: 'every node is terminal but completeness is not yet fully satisfied (likely a BLOCKED node awaiting a human decision)',
    completeness
  }
}

// One bounded pass over `missionIds` -- processes up to `maxConcurrentTicks`
// at once (a simple worker-pool, not Promise.all(unbounded)); one
// mission's failure never aborts the others, mirroring keep-going-fleet-
// driver.mjs's own driveOneCycle exactly.
export async function driveOneCycle(
  missionIds,
  clock,
  deps = {},
  maxConcurrentTicks = DEFAULT_MAX_CONCURRENT_TICKS
) {
  const results = Array.from({ length: missionIds.length })
  let cursor = 0
  async function worker() {
    while (cursor < missionIds.length) {
      const index = cursor
      cursor += 1
      const missionId = missionIds[index]
      try {
        results[index] = await advanceOneMission(missionId, clock, deps) // eslint-disable-line no-await-in-loop
      } catch (error) {
        results[index] = { missionId, action: 'ERROR', reason: error.message }
      }
    }
  }
  const pool = Array.from(
    { length: Math.max(1, Math.min(maxConcurrentTicks, missionIds.length || 1)) },
    worker
  )
  await Promise.all(pool)
  return results
}

// Starts the durable heartbeat -- identical shape to
// startKeepGoingFleetDriver: survives UI navigation/disconnect and a TSF
// backend restart by construction (all state read/written here is the same
// durable, file-locked research mission store every other caller already
// uses -- a fresh process calling this again simply resumes ticking
// whatever is still ACTIVE on disk; a stale tick lock left by a crashed
// process self-heals via the store's own existing lock-staleness
// mechanism, the same one an HTTP-triggered call already relies on).
export function startResearchMissionFleetDriver({
  listEligibleMissionIds,
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
      const missionIds = await listEligibleMissionIds()
      const results = await driveOneCycle(missionIds, clock, deps, maxConcurrentTicks)
      onCycle(results)
    } catch (error) {
      onError(error)
    } finally {
      inProgress = false
    }
  }
  const timer = setInterval(fire, intervalMs)
  // unref so this driver's own interval never keeps a real process alive
  // on its own -- the server process's real work (its HTTP listener)
  // determines process lifetime, not this background loop.
  timer.unref?.()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
    // Exposed for tests and for a manual "tick research now" trigger --
    // runs one real cycle immediately, outside the interval schedule.
    fireNow: fire
  }
}
