// PlannerSessionLifecycle -- the Checkpoint -> Relinquish -> Hydrate
// orchestration (2C) over planner-mission-store.mjs + the pure domain
// mutators in planner-mission-checkpoint.mjs/planner-mission-lease.mjs.
//
// Deliberately holds almost no state of its own: missionId, plannerSessionId,
// and injected deps only. Every read (getCheckpoint/getWorkers/getNeedsYou)
// re-reads the durable store rather than an in-memory cache -- the whole
// point of "the mission outlives the planner session" is that a fresh
// instance, given nothing but the missionId, sees exactly what a prior
// instance left durable. This is what the golden rollover test exercises:
// two independent instances, connected only through the file-backed store.
import { classifyDispatchAdmission } from '../domain/resource-pressure-governor.mjs'
import {
  advancePhase as advancePhaseCheckpoint,
  assertRepoStateContinuity,
  completePlannerMission,
  createPlannerMissionCheckpoint,
  findWorkerByTaskFingerprint,
  raisePlannerNeedsYou,
  recordDecision as recordDecisionCheckpoint,
  recordVerifierResult as recordVerifierResultCheckpoint,
  recordWorkerResult as recordWorkerResultCheckpoint,
  registerDispatchedWorker,
  resolvePlannerNeedsYou,
  setLastAction,
  setNextIntendedAction
} from '../domain/planner-mission-checkpoint.mjs'
import { isPlannerMissionLeaseLive } from '../domain/planner-mission-lease.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'
import { observeCanonicalRepoState } from './planner-mission-repo-state.mjs'
import {
  acquirePlannerLease,
  mutateCheckpoint,
  readPlannerMissionRecord,
  relinquishPlannerLease,
  renewPlannerLease
} from './planner-mission-store.mjs'

// The one admission category chat-dispatch-bridge.mjs already gates real
// Claude/Codex worker dispatch on (REUSE_DIRECTLY, not a new category): a
// planner session is itself exactly this kind of heavyweight dispatch.
const ADMISSION_FIELD = 'newHeavyweightWorkerDispatch'

export class PlannerSessionLifecycle {
  constructor({ missionId, plannerSessionId, deps = {} }) {
    if (!missionId || !plannerSessionId) { throw new Error('PlannerSessionLifecycle requires missionId and plannerSessionId') }
    this.missionId = missionId
    this.plannerSessionId = plannerSessionId
    this.deps = {
      clock: deps.clock ?? (() => new Date()),
      collectHostMemoryEvidence: deps.collectHostMemoryEvidence ?? collectHostMemoryEvidence,
      observeRepoState: deps.observeRepoState ?? ((cwd) => observeCanonicalRepoState(cwd)),
      cwd: deps.cwd ?? process.cwd(),
      dispatchWorker: deps.dispatchWorker ?? null,
      leaseTtlMs: deps.leaseTtlMs
    }
  }

  // 2F: creating/resuming a planner session must respect the Resource
  // Pressure Governor -- fail closed, never race ahead of insufficient
  // capacity. Real reuse of the one shared classifier (independent-review
  // finding this codebase already disclosed: don't re-implement this a 4th
  // time).
  _assertResourceAdmission() {
    const hostMemory = this.deps.collectHostMemoryEvidence()
    const { admitted, tier, reason } = classifyDispatchAdmission(hostMemory, ADMISSION_FIELD)
    if (!admitted) {
      const error = new Error(`planner session blocked by Resource Pressure Governor (tier ${tier}): ${reason}`)
      error.code = 'TSF_PLANNER_SESSION_BLOCKED_BY_RESOURCE_PRESSURE'
      error.tier = tier
      throw error
    }
  }

  _requireLease(record) {
    const lease = record?.lease
    if (!isPlannerMissionLeaseLive(lease, this.deps.clock()) || lease.holderPlannerSessionId !== this.plannerSessionId) {
      const error = new Error(`planner session ${this.plannerSessionId} does not currently hold the mission lease for ${this.missionId}`)
      error.code = 'TSF_PLANNER_LEASE_NOT_HELD'
      throw error
    }
  }

  // Any mutation must be made by the live lease holder -- structurally
  // prevents a preempted/stale planner (still alive in-process, but rolled
  // over) from mutating mission state after a successor took over (2D).
  async _mutate(checkpointMutator) {
    const record = readPlannerMissionRecord(this.missionId)
    this._requireLease(record)
    return mutateCheckpoint(this.missionId, (current) => checkpointMutator(current, this.deps.clock), this.deps.clock)
  }

  async startMission({ missionGoal, phase, repoState }) {
    this._assertResourceAdmission()
    const existing = readPlannerMissionRecord(this.missionId)
    if (existing?.checkpoint) {
      const error = new Error(`mission ${this.missionId} already has a durable checkpoint -- use acquireLeaseAndHydrate to resume it`)
      error.code = 'TSF_PLANNER_MISSION_ALREADY_STARTED'
      throw error
    }
    const outcome = await acquirePlannerLease(this.missionId, this.plannerSessionId, this.deps.clock, { ttlMs: this.deps.leaseTtlMs, boundary: 'MISSION_START' })
    if (!outcome.granted) {
      const error = new Error(outcome.reason)
      error.code = 'TSF_PLANNER_LEASE_DENIED'
      throw error
    }
    return mutateCheckpoint(this.missionId, () => createPlannerMissionCheckpoint({ missionId: this.missionId, missionGoal, phase, repoState }, this.deps.clock), this.deps.clock)
  }

