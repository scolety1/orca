// Real V1 stabilization finding (Project Health / DEGRADED catch-all): the
// onboarded-project projection folded HEALTHY_WITH_CAVEATS (a non-blocking
// caveat -- no README, dirty-but-preserved, a linked worktree...) into the
// same 'DEGRADED' fleet-card badge as a genuine NEEDS_ATTENTION finding, so
// merely-paused/read-only/dirty-preserve real projects rendered as if
// something were actually broken. Only a real NEEDS_ATTENTION finding
// should read as DEGRADED; a caveat alone should not.
import assert from 'node:assert/strict'
import test from 'node:test'
import { projectOnboardedProject } from '../server/onboarded-project-projection.mjs'
import { createOvernightRun, recordWave } from '../domain/keep-going.mjs'

function baseAnalysis(overrides = {}) {
  return {
    projectId: 'test-project',
    displayName: 'Test Project',
    repoPath: 'C:/fake/test-project',
    analyzedAt: '2026-08-23T00:00:00.000Z',
    maturity: 'DEVELOPING',
    identity: { branch: 'main', head: 'abc123', tree: 'def456' },
    migrationClassification: { classification: 'SAFE_TO_ONBOARD_NOW', reasons: [] },
    handoffReconciliation: { hasHandoff: false },
    orcaRegistration: { checked: false, registered: false },
    discovery: {
      commandGuidance: {
        hasKnownTestCommand: false,
        testCommands: [],
        lintCommands: [],
        buildCommands: []
      }
    },
    direction: {
      purpose: null,
      recommendedNextMission: null,
      upgradeCandidates: [],
      unfinishedSummary: null,
      completedSummary: null,
      alignment: 'UNKNOWN',
      live: false
    },
    ...overrides
  }
}

function projectWithHealth(status, findings = []) {
  const record = {
    acceptedAt: '2026-08-23T00:00:00.000Z',
    receipts: [],
    lastAnalysis: baseAnalysis({
      health: { status, findings, observedAt: '2026-08-23T00:00:00.000Z' }
    })
  }
  return projectOnboardedProject(record, { activeFleet: false, workSet: false })
}

test('HEALTHY_WITH_CAVEATS (e.g. no README, a resolved handoff, a linked worktree) reads as HEALTHY on the fleet card, not DEGRADED', () => {
  const project = projectWithHealth('HEALTHY_WITH_CAVEATS', [
    {
      code: 'NO_README',
      status: 'HEALTHY_WITH_CAVEATS',
      summary: 'No README found.',
      remediation: 'Optional.'
    }
  ])
  assert.equal(project.health.status, 'HEALTHY')
})

test('a genuine NEEDS_ATTENTION finding still reads as DEGRADED', () => {
  const project = projectWithHealth('NEEDS_ATTENTION', [
    {
      code: 'NO_KNOWN_TEST_COMMAND',
      status: 'NEEDS_ATTENTION',
      summary: 'No test command discovered.',
      remediation: 'Ask the operator.'
    }
  ])
  assert.equal(project.health.status, 'DEGRADED')
})

test('HEALTHY stays HEALTHY, BLOCKED stays BLOCKED, UNKNOWN stays UNKNOWN', () => {
  assert.equal(projectWithHealth('HEALTHY').health.status, 'HEALTHY')
  assert.equal(projectWithHealth('BLOCKED').health.status, 'BLOCKED')
  assert.equal(projectWithHealth('UNKNOWN').health.status, 'UNKNOWN')
})

test('the underlying HEALTHY_WITH_CAVEATS findings remain visible in evidence even though the card badge reads HEALTHY', () => {
  const project = projectWithHealth('HEALTHY_WITH_CAVEATS', [
    {
      code: 'REPOSITORY_IS_LINKED_WORKTREE',
      status: 'HEALTHY_WITH_CAVEATS',
      summary: 'This repository is a linked Git worktree.',
      remediation: 'Confirm this is the intended location.'
    }
  ])
  assert.equal(project.health.status, 'HEALTHY', 'card badge is not degraded')
  assert.ok(
    project.health.findings.some((f) => f.code === 'REPOSITORY_IS_LINKED_WORKTREE'),
    'the real finding is never hidden, only the summary badge is not overstated'
  )
})

// BUG-16: no run passed -> unchanged prior behavior (honestly empty), never
// a regression for a project with no Keep Going run yet.
test('no Keep Going run -> resultCapsules stays honestly empty', () => {
  const project = projectWithHealth('HEALTHY')
  assert.deepEqual(project.evidence.resultCapsules, [])
})

// BUG-16 fix proof, one full layer up from resultCapsulesFromRun's own
// domain-level test: a real run passed through projectOnboardedProject
// reaches evidence.resultCapsules -- the exact field ProjectDetailPage's
// Evidence tab reads, closing the "Flight Recorder records waves while
// Evidence shows nothing" gap end to end at this projection layer.
test('a real Keep Going run with a settled wave -> evidence.resultCapsules reflects it', () => {
  const clock = () => new Date('2026-09-03T00:00:00.000Z')
  const run = recordWave(
    createOvernightRun(
      { id: 'run-1', projectId: 'test-project', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] },
      clock
    ),
    { workItems: [{ id: 'w1', scope: ['x'] }] },
    {
      schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
      outcomes: [{ workItemId: 'w1', taskId: 'task-1', outcome: 'COMPLETED' }],
      settledAt: clock().toISOString()
    },
    clock,
    0
  )
  const record = {
    acceptedAt: '2026-08-23T00:00:00.000Z',
    receipts: [],
    lastAnalysis: baseAnalysis({
      health: { status: 'HEALTHY', findings: [], observedAt: '2026-08-23T00:00:00.000Z' }
    })
  }
  const project = projectOnboardedProject(record, { activeFleet: false, workSet: false }, run)
  assert.equal(project.evidence.resultCapsules.length, 1)
  assert.equal(project.evidence.resultCapsules[0].id, 'w1')
  assert.equal(project.evidence.resultCapsules[0].status, 'COMPLETED')
})
