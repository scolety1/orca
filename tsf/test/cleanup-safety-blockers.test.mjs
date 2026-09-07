import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCleanupBlockers } from '../domain/cleanup-safety-blockers.mjs'

const CLOCK = () => new Date('2026-09-06T12:00:00.000Z')
function baseContext(overrides = {}) {
  return {
    evidenceObservedAt: '2026-09-06T11:59:50.000Z',
    protectedPath: false,
    protectedBranch: false,
    activeMissionReferenced: false,
    ...overrides
  }
}

test('a fully clear context passes with zero blockers', () => {
  const result = evaluateCleanupBlockers(baseContext(), CLOCK)
  assert.equal(result.blocked, false)
  assert.equal(result.tier, 'CLEAR')
  assert.equal(result.blockers.length, 0)
})

test('protectedPath=true forces PROTECTED regardless of every other field', () => {
  const result = evaluateCleanupBlockers(baseContext({ protectedPath: true }), CLOCK)
  assert.equal(result.blocked, true)
  assert.equal(result.tier, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'PROTECTED_PATH'))
})

test('protectedBranch=true forces PROTECTED', () => {
  const result = evaluateCleanupBlockers(baseContext({ protectedBranch: true }), CLOCK)
  assert.equal(result.tier, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'PROTECTED_BRANCH'))
})

test('isMainWorktree=true forces PROTECTED (canonical-main protection)', () => {
  const result = evaluateCleanupBlockers(baseContext({ isMainWorktree: true }), CLOCK)
  assert.equal(result.tier, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'CANONICAL_MAIN_WORKTREE'))
})

test('isMainWorktree field absent entirely is simply not checked (not an SSH/worktree resource)', () => {
  const result = evaluateCleanupBlockers(baseContext(), CLOCK)
  assert.equal(result.passedChecks.includes('NOT_MAIN_WORKTREE'), false)
  assert.equal(result.blocked, false)
})

test('git.clean=false (dirty-worktree protection) forces PROTECTED', () => {
  const result = evaluateCleanupBlockers(baseContext({ git: { clean: false } }), CLOCK)
  assert.equal(result.tier, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'DIRTY_WORKTREE'))
})

test('git.clean=null/undefined fails closed to UNKNOWN, never treated as clean', () => {
  const result = evaluateCleanupBlockers(baseContext({ git: {} }), CLOCK)
  assert.equal(result.tier, 'UNKNOWN')
  assert.ok(result.blockers.some((b) => b.code === 'GIT_CLEAN_UNKNOWN'))
})

test('activeMissionReferenced=true forces PROTECTED (active-mission protection)', () => {
  const result = evaluateCleanupBlockers(baseContext({ activeMissionReferenced: true }), CLOCK)
  assert.equal(result.tier, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'ACTIVE_MISSION_REFERENCE'))
})

test('activeMissionReferenced omitted entirely fails closed to UNKNOWN -- this field is REQUIRED, never optional', () => {
  const context = baseContext()
  delete context.activeMissionReferenced
  const result = evaluateCleanupBlockers(context, CLOCK)
  assert.equal(result.tier, 'UNKNOWN')
  assert.ok(result.blockers.some((b) => b.code === 'ACTIVE_MISSION_REFERENCE_UNKNOWN'))
})

test('sessionLive=true blocks PROTECTED; omitted entirely is not checked', () => {
  const live = evaluateCleanupBlockers(baseContext({ sessionLive: true }), CLOCK)
  assert.equal(live.tier, 'PROTECTED')
  const omitted = evaluateCleanupBlockers(baseContext(), CLOCK)
  assert.equal(omitted.passedChecks.includes('NO_ACTIVE_SESSION'), false)
})

test('sessionLive=null (present but ambiguous) fails closed to UNKNOWN', () => {
  const result = evaluateCleanupBlockers(baseContext({ sessionLive: null }), CLOCK)
  assert.equal(result.tier, 'UNKNOWN')
  assert.ok(result.blockers.some((b) => b.code === 'SESSION_LIVENESS_UNKNOWN'))
})

test('fileLocked=true (Windows file-handle lock) blocks PROTECTED', () => {
  const result = evaluateCleanupBlockers(baseContext({ fileLocked: true }), CLOCK)
  assert.equal(result.tier, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'FILE_HANDLE_LOCKED'))
})

test('stale evidence (observed too long ago) is UNKNOWN, not silently accepted', () => {
  const result = evaluateCleanupBlockers(baseContext({ evidenceObservedAt: '2026-09-06T11:00:00.000Z' }), CLOCK)
  assert.equal(result.tier, 'UNKNOWN')
  assert.ok(result.blockers.some((b) => b.code === 'SAFETY_EVIDENCE_STALE'))
})

test('PROTECTED always wins over UNKNOWN when both are present', () => {
  const result = evaluateCleanupBlockers(baseContext({ protectedPath: true, git: {} }), CLOCK)
  assert.equal(result.tier, 'PROTECTED')
})

test('evaluateCleanupBlockers is a pure function -- same input always yields the same output', () => {
  const context = baseContext({ protectedPath: false, git: { clean: true }, sessionLive: false })
  const a = evaluateCleanupBlockers(context, CLOCK)
  const b = evaluateCleanupBlockers(context, CLOCK)
  assert.deepEqual(a, b)
})
