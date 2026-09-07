// CRASH MID-CLEANUP: proves server/cleanup-executor.mjs's real crash-
// recovery entry point (recoverStalledCleanupExecution, wired to POST
// /api/cleanup/recover) against a REAL interrupted execution -- not the
// already-covered cleanup-quarantine-store.test.mjs unit tests, which only
// ever call recoverIncompleteQuarantine directly with a hand-supplied
// quarantineId. Every stage here reconstructs runGovernedCleanupAction's OWN
// real pipeline using its own real, exported building blocks (never a
// second/parallel implementation), stopping short of completeCleanupExecution
// to model "the process died right here" -- the same technique this file's
// sibling adversarial suites use for a real Windows file-lock/race fixture.
//
// SECURITY (Phase 10, real bug found, reproduced, fixed): before this fix,
// recoverStalledCleanupExecution(requestId) called
// recoverIncompleteQuarantine(requestId) -- but quarantineId is a fresh
// randomUUID minted inside moveToQuarantine per attempt, never equal to
// requestId and never durably recorded on the execution record until AFTER
// mutate() returns. A real crash mid-mutate left recovery either looking in
// the wrong quarantine directory (found nothing) or, because the durable
// execution status itself never advanced past PENDING before mutate() ran,
// short-circuiting to `{status:'PENDING', requiresOwnerReview:false}` before
// ever consulting the quarantine manifest at all -- silently reporting
// nothing needs attention while a real quarantine attempt was genuinely
// stuck mid-flight.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-crash-recovery-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
const QUARANTINE_DIR = path.join(HERE, '..', 'server', '.local-state', `cleanup-quarantine-test-crash-recovery-${process.pid}`)
process.env.TSF_CLEANUP_QUARANTINE_DIR = QUARANTINE_DIR

const { recoverStalledCleanupExecution } = await import('../server/cleanup-executor.mjs')
const {
  beginCleanupExecution,
  buildCleanupPlan,
  buildCleanupRecommendation,
  computeCleanupRequestId,
  createCleanupAuthorization
} = await import('../domain/cleanup-lifecycle.mjs')
const { evaluateCleanupBlockers } = await import('../domain/cleanup-safety-blockers.mjs')
const { appendExecution, putAuthorization, putPlan, putRecommendation } = await import('../server/cleanup-request-store.mjs')
const { moveToQuarantine } = await import('../server/cleanup-quarantine-store.mjs')

function cleanupIsolatedState() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock', '.cleanup-request.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
  rmSync(QUARANTINE_DIR, { recursive: true, force: true })
}
cleanupIsolatedState()
test.after(cleanupIsolatedState)

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-crash-recovery-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))
const clock = () => new Date('2026-09-06T12:00:00.000Z')
const CLEAR_CONTEXT = { evidenceObservedAt: clock().toISOString(), protectedPath: false, protectedBranch: false, activeMissionReferenced: false }

// Reconstructs runGovernedCleanupAction's real pipeline through the point
// immediately before mutate() would run (RECOMMENDATION -> PLAN ->
// AUTHORIZATION -> EXECUTION durably persisted as IN_PROGRESS), using only
// its own real, exported building blocks. Returns requestId so the caller
// can simulate whatever happens (or doesn't) inside the real mutate call.
async function driveToPreMutate(actionClass, targetIdentity, rationale) {
  const requestId = computeCleanupRequestId(actionClass, targetIdentity)
  const recommendation = buildCleanupRecommendation({ actionClass, targetIdentity, rationale }, clock)
  await putRecommendation(requestId, recommendation)
  const blockerEval = evaluateCleanupBlockers(CLEAR_CONTEXT, clock)
  const plan = buildCleanupPlan(recommendation, { steps: ['REVALIDATE'], blockerEvaluationAtPlanTime: blockerEval, reversibilityStrategy: 'QUARANTINE_FIRST' }, clock)
  await putPlan(requestId, plan)
  const authorization = createCleanupAuthorization(plan, { grantedBy: 'crash-recovery-fixture', ownerGateOpen: true, blockerEvaluationAtAuthorizationTime: blockerEval }, clock)
  await putAuthorization(requestId, authorization)
  let execution = beginCleanupExecution(authorization, clock)
  await appendExecution(requestId, execution)
  // Mirrors the fixed cleanup-executor.mjs: the RACE_RECHECK-passed
  // transition (PENDING -> IN_PROGRESS) is durably persisted BEFORE mutate()
  // would run.
  execution = { ...execution, status: 'IN_PROGRESS', steps: [...execution.steps, { name: 'RACE_RECHECK', status: 'PASSED', at: clock().toISOString() }] }
  await appendExecution(requestId, execution)
  return requestId
}

