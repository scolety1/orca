// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part A: pure
// domain coverage -- revalidation checklist, ambiguous-vs-explicit intent
// classification, worktree resolution from a settled run, and the HARD
// BOUNDARY against self-improvement adoption.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyAdoptionCommandIntent,
  resolveCandidateWorktreeFromRun,
  revalidateCommandAdoptionCandidate
} from '../domain/command-adoption-execution.mjs'

const BASE_FACTS = Object.freeze({
  candidateKind: 'KEEP_GOING_RUN',
  runExists: true,
  runState: 'COMPLETE',
  candidateProjectId: 'proj-a',
  targetProjectId: 'proj-a',
  holdActive: false,
  holdDetail: null,
  worktreeResolved: true,
  worktreeClean: true,
  ancestry: 'FAST_FORWARD_AVAILABLE'
})

test('revalidateCommandAdoptionCandidate: a fully-satisfied candidate is eligible', () => {
  const result = revalidateCommandAdoptionCandidate(BASE_FACTS)
  assert.equal(result.eligible, true)
  assert.equal(result.alreadyIncluded, false)
})

test('revalidateCommandAdoptionCandidate: ALREADY_INCLUDED ancestry is eligible and reported distinctly', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, ancestry: 'ALREADY_INCLUDED' })
  assert.equal(result.eligible, true)
  assert.equal(result.alreadyIncluded, true)
})

// HARD BOUNDARY: a self-improvement finding (or any candidate kind other
// than KEEP_GOING_RUN) fed into this engine's own entry point is REFUSED
// outright, never silently adopted.
test('revalidateCommandAdoptionCandidate: a self-improvement finding candidate kind is refused outright, never adopted', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, candidateKind: 'SELF_IMPROVEMENT_FINDING' })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'WRONG_CANDIDATE_KIND')
})

test('revalidateCommandAdoptionCandidate: candidate not found refuses honestly', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, runExists: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'CANDIDATE_NOT_FOUND')
})

test('revalidateCommandAdoptionCandidate: an unverified (not COMPLETE) candidate is refused with the real reason', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, runState: 'ACTIVE' })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'NOT_READY_FOR_ADOPTION')
  assert.match(result.detail, /ACTIVE/)
})

test('revalidateCommandAdoptionCandidate: cross-project candidate is refused', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, candidateProjectId: 'proj-b', targetProjectId: 'proj-a' })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'CROSS_PROJECT_CANDIDATE')
})

test('revalidateCommandAdoptionCandidate: an active hold refuses', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, holdActive: true, holdDetail: 'EXTERNAL_WORK_ACTIVE: another agent' })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'PROJECT_EXECUTION_HOLD_ACTIVE')
  assert.equal(result.detail, 'EXTERNAL_WORK_ACTIVE: another agent')
})

test('revalidateCommandAdoptionCandidate: unresolved worktree refuses', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, worktreeResolved: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'CANDIDATE_WORKTREE_UNRESOLVED')
})

test('revalidateCommandAdoptionCandidate: a dirty candidate worktree refuses', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, worktreeClean: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'CANDIDATE_WORKTREE_NOT_CLEAN')
})

test('revalidateCommandAdoptionCandidate: diverged ancestry refuses, never forces', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, ancestry: 'DIVERGED' })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'CANDIDATE_DIVERGED_FROM_CANONICAL_BASE')
})

test('revalidateCommandAdoptionCandidate: unknown ancestry (a real probe failure) refuses, never assumed safe', () => {
  const result = revalidateCommandAdoptionCandidate({ ...BASE_FACTS, ancestry: 'UNKNOWN' })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'CANDIDATE_ANCESTRY_UNKNOWN')
})

// classifyAdoptionCommandIntent -- mission's own required examples.
for (const message of ['adopt the Nytheria run', 'accept that verified candidate', 'the WorldForge one looks good, adopt it', 'adopt both of those']) {
  test(`classifyAdoptionCommandIntent: sufficient explicit phrasing -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'EXECUTE_ADOPTION')
  })
}

for (const message of ['looks good', 'continue', "what's ready?", 'probably fine']) {
  test(`classifyAdoptionCommandIntent: NOT sufficient -- "${message}" stays report-only`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'NOT_ADOPTION')
  })
}

for (const message of ['should I adopt the Nytheria run?', 'not sure whether to adopt that one', 'maybe accept the candidate']) {
  test(`classifyAdoptionCommandIntent: genuinely ambiguous -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'AMBIGUOUS')
  })
}

// resolveCandidateWorktreeFromRun
test('resolveCandidateWorktreeFromRun: no run -> null', () => {
  assert.equal(resolveCandidateWorktreeFromRun(null), null)
})

test('resolveCandidateWorktreeFromRun: no waves -> null', () => {
  assert.equal(resolveCandidateWorktreeFromRun({ waves: [] }), null)
})

test('resolveCandidateWorktreeFromRun: a single COMPLETED outcome with a worktree resolves it', () => {
  const run = { waves: [{ waveResult: { outcomes: [{ outcome: 'COMPLETED', worktree: '/w/one' }] } }] }
  assert.equal(resolveCandidateWorktreeFromRun(run), '/w/one')
})

test('resolveCandidateWorktreeFromRun: reads the MOST RECENT wave, not an earlier one', () => {
  const run = {
    waves: [
      { waveResult: { outcomes: [{ outcome: 'COMPLETED', worktree: '/w/old' }] } },
      { waveResult: { outcomes: [{ outcome: 'COMPLETED', worktree: '/w/new' }] } }
    ]
  }
  assert.equal(resolveCandidateWorktreeFromRun(run), '/w/new')
})

test('resolveCandidateWorktreeFromRun: disagreeing worktrees in the same wave are honestly ambiguous, never guessed', () => {
  const run = {
    waves: [{
      waveResult: {
        outcomes: [
          { outcome: 'COMPLETED', worktree: '/w/a' },
          { outcome: 'COMPLETED', worktree: '/w/b' }
        ]
      }
    }]
  }
  assert.equal(resolveCandidateWorktreeFromRun(run), null)
})

test('resolveCandidateWorktreeFromRun: a legacy run with no worktree recorded resolves null, never fabricated', () => {
  const run = { waves: [{ waveResult: { outcomes: [{ outcome: 'COMPLETED' }] } }] }
  assert.equal(resolveCandidateWorktreeFromRun(run), null)
})
