// TSF_PLANNER_MISSION_CHECKPOINT_V1 -- the durable "mission outlives the
// planner session" record (PLANNER_CONTEXT_LIFECYCLE_V0, Phase 2 of the
// Autonomous Post-Cleanup Upgrade Program). Structured, not prose-only, so
// a fresh planner session can rehydrate deterministically: goal, phase,
// canonical repo state, decisions, blockers, Needs-You, workers (durable
// registry, not one session's in-memory list), verifier results,
// completed/outstanding tasks, resource state, authority grants, lessons,
// and last/next action. Pure domain logic only -- persistence lives in
// server/planner-mission-store.mjs.
//
// Modeled on research-mission.mjs's revisioned-record convention
// (REUSE_PATTERN, not REUSE_CODE: a research mission's execution/epistemic
// shape doesn't fit a planner's own goal/decision/worker shape). Unlike
// research-mission.mjs, mutators here do NOT enforce expectedRevision --
// server/planner-mission-store.mjs's withPlannerMissionRecord already gives
// every mutation its own atomic read-under-lock, so a second CAS layer here
// would be redundant for V0; revision is kept for observability/debugging.
import { isoNow, sha256 } from './canonical.mjs'

const REQUIRED_CREATE_FIELDS = ['missionId', 'missionGoal', 'phase']

function requireRepoState(repoState) {
  if (!repoState || typeof repoState.branch !== 'string' || typeof repoState.sha !== 'string') {
    throw new Error('planner mission checkpoint requires repoState.{branch, sha} -- refusing to fabricate canonical repo state')
  }
}

export function createPlannerMissionCheckpoint(input, clock) {
  for (const key of REQUIRED_CREATE_FIELDS) {
    if (!input[key]) { throw new Error(`planner mission checkpoint requires ${key}`) }
  }
  requireRepoState(input.repoState)
  const now = isoNow(clock)
  return {
    schemaVersion: 'TSF_PLANNER_MISSION_CHECKPOINT_V1',
    missionId: input.missionId,
    revision: 0,
    missionState: 'ACTIVE',
    missionGoal: input.missionGoal,
    phase: input.phase,
    repoState: { branch: input.repoState.branch, sha: input.repoState.sha, worktreePath: input.repoState.worktreePath ?? null },
    decisions: [],
    blockers: [],
    needsYou: [],
    workers: {},
    verifierResults: [],
    completedTasks: [],
    outstandingTasks: [],
    resourceState: null,
    authority: { grants: [] },
    lessons: [],
    lastAction: null,
    nextIntendedAction: null,
    createdAt: now,
    updatedAt: now
  }
}

function touch(checkpoint, clock) {
  return { ...checkpoint, revision: checkpoint.revision + 1, updatedAt: isoNow(clock) }
}

// Verifies a rehydrating planner's observed repo state still matches what
// the checkpoint recorded -- 2C's "re-confirm canonical repo state still
// matches". worktreePath is deliberately NOT compared: a successor planner
// legitimately runs from a different worktree/host for the same branch+sha
// (SSH/remote host use case). Fails honest (throws) rather than silently
// continuing over drift.
export function assertRepoStateContinuity(checkpoint, observedRepoState) {
  if (!observedRepoState || typeof observedRepoState.branch !== 'string' || typeof observedRepoState.sha !== 'string') {
    const error = new Error('cannot verify repo-state continuity: observed repo state is missing or ambiguous')
    error.code = 'TSF_PLANNER_REPO_STATE_UNVERIFIABLE'
    throw error
  }
  const drifted = checkpoint.repoState.branch !== observedRepoState.branch || checkpoint.repoState.sha !== observedRepoState.sha
  if (drifted) {
    const error = new Error(
      `repo-state drift: checkpoint recorded ${checkpoint.repoState.branch}@${checkpoint.repoState.sha}, observed ${observedRepoState.branch}@${observedRepoState.sha}`
    )
    error.code = 'TSF_PLANNER_REPO_STATE_DRIFT'
    throw error
  }
  return true
}