test('CRASH MID-CLEANUP: quarantine move actually finished before the crash -- recoverStalledCleanupExecution finds the REAL quarantineId (never equal to requestId) and reconciles to QUARANTINED, content intact', async () => {
  const artifact = path.join(ROOT, 'crash-after-move.txt')
  writeFileSync(artifact, 'irreplaceable content')
  const targetIdentity = { realPath: artifact }

  const requestId = await driveToPreMutate('QUARANTINE_ARTIFACT', targetIdentity, 'crash-mid-cleanup fixture: move finishes, process dies before completion is recorded')
  // The real mutate function's own real first (and only, for a small file)
  // side effect -- then the process is modeled as dying right here, before
  // completeCleanupExecution/appendExecution(COMPLETED) ever runs.
  const manifest = moveToQuarantine({ requestId, actionClass: 'QUARANTINE_ARTIFACT', originalPath: artifact, mode: 'MOVE' }, { clock })
  assert.notEqual(manifest.quarantineId, requestId, 'quarantineId must be a distinct, freshly-minted id -- never assumed equal to requestId')
  assert.equal(existsSync(artifact), false, 'the real move already happened before the crash')

  const recovery = recoverStalledCleanupExecution(requestId)
  assert.equal(recovery.status, 'QUARANTINED')
  assert.equal(recovery.requiresOwnerReview, false)
  assert.equal(readFileSync(manifest.quarantinedPath, 'utf8'), 'irreplaceable content', 'no data lost across the simulated crash')
})

test('CRASH MID-CLEANUP: quarantine move was still in flight (both copies present) at the crash -- recoverStalledCleanupExecution surfaces QUARANTINE_SOURCE_STILL_PRESENT and demands owner review, nothing silently discarded', async () => {
  const artifact = path.join(ROOT, 'crash-during-move')
  writeFileSync(artifact, 'mid-flight content')
  const targetIdentity = { realPath: artifact }

  const requestId = await driveToPreMutate('QUARANTINE_ARTIFACT', targetIdentity, 'crash-mid-cleanup fixture: crash strictly between copy and delete-original')
  // Model the EXDEV copy-then-delete fallback's own crash window: manifest
  // written IN_PROGRESS, copy present at destination, original not yet
  // removed -- exactly moveDirOrFile's real intermediate state.
  const quarantineId = 'crash-mid-move-fixture'
  const quarantinedPath = path.join(QUARANTINE_DIR, quarantineId, 'crash-during-move')
  const { mkdirSync, writeFileSync: writeFile } = await import('node:fs')
  mkdirSync(path.dirname(quarantinedPath), { recursive: true })
  writeFile(quarantinedPath, 'mid-flight content')
  writeFile(
    path.join(QUARANTINE_DIR, quarantineId, 'manifest.json'),
    JSON.stringify({ schemaVersion: 'TSF_CLEANUP_QUARANTINE_MANIFEST_V1', quarantineId, requestId, actionClass: 'QUARANTINE_ARTIFACT', mode: 'MOVE', kind: 'FILE', originalPath: artifact, quarantinedPath, quarantinedAt: null, status: 'QUARANTINE_IN_PROGRESS' })
  )

  const recovery = recoverStalledCleanupExecution(requestId)
  assert.equal(recovery.status, 'QUARANTINE_SOURCE_STILL_PRESENT')
  assert.equal(recovery.requiresOwnerReview, true)
  assert.equal(existsSync(artifact), true, 'original must still be present -- nothing lost')
  assert.equal(readFileSync(quarantinedPath, 'utf8'), 'mid-flight content', 'quarantine copy also intact')
})

test('a crash BEFORE the race-recheck durable persist (execution still PENDING) reports PENDING, never falsely claims recovery is unnecessary by fabricating a manifest lookup', async () => {
  const artifact = path.join(ROOT, 'crash-before-mutate.txt')
  writeFileSync(artifact, 'never touched')
  const targetIdentity = { realPath: artifact }
  const requestId = computeCleanupRequestId('QUARANTINE_ARTIFACT', targetIdentity)
  const recommendation = buildCleanupRecommendation({ actionClass: 'QUARANTINE_ARTIFACT', targetIdentity, rationale: 'crash before race-recheck persist' }, clock)
  await putRecommendation(requestId, recommendation)
  const blockerEval = evaluateCleanupBlockers(CLEAR_CONTEXT, clock)
  const plan = buildCleanupPlan(recommendation, { steps: ['REVALIDATE'], blockerEvaluationAtPlanTime: blockerEval, reversibilityStrategy: 'QUARANTINE_FIRST' }, clock)
  await putPlan(requestId, plan)
  const authorization = createCleanupAuthorization(plan, { grantedBy: 'crash-recovery-fixture', ownerGateOpen: true, blockerEvaluationAtAuthorizationTime: blockerEval }, clock)
  await putAuthorization(requestId, authorization)
  const execution = beginCleanupExecution(authorization, clock)
  await appendExecution(requestId, execution) // crash right here -- still PENDING, mutate never invoked

  const recovery = recoverStalledCleanupExecution(requestId)
  assert.equal(recovery.status, 'PENDING')
  assert.equal(recovery.requiresOwnerReview, false)
  assert.equal(existsSync(artifact), true, 'never mutated')
})
