// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part A3.
import assert from 'node:assert/strict'
import test from 'node:test'
import { decomposeMultiAction, MULTI_ACTION_INTENTS } from '../domain/command-multi-action-decomposition.mjs'
import { loadProjectAliases } from '../domain/project-aliases.mjs'

const PROJECTS = [
  { id: 'niners-war-room', displayName: 'Niners War Room' },
  { id: 'worldforge-sablewake-live-runtime-repair-v3', displayName: 'Worldforge-Sablewake-Live-Runtime-Repair-V3' },
  { id: 'easylifehq-github-io', displayName: 'EasyLifeHQ' }
]
const aliases = loadProjectAliases()

function entriesFor(target, entries) {
  return entries.filter((e) => e.target === target)
}

// The mission's own literal example, verbatim.
const MESSAGE =
  "NWR is being handled by another AI, leave it alone. Nytheria looks good, adopt that run and keep going overnight. EasyLife needs serious work -- get EasyWorkouts up so I can start logging workouts."

test('the mission\'s own literal multi-project message decomposes into real, correctly-targeted, correctly-intended actions', () => {
  const entries = decomposeMultiAction(MESSAGE, PROJECTS, aliases)

  const nwr = entriesFor('niners-war-room', entries)
  assert.equal(nwr.length, 1)
  assert.equal(nwr[0].intent, 'EXTERNAL_WORK_HOLD')

  const worldforge = entriesFor('worldforge-sablewake-live-runtime-repair-v3', entries)
  assert.deepEqual(new Set(worldforge.map((e) => e.intent)), new Set(['ADOPT_CANDIDATE_REPORT', 'START_KEEP_GOING']))

  const easylife = entriesFor('easylifehq-github-io', entries)
  assert.equal(easylife.length, 1)
  assert.equal(easylife[0].intent, 'ASSESS_AND_UPGRADE')

  // Every real target resolved, nothing fabricated, nothing dropped.
  assert.deepEqual(new Set(entries.map((e) => e.target)), new Set([
    'niners-war-room',
    'worldforge-sablewake-live-runtime-repair-v3',
    'easylifehq-github-io'
  ]))
})

test('never produces ADOPT_CANDIDATE_EXECUTE or any execution intent -- adoption is always report-only', () => {
  const entries = decomposeMultiAction(MESSAGE, PROJECTS, aliases)
  assert.ok(entries.every((e) => MULTI_ACTION_INTENTS.includes(e.intent)))
  assert.ok(!entries.some((e) => /EXECUTE/i.test(e.intent)))
})

test('a single clause naming two projects attributes an entry to each, never drops one', () => {
  const entries = decomposeMultiAction('get niners-war-room and worldforge-sablewake-live-runtime-repair-v3 ready', PROJECTS, aliases)
  assert.deepEqual(new Set(entries.map((e) => e.target)), new Set([
    'niners-war-room',
    'worldforge-sablewake-live-runtime-repair-v3'
  ]))
})

test('a clause naming no project at all is honestly dropped -- never a fabricated null-target action', () => {
  const entries = decomposeMultiAction('sounds good, thanks', PROJECTS, aliases)
  assert.deepEqual(entries, [])
})

test('a single-project message decomposes to entries for exactly one target', () => {
  const entries = decomposeMultiAction('worldforge needs serious work', PROJECTS, aliases)
  assert.deepEqual(new Set(entries.map((e) => e.target)), new Set(['worldforge-sablewake-live-runtime-repair-v3']))
  assert.ok(entries.some((e) => e.intent === 'ASSESS_AND_UPGRADE'))
})

test('no separate chat threads required -- one decomposeMultiAction call covers the whole multi-project message', () => {
  const entries = decomposeMultiAction(MESSAGE, PROJECTS, aliases)
  assert.ok(entries.length >= 4)
})