export function recordDecision(checkpoint, { summary, kind, by = null }, clock) {
  if (!summary || (kind !== 'ACCEPTED' && kind !== 'REJECTED')) {
    throw new Error('a decision requires a summary and kind ACCEPTED|REJECTED')
  }
  const at = isoNow(clock)
  const entry = { id: sha256({ summary, kind, at, ordinal: checkpoint.decisions.length }), summary, kind, by, at }
  return touch({ ...checkpoint, decisions: [...checkpoint.decisions, entry] }, clock)
}

export function recordBlocker(checkpoint, { summary }, clock) {
  if (!summary) { throw new Error('a blocker requires a summary') }
  const raisedAt = isoNow(clock)
  const entry = { id: sha256({ summary, raisedAt, ordinal: checkpoint.blockers.length }), summary, raisedAt, resolvedAt: null, resolution: null }
  return touch({ ...checkpoint, blockers: [...checkpoint.blockers, entry] }, clock)
}

export function resolveBlocker(checkpoint, blockerId, resolution, clock) {
  const index = checkpoint.blockers.findIndex((b) => b.id === blockerId)
  if (index === -1) { throw new Error(`unknown blocker: ${blockerId}`) }
  const blockers = [...checkpoint.blockers]
  blockers[index] = { ...blockers[index], resolvedAt: isoNow(clock), resolution }
  return touch({ ...checkpoint, blockers }, clock)
}

// Needs-You shape mirrors research-mission.mjs's raiseResearchNeedsYou
// (REUSE_PATTERN) -- id/question/category/at/resolvedAt/resolution.
export const PLANNER_NEEDS_YOU_CATEGORIES = Object.freeze([
  'AUTHORITY_REQUIRED',
  'AMBIGUOUS_INSTRUCTION',
  'DESTRUCTIVE_ACTION_CONFIRMATION',
  'RESOURCE_UNAVAILABLE',
  'OTHER'
])

export function raisePlannerNeedsYou(checkpoint, { question, category = 'OTHER' }, clock) {
  if (!question) { throw new Error('a Needs-You item requires a question') }
  if (!PLANNER_NEEDS_YOU_CATEGORIES.includes(category)) { throw new Error(`unknown Needs-You category: ${category}`) }
  const at = isoNow(clock)
  const entry = { id: sha256({ question, category, at, ordinal: checkpoint.needsYou.length }), question, category, at, resolvedAt: null, resolution: null }
  return touch({ ...checkpoint, needsYou: [...checkpoint.needsYou, entry] }, clock)
}

export function resolvePlannerNeedsYou(checkpoint, needsYouId, resolution, clock) {
  const index = checkpoint.needsYou.findIndex((n) => n.id === needsYouId)
  if (index === -1) { throw new Error(`unknown Needs-You item: ${needsYouId}`) }
  const needsYou = [...checkpoint.needsYou]
  needsYou[index] = { ...needsYou[index], resolvedAt: isoNow(clock), resolution }
  return touch({ ...checkpoint, needsYou }, clock)
}

// Workers belong to the durable mission record (2D), not one planner's
// in-memory state -- a rollover reads this map, never a session variable.
// `taskFingerprint` is the caller's own idempotency key (e.g. a stable hash
// of the task description); findWorkerByTaskFingerprint lets a caller check
// BEFORE calling a real external dispatcher, so a rollover never redispatches
// already-dispatched work.
export function findWorkerByTaskFingerprint(checkpoint, taskFingerprint) {
  return Object.values(checkpoint.workers).find((w) => w.taskFingerprint === taskFingerprint) ?? null
}

