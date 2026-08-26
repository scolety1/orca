import assert from 'node:assert/strict'
import test from 'node:test'
import {
  needsReconciliation,
  decideReconciliationAction,
  RECONCILIATION_VERIFICATION_TASK_ID,
  LATE_COMMITS_CHECKPOINT_PHASE
} from '../domain/settled-run-reconciliation.mjs'

function baseRun(overrides = {}) {
  return {
    id: 'run-x',
    projectId: 'p',
    state: 'ACTIVE',
    originalGoal: { statement: 'do the thing', acceptanceCriteria: ['A', 'B'] },
    budget: { maxWaves: 10, maxRetriesPerTask: 2 },
    waves: [
      {
        digest: 'd1',
        wavePlan: {},
        waveResult: { outcomes: [] },
        recordedAt: '2026-08-24T09:00:00.000Z'
      }
    ],
    inFlightWave: null,
    tickLock: null,
    needsYou: [],
    checkpoints: [],
    retryCounts: {},
    ...overrides
  }
}

test('needsReconciliation is false while a wave is genuinely in flight', () => {
  const run = baseRun({ inFlightWave: { wavePlan: {} } })
  assert.equal(needsReconciliation(run), false)
})

test('needsReconciliation is false with an open Needs You question -- that gate takes priority', () => {
  const run = baseRun({ needsYou: [{ question: 'x', resolvedAt: null }] })
  assert.equal(needsReconciliation(run), false)
})

test("needsReconciliation is false with no waves dispatched yet (PLANNING territory, not this mechanism's job)", () => {
  const run = baseRun({ waves: [] })
  assert.equal(needsReconciliation(run), false)
})

test('needsReconciliation is true for the exact real settled shape (no in-flight wave, no lock, waves exist)', () => {
  assert.equal(needsReconciliation(baseRun()), true)
})

test('decideReconciliationAction: NOT_APPLICABLE when the run is not a reconciliation candidate', () => {
  const result = decideReconciliationAction({
    run: baseRun({ inFlightWave: { wavePlan: {} } }),
    worktreeEvidence: null,
    verdict: null
  })
  assert.equal(result.action, 'NOT_APPLICABLE')
})

test("decideReconciliationAction: CAPTURE_LATE_COMMITS when real uncaptured commits exist -- WorldForge/Landing Page's exact real shape", () => {
  const result = decideReconciliationAction({
    run: baseRun(),
    worktreeEvidence: {
      headCommit: 'abc123',
      clean: true,
      commitsSinceLastCheckpoint: [
        { sha: 'abc123', at: '2026-08-24T10:52:52.000Z', subject: 'fix: close the gate' }
      ]
    },
    verdict: null
  })
  assert.equal(result.action, 'CAPTURE_LATE_COMMITS')
  assert.equal(result.commits.length, 1)
})

test('decideReconciliationAction: idempotent -- a commit already captured in a prior reconciliation checkpoint is not re-flagged', () => {
  const run = baseRun({
    checkpoints: [
      {
        phase: LATE_COMMITS_CHECKPOINT_PHASE,
        note: 'x',
        evidence: ['abc123'],
        at: '2026-08-24T11:00:00.000Z'
      }
    ]
  })
  const result = decideReconciliationAction({
    run,
    worktreeEvidence: {
      headCommit: 'abc123',
      clean: true,
      commitsSinceLastCheckpoint: [
        { sha: 'abc123', at: '2026-08-24T10:52:52.000Z', subject: 'already captured' }
      ]
    },
    verdict: null
  })
  // No uncaptured commits -> falls through to the next real gap: no
  // verdict exists yet.
  assert.equal(result.action, 'DISPATCH_VERIFICATION')
})

test('decideReconciliationAction: DISPATCH_VERIFICATION when no verdict exists -- never assumes passed, never assumes failed', () => {
  const result = decideReconciliationAction({
    run: baseRun(),
    worktreeEvidence: { headCommit: 'x', clean: true, commitsSinceLastCheckpoint: [] },
    verdict: null
  })
  assert.equal(result.action, 'DISPATCH_VERIFICATION')
})

test('decideReconciliationAction: COMPLETE only when a real verdict confirms every criterion, and returns the exact criteria as verifiedSatisfied -- never manufactured', () => {
  const result = decideReconciliationAction({
    run: baseRun(),
    worktreeEvidence: { headCommit: 'x', clean: true, commitsSinceLastCheckpoint: [] },
    verdict: {
      criteria: [
        { criterion: 'A', verified: true, evidence: 'ruff check . passed, 0 findings' },
        { criterion: 'B', verified: true, evidence: 'pytest timeout root-caused, see report' }
      ]
    }
  })
  assert.equal(result.action, 'COMPLETE')
  assert.deepEqual(result.verifiedSatisfied, ['A', 'B'])
})

test('decideReconciliationAction: NEEDS_DECISION when real verification finds unsatisfied criteria -- never silently called complete', () => {
  const result = decideReconciliationAction({
    run: baseRun(),
    worktreeEvidence: { headCommit: 'x', clean: true, commitsSinceLastCheckpoint: [] },
    verdict: {
      criteria: [
        { criterion: 'A', verified: true, evidence: '...' },
        { criterion: 'B', verified: false, evidence: 'pytest still times out after 30 min' }
      ]
    }
  })
  assert.equal(result.action, 'NEEDS_DECISION')
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].criterion, 'B')
  assert.equal(result.retryBudgetExceeded, false)
})

test("decideReconciliationAction: NEEDS_DECISION flags retryBudgetExceeded using the run's own real budget -- reuses abandonStalledWave's exact convention, not a new one", () => {
  const run = baseRun({ retryCounts: { [RECONCILIATION_VERIFICATION_TASK_ID]: 2 } })
  const result = decideReconciliationAction({
    run,
    worktreeEvidence: { headCommit: 'x', clean: true, commitsSinceLastCheckpoint: [] },
    verdict: { criteria: [{ criterion: 'A', verified: false, evidence: 'still failing' }] }
  })
  assert.equal(result.action, 'NEEDS_DECISION')
  assert.equal(result.retryBudgetExceeded, true)
})
