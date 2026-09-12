// Native Self-Improvement Loop V1, Phase 4/5: real attempt/retry/escalate
// proof against the real durable planner-mission checkpoint (real file
// lock, real transition guards) with FAKE worker dispatch and FAKE
// verifier (no real Codex/Claude process, no real git/process spawn --
// per this program's own "real mechanisms proven with fakes" test
// discipline). Proves: the retry/correction-attempt budget is real and
// bounded, escalates to NEEDS_OWNER on exhaustion, and a VERIFIED_PASS
// reaches READY_FOR_ADOPTION.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-selfimprove-repair-cycle-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { applyAutofixEligibility } =
  await import('../domain/self-improvement-autofix-eligibility.mjs')
const { originateRepairMission } =
  await import('../server/self-improvement-mission-origination.mjs')
const { runRepairAttempt } = await import('../server/self-improvement-repair-cycle.mjs')
const { readFinding } = await import('../server/self-improvement-finding-store.mjs')
const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
const { withProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')

function cleanupStateFile() {
  for (const suffix of [
    '',
    '.tmp',
    '.planner-mission.lock',
    '.self-improvement-finding.lock',
    '.self-improvement-receipt.lock',
    '.project-execution-hold.lock'
  ]) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const CANONICAL_REPO_PATH = 'C:/fixture/canonical-repo'
const FAKE_REPO_STATE = {
  branch: 'tsf/main',
  sha: 'a'.repeat(40),
  worktreePath: CANONICAL_REPO_PATH
}
const GB = 1024 ** 3
const fakeHealthyMemory = () => ({
  totalBytes: 16 * GB,
  freeBytes: 8 * GB,
  availableBytes: 8 * GB,
  usedPercent: 50
})

function eligibleFinding(affectedSurface, overrides = {}) {
  let finding = createFinding(
    {
      sourceDetector: 'RUNTIME_ASSERTION',
      severity: 'P1',
      evidence: { assertion: 'x' },
      reproduction: { command: 'node --test tsf/test/fixture.test.mjs' },
      affectedSurface,
      confidence: 0.95,
      verificationMethod: 'RECHECK_ASSERTION',
      candidateFixScope: {
        kind: 'BOUNDED_CODE_DEFECT',
        summary: 'fix',
        filesHint: ['tsf/domain/fixture.mjs']
      },
      ...overrides
    },
    clock
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  return applyAutofixEligibility(finding, clock)
}

async function originate(finding) {
  const result = await originateRepairMission(finding, {
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: {
      observeRepoState: () => FAKE_REPO_STATE,
      lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory }
    }
  })
  return result.missionId
}

let fakeWorkerCallCount = 0
function fakeWorker({ exitCode = 0 } = {}) {
  return async () => {
    fakeWorkerCallCount += 1
    return {
      workerId: `fake-worker-${fakeWorkerCallCount}`,
      providerId: 'openai',
      agentId: 'codex',
      worktreePath: `C:/fixture/attempt-${fakeWorkerCallCount}`,
      branch: `tsf/self-improve/fixture/attempt-${fakeWorkerCallCount}`,
      baseSha: 'b'.repeat(40),
      exitCode,
      timedOut: false
    }
  }
}

function fakeVerifier(verdict, reasons = []) {
  return async () => ({
    verdict,
    reasons,
    detail: { worktreePath: 'C:/fixture/attempt', branch: 'tsf/fixture', changedFiles: [] }
  })
}

// Wave D real-bug fix: worktreePath/branch/baseSha are re-derived (never
// read off the checkpoint's own narrow worker record, see self-improvement-
// repair-cycle.mjs's own header comment) -- baseSha's re-derivation is a
// real `git rev-parse HEAD` against the worktree path, faked here since
// these fixture paths (C:/fixture/attempt-N) never really exist on disk.
const LIFECYCLE_DEPS = { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
const FAKE_BASE_SHA_DEPS = { currentHeadSha: async () => 'b'.repeat(40) }

test('a VERIFIED_PASS on the first attempt reaches READY_FOR_ADOPTION', async () => {
  const finding = eligibleFinding('tsf/domain/pass-fixture.mjs')
  const missionId = await originate(finding)
  const result = await runRepairAttempt({
    finding,
    missionId,
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: {
      dispatchWorker: fakeWorker(),
      runIndependentVerification: fakeVerifier('VERIFIED_PASS'),
      ...LIFECYCLE_DEPS,
      ...FAKE_BASE_SHA_DEPS
    }
  })
  assert.equal(result.outcome, 'READY_FOR_ADOPTION')
  assert.equal(result.finding.status, 'READY_FOR_ADOPTION')
})

test('retry/correction-attempt budget: real, bounded -- retries once, then escalates to NEEDS_OWNER, never retries forever', async (t) => {
  const finding = eligibleFinding('tsf/domain/retry-fixture.mjs')
  const missionId = await originate(finding)
  const budget = { maxAttemptsPerMission: 2 }
  const deps = {
    dispatchWorker: fakeWorker(),
    runIndependentVerification: fakeVerifier('VERIFIED_FAIL', ['REPRODUCTION_STILL_FAILS']),
    ...LIFECYCLE_DEPS,
    ...FAKE_BASE_SHA_DEPS
  }

  let attempt1
  await t.test(
    'attempt 1 fails verification -- stays in progress, does not escalate yet',
    async () => {
      attempt1 = await runRepairAttempt({
        finding,
        missionId,
        canonicalRepoPath: CANONICAL_REPO_PATH,
        clock,
        budget,
        deps
      })
      assert.equal(attempt1.outcome, 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK')
      assert.equal(attempt1.finding.status, 'FIX_IN_PROGRESS')
    }
  )

  let attempt2
  await t.test(
    'attempt 2 (retry) also fails verification -- budget of 2 now exhausted',
    async () => {
      attempt2 = await runRepairAttempt({
        finding: attempt1.finding,
        missionId,
        canonicalRepoPath: CANONICAL_REPO_PATH,
        clock,
        budget,
        deps
      })
      assert.equal(attempt2.outcome, 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK')
    }
  )

  await t.test(
    'attempt 3 (over budget): escalates to NEEDS_OWNER, does NOT dispatch a third worker',
    async () => {
      const before = readFinding(finding.findingId)
      const dispatchCountBefore = fakeWorkerCallCount
      const attempt3 = await runRepairAttempt({
        finding: before,
        missionId,
        canonicalRepoPath: CANONICAL_REPO_PATH,
        clock,
        budget,
        deps
      })
      assert.equal(attempt3.outcome, 'ESCALATED')
      assert.equal(attempt3.finding.status, 'NEEDS_OWNER')
      assert.equal(
        fakeWorkerCallCount,
        dispatchCountBefore,
        'escalation must never dispatch another real worker'
      )
    }
  )
})

// TSF Reconcile & Upgrade Protocol V1, Lane 4 self-dogfood fix: a real,
// active project execution hold blocks a fresh worker dispatch outright
// -- no worker call, no receipt, no status transition, no budget
// consumed -- mirroring keep-going-dispatch-loop.mjs's own
// DISPATCH_BLOCKED_BY_HOLD convention.
test('a real active project execution hold blocks a fresh repair-attempt worker dispatch, nothing durable mutated', async () => {
  const projectId = 'selfimprove-repair-cycle-hold-fixture'
  const finding = eligibleFinding('tsf/domain/hold-fixture.mjs', { projectId })
  const missionId = await originate(finding)
  await withProjectExecutionHold(projectId, () =>
    createProjectExecutionHold(
      { projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT' },
      clock
    )
  )

  const dispatchCountBefore = fakeWorkerCallCount
  const result = await runRepairAttempt({
    finding,
    missionId,
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: {
      dispatchWorker: fakeWorker(),
      runIndependentVerification: fakeVerifier('VERIFIED_PASS'),
      ...LIFECYCLE_DEPS,
      ...FAKE_BASE_SHA_DEPS
    }
  })

  assert.equal(result.outcome, 'BLOCKED_BY_PROJECT_EXECUTION_HOLD')
  assert.match(result.reason, /EXTERNAL_WORK_ACTIVE/)
  assert.equal(
    result.finding.status,
    finding.status,
    'a blocked attempt must never transition the finding'
  )
  assert.equal(
    fakeWorkerCallCount,
    dispatchCountBefore,
    'a blocked attempt must never dispatch a real worker'
  )
  assert.equal(
    readFinding(finding.findingId).status,
    'FIX_MISSION_CREATED',
    'the durable record is untouched'
  )
})

test('resource-pressure refusal returns BLOCKED_BY_RESOURCE_PRESSURE, preserves the finding, and records the mission resource state', async () => {
  const finding = eligibleFinding('tsf/domain/resource-pressure-fixture.mjs')
  const missionId = await originate(finding)
  const findingBefore = readFinding(finding.findingId)
  const checkpointBefore = readPlannerMissionRecord(missionId).checkpoint
  const governorReason = 'host memory critical -- no new heavyweight dispatch; let active work checkpoint and replan'

  const result = await runRepairAttempt({
    finding: findingBefore,
    missionId,
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: {
      ...LIFECYCLE_DEPS,
      workerDeps: {
        collectHostMemoryEvidence: () => ({
          totalBytes: 16 * GB,
          freeBytes: 2 * GB,
          availableBytes: 2 * GB,
          usedPercent: 87.5
        })
      }
    }
  })

  assert.equal(result.outcome, 'BLOCKED_BY_RESOURCE_PRESSURE')
  assert.equal(result.tier, 'CRITICAL')
  assert.match(result.reason, /tier CRITICAL/)
  assert.match(result.reason, new RegExp(governorReason))
  assert.deepEqual(result.finding, findingBefore)
  assert.deepEqual(readFinding(finding.findingId), findingBefore)
  const resourceState = {
    tier: 'CRITICAL',
    reason: governorReason,
    observedAt: clock().toISOString()
  }
  const checkpointAfter = readPlannerMissionRecord(missionId).checkpoint
  assert.deepEqual(checkpointAfter.resourceState, resourceState)
  // Director review finding: an earlier draft rebuilt the checkpoint from
  // the STALE pre-attempt snapshot instead of the fresh current record,
  // silently discarding the real, already-durably-written dispatch-attempt
  // bookkeeping dispatchWorkerForTask's own internal catch makes just
  // before this error reaches runRepairAttempt (recordDispatchAttempt's
  // UNKNOWN, then resolveDispatchAttempt's real FAILED_CLEAN resolution --
  // see planner-session-lifecycle.mjs). That real entry must survive.
  const taskFingerprint = `${missionId}:attempt-1`
  const dispatchAttempt = checkpointAfter.dispatchAttempts.find((a) => a.taskFingerprint === taskFingerprint)
  assert.ok(dispatchAttempt, 'the real dispatch-attempt bookkeeping entry must survive, never silently reverted')
  assert.equal(dispatchAttempt.outcome, 'FAILED_CLEAN')
  assert.ok(dispatchAttempt.resolvedAt, 'a cleanly-refused attempt must be resolved, never left UNKNOWN')
  assert.ok(
    checkpointAfter.revision > checkpointBefore.revision,
    'the checkpoint must have genuinely advanced, not reverted to a stale snapshot'
  )
})

// Adversarial-review finding (P1, reproduced by tracing the real code):
// lifecycle.dispatchWorkerForTask awaits a real cross-process mutate
// BEFORE calling the real dispatchWorker -- a hold set during that
// window used to be silently missed by a single early check. Proven
// here with a stateful fake readProjectExecutionHold: no hold on the
// FIRST read (the early check passes, matching a real "hold appeared
// after the early check but before the real dispatch" scenario), a real
// active hold on every read after that (the fresh check wrapped around
// the real dispatch call) -- the attempt must still be refused, and
// nothing durable mutated by the refused attempt itself.
test('a project execution hold that appears AFTER the early check but before the real dispatch call is still caught by the fresh, wrapped check', async () => {
  const projectId = 'selfimprove-repair-cycle-hold-race-fixture'
  const finding = eligibleFinding('tsf/domain/hold-race-fixture.mjs', { projectId })
  const missionId = await originate(finding)
  const hold = createProjectExecutionHold(
    { projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT' },
    clock
  )
  let readCount = 0
  const staggeredReadHold = () => {
    readCount += 1
    return readCount === 1 ? null : hold
  }

  const dispatchCountBefore = fakeWorkerCallCount
  const result = await runRepairAttempt({
    finding,
    missionId,
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: {
      dispatchWorker: fakeWorker(),
      runIndependentVerification: fakeVerifier('VERIFIED_PASS'),
      readProjectExecutionHold: staggeredReadHold,
      ...LIFECYCLE_DEPS,
      ...FAKE_BASE_SHA_DEPS
    }
  })

  assert.ok(
    readCount >= 2,
    'sanity: the hold must genuinely be read more than once (early check + fresh check)'
  )
  assert.equal(result.outcome, 'BLOCKED_BY_PROJECT_EXECUTION_HOLD')
  assert.equal(
    fakeWorkerCallCount,
    dispatchCountBefore,
    'a hold caught by the fresh check must never reach the real dispatch'
  )
  assert.equal(
    readFinding(finding.findingId).status,
    'FIX_MISSION_CREATED',
    'the durable record is untouched, safe to retry once the hold clears'
  )
})

// A finding with no real project (platform-wide diagnostic, projectId
// null) has nothing to check a hold against -- must proceed exactly as
// before this fix, never fabricate a block.
test('a finding with no real projectId is never blocked by a hold check', async () => {
  const finding = eligibleFinding('tsf/domain/no-project-fixture.mjs')
  assert.equal(finding.projectId, null)
  const missionId = await originate(finding)
  const result = await runRepairAttempt({
    finding,
    missionId,
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: {
      dispatchWorker: fakeWorker(),
      runIndependentVerification: fakeVerifier('VERIFIED_PASS'),
      ...LIFECYCLE_DEPS,
      ...FAKE_BASE_SHA_DEPS
    }
  })
  assert.equal(result.outcome, 'READY_FOR_ADOPTION')
})

test.after(cleanupStateFile)
