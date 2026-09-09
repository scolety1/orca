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

// Fuzzing finding (Full Conversational Control Plane Exhaustive Gauntlet
// V1, Batch 5, MOST SEVERE finding this mission): the negator list never
// generalized the "-n't" contraction family, so every one of these real,
// clearly-declined adoption requests wrongly classified EXECUTE_ADOPTION --
// feeding executeCommandAdoption, a real branch-advancing operation.
for (const message of [
  "I didn't want to adopt this candidate.",
  "We haven't decided to adopt this one.",
  "This project doesn't need to adopt that run.",
  "She hasn't approved adopting this candidate.",
  "It wasn't approved for adoption.",
  "They weren't going to adopt that run.",
  "You mustn't adopt this candidate.",
  "You needn't adopt this one."
]) {
  test(`classifyAdoptionCommandIntent: the full "-n't" contraction family is recognized as negation, never EXECUTE_ADOPTION -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'NOT_ADOPTION')
  })
}

// Adversarial-review finding (BLOCKING, real, verified): a curly/"smart"
// apostrophe (U+2019 -- the macOS/iOS/Word autocorrect default) reopened
// this exact P0 class even for the already-covered base "don't". Also
// covers the archaic/dialectal forms found in the same review pass.
for (const message of [
  'I don’t want to adopt this candidate.',
  'She hasn’t approved adopting this candidate.',
  "You shan't adopt this candidate.",
  "You oughtn't adopt this candidate.",
  "You daren't adopt this candidate."
]) {
  test(`classifyAdoptionCommandIntent: curly apostrophes and archaic "-n't" forms are recognized as negation, never EXECUTE_ADOPTION -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'NOT_ADOPTION')
  })
}

// Positive control: broadening to "ai" (for "ain't") must not falsely
// negate genuine words that merely contain that substring.
for (const word of ['paint', 'complaint', 'saint', 'maintain', 'acquaint']) {
  test(`classifyAdoptionCommandIntent: the "ai" (ain't) broadening does not falsely match "${word}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(`please ${word} and adopt this candidate`), 'EXECUTE_ADOPTION')
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

// Full Control Plane Exhaustive Gauntlet V1, one-hour continuation
// (independent red-team finding, real, live-confirmed P0): "accept"/
// "approve" are common general-purpose English verbs with no scoping to
// this engine's own candidate/run/mission vocabulary -- "I accept your
// apology.", "approve the vacation request", and (the confirmed-reachable
// case, since a real, exact-matched project can genuinely be named
// alongside completely unrelated content) "Please approve the PR for
// EasyLifeHQ." all classified EXECUTE_ADOPTION.
for (const message of [
  'I accept your apology.',
  'approve the vacation request',
  'Please approve the PR for EasyLifeHQ.',
  'I accept his offer.',
  'approve my proposal',
  'accept the resignation'
]) {
  test(`classifyAdoptionCommandIntent: accept/approve used in a confirmed-unrelated sense is NOT_ADOPTION -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'NOT_ADOPTION')
  })
}

// Positive control: every one of this file's own required sufficient
// examples using accept -- plus the golden-path-eval's own bare
// "accept <ProjectName>" -- must survive this narrowing completely
// unchanged.
for (const message of ['accept that verified candidate', 'accept EasyLifeHQ', 'accept the candidate', 'accept the Nytheria candidate', 'approve the run', 'approve this adoption']) {
  test(`classifyAdoptionCommandIntent: the accept/approve narrowing does not regress a genuine adoption request -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'EXECUTE_ADOPTION')
  })
}

// Independent adversarial-review finding (BLOCKING, same mission, caught
// before adoption): the curated-denylist-only version of the fix above
// could never enumerate all of ordinary English -- "approve the budget
// for WorldForge", "accept the invoice for WorldForge", etc. all still
// classified EXECUTE_ADOPTION and were confirmed reachable to a real
// merge. Redesigned as an allowlist requiring accept/approve's own DIRECT
// OBJECT to be a real, known project name (or a candidate-referring noun)
// -- verified here with real project context, matching the review's own
// exact repro cases.
const REVIEW_PROJECTS = [{ id: 'worldforge', displayName: 'WorldForge' }, { id: 'easylife', displayName: 'EasyLifeHQ' }]
for (const message of [
  'approve the budget for WorldForge',
  'accept the invoice for WorldForge',
  'accept the challenge, WorldForge',
  'approve the timeline for WorldForge',
  'I accept the deal, ship WorldForge',
  'approve the design for WorldForge'
]) {
  test(`classifyAdoptionCommandIntent: with real project context, accept/approve's object must be the project itself, not a co-mentioned unrelated noun -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message, REVIEW_PROJECTS), 'NOT_ADOPTION')
  })
}

// Positive control: bare "accept/approve <ProjectName>" (the project
// itself as the direct object) still executes when real project context
// confirms it's a known project -- the allowlist's own intended match.
for (const message of ['accept WorldForge', 'approve WorldForge', 'accept EasyLifeHQ']) {
  test(`classifyAdoptionCommandIntent: with real project context, accept/approve naming the project as its own direct object still executes -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message, REVIEW_PROJECTS), 'EXECUTE_ADOPTION')
  })
}

// Positive control: every required example still works with NO project
// context supplied at all (the legacy curated-denylist fallback for pure,
// project-agnostic classification calls).
for (const message of ['adopt the Nytheria run', 'accept that verified candidate', 'the WorldForge one looks good, adopt it', 'adopt both of those', 'accept EasyLifeHQ']) {
  test(`classifyAdoptionCommandIntent: with NO project context supplied, the legacy fallback still recognizes required phrasings -- "${message}"`, () => {
    assert.equal(classifyAdoptionCommandIntent(message), 'EXECUTE_ADOPTION')
  })
}

// CASE-31 (DEFERRED, disclosed, not fixed this mission): pins the CURRENT
// fail-safe behavior for two known, real gaps found by the same
// adversarial review -- self-correction/quoted-reversal negation scoring,
// and common hedge idioms false-positiving to NOT_ADOPTION. Both under-
// act (never wrongly execute); this test exists so the corpus's own
// regressionTestFile reference for CASE-31 has real, matching coverage,
// not just an unrelated passing test in the same file.
for (const message of [
  'The plan said "do not adopt this candidate" but I want you to adopt EasyLifeHQ now.',
  "Actually, don't adopt EasyLifeHQ, adopt EasyLifeHQ -- go ahead.",
  'no rush, adopt it',
  'not gonna lie, adopt it',
  "there's no reason not to adopt it"
]) {
  test(`CASE-31 (deferred, disclosed): pins the current fail-safe (never wrongly EXECUTE_ADOPTION) behavior -- "${message}"`, () => {
    assert.notEqual(classifyAdoptionCommandIntent(message), 'EXECUTE_ADOPTION')
  })
}
