// Phase 8 (Planner Lifecycle Chaos Test) reconciliation: F4's crash-reclaim
// test (planner-mission-lease-crash-reclaim.test.mjs) proves ONE successor
// reclaims a stale lease left by a real killed process. planner-mission-
// lease-cross-process.test.mjs proves TWO racing processes split an EMPTY
// (never-held) lease correctly. Neither combines both: TWO real successor
// processes racing to reclaim the SAME STALE lease (left by a real crashed
// holder) AT ONCE, through the real end-to-end
// PlannerSessionLifecycle.acquireLeaseAndHydrate path. This closes that gap.
//
// Expectation going in: the domain lease algorithm (acquirePlannerMissionLease)
// is applied atomically under cross-process-file-lock.mjs's real mutex for
// EVERY acquire, stale-reclaim included -- of two racers, only the one that
// wins the file lock's serialization order observes the lease as reclaimable;
// the other observes it already re-held by the winner and is refused. This
// test either confirms that holds for the real crash-then-double-race case
// too, or catches it if it doesn't.
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn, execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HERE = import.meta.dirname
const CRASH_WORKER = path.join(HERE, 'fixtures', 'planner-crash-reclaim-worker.mjs')
const SUCCESSOR_WORKER = path.join(HERE, 'fixtures', 'planner-mission-lease-concurrent-successor-worker.mjs')
const LEASE_TTL_MS = 600
const MISSION_ID = 'mission:concurrent-takeover-fixture'

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) { return }
    if (Date.now() > deadline) { throw new Error('waitFor timed out') }
    await new Promise((resolve) => setTimeout(resolve, intervalMs)) // eslint-disable-line no-await-in-loop
  }
}

test(
  'TWO real successor processes racing to reclaim the SAME stale lease (left by a real crashed holder) at once: exactly one wins, no state is lost or duplicated',
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-concurrent-takeover-test-'))
    const stateFile = path.join(dir, 'operator-state.json')
    const heldResultPath = path.join(dir, 'held.json')
    const resultC1 = path.join(dir, 'result-c1.json')
    const resultC2 = path.join(dir, 'result-c2.json')
    const startC1 = path.join(dir, 'race.start-c1')
    const startC2 = path.join(dir, 'race.start-c2')
    const env = { ...process.env, TSF_UI_STATE_FILE: stateFile }

    const crashed = spawn(process.execPath, [CRASH_WORKER, MISSION_ID, 'planner-crashed', String(LEASE_TTL_MS), heldResultPath], { env, stdio: 'ignore' })
    try {
      await waitFor(() => {
        try {
          return JSON.parse(readFileSync(heldResultPath, 'utf8')).held === true
        } catch {
          return false
        }
      })
      const heldResult = JSON.parse(readFileSync(heldResultPath, 'utf8'))

      crashed.kill('SIGKILL')
      await new Promise((resolve) => setTimeout(resolve, LEASE_TTL_MS + 400)) // past the real TTL

      // TWO real successor processes fired concurrently at the SAME stale lease.
      await Promise.all([
        execFileAsync(process.execPath, [SUCCESSOR_WORKER, MISSION_ID, 'planner-successor-1', resultC1, startC1], { env }),
        execFileAsync(process.execPath, [SUCCESSOR_WORKER, MISSION_ID, 'planner-successor-2', resultC2, startC2], { env })
      ])

      const startedC1 = Number(readFileSync(startC1, 'utf8'))
      const startedC2 = Number(readFileSync(startC2, 'utf8'))
      assert.ok(Math.abs(startedC1 - startedC2) < 2000, 'the two racing successors must genuinely overlap to exercise the lock')

      const c1 = JSON.parse(readFileSync(resultC1, 'utf8'))
      const c2 = JSON.parse(readFileSync(resultC2, 'utf8'))
      assert.notEqual(c1.granted, c2.granted, 'exactly one successor must win the stale lease -- never both, never neither')
      const [winner, loser] = c1.granted ? [c1, c2] : [c2, c1]
      assert.equal(loser.code, 'TSF_PLANNER_LEASE_DENIED', 'the losing successor gets an honest, typed refusal, not a silent partial hydrate')

      // The winner sees intact mission state -- the crashed holder's real
      // dispatched worker survives, no state lost across the double-race.
      assert.equal(winner.missionGoal, 'crash-reclaim fixture mission')
      assert.equal(winner.workerCount, 1)
      void heldResult
    } finally {
      crashed.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
