import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProjectManagerSnapshot } from '../domain/project-manager-snapshot.mjs'
import { createOvernightRun, raiseNeedsYou } from '../domain/keep-going.mjs'
import {
  createProjectExecutionHold,
  releaseProjectExecutionHold
} from '../domain/project-execution-hold.mjs'

const clock = () => new Date('2026-09-19T00:00:00.000Z')
const PROJECT = {
  id: 'nwr',
  displayName: 'Niners War Room',
  mission: { state: 'ADOPTED', blockedReason: null },
  candidateState: null
}

test('buildProjectManagerSnapshot: a project with no run and no legacy state at all reads DONE, no hold', () => {
  const snapshot = buildProjectManagerSnapshot(PROJECT, {}, clock)
  assert.equal(snapshot.primaryState, 'DONE')
  assert.equal(snapshot.keepGoingRun, null)
  assert.equal(snapshot.gap, null)
  assert.deepEqual(snapshot.openResearchMissions, [])
  assert.deepEqual(snapshot.openNeedsYou, [])
})

test('buildProjectManagerSnapshot: a real ACTIVE Keep Going run is reflected in primaryState/gap, grounded not fabricated', () => {
  const run = createOvernightRun(
    {
      id: 'run-nwr',
      projectId: PROJECT.id,
      originalGoal: 'Ship the thing.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  const snapshot = buildProjectManagerSnapshot(PROJECT, { keepGoingRun: run }, clock)
  assert.equal(snapshot.keepGoingRun, run)
  assert.ok(snapshot.gap, 'an ACTIVE run must have a real, non-null gap')
  assert.deepEqual(snapshot.gap.remainingGaps, ['CRITERION_A'])
  assert.ok(['WORKING', 'WAITING'].includes(snapshot.primaryState) || snapshot.primaryState)
})

test("buildProjectManagerSnapshot: a real open Needs You on this project's own run is surfaced, scoped correctly", () => {
  let run = createOvernightRun(
    {
      id: 'run-nwr',
      projectId: PROJECT.id,
      originalGoal: 'Ship the thing.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
  run = raiseNeedsYou(run, { question: 'Which provider?', options: [] }, clock, run.revision)
  const snapshot = buildProjectManagerSnapshot(PROJECT, { keepGoingRun: run }, clock)
  assert.equal(snapshot.openNeedsYou.length, 1)
  assert.equal(snapshot.openNeedsYou[0].question, 'Which provider?')
  assert.equal(snapshot.openNeedsYou[0].projectId, PROJECT.id)
})

test("buildProjectManagerSnapshot: a research mission for a DIFFERENT project never leaks into this project's snapshot", () => {
  const researchMissions = {
    'mission-other': { id: 'mission-other', projectId: 'some-other-project', needsYou: [] },
    'mission-nwr': { id: 'mission-nwr', projectId: PROJECT.id, needsYou: [] }
  }
  const snapshot = buildProjectManagerSnapshot(PROJECT, { researchMissions }, clock)
  assert.equal(snapshot.openResearchMissions.length, 1)
  assert.equal(snapshot.openResearchMissions[0].id, 'mission-nwr')
})

test('buildProjectManagerSnapshot: an active execution hold is reflected honestly (never bypassed, never invented)', () => {
  const hold = createProjectExecutionHold(
    { projectId: PROJECT.id, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'owner' },
    clock
  )
  const snapshot = buildProjectManagerSnapshot(PROJECT, { projectExecutionHold: hold }, clock)
  assert.equal(snapshot.projectExecutionHold, hold)
})

// REAL DOGFOOD FINDING (round 1, P1, Codex-confirmed): a RELEASED hold is
// a real, durable record (never deleted, status flips instead) -- it must
// never be reported as if it were still active.
test('buildProjectManagerSnapshot: a RELEASED execution hold is never reported as active', () => {
  const active = createProjectExecutionHold(
    { projectId: PROJECT.id, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'owner' },
    clock
  )
  const released = releaseProjectExecutionHold(active, { releasedBy: 'owner' }, clock)
  const snapshot = buildProjectManagerSnapshot(PROJECT, { projectExecutionHold: released }, clock)
  assert.equal(snapshot.projectExecutionHold, null)
})

// REAL DOGFOOD FINDING (round 1, P1, Codex-confirmed): a COMPLETE research
// mission stayed in openResearchMissions forever (no terminal-state check).
test('buildProjectManagerSnapshot: a COMPLETE research mission for this project is never reported as still open', () => {
  const researchMissions = {
    'mission-done': { id: 'mission-done', projectId: PROJECT.id, phase: 'COMPLETE', needsYou: [] },
    'mission-live': { id: 'mission-live', projectId: PROJECT.id, phase: 'EXECUTING', needsYou: [] }
  }
  const snapshot = buildProjectManagerSnapshot(PROJECT, { researchMissions }, clock)
  assert.equal(snapshot.openResearchMissions.length, 1)
  assert.equal(snapshot.openResearchMissions[0].id, 'mission-live')
})