// FIXED (real, live-confirmed P0 -- Full Conversational Control Plane
// Exhaustive Gauntlet V1, Batch 2): a negated adoption clause and a
// genuine adoption clause for a DIFFERENT project used to decompose into
// the SAME intent (ADOPT_CANDIDATE_REPORT, negation-blind), so the outer
// gate (classifyMultiActionEntries) never saw 2 distinguishing intents and
// the whole message fell through to a single-message-level classifier
// that wrongly refused BOTH projects. ADOPT_CANDIDATE_DECLINED is real,
// distinct decomposition output that fixes this at its root.
test('a negated adoption clause decomposes to ADOPT_CANDIDATE_DECLINED, distinct from an affirmed adoption clause for a different project', () => {
  const entries = decomposeMultiAction("Don't adopt niners-war-room; adopt EasyLifeHQ.", PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
  assert.equal(nwr.intent, 'ADOPT_CANDIDATE_DECLINED')
  assert.equal(easyLife.intent, 'ADOPT_CANDIDATE_REPORT')
})

for (const message of ["Do not adopt niners-war-room.", "Don't adopt niners-war-room.", "Never adopt niners-war-room."]) {
  test(`ADOPT_CANDIDATE_DECLINED, not ADOPT_CANDIDATE_REPORT, for a genuinely negated single-clause adoption request -- "${message}"`, () => {
    const entries = decomposeMultiAction(message, PROJECTS, aliases)
    const forNwr = entries.filter((e) => e.target === 'niners-war-room')
    assert.ok(forNwr.length > 0, 'must still resolve the target')
    assert.ok(forNwr.every((e) => e.intent !== 'ADOPT_CANDIDATE_REPORT'), 'must never carry the unnegated report intent')
    assert.ok(forNwr.some((e) => e.intent === 'ADOPT_CANDIDATE_DECLINED'))
  })
}

// "Hold off on adopting X" genuinely matches BOTH EXTERNAL_WORK_HOLD's own
// "hold off" pattern and the negated-adoption pattern -- a real, correct
// double-match (this phrasing IS both a hold request and an adoption
// decline), not a bug. Checked separately so it's not conflated with the
// simpler single-intent cases above.
test('"hold off on adopting X" carries BOTH EXTERNAL_WORK_HOLD and ADOPT_CANDIDATE_DECLINED, never the unnegated ADOPT_CANDIDATE_REPORT', () => {
  const entries = decomposeMultiAction('Hold off on adopting niners-war-room.', PROJECTS, aliases)
  const forNwr = entries.filter((e) => e.target === 'niners-war-room')
  const intents = new Set(forNwr.map((e) => e.intent))
  assert.ok(intents.has('ADOPT_CANDIDATE_DECLINED'))
  assert.ok(!intents.has('ADOPT_CANDIDATE_REPORT'))
})

// Adversarial-review findings (Batch 2, 2nd pass) -- the first fix only
// handled the semicolon/period-separated phrasing; these two realistic
// alternate phrasings reproduced the identical bug (a negation on one
// project wrongly suppressing a different project's own, separate,
// legitimate adoption request).
test('adversarial-review fix: "and"-joined negated/affirmed adoption for DIFFERENT targets is correctly split, not shared', () => {
  const entries = decomposeMultiAction("Don't adopt niners-war-room and adopt EasyLifeHQ.", PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
  assert.equal(nwr.intent, 'ADOPT_CANDIDATE_DECLINED')
  assert.equal(easyLife.intent, 'ADOPT_CANDIDATE_REPORT')
})

test('adversarial-review fix: comma-fragmented negation ("Do not, under any circumstances, adopt X") is not lost by clause-splitting', () => {
  const entries = decomposeMultiAction('Do not, under any circumstances, adopt niners-war-room, but please adopt EasyLifeHQ.', PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
  assert.equal(nwr.intent, 'ADOPT_CANDIDATE_DECLINED')
  assert.equal(easyLife.intent, 'ADOPT_CANDIDATE_REPORT')
})

// Regression guard: a genuinely SHARED/compound instruction across
// multiple targets (one verb, a shared object list) must not be split
// apart and must keep the SAME intent for every named target -- the "and"
// split is verb-lookahead-gated specifically so this never breaks.
test('a genuine shared adoption request across two projects ("adopt A and B") is NOT split -- both keep the same real intent', () => {
  const entries = decomposeMultiAction('adopt niners-war-room and worldforge-sablewake-live-runtime-repair-v3', PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const worldforge = entries.find((e) => e.target === 'worldforge-sablewake-live-runtime-repair-v3')
  assert.equal(nwr.intent, 'ADOPT_CANDIDATE_REPORT')
  assert.equal(worldforge.intent, 'ADOPT_CANDIDATE_REPORT')
})

// FIXED (real, BLOCKING, live-confirmed via real end-to-end dispatch --
// Full Conversational Control Plane Exhaustive Gauntlet V1, Batch 3
// adversarial review): unlike ADOPT_CANDIDATE_REPORT/DECLINED,
// START_KEEP_GOING/ASSESS_AND_UPGRADE had ZERO negation awareness --
// "Don't keep going on niners-war-room" classified as a real, positive
// START_KEEP_GOING action, which server/command-multi-action-bridge.mjs
// routes straight to a REAL Keep Going dispatch. MULTI_ACTION_DECLINED is
// the fix.
test('a negated "keep going" clause decomposes to MULTI_ACTION_DECLINED, never the real-dispatching START_KEEP_GOING', () => {
  const entries = decomposeMultiAction("Don't keep going on niners-war-room.", PROJECTS, aliases)
  const forNwr = entries.filter((e) => e.target === 'niners-war-room')
  assert.ok(forNwr.some((e) => e.intent === 'MULTI_ACTION_DECLINED'))
  assert.ok(forNwr.every((e) => e.intent !== 'START_KEEP_GOING'))
})

test('a negated "assess/upgrade" clause decomposes to MULTI_ACTION_DECLINED, never the real-dispatching ASSESS_AND_UPGRADE', () => {
  const entries = decomposeMultiAction("Don't assess niners-war-room.", PROJECTS, aliases)
  const forNwr = entries.filter((e) => e.target === 'niners-war-room')
  assert.ok(forNwr.some((e) => e.intent === 'MULTI_ACTION_DECLINED'))
  assert.ok(forNwr.every((e) => e.intent !== 'ASSESS_AND_UPGRADE'))
})

test('a negated keep-going clause for one target never suppresses a genuine keep-going/assess request for a different target', () => {
  const entries = decomposeMultiAction("Don't keep going on niners-war-room; EasyLifeHQ needs serious work.", PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
  assert.equal(nwr.intent, 'MULTI_ACTION_DECLINED')
  assert.equal(easyLife.intent, 'ASSESS_AND_UPGRADE')
})

// Adversarial-review findings (Batch 3, 2nd pass): the "please" filler
// tolerance in the "and"-split lookahead missed a comma directly after
// "please" and a second filler word.
test('adversarial-review fix: "and please, adopt X" (comma after please) still splits correctly', () => {
  const entries = decomposeMultiAction("Don't adopt niners-war-room and please, adopt EasyLifeHQ.", PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
  assert.equal(nwr.intent, 'ADOPT_CANDIDATE_DECLINED')
  assert.equal(easyLife.intent, 'ADOPT_CANDIDATE_REPORT')
})

test('adversarial-review fix: "and please just adopt X" (two filler words) still splits correctly', () => {
  const entries = decomposeMultiAction('Don\'t adopt niners-war-room and please just adopt EasyLifeHQ.', PROJECTS, aliases)
  const nwr = entries.find((e) => e.target === 'niners-war-room')
  const easyLife = entries.find((e) => e.target === 'easylifehq-github-io')
  assert.equal(nwr.intent, 'ADOPT_CANDIDATE_DECLINED')
  assert.equal(easyLife.intent, 'ADOPT_CANDIDATE_REPORT')
})

// FIXED (real, SHOULD-FIX, found by the program's final broad red-team
// review pass): EXTERNAL_WORK_HOLD was the one remaining action-creating
// intent in this file with no negation awareness -- "Don't leave X alone,
// keep working on it", "Don't hold off on X", and "X is NOT being handled
// by another AI" all wrongly classified as a positive EXTERNAL_WORK_HOLD,
// which server/command-multi-action-bridge.mjs's applyExternalWorkHold
// routes to a REAL, durable createProjectExecutionHold write for the
// exact opposite of what the owner said.
for (const message of [
  "Don't leave niners-war-room alone, keep working on it directly.",
  "Don't hold off on niners-war-room.",
  'niners-war-room is NOT being handled by another AI -- keep working on it directly.'
]) {
  test(`a negated hold-request classifies MULTI_ACTION_DECLINED, never the real-hold-creating EXTERNAL_WORK_HOLD -- "${message}"`, () => {
    const entries = decomposeMultiAction(message, PROJECTS, aliases)
    const forNwr = entries.filter((e) => e.target === 'niners-war-room')
    assert.ok(forNwr.some((e) => e.intent === 'MULTI_ACTION_DECLINED'))
    assert.ok(forNwr.every((e) => e.intent !== 'EXTERNAL_WORK_HOLD'))
  })
}

// Positive controls -- the negation fix must not regress the real,
// affirmative hold-request phrasings (this is the mission's own literal
// example vocabulary).
for (const message of [
  'niners-war-room is being handled by another AI, leave it alone.',
  'hold off on niners-war-room.',
  'leave niners-war-room alone.'
]) {
  test(`a genuine hold request still correctly fires EXTERNAL_WORK_HOLD -- "${message}"`, () => {
    const entries = decomposeMultiAction(message, PROJECTS, aliases)
    const forNwr = entries.filter((e) => e.target === 'niners-war-room')
    assert.ok(forNwr.some((e) => e.intent === 'EXTERNAL_WORK_HOLD'))
  })
}
