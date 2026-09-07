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
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-selfimprove-repair-cycle-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
const { originateRepairMission } = await import('../server/self-improvement-mission-origination.mjs')
const { runRepairAttempt } = await import('../server/self-improvement-repair-cycle.mjs')
const { readFinding } = await import('../server/self-improvement-finding-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock', '.self-improvement-finding.lock', '.self-improvement-receipt.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const CANONICAL_REPO_PATH = 'C:/fixture/canonical-repo'
const FAKE_REPO_STATE = { branch: 'tsf/main', sha: 'a'.repeat(40), worktreePath: CANONICAL_REPO_PATH }
const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

function eligibleFinding(affectedSurface) {
  let finding = createFinding(
    {
      sourceDetector: 'RUNTIME_ASSERTION',
      severity: 'P1',
      evidence: { assertion: 'x' },
      reproduction: { command: 'node --test tsf/test/fixture.test.mjs' },
      affectedSurface,
      confidence: 0.95,
      verificationMethod: 'RECHECK_ASSERTION',
      candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'fix', filesHint: ['tsf/domain/fixture.mjs'] }
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
    deps: { observeRepoState: () => FAKE_REPO_STATE, lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
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
  return async () => ({ verdict, reasons, detail: { worktreePath: 'C:/fixture/attempt', branch: 'tsf/fixture', changedFiles: [] } })
}

const LIFECYCLE_DEPS = { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }

test('a VERIFIED_PASS on the first attempt reaches READY_FOR_ADOPTION', async () => {
  const finding = eligibleFinding('tsf/domain/pass-fixture.mjs')
  const missionId = await originate(finding)
  const result = await runRepairAttempt({
    finding,
    missionId,
    canonicalRepoPath: CANONICAL_REPO_PATH,
    clock,
    deps: { dispatchWorker: fakeWorker(), runIndependentVerification: fakeVerifier('VERIFIED_PASS'), ...LIFECYCLE_DEPS }
  })
  assert.equal(result.outcome, 'READY_FOR_ADOPTION')
  assert.equal(result.finding.status, 'READY_FOR_ADOPTION')
})

test('retry/correction-attempt budget: real, bounded -- retries once, then escalates to NEEDS_OWNER, never retries forever', async (t) => {
  const finding = eligibleFinding('tsf/domain/retry-fixture.mjs')
  const missionId = await originate(finding)
  const budget = { maxAttemptsPerMission: 2 }
  const deps = { dispatchWorker: fakeWorker(), runIndependentVerification: fakeVerifier('VERIFIED_FAIL', ['REPRODUCTION_STILL_FAILS']), ...LIFECYCLE_DEPS }

  let attempt1
  await t.test('attempt 1 fails verification -- stays in progress, does not escalate yet', async () => {
    attempt1 = await runRepairAttempt({ finding, missionId, canonicalRepoPath: CANONICAL_REPO_PATH, clock, budget, deps })
    assert.equal(attempt1.outcome, 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK')
    assert.equal(attempt1.finding.status, 'FIX_IN_PROGRESS')
  })

  let attempt2
  await t.test('attempt 2 (retry) also fails verification -- budget of 2 now exhausted', async () => {
    attempt2 = await runRepairAttempt({ finding: attempt1.finding, missionId, canonicalRepoPath: CANONICAL_REPO_PATH, clock, budget, deps })
    assert.equal(attempt2.outcome, 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK')
  })

  await t.test('attempt 3 (over budget): escalates to NEEDS_OWNER, does NOT dispatch a third worker', async () => {
    const before = readFinding(finding.findingId)
    const dispatchCountBefore = fakeWorkerCallCount
    const attempt3 = await runRepairAttempt({ finding: before, missionId, canonicalRepoPath: CANONICAL_REPO_PATH, clock, budget, deps })
    assert.equal(attempt3.outcome, 'ESCALATED')
    assert.equal(attempt3.finding.status, 'NEEDS_OWNER')
    assert.equal(fakeWorkerCallCount, dispatchCountBefore, 'escalation must never dispatch another real worker')
  })
})

test.after(cleanupStateFile)
