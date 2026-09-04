// BUG-16 reproduction + fix proof: Flight Recorder records real waves while
// Evidence shows nothing, because Evidence reads a field
// (evidence.resultCapsules) nothing ever wrote for a real Keep Going run.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createOvernightRun, recordWave } from '../domain/keep-going.mjs'
import { resultCapsulesFromRun } from '../domain/keep-going-result-capsules.mjs'

const clock = () => new Date('2026-09-03T00:00:00.000Z')

function newRun() {
  return createOvernightRun(
    { id: 'run-1', projectId: 'proj-1', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
    clock
  )
}

test('no run -> no result capsules, honestly empty', () => {
  assert.deepEqual(resultCapsulesFromRun(null), [])
})

test('a fresh run with no recorded waves yet -> honestly empty, not fabricated', () => {
  assert.deepEqual(resultCapsulesFromRun(newRun()), [])
})

// Independent-verification hardening: neither shape is reachable via any
// real write path today (createOvernightRun always initializes waves: [],
// and every real waveResult.outcomes is built via .map()) -- defense-in-
// depth against genuinely corrupted persisted state only.
test('a run with no waves field at all -> honestly empty, never throws', () => {
  const { waves: _waves, ...runWithoutWaves } = newRun()
  assert.deepEqual(resultCapsulesFromRun(runWithoutWaves), [])
})

test('a wave whose waveResult.outcomes is not an array -> that wave contributes nothing, never throws', () => {
  const run = newRun()
  run.waves.push({ waveResult: { outcomes: { not: 'an array' } } })
  assert.deepEqual(resultCapsulesFromRun(run), [])
})

// Real reproduction: exactly what Flight Recorder's own buildRunTimeline
// already sees (a WAVE_RECORDED event per run.waves entry) must now also
// reach Evidence via this same, single source of run.waves.
test('a real recorded wave -> a result capsule per outcome, derived from the same run.waves Flight Recorder reads', () => {
  const run = recordWave(
    newRun(),
    { workItems: [{ id: 'w1', scope: ['x'] }] },
    {
      schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
      outcomes: [{ workItemId: 'w1', scope: ['x'], taskId: 'task-1', outcome: 'COMPLETED' }],
      settledAt: clock().toISOString()
    },
    clock,
    0
  )
  const capsules = resultCapsulesFromRun(run)
  assert.equal(capsules.length, 1)
  assert.equal(capsules[0].id, 'w1')
  assert.equal(capsules[0].status, 'COMPLETED')
  assert.equal(capsules[0].workerIdentity.orcaSessionId, 'task-1')
})

test('multiple settled waves flatten into one ordered list, each outcome its own capsule', () => {
  let run = recordWave(
    newRun(),
    { workItems: [{ id: 'w1', scope: ['x'] }] },
    {
      schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
      outcomes: [{ workItemId: 'w1', outcome: 'COMPLETED' }],
      settledAt: clock().toISOString()
    },
    clock,
    0
  )
  run = recordWave(
    run,
    { workItems: [{ id: 'w2', scope: ['y'] }] },
    {
      schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
      outcomes: [{ workItemId: 'w2', outcome: 'FAILED' }],
      settledAt: clock().toISOString()
    },
    clock,
    run.revision
  )
  const capsules = resultCapsulesFromRun(run)
  assert.deepEqual(
    capsules.map((c) => [c.id, c.status]),
    [
      ['w1', 'COMPLETED'],
      ['w2', 'FAILED']
    ]
  )
})

// An abandoned-stalled-wave outcome carries a `note`, not workerIdentity --
// never fabricated beyond what the real abandon path actually records.
test('an abandoned stalled outcome (no taskId) -> honest null workerIdentity, note used as the summary', () => {
  const run = recordWave(
    newRun(),
    { workItems: [{ id: 'w1', scope: ['x'] }] },
    {
      schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
      outcomes: [{ workItemId: 'w1', outcome: 'ABANDONED_STALLED', note: 'operator abandoned' }],
      settledAt: clock().toISOString()
    },
    clock,
    0
  )
  const [capsule] = resultCapsulesFromRun(run)
  assert.equal(capsule.status, 'ABANDONED_STALLED')
  assert.equal(capsule.workerIdentity, null)
  assert.equal(capsule.implementationSummary, 'operator abandoned')
})