  // 2C's hydrate step: acquire (must succeed -- prior holder must have
  // relinquished or gone stale), read the durable checkpoint, verify repo
  // continuity. Never fabricates continuity: a null/mismatched observed
  // repo state throws rather than silently proceeding.
  async acquireLeaseAndHydrate({ observedRepoState } = {}) {
    this._assertResourceAdmission()
    const outcome = await acquirePlannerLease(this.missionId, this.plannerSessionId, this.deps.clock, { ttlMs: this.deps.leaseTtlMs, boundary: 'HYDRATE_TAKEOVER' })
    if (!outcome.granted) {
      const error = new Error(outcome.reason)
      error.code = 'TSF_PLANNER_LEASE_DENIED'
      throw error
    }
    const record = readPlannerMissionRecord(this.missionId)
    if (!record?.checkpoint) {
      const error = new Error(`no durable checkpoint exists for mission ${this.missionId} to hydrate from`)
      error.code = 'TSF_PLANNER_NO_CHECKPOINT_TO_HYDRATE'
      throw error
    }
    const observed = observedRepoState ?? this.deps.observeRepoState(this.deps.cwd)
    assertRepoStateContinuity(record.checkpoint, observed)
    return record.checkpoint
  }

  async renewLease() {
    return renewPlannerLease(this.missionId, this.plannerSessionId, this.deps.clock, { ttlMs: this.deps.leaseTtlMs })
  }

  getCheckpoint() {
    return readPlannerMissionRecord(this.missionId)?.checkpoint ?? null
  }

  getLease() {
    return readPlannerMissionRecord(this.missionId)?.lease ?? null
  }

  getWorkers() {
    return Object.values(this.getCheckpoint()?.workers ?? {})
  }

  getNeedsYou() {
    return this.getCheckpoint()?.needsYou ?? []
  }

  // Idempotent by taskFingerprint (default: taskId): if a worker for this
  // exact task is already registered (dispatched by this session or a
  // predecessor), the real external dispatcher is never called again --
  // this is what "no re-dispatch after rollover" and "no double-spend of
  // dispatch capacity" actually means at the mechanism level, not just a
  // policy statement.
  async dispatchWorkerForTask({ taskId, kind, taskFingerprint = taskId }) {
    const checkpoint = this.getCheckpoint()
    if (!checkpoint) { throw new Error(`mission ${this.missionId} has no checkpoint yet -- call startMission or acquireLeaseAndHydrate first`) }
    const existing = findWorkerByTaskFingerprint(checkpoint, taskFingerprint)
    if (existing) {
      return { alreadyDispatched: true, worker: existing }
    }
    if (!this.deps.dispatchWorker) { throw new Error('no dispatchWorker dependency configured') }
    this._requireLease(readPlannerMissionRecord(this.missionId))
    const dispatched = await this.deps.dispatchWorker({ taskId, kind, taskFingerprint })
    if (!dispatched?.workerId) { throw new Error('dispatchWorker did not return a workerId') }
    const next = await this._mutate((current, clock) => registerDispatchedWorker(current, { workerId: dispatched.workerId, kind, taskFingerprint }, clock))
    return { alreadyDispatched: false, worker: next.workers[dispatched.workerId] }
  }

  async recordWorkerResult(workerId, result) {
    return this._mutate((current, clock) => recordWorkerResultCheckpoint(current, workerId, result, clock))
  }

  async raiseNeedsYou(item) {
    return this._mutate((current, clock) => raisePlannerNeedsYou(current, item, clock))
  }

  async resolveNeedsYou(needsYouId, resolution) {
    return this._mutate((current, clock) => resolvePlannerNeedsYou(current, needsYouId, resolution, clock))
  }

  async recordDecision(decision) {
    return this._mutate((current, clock) => recordDecisionCheckpoint(current, decision, clock))
  }

  async recordVerifierResult(verifierResult) {
    return this._mutate((current, clock) => recordVerifierResultCheckpoint(current, verifierResult, clock))
  }

  async advancePhase(phase) {
    return this._mutate((current, clock) => advancePhaseCheckpoint(current, phase, clock))
  }

  // Explicit "I am about to retire" checkpoint write (2C/2E EXPLICIT_RETIREMENT
  // trigger) -- distinct from every other mutator above (which already
  // persist immediately) only in that it records what the outgoing planner
  // believes should happen next, for the successor to read.
  async checkpoint({ lastAction, nextIntendedAction } = {}) {
    return this._mutate((current, clock) => {
      let next = current
      if (lastAction) { next = setLastAction(next, lastAction, clock) }
      if (nextIntendedAction) { next = setNextIntendedAction(next, nextIntendedAction, clock) }
      return next
    })
  }

  // Relinquish is intentionally tolerant of "not currently held" (a
  // preempted session retiring after losing its lease already) -- see
  // relinquishPlannerMissionLease's own graceful non-throw for that case.
  async relinquish() {
    return relinquishPlannerLease(this.missionId, this.plannerSessionId, this.deps.clock)
  }

  async retire({ reason = 'EXPLICIT_RETIREMENT' } = {}) {
    await this.checkpoint({ lastAction: { type: 'RETIRE', reason } })
    return this.relinquish()
  }

  async completeMission() {
    return this._mutate((current, clock) => completePlannerMission(current, clock))
  }
}
