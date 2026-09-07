// Phase 8 (Planner Lifecycle Chaos Test) finding: the golden-rollover test
// only proves a CLEAN handoff -- planner A fully relinquishes, THEN planner B
// takes over, THEN B records worker/verifier/Needs-You state. It never
// exercises a real result arriving from planner A's own side WHILE a
// rollover is genuinely in progress (a successor already reclaimed the lease,
// but A -- still alive in-process, mid-write -- has not found out yet).
//
// Real gap found: PlannerSessionLifecycle._mutate's lease check
// (readPlannerMissionRecord + _requireLease) ran as a plain pre-flight read,
// OUTSIDE the file lock mutateCheckpoint's actual write takes. In-process
// there is no `await` between that check and the write, so the window is
// normally sub-millisecond -- but it is real: a genuinely separate OS process
// (exactly what a rollover/crash-reclaim successor is) can land its own
// lease takeover in that gap. A stale planner whose check had already passed
// could still commit its write afterward, unconditionally -- two planners
// mutating the same mission concurrently, violating the single-authoritative-
// planner guarantee this whole mechanism exists to enforce.
//
// This test widens that real (not fabricated) window deterministically, the
// same way Finding F22's own test made its race deterministic (patching
// _mutate for exact timing) -- every function called below is the REAL
// production function (readPlannerMissionRecord, _requireLease,
// mutateCheckpoint, the domain mutators), just with an explicit await
// inserted where production code has none, so a real successor's real
// takeover can land inside it on every run instead of by chance.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-rollover-race-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { PlannerSessionLifecycle } = await import('../server/planner-session-lifecycle.mjs')
const { mutateCheckpoint, readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { recordVerifierResult, recordWorkerResult, raisePlannerNeedsYou } = await import('../domain/planner-mission-checkpoint.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) { rmSync(`${STATE_FILE}${suffix}`, { force: true }) }
}
cleanupStateFile()

const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })
const REPO_STATE = { branch: 'tsf/feature/fixture-rollover-race', sha: 'd'.repeat(40), worktreePath: 'C:/fixture/worktree' }
const wallClock = () => new Date()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Reimplements _mutate's own two steps with a real, injectable gap between
// them -- the SAME real functions, just letting a caller widen the window a
// real cross-process race would otherwise hit only by chance.
async function raceWidenedMutate(plannerSession, missionId, checkpointMutator, { afterCheck }) {
  const record = readPlannerMissionRecord(missionId)
  plannerSession._requireLease(record) // real pre-flight check -- must genuinely pass here, not vacuously
  await afterCheck()
  return mutateCheckpoint(missionId, (current, clock) => checkpointMutator(current, clock), plannerSession.deps.clock, { requireLeaseHolder: plannerSession.plannerSessionId })
}

// One scenario per mutator the mission brief names separately (worker
// result, verifier result, Needs-You) -- all funnel through the identical
// _mutate mechanism, but each gets its own real race proof rather than an
// assumed-equivalent claim.
const SCENARIOS = [
  {
    name: 'a worker result',
    needsWorkerDispatch: true,
    mutator: (current, clock) => recordWorkerResult(current, 'race-worker-1', { status: 'COMPLETED', result: { summary: 'A\'s real worker finished' } }, clock),
    landed: (checkpoint) => checkpoint.workers['race-worker-1']?.status === 'COMPLETED'
  },
  {
    name: 'a verifier result',
    mutator: (current, clock) => recordVerifierResult(current, { verifier: 'fixture-verifier', verdict: 'PASS' }, clock),
    landed: (checkpoint) => checkpoint.verifierResults.length > 0
  },
  {
    name: 'a Needs-You item',
    mutator: (current, clock) => raisePlannerNeedsYou(current, { question: 'A\'s own real question, raised too late', category: 'OTHER' }, clock),
    landed: (checkpoint) => checkpoint.needsYou.some((n) => n.question === 'A\'s own real question, raised too late')
  }
]

for (const scenario of SCENARIOS) {
  test(`rollover race: ${scenario.name} arriving from a stale planner mid-write, after a real successor already took over, is rejected atomically`, async (t) => {
    const missionId = `mission:rollover-race-${scenario.name.replace(/\s+/g, '-')}`
    try {
      const plannerA = new PlannerSessionLifecycle({
        missionId,
        plannerSessionId: 'planner-A',
        deps: { clock: wallClock, collectHostMemoryEvidence: fakeHealthyMemory, leaseTtlMs: 150 }
      })
      await plannerA.startMission({ missionGoal: 'rollover race fixture', phase: 'BUILD', repoState: REPO_STATE })
      if (scenario.needsWorkerDispatch) {
        plannerA.deps.dispatchWorker = async () => ({ workerId: 'race-worker-1' })
        await plannerA.dispatchWorkerForTask({ taskId: 'race-worker-1', kind: 'FIXTURE_WORKER' })
      }
      // A single call: the pre-flight check inside raceWidenedMutate runs
      // synchronously, RIGHT NOW, while A's lease is genuinely still live --
      // then afterCheck() (real TTL wait + a real successor's real takeover
      // and real write) runs before A's actual mutateCheckpoint call. This
      // must stay ONE call, not split across separate awaited sub-tests --
      // splitting it would let each sub-test's own fresh lease read see B's
      // takeover BEFORE A's check runs, which proves nothing about the race.
      let plannerBNeedsYouId
      const pendingWrite = raceWidenedMutate(plannerA, missionId, scenario.mutator, {
        afterCheck: async () => {
          await sleep(250) // past plannerA's real 150ms TTL
          const plannerB = new PlannerSessionLifecycle({
            missionId,
            plannerSessionId: 'planner-B',
            deps: { clock: wallClock, collectHostMemoryEvidence: fakeHealthyMemory, observeRepoState: () => REPO_STATE }
          })
          await plannerB.acquireLeaseAndHydrate()
          const afterB = await plannerB.raiseNeedsYou({ question: 'planner B\'s own real, concurrent decision', category: 'OTHER' })
          plannerBNeedsYouId = afterB.needsYou.at(-1).id
        }
      })

      await t.test('A\'s delayed write, landing after a real successor already took over and did its own real work, is refused -- not silently applied', async () => {
        await assert.rejects(pendingWrite, (error) => error.code === 'TSF_PLANNER_LEASE_NOT_HELD')
      })

      await t.test('the durable checkpoint shows only B\'s work -- A never landed', () => {
        const record = readPlannerMissionRecord(missionId)
        assert.equal(record.lease.holderPlannerSessionId, 'planner-B')
        assert.equal(record.checkpoint.needsYou.some((n) => n.id === plannerBNeedsYouId), true, 'B\'s real concurrent write must be intact')
        assert.equal(scenario.landed(record.checkpoint), false, `A's ${scenario.name} must never have landed in the durable checkpoint`)
      })
    } finally {
      cleanupStateFile()
    }
  })
}
