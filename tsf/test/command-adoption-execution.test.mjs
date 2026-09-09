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

// FIXED (real, live-confirmed P0 -- Full Conversational Control Plane
// Exhaustive Gauntlet V1): "Do not adopt this candidate." used to classify
// EXECUTE_ADOPTION -- the gate that triggers REAL adoption execution never
// checked whether the adoption verb was actually negated. NEGATED_ACTION_
// CAN_EXECUTE must be NO.
for (const message of [
  "Don't adopt it yet.",
  'Do not adopt this candidate.',
  'Never adopt the stalled one.',
  "Don't approve it.",
  'avoid adopting it for now',
  "we previously rejected adopting the stalled one -- don't reconsider that",
  "Won't adopt that one, it's not ready."
]) {
  test(`classifyAdoptionCommandIntent: negated adoption verb NEVER executes -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'NOT_ADOPTION')
  })
}

// Adversarial-review findings (2nd pass): the first negation pattern only
// recognized a hand-picked set of two-word negators within a tight 0-4
// word gap -- these real, live-reproducible refusals slipped through
// entirely (bare "not", "hold off (on)"/"pass on" with no negator word at
// all, and gaps wider than 4 words/tokens with intervening punctuation).
for (const message of [
  'not ready to adopt yet',
  "I'd rather not adopt this one",
  "we're not adopting this one",
  'not adopting this one',
  'not going to adopt this',
  "let's not adopt this one",
  'hold off on adopting',
  'hold off on adopting it',
  'pass on adopting this one',
  'do not, under any circumstances right now, adopt this candidate',
  'please, under absolutely no circumstances whatsoever right now today, adopt this candidate'
]) {
  test(`classifyAdoptionCommandIntent: broadened negation vocabulary/gap -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'NOT_ADOPTION')
  })
}

// The broadened bare-"not" negation trigger must not swallow "not sure" --
// that's HEDGE_PATTERN's own, already-tested uncertainty marker (AMBIGUOUS,
// not a flat refusal) and must keep classifying that way.
test('classifyAdoptionCommandIntent: "not sure" stays a HEDGE (AMBIGUOUS), not swallowed by the broadened bare-"not" negation trigger', () => {
  assert.equal(classifyAdoptionCommandIntent('not sure whether to adopt that one'), 'AMBIGUOUS')
})

// The "never mind" idiom ("disregard that") must not itself be misread as a
// negation of a genuine adoption request that follows later in the same
// message.
test('classifyAdoptionCommandIntent: "never mind" is an idiom, not a negation -- a genuine adoption request after it still executes', () => {
  assert.equal(classifyAdoptionCommandIntent('Never mind my earlier hesitation, adopt it now.'), 'EXECUTE_ADOPTION')
})

// Mission's own required positive examples must survive the negation fix
// completely unchanged.
for (const message of ['adopt the Nytheria run', 'accept that verified candidate', 'the WorldForge one looks good, adopt it', 'adopt both of those']) {
  test(`classifyAdoptionCommandIntent: negation fix does not regress a genuine explicit request -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'EXECUTE_ADOPTION')
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

// Real, disclosed gap this fallback closes: a run whose outcomes predate
// worktree-in-outcome tracking (e.g. the real Landing Page run, completed
// 2026-08-27) but whose wave PLAN -- real, durable data written before
// dispatch -- already recorded it.
test('resolveCandidateWorktreeFromRun: falls back to the wave PLAN\'s own worktree when the outcome carries none, for a work item confirmed COMPLETED', () => {
  const run = {
    waves: [{
      wavePlan: { batches: [[{ id: 'w1', worktree: '/plan/wt' }]] },
      waveResult: { outcomes: [{ workItemId: 'w1', outcome: 'COMPLETED' }] }
    }]
  }
  assert.equal(resolveCandidateWorktreeFromRun(run), '/plan/wt')
})

test('resolveCandidateWorktreeFromRun: the plan fallback never trusts a plan item that did not actually complete', () => {
  const run = {
    waves: [{
      wavePlan: { batches: [[{ id: 'w1', worktree: '/plan/wt' }]] },
      // w1 itself never completed -- only an unrelated item did, so the
      // plan's own worktree for w1 must never be trusted here.
      waveResult: { outcomes: [{ workItemId: 'w2', outcome: 'COMPLETED' }] }
    }]
  }
  assert.equal(resolveCandidateWorktreeFromRun(run), null)
})

test('resolveCandidateWorktreeFromRun: the plan fallback is refused on disagreement too, same as the outcome-level check', () => {
  const run = {
    waves: [{
      wavePlan: { batches: [[{ id: 'w1', worktree: '/plan/a' }], [{ id: 'w2', worktree: '/plan/b' }]] },
      waveResult: {
        outcomes: [
          { workItemId: 'w1', outcome: 'COMPLETED' },
          { workItemId: 'w2', outcome: 'COMPLETED' }
        ]
      }
    }]
  }
  assert.equal(resolveCandidateWorktreeFromRun(run), null)
})

test('resolveCandidateWorktreeFromRun: a real, present outcome-level worktree always wins over the plan fallback -- never falls through when the newer field is already there', () => {
  const run = {
    waves: [{
      wavePlan: { batches: [[{ id: 'w1', worktree: '/plan/stale-or-different' }]] },
      waveResult: { outcomes: [{ workItemId: 'w1', outcome: 'COMPLETED', worktree: '/outcome/real' }] }
    }]
  }
  assert.equal(resolveCandidateWorktreeFromRun(run), '/outcome/real')
})
