// Bounded fixture/dogfood mission for M2 (Keep Going / Overnight V1). Proves
// the governance loop (tsf/domain/keep-going.mjs) end to end against a
// synthetic project goal: multiple waves, one revision (a retried task),
// verification that never trusts a worker's own claim, pause/resume,
// idempotent no-duplicate-settled-work on replay, a Needs You round trip,
// and a concise summary -- composed with the real mapOrchestrationFacts
// projection (tsf/adapters/orca-runtime.mjs) fed synthetic-but-realistically-
// shaped orchestration facts, proving the adapter and domain layer actually
// compose. Mirrors the existing fixtures/run-dogfood.mjs pattern for the
// older mission-state.mjs loop; this is the Keep Going equivalent.
import { mapOrchestrationFacts } from '../adapters/orca-runtime.mjs'
import {
  checkpointRun,
  compareStateToGoal,
  createOvernightRun,
  detectStall,
  pauseRun,
  planWave,
  raiseNeedsYou,
  recordTaskAttempt,
  recordWave,
  resolveNeedsYou,
  resumeRun,
  summarizeRun,
  transitionRun
} from '../domain/keep-going.mjs'

const GOAL = 'Ship the fixture upgrade: two independently-scoped criteria, verified honestly.'
const CRITERIA = ['ALPHA_IMPLEMENTED_AND_TESTED', 'BETA_IMPLEMENTED_AND_TESTED']

// compareStateToGoal only ever accepts criteria the caller marks
// verifiedSatisfied -- standing in here for a real VERIFIER_INDEPENDENT
// result; a worker's own "done" claim is never sufficient (program charter
// Section F). This fixture passes the criterion strings directly to mirror
// that contract without inventing an unused intermediate shape.

