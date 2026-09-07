// Wave D Phase 10, chaos scenario 4: a REAL backend crash (SIGKILL) mid-
// repair-cycle -- after one real repair attempt's VERIFIED_FAIL result is
// durably recorded, but before attempt 2 ever runs. Proves a fresh process
// (the "restarted backend") sees the exact durable attempt history (no
// data loss, no duplication) and correctly continues to attempt 2, never
// re-running attempt 1. Reuses this repo's own established real crash-
// reclaim template (F4/F6 shape, mirrors planner-mission-lease-crash-
// reclaim.test.mjs and self-improvement-chaos-planner-crash.test.mjs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'self-improvement-backend-restart-worker.mjs')
const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })
const fakeVerifierPass = async () => ({ verdict: 'VERIFIED_PASS', reasons: [], detail: {} })

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) { return }
    if (Date.now() > deadline) { throw new Error('waitFor timed out') }
    await new Promise((resolve) => setTimeout(resolve, intervalMs)) // eslint-disable-line no-await-in-loop
  }
}

test(
  'REAL backend crash mid-repair-cycle: attempt 1\'s durable VERIFIED_FAIL result survives, a fresh process continues correctly to attempt 2 (never re-runs attempt 1)',
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-backend-restart-test-'))
    const stateFile = path.join(dir, 'operator-state.json')
    const resultPath = path.join(dir, 'held.json')
    const canonicalRepoPath = path.resolve(HERE, '..', '..')
    process.env.TSF_UI_STATE_FILE = stateFile
    const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
    const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
    const { readFinding } = await import('../server/self-improvement-finding-store.mjs')
    const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
    const { runRepairAttempt } = await import('../server/self-improvement-repair-cycle.mjs')

    let finding = createFinding(
      {
        sourceDetector: 'RUNTIME_ASSERTION',
        severity: 'P1',
        evidence: { x: 1 },
        reproduction: { command: 'node -e "process.exit(1)"' },
        affectedSurface: 'tsf/domain/chaos-backend-restart-fixture.mjs',
        confidence: 0.95,
        verificationMethod: 'RECHECK',
        candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'fix', filesHint: [] }
      },
      () => new Date()
    )
    finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, () => new Date())
    finding = applyAutofixEligibility(finding, () => new Date())

    const findingJsonPath = path.join(dir, 'finding.json')
    writeFileSync(findingJsonPath, JSON.stringify(finding))

    const child = spawn(process.execPath, [WORKER, findingJsonPath, canonicalRepoPath, resultPath], {
      env: { ...process.env, TSF_UI_STATE_FILE: stateFile },
      stdio: 'ignore'
    })
    try {
      await waitFor(() => {
        try { return JSON.parse(readFileSync(resultPath, 'utf8')).done === true } catch { return false }
      })
      const held = JSON.parse(readFileSync(resultPath, 'utf8'))
      assert.equal(held.outcome, 'VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK')

      // Real crash: no relinquish, no graceful shutdown.
      child.kill('SIGKILL')
      await new Promise((resolve) => setTimeout(resolve, 300))

      // The "restarted backend": a fresh read of durable state.
      const record = readPlannerMissionRecord(held.missionId)
      assert.equal(record.checkpoint.verifierResults.length, 1, 'exactly one durable verifier result must survive the crash -- no loss, no duplication')
      assert.equal(record.checkpoint.verifierResults[0].verdict, 'VERIFIED_FAIL')
      const findingAfterCrash = readFinding(finding.findingId)
      assert.equal(findingAfterCrash.status, 'FIX_IN_PROGRESS', 'the finding record itself survives the crash intact')

      let attempt2DispatchCount = 0
      const attempt2 = await runRepairAttempt({
        finding: findingAfterCrash,
        missionId: held.missionId,
        canonicalRepoPath,
        clock: () => new Date(),
        deps: {
          dispatchWorker: async () => { attempt2DispatchCount += 1; return { workerId: 'restart-fixture-worker-2', providerId: 'openai', agentId: 'codex', exitCode: 0, timedOut: false } },
          runIndependentVerification: fakeVerifierPass,
          currentHeadSha: async () => 'e'.repeat(40),
          lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory }
        }
      })

      assert.equal(attempt2DispatchCount, 1, 'the fresh process must dispatch exactly ONE new worker for attempt 2, never re-dispatch attempt 1')
      assert.equal(attempt2.outcome, 'READY_FOR_ADOPTION')
      const finalRecord = readPlannerMissionRecord(held.missionId)
      assert.equal(finalRecord.checkpoint.verifierResults.length, 2, 'both attempts durably recorded: the pre-crash VERIFIED_FAIL and the post-restart VERIFIED_PASS')
    } finally {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