export function registerDispatchedWorker(checkpoint, { workerId, kind, taskFingerprint }, clock) {
  if (!workerId || !kind || !taskFingerprint) { throw new Error('a dispatched worker requires workerId, kind, and taskFingerprint') }
  if (checkpoint.workers[workerId]) {
    const error = new Error(`worker ${workerId} is already registered -- refusing to duplicate-dispatch`)
    error.code = 'TSF_PLANNER_WORKER_ALREADY_REGISTERED'
    throw error
  }
  const dispatchedAt = isoNow(clock)
  const worker = { workerId, kind, taskFingerprint, status: 'DISPATCHED', dispatchedAt, completedAt: null, result: null }
  return touch({ ...checkpoint, workers: { ...checkpoint.workers, [workerId]: worker } }, clock)
}

export function recordWorkerResult(checkpoint, workerId, { status, result = null }, clock) {
  const worker = checkpoint.workers[workerId]
  if (!worker) { throw new Error(`unknown worker: ${workerId}`) }
  if (status !== 'COMPLETED' && status !== 'FAILED') { throw new Error(`worker result status must be COMPLETED|FAILED, got ${status}`) }
  const next = { ...worker, status, result, completedAt: isoNow(clock) }
  return touch({ ...checkpoint, workers: { ...checkpoint.workers, [workerId]: next } }, clock)
}

export function recordVerifierResult(checkpoint, { verifier, verdict, detail = null }, clock) {
  if (!verifier || !verdict) { throw new Error('a verifier result requires verifier and verdict') }
  const at = isoNow(clock)
  const entry = { id: sha256({ verifier, verdict, at, ordinal: checkpoint.verifierResults.length }), verifier, verdict, detail, at }
  return touch({ ...checkpoint, verifierResults: [...checkpoint.verifierResults, entry] }, clock)
}

export function setOutstandingTasks(checkpoint, taskIds, clock) {
  return touch({ ...checkpoint, outstandingTasks: [...taskIds] }, clock)
}

export function recordTaskCompleted(checkpoint, taskId, clock) {
  return touch(
    {
      ...checkpoint,
      outstandingTasks: checkpoint.outstandingTasks.filter((t) => t !== taskId),
      completedTasks: checkpoint.completedTasks.includes(taskId) ? checkpoint.completedTasks : [...checkpoint.completedTasks, taskId]
    },
    clock
  )
}

export function recordResourceState(checkpoint, resourceState, clock) {
  return touch({ ...checkpoint, resourceState }, clock)
}

export function recordAuthorityGrant(checkpoint, grant, clock) {
  return touch({ ...checkpoint, authority: { grants: [...checkpoint.authority.grants, grant] } }, clock)
}

export function recordLesson(checkpoint, summary, clock) {
  if (!summary) { throw new Error('a lesson requires a summary') }
  const at = isoNow(clock)
  return touch({ ...checkpoint, lessons: [...checkpoint.lessons, { id: sha256({ summary, at }), summary, at }] }, clock)
}

export function setLastAction(checkpoint, action, clock) {
  return touch({ ...checkpoint, lastAction: { ...action, at: isoNow(clock) } }, clock)
}

export function setNextIntendedAction(checkpoint, action, clock) {
  return touch({ ...checkpoint, nextIntendedAction: { ...action, at: isoNow(clock) } }, clock)
}

export function advancePhase(checkpoint, phase, clock) {
  if (!phase) { throw new Error('advancePhase requires a phase') }
  return touch({ ...checkpoint, phase }, clock)
}

// Fails honest rather than fabricating completion: an unresolved Needs-You
// or outstanding task means the mission is NOT actually done, regardless of
// what a planner believes.
export function completePlannerMission(checkpoint, clock) {
  const openNeedsYou = checkpoint.needsYou.filter((n) => !n.resolvedAt)
  if (openNeedsYou.length > 0) {
    throw new Error(`cannot complete mission: ${openNeedsYou.length} unresolved Needs-You item(s)`)
  }
  if (checkpoint.outstandingTasks.length > 0) {
    throw new Error(`cannot complete mission: ${checkpoint.outstandingTasks.length} outstanding task(s)`)
  }
  return touch({ ...checkpoint, missionState: 'COMPLETE' }, clock)
}