export function runKeepGoingDogfood(clock = () => new Date('2026-08-19T18:00:00.000Z')) {
  let run = createOvernightRun(
    {
      id: 'overnight-fixture-001',
      projectId: 'fixture:keep-going-dogfood',
      originalGoal: GOAL,
      acceptanceCriteria: CRITERIA,
      usageMode: 'BALANCED',
      constraints: ['Fixture repository only.'],
      stopConditions: ['Any path outside the fixture is requested.']
    },
    clock
  )

  // --- Wave 1: two conflict-free items targeting ALPHA; item B fails once
  // and is retried (the revision) before it settles. ---
  const wave1Items = [
    { id: 'alpha-impl', scope: ['src/alpha.mjs'] },
    { id: 'alpha-tests', scope: ['test/alpha.test.mjs'] }
  ]
  const wave1Plan = planWave(run, wave1Items, clock)
  run = recordTaskAttempt(run, 'alpha-tests', 'RETRY', clock)
  const wave1Result = {
    outcomes: [
      { taskId: 'alpha-impl', dispatchId: 'ctx_alpha_impl', outcome: 'SUCCEEDED', attempts: 1 },
      { taskId: 'alpha-tests', dispatchId: 'ctx_alpha_tests', outcome: 'SUCCEEDED', attempts: 2 }
    ]
  }
  run = recordWave(run, wave1Plan, wave1Result, clock)
  const wavesAfterFirstRecord = run.waves.length
  run = recordWave(run, wave1Plan, wave1Result, clock) // replay: must not duplicate settled work
  const noDuplicateOnReplay = run.waves.length === wavesAfterFirstRecord

  const gapAfterWave1 = compareStateToGoal(run, { verifiedSatisfied: [CRITERIA[0]] }, clock)
  run = checkpointRun(run, { phase: 'WAVE_1_SETTLED', evidence: [gapAfterWave1.runId] }, clock)

  // --- Safe pause/resume round trip (e.g. a capacity or Needs You concern
  // surfaced between waves) ---
  run = pauseRun(run, 'CAPACITY_REVIEW', clock)
  const pausedState = run.state
  run = resumeRun(run, clock)
  const resumedState = run.state

  // --- Needs You round trip: a real human-decision gate that must resolve
  // before the run returns to ACTIVE ---
  run = raiseNeedsYou(
    run,
    { question: 'Proceed with BETA using the Claude-only budget?', options: ['yes', 'no'] },
    clock
  )
  const needsYouState = run.state
  const needsYouId = run.needsYou.at(-1).id
  run = resolveNeedsYou(run, needsYouId, 'yes', clock)
  const resolvedNeedsYouState = run.state

  // --- mapOrchestrationFacts composed with detectStall against a real-shaped
  // worker-list snapshot: proves the adapter and domain layer actually wire
  // together, not just theoretically compatible shapes. ---
  const orchestrationFacts = mapOrchestrationFacts({
    workerList: {
      workers: [
        {
          dispatchId: 'ctx_beta_impl',
          taskId: 'beta-impl',
          runId: run.id,
          workerState: 'ready',
          dispatchStatus: 'dispatched',
          terminalState: 'active'
        }
      ]
    }
  })
  // Real worker-list output carries no heartbeat timestamp today (see
  // tsf/adapters/orca-runtime.mjs) -- detectStall correctly cannot judge
  // staleness from a null timestamp, so it reports no stalls rather than
  // guessing. This documents the real current limitation instead of hiding it.
  const stalls = detectStall(
    run,
    orchestrationFacts.workerHeartbeats.filter((worker) => worker.lastHeartbeatAt !== null),
    clock
  )

  // --- Wave 2: BETA settles in one attempt, independently verified. ---
  const wave2Items = [{ id: 'beta-impl', scope: ['src/beta.mjs'] }]
  const wave2Plan = planWave(run, wave2Items, clock)
  const wave2Result = {
    outcomes: [
      { taskId: 'beta-impl', dispatchId: 'ctx_beta_impl', outcome: 'SUCCEEDED', attempts: 1 }
    ]
  }
  run = recordWave(run, wave2Plan, wave2Result, clock)

  const gapAfterWave2 = compareStateToGoal(run, { verifiedSatisfied: CRITERIA }, clock)
  run = checkpointRun(run, { phase: 'WAVE_2_SETTLED', evidence: [gapAfterWave2.runId] }, clock)
  run = transitionRun(
    run,
    'COMPLETE',
    { reason: 'ORIGINAL_GOAL_SATISFIED', evidence: CRITERIA },
    clock
  )

  const summary = summarizeRun(run, clock)

  return {
    schemaVersion: 'TSF_KEEP_GOING_DOGFOOD_REPORT_V1',
    status: run.state === 'COMPLETE' ? 'GREEN_KEEP_GOING_DOGFOOD' : 'INCOMPLETE',
    executionTruth:
      'DOMAIN_AND_ADAPTER_FIXTURE; NATIVE_ORCA_WORKTREE_DISPATCH_PROOF_IS_SEPARATE (see program state.json M2 wave 3 for that live-dispatch proof)',
    runId: run.id,
    wavesCompleted: run.waves.length,
    revisionProven: run.retryCounts['alpha-tests'] === 1,
    noDuplicateOnReplay,
    pauseResumeProven: pausedState === 'PAUSED' && resumedState === 'ACTIVE',
    needsYouProven: needsYouState === 'NEEDS_YOU' && resolvedNeedsYouState === 'ACTIVE',
    verifierNeverTrustedWorkerClaim:
      gapAfterWave1.decision === 'CONTINUE' && gapAfterWave2.decision === 'STOP_COMPLETE',
    orchestrationAdapterComposed: orchestrationFacts.workerHeartbeats.length === 1,
    stallsDetected: stalls.length,
    finalState: run.state,
    checkpointCount: run.checkpoints.length,
    checkpointsHashChained: run.checkpoints.every(
      (cp, i) => cp.previousHash === (i === 0 ? null : run.checkpoints[i - 1].hash)
    ),
    summary
  }
}

if (process.argv[1] === import.meta.filename) {
  console.log(JSON.stringify(runKeepGoingDogfood(), null, 2))
}
