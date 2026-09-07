// Finding F4, Part B (Autonomous Reliability Hardening Overnight V1, Phase
// 1): planner-mission-lease.test.mjs proves stale/expired-lease reclaim at
// the pure-function level with a fake clock; planner-mission-lease-cross-
// process.test.mjs proves graceful relinquish/reacquire across real OS
// processes. Neither combines a REAL killed process that was holding the
// lease + real TTL-expiry-based reclaim + a real successor hydrating and
// passing continuity verification, all in one real end-to-end test. This
// does.
//
// Spawn/kill mechanics mirror resource-pressure-lease-host-wide.test.mjs's
// own "a real process crash while holding a lease self-heals via TTL" proof
// (REUSE_PATTERN, the actual real spawn-and-SIGKILL-a-resource-holder
// template in this repo): spawn a real child holding a resource, confirm a
// second party sees it as genuinely live, SIGKILL it, wait past the real
// TTL, reclaim. keep-going-autonomy-proof.test.mjs was checked as the task
// brief's suggested template but does not actually spawn+kill a separate OS
// process (its "restart" is deactivate()/activate() in the SAME test
// process) -- resource-pressure-lease-host-wide.test.mjs is the file that
// genuinely does what this test needs, so that is the template reused here.
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const WORKER = path.join(HERE, 'fixtures', 'planner-crash-reclaim-worker.mjs')
const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })
// Short enough to keep this test fast; long enough that real child-process
// spawn + module-load + startMission + dispatch jitter on a loaded host
// still reliably completes and gets observed BEFORE it expires (the
// "refused before TTL expiry" assertion below would be meaningless
// otherwise). acquirePlannerLease's own ttlMs override is what makes this
// possible without touching DEFAULT_PLANNER_MISSION_LEASE_TTL_MS (10min).
const LEASE_TTL_MS = 600
const MISSION_ID = 'mission:crash-reclaim-fixture'
const REPO_STATE = { branch: 'tsf/feature/f4-crash-reclaim-fixture', sha: 'c'.repeat(40) }

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) { return }
    if (Date.now() > deadline) { throw new Error('waitFor timed out') }
    await new Promise((resolve) => setTimeout(resolve, intervalMs)) // eslint-disable-line no-await-in-loop
  }
}

test(
  'REAL crash-reclaim: a killed planner process\'s lease is refused before TTL expiry, then reclaimed with intact worker state and passing continuity after',
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-planner-crash-reclaim-test-'))
    const stateFile = path.join(dir, 'operator-state.json')
    const resultPath = path.join(dir, 'held.json')
    // Set BEFORE the in-process dynamic import below -- data-store.mjs
    // captures TSF_UI_STATE_FILE into a module-level const at import time.
    process.env.TSF_UI_STATE_FILE = stateFile
    const { PlannerSessionLifecycle } = await import('../server/planner-session-lifecycle.mjs')

    const child = spawn(process.execPath, [WORKER, MISSION_ID, 'planner-crashed', String(LEASE_TTL_MS), resultPath], {
      env: { ...process.env, TSF_UI_STATE_FILE: stateFile },
      stdio: 'ignore'
    })
    try {
      // Confirms the child genuinely got past a real acquire + real
      // dispatch (durable on disk) before anything else happens -- not
      // merely spawned.
      await waitFor(() => {
        try {
          return JSON.parse(readFileSync(resultPath, 'utf8')).held === true
        } catch {
          return false
        }
      })
      const heldResult = JSON.parse(readFileSync(resultPath, 'utf8'))

      // BEFORE the TTL expires: a fresh successor is genuinely refused --
      // proves the lease was live (not abandoned/empty) at this point, so
      // the later successful reclaim is real TTL-expiry recovery, not a
      // no-op against an already-free lease.
      const tooEarly = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-successor',
        deps: { clock: () => new Date(), collectHostMemoryEvidence: fakeHealthyMemory, observeRepoState: () => REPO_STATE }
      })
      await assert.rejects(tooEarly.acquireLeaseAndHydrate(), (error) => error.code === 'TSF_PLANNER_LEASE_DENIED')

      // Kill -9 -- no relinquish, no graceful shutdown, exactly a real
      // crash (cross-platform: Node maps SIGKILL to TerminateProcess on
      // Windows, same as resource-pressure-lease-host-wide.test.mjs).
      child.kill('SIGKILL')

      // Past the real TTL, a genuinely separate PlannerSessionLifecycle
      // object (no shared in-memory state with the crashed child or with
      // `tooEarly` above) must be able to reclaim.
      await new Promise((resolve) => setTimeout(resolve, LEASE_TTL_MS + 400))

      const successor = new PlannerSessionLifecycle({
        missionId: MISSION_ID,
        plannerSessionId: 'planner-successor',
        deps: { clock: () => new Date(), collectHostMemoryEvidence: fakeHealthyMemory, observeRepoState: () => REPO_STATE }
      })
      // acquireLeaseAndHydrate internally calls assertRepoStateContinuity --
      // resolving without throwing IS the real continuity-verification proof.
      const checkpoint = await successor.acquireLeaseAndHydrate()
      assert.equal(checkpoint.missionGoal, 'crash-reclaim fixture mission')
      assert.equal(checkpoint.phase, 'BUILD')

      // The crashed process's dispatched worker survives, intact, for the
      // successor to see -- proving state was hydrated from durable
      // storage, not fabricated fresh.
      const workers = successor.getWorkers()
      assert.equal(workers.length, 1)
      assert.equal(workers[0].workerId, heldResult.workerId)
      assert.equal(workers[0].status, 'DISPATCHED')

      assert.equal(successor.getLease().holderPlannerSessionId, 'planner-successor')
    } finally {
      child.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
