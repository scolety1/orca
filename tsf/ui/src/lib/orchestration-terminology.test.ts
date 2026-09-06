import assert from 'node:assert/strict'
import test from 'node:test'
import {
  humanizeConstant,
  humanizePhase,
  humanizeGapDecision,
  humanizeEventType,
  humanizeResearchPhase
} from './orchestration-terminology.ts'

test('humanizeConstant converts SCREAMING_SNAKE_CASE to a readable sentence fragment', () => {
  assert.equal(humanizeConstant('WAVE_DISPATCHED_PARTIAL'), 'Wave dispatched partial')
  assert.equal(humanizeConstant('CHECKPOINT'), 'Checkpoint')
})

test('humanizeConstant never crashes on an empty string', () => {
  assert.equal(humanizeConstant(''), '')
})

// Real, live-discovered crash (Operator IA consolidation hands-on pass): a
// real resultCapsule with status: null crashed ProjectDetailPage entirely.
test('humanizeConstant never crashes on null/undefined -- degrades to "Unknown"', () => {
  assert.equal(humanizeConstant(null), 'Unknown')
  assert.equal(humanizeConstant(undefined), 'Unknown')
})

test('every real, already-observed phase constant gets a specific human label', () => {
  assert.equal(humanizePhase('RUN_STARTED'), 'Run started')
  assert.equal(humanizePhase('WAVE_STALLED'), 'Stalled')
  assert.equal(humanizePhase('WAVE_DISPATCHED'), 'Work dispatched')
  assert.equal(humanizePhase('RETRY_BUDGET_NEEDS_YOU'), 'Needs you (retries exhausted)')
})

test('an unrecognized phase (a future value this map has not caught up to) degrades to a readable fallback, never raw snake_case', () => {
  assert.equal(humanizePhase('SOME_NEW_PHASE_NOT_YET_MAPPED'), 'Some new phase not yet mapped')
})

test('every real gap decision gets a human label, never the raw command-like string', () => {
  assert.equal(humanizeGapDecision('CONTINUE'), 'In progress')
  assert.equal(humanizeGapDecision('STOP_COMPLETE'), 'All criteria verified')
  assert.equal(humanizeGapDecision('STOP_BLOCKED'), 'Blocked')
  assert.equal(humanizeGapDecision('STOP_BUDGET_EXHAUSTED'), 'Budget exhausted')
})

test('every real Flight Recorder event type gets a human label', () => {
  assert.equal(humanizeEventType('RUN_CREATED'), 'Run created')
  assert.equal(humanizeEventType('STATE_TRANSITION'), 'State changed')
  assert.equal(humanizeEventType('WAVE_RECORDED'), 'Wave recorded')
  assert.equal(humanizeEventType('NEEDS_YOU_RAISED'), 'Needs you raised')
})

test('every real ResearchMission phase gets a human-first label, not the raw state name', () => {
  assert.equal(humanizeResearchPhase('EXECUTING'), 'Researching')
  assert.equal(humanizeResearchPhase('WAITING_NEEDS_INPUT'), 'Needs your approval')
  assert.equal(humanizeResearchPhase('COMPLETE'), 'Complete')
  assert.equal(humanizeResearchPhase('BLOCKED'), 'Blocked')
  assert.equal(humanizeResearchPhase('CREATED'), 'Starting research')
  assert.equal(humanizeResearchPhase('SOME_NEW_PHASE'), 'Some new phase', 'an unmapped future phase still degrades to a readable fallback')
})
