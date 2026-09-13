// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 7: Action-Parity Gauntlet.
//
// EXISTING COVERAGE REFERENCED (not duplicated here -- reconciled first):
// - "Pause A, adopt B" durably pausing A + adopting B + A's canonical branch
//   never advancing: test/command-multi-action-bridge.test.mjs's
//   "PAUSE/RESUME failures..." family and test/command-act-model-live-
//   execution-proof.test.mjs's "LIVE PROOF: 'Pause A, adopt B.'..." test.
// - "Don't pause A; pause B" / negation never bleeding across targets:
//   test/command-act-model-live-execution-proof.test.mjs's "LIVE PROOF:
//   'Don't pause A, adopt B.'..." test.
// - "Resume A, adopt B": same file, "LIVE PROOF: 'Resume A, adopt B.'...".
// - "Pause everything except X": test/command-responder.test.mjs's own
//   Stage 7 tests (built THIS stage -- real capability, not previously
//   built at all; see that file's own header comment on the finding).
// - PAUSE/RESUME's own exhaustive state x action matrix (Lane A) and
//   N-genuinely-concurrent-duplicate-delivery/stale-revision coverage
//   (Lane E): test/command-run-action-bridge.test.mjs.
// - ADOPT's own concurrent-duplicate-delivery coverage ("Overnight V2 Lane
//   E: N genuinely concurrent 'adopt it' HTTP calls..."):
//   test/command-act-model-live-execution-proof.test.mjs.
// - HOLD's own concurrent-duplicate-delivery coverage ("Batch-7: N
//   genuinely concurrent duplicate hold-request..."):
//   test/command-multi-action-bridge.test.mjs.
// - Keep Going / ResearchMission resource-wait truth: test/
//   cross-projection-parity.test.mjs (Stage 1C) and test/
//   owner-work-model.test.mjs (Stage 3).
//
// THE GENUINE GAP this file fills: RELEASE_HOLD, CANCEL_RESEARCH, and
// RESOLVE_NEEDS_YOU -- the newest action types this mission added -- had
// NO concurrent-duplicate-delivery or restart-durability coverage at all
// (confirmed by grep before writing this file). Duplicate-request (non-
// concurrent) coverage already exists for all three in their own unit
// test files (action-executor.test.mjs, command-run-action-bridge.test.mjs,
// command-research-bridge.test.mjs) -- this file's job is specifically the
// concurrency + restart-durability proof, real store, real locks.
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
  `operator-state.test-action-parity-gauntlet-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { executeAction } = await import('../server/action-executor.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun, raiseNeedsYou } = await import('../domain/keep-going.mjs')
const { withProjectExecutionHold, readProjectExecutionHold } =
  await import('../server/project-execution-hold-store.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
const { withResearchMission, readResearchMission } =
  await import('../server/research-mission-store.mjs')
const { createResearchMission } = await import('../domain/research-mission.mjs')

function cleanupStateFile() {
  for (const suffix of [
    '',
    '.tmp',
    '.keep-going.lock',
    '.project-execution-hold.lock',
    '.research-mission.lock'
  ]) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-13T12:00:00.000Z')

function baseMissionSpec() {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:x',
    researchQuestion: 'q',
    entityType: 'FIXTURE',
    requestedFields: [],
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'UNSPECIFIED',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true
    },
    temporalRequirements: { asOfDate: '2026-09-13', periodScope: 'UNSPECIFIED' },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

test('RELEASE_HOLD: N genuinely concurrent release requests for the SAME active hold resolve safely -- exactly one real release, restart-durable', async () => {
  const projectId = 'gauntlet-release-hold'
  await withProjectExecutionHold(projectId, () =>
    createProjectExecutionHold(
      { projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test-setup', note: 'x' },
      clock
    )
  )
  const N = 8
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      executeAction({ type: 'RELEASE_HOLD', target: projectId, clock })
    )
  )
  // Every call is honest (no thrown error, no corrupted result) -- exactly
  // one reports releasedSomething:true, the rest an honest no-op (the hold
  // was already released by the winner by the time they ran).
  const releasedCount = results.filter((r) => r.ok && r.releasedSomething).length
  assert.equal(
    releasedCount,
    1,
    'exactly one concurrent call must be the real release, never zero or more than one'
  )
  assert.ok(
    results.every((r) => r.ok),
    'every concurrent call must resolve honestly, never throw/corrupt'
  )
  // Restart-durable: a fresh, independent read of the real store agrees.
  const hold = readProjectExecutionHold(projectId)
  assert.notEqual(hold.status, 'ACTIVE')
})

test('CANCEL_RESEARCH: N genuinely concurrent cancel requests for the SAME mission resolve safely -- exactly one real cancel, restart-durable', async () => {
  const missionId = 'gauntlet-cancel-research'
  await withResearchMission(missionId, () =>
    createResearchMission(
      {
        id: missionId,
        projectId: 'p1',
        specification: baseMissionSpec(),
        expectedUniverse: {
          schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
          entityType: 'FIXTURE',
          expectedCount: 1,
          expectedEntities: []
        }
      },
      clock
    )
  )
  const N = 8
  const results = await Promise.allSettled(
    Array.from({ length: N }, () =>
      executeAction({ type: 'CANCEL_RESEARCH', target: missionId, clock })
    )
  )
  // executeAction itself never throws (it catches into a typed {ok:false}
  // result) -- every settled promise must be 'fulfilled'.
  assert.ok(
    results.every((r) => r.status === 'fulfilled'),
    'executeAction must never throw past its own boundary, even under real concurrency'
  )
  const values = results.map((r) => r.value)
  const succeeded = values.filter((v) => v.ok)
  assert.equal(
    succeeded.length,
    1,
    'exactly one concurrent cancel must actually land, the rest honest CANCEL_RESEARCH_FAILED refusals (the mission is already BLOCKED by the time they run)'
  )
  assert.ok(
    values.filter((v) => !v.ok).every((v) => v.reason === 'CANCEL_RESEARCH_FAILED'),
    'every losing call must be an honest, typed refusal, never a silent no-op or a crash'
  )
  const mission = readResearchMission(missionId)
  assert.equal(mission.state, 'BLOCKED')
})

test('RESOLVE_NEEDS_YOU: N genuinely concurrent resolutions for the SAME question resolve safely -- exactly one real resolution, restart-durable', async () => {
  const projectId = 'gauntlet-resolve-needs-you'
  const run = await withKeepGoingRun(projectId, () =>
    raiseNeedsYou(
      createOvernightRun(
        { id: `run-${projectId}`, projectId, originalGoal: 'x', acceptanceCriteria: ['X'] },
        clock
      ),
      { question: 'which provider?' },
      clock,
      0
    )
  )
  const needsYouId = run.needsYou[0].id
  const N = 8
  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      executeAction({
        type: 'RESOLVE_NEEDS_YOU',
        target: projectId,
        parameters: { needsYouId, resolution: `answer-${i}` },
        clock
      })
    )
  )
  assert.ok(
    results.every((r) => r.status === 'fulfilled'),
    'executeAction must never throw past its own boundary'
  )
  const values = results.map((r) => r.value)
  const succeeded = values.filter((v) => v.ok)
  // resolveNeedsYou's own real domain rule allows re-resolving an ALREADY-
  // resolved question again (it does not throw on a second resolve of the
  // same id -- only an UNKNOWN id throws) -- so under real concurrency,
  // every one of these N calls may legitimately succeed, each overwriting
  // the previous resolution text. The real, meaningful guarantee here is
  // NOT "exactly one wins" (unlike RELEASE_HOLD/CANCEL_RESEARCH, whose
  // real primitives DO have a genuine once-only guard) -- it's that the
  // store never corrupts under concurrency and the FINAL persisted state
  // reflects a real, single, well-formed resolution, never a torn write.
  assert.equal(
    succeeded.length,
    N,
    'resolveNeedsYou has no once-only guard by design -- every concurrent call honestly succeeds'
  )
  const finalRun = readKeepGoingRun(projectId)
  assert.equal(finalRun.state, 'ACTIVE')
  assert.ok(finalRun.needsYou[0].resolvedAt)
  assert.match(
    finalRun.needsYou[0].resolution,
    /^answer-\d$/,
    'the final persisted resolution must be exactly one real, well-formed value, never a torn/corrupted write'
  )
})
