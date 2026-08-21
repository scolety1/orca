import assert from 'node:assert/strict'
import test from 'node:test'
import { detectCompetingCommitments } from '../domain/competing-commitments.mjs'

function run(state, overrides = {}) {
  return {
    id: 'run-1',
    state,
    originalGoal: { statement: 'do the thing' },
    ...overrides
  }
}

test('reports no competing commitments when this project is the only Work Set member', () => {
  const result = detectCompetingCommitments({
    projectId: 'proj-a',
    workSet: ['proj-a'],
    keepGoingRuns: { 'proj-a': run('ACTIVE') },
    providerForecast: {}
  })
  assert.deepEqual(result.otherActiveRuns, [])
  assert.equal(result.capacityContentionLikely, false)
})

test('lists another Work Set project with a genuinely active run', () => {
  const result = detectCompetingCommitments({
    projectId: 'proj-a',
    workSet: ['proj-a', 'proj-b'],
    keepGoingRuns: { 'proj-b': run('ACTIVE') },
    providerForecast: {}
  })
  assert.equal(result.otherActiveRuns.length, 1)
  assert.equal(result.otherActiveRuns[0].projectId, 'proj-b')
  assert.equal(result.otherActiveRuns[0].goal, 'do the thing')
})

test('excludes a Work Set project whose run has already settled (COMPLETE/BLOCKED/PAUSED)', () => {
  const result = detectCompetingCommitments({
    projectId: 'proj-a',
    workSet: ['proj-a', 'proj-b', 'proj-c'],
    keepGoingRuns: { 'proj-b': run('COMPLETE'), 'proj-c': run('PAUSED') },
    providerForecast: {}
  })
  assert.deepEqual(result.otherActiveRuns, [])
})

test('excludes a Work Set project with no Keep Going run at all', () => {
  const result = detectCompetingCommitments({
    projectId: 'proj-a',
    workSet: ['proj-a', 'proj-b'],
    keepGoingRuns: {},
    providerForecast: {}
  })
  assert.deepEqual(result.otherActiveRuns, [])
})

test('REQUIRED PROOF: capacityContentionLikely requires BOTH a real competing run AND real evidenced provider pressure -- never flagged from either fact alone', () => {
  const competingRunOnly = detectCompetingCommitments({
    projectId: 'proj-a',
    workSet: ['proj-a', 'proj-b'],
    keepGoingRuns: { 'proj-b': run('ACTIVE') },
    providerForecast: { codex: { likelyBottleneck: false } }
  })
  assert.equal(competingRunOnly.capacityContentionLikely, false)

  const pressureOnly = detectCompetingCommitments({
    projectId: 'proj-a',
    workSet: ['proj-a'],
    keepGoingRuns: {},
    providerForecast: { codex: { likelyBottleneck: true } }
  })
  assert.equal(pressureOnly.capacityContentionLikely, false)

  const both = detectCompetingCommitments({
    projectId: 'proj-a',
    workSet: ['proj-a', 'proj-b'],
    keepGoingRuns: { 'proj-b': run('ACTIVE') },
    providerForecast: { codex: { likelyBottleneck: true } }
  })
  assert.equal(both.capacityContentionLikely, true)
})
