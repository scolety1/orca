// Wave D Phase 10, chaos scenario 1: a REAL planner process crashes
// (SIGKILL, no relinquish) immediately after real origination -- proves a
// recovery call to originateRepairMission for the SAME finding never
// creates a second mission/checkpoint. Real spawn+SIGKILL mirrors this
// repo's own established template (planner-mission-lease-crash-reclaim.
// test.mjs / resource-pressure-lease-host-wide.test.mjs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'self-improvement-crash-reclaim-worker.mjs')
const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) { return }
    if (Date.now() > deadline) { throw new Error('waitFor timed out') }
    await new Promise((resolve) => setTimeout(resolve, intervalMs)) // eslint-disable-line no-await-in-loop
  }
}

test(
  'REAL planner crash after origination: a killed process\'s real mission checkpoint survives, and re-invoking origination for the SAME finding never creates a duplicate mission',
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-crash-reclaim-test-'))
    const stateFile = path.join(dir, 'operator-state.json')
    const resultPath = path.join(dir, 'held.json')
    const canonicalRepoPath = path.resolve(HERE, '..', '..')
    process.env.TSF_UI_STATE_FILE = stateFile
    const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
    const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
    const { originateRepairMission, computeRepairMissionId } = await import('../server/self-improvement-mission-origination.mjs')
    const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')

    let finding = createFinding(
      {
        sourceDetector: 'RUNTIME_ASSERTION',
        severity: 'P1',
        evidence: { x: 1 },
        reproduction: { command: 'node -e "process.exit(1)"' },
        affectedSurface: 'tsf/domain/chaos-planner-crash-fixture.mjs',
        confidence: 0.95,
        verificationMethod: 'RECHECK',
        candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'fix', filesHint: [] }
      },
      () => new Date()
    )
    finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, () => new Date())
    finding = applyAutofixEligibility(finding, () => new Date())
    assert.equal(finding.status, 'ELIGIBLE_FOR_AUTOFIX')

    const findingJsonPath = path.join(dir, 'finding.json')
    writeFileSync(findingJsonPath, JSON.stringify(finding))

    const child = spawn(process.execPath, [WORKER, findingJsonPath, canonicalRepoPath, resultPath], {
      env: { ...process.env, TSF_UI_STATE_FILE: stateFile },
      stdio: 'ignore'
    })
    try {
      await waitFor(() => {
        try { return JSON.parse(readFileSync(resultPath, 'utf8')).originated === true } catch { return false }
      })
      const held = JSON.parse(readFileSync(resultPath, 'utf8'))
      assert.equal(held.created, true, 'the crashed process must have genuinely originated a NEW mission before dying')
      const expectedMissionId = computeRepairMissionId(finding.findingId)
      assert.equal(held.missionId, expectedMissionId)

      // Real crash: SIGKILL, no relinquish, no graceful shutdown.
      child.kill('SIGKILL')
      await new Promise((resolve) => setTimeout(resolve, 300))

      // A fresh, independent recovery call for the IDENTICAL finding must
      // see the crashed process's own durable checkpoint and refuse to
      // duplicate it -- never a second PlannerSessionLifecycle.startMission.
      let secondStartMissionCalled = false
      const recovery = await originateRepairMission(finding, {
        canonicalRepoPath,
        clock: () => new Date(),
        deps: {
          lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory },
          PlannerSessionLifecycle: class {
            async startMission() { secondStartMissionCalled = true; throw new Error('must never be called -- checkpoint already exists') }
          }
        }
      })

      assert.equal(recovery.created, false, 'recovery must recognize the existing checkpoint, never report a fresh creation')
      assert.equal(recovery.missionId, expectedMissionId)
      assert.equal(secondStartMissionCalled, false, 'no duplicate dispatch: startMission must never be invoked a second time')

      const record = readPlannerMissionRecord(expectedMissionId)
      assert.ok(record?.checkpoint, 'exactly one durable checkpoint must exist')
    } finally {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
