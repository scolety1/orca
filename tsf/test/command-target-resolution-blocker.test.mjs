// COMMAND TARGET-RESOLUTION BLOCKER (live hands-on finding): "whats the
// current state of nytheria/worldforge" resolved BOTH the intended canonical
// WorldForge project (via the real "nytheria" alias) AND an unrelated real
// project literally named "whats-the-func" -- the operator's own question
// words ("whats", "the") token-overlapped that project's name well enough
// to clear FUZZY_CONFIDENCE_FLOOR (2 of 3 name tokens = 0.667), and nothing
// suppressed that fuzzy noise once a confident alias match already existed.
// Reproduced here against real project id/displayName strings from the
// actual live catalog (project-name-resolver.mjs/command-responder.mjs are
// pure functions over inert data -- this never touches live TSF, NWR,
// WorldForge, or Dataset Research).
//
// Root cause (traced, not assumed) -- see project-name-resolver.mjs:
//   1. Exact/alias recognition on "nytheria/worldforge" did NOT fail --
//      both "nytheria" and "worldforge" matched their shared alias entry
//      correctly (word-boundary regex tolerates the slash).
//   2. The generic tokens "whats"/"the" WERE allowed into fuzzy overlap
//      scoring and DID produce a real, unrelated fuzzy match.
//   3. `matches` returned BOTH the exact/alias match and the fuzzy match
//      together -- only the `ambiguous` flag ever treated exact as
//      authoritative, not what callers (command-responder.mjs's
//      resolvedProjectIds / fleet-status text, and the UI's "Targeting"
//      chip row) actually used.
// The live planner is not involved in this bug at all: this message
// (GENERAL intent, no dispatch, resolves to >1 candidates) is answered
// entirely by command-responder.mjs's deterministic formatFleetStatusText
// path -- server/live-planner.mjs's invokeLivePlanner is never called.
// Architecture note (for the record): when the live planner IS invoked
// elsewhere (a genuinely single-resolved-project, non-status conversational
// message), it receives the raw message text plus that ONE already-resolved
// project's own context capsule (server/live-planner.mjs's
// buildProjectContextCapsule) -- never the raw candidate/alias list itself.
// A wrong resolution therefore has nowhere to be caught downstream; fixing
// it upstream, in the resolver, is the only correct place -- which is what
// this file verifies.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProjectsFromText } from '../server/project-name-resolver.mjs'
import { respondCommand } from '../server/command-responder.mjs'

// The real catalog entries actually involved in the live failure (id/
// displayName strings only -- inert test data, never a real dispatch).
const REAL_PROJECTS = [
  { id: 'whats-the-func', displayName: 'whats-the-func' },
  { id: 'niners-war-room', displayName: 'Niners-War-Room' },
  {
    id: 'worldforge-sablewake-live-runtime-repair-v3',
    displayName: 'Worldforge-Sablewake-Live-Runtime-Repair-V3'
  },
  { id: 'tsf-orca', displayName: 'TSF_ORCA' }
]

function ids(matches) {
  return matches.map((m) => m.project.id)
}

// --- Exact reproduction of the reported live failure -----------------------

test('REPRODUCTION: the exact live failing message resolves to ONLY the canonical WorldForge project -- "whats-the-func" never leaks in', () => {
  const { matches, ambiguous, candidateAlternatives } = resolveProjectsFromText(
    'whats the current state of nytheria/worldforge',
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
  assert.equal(matches[0].matchedOn, 'alias')
  assert.equal(ambiguous, false)
  // The stopword fix alone already eliminates "whats-the-func" as a fuzzy
  // candidate for THIS exact message (its only overlapping tokens, "whats"
  // and "the", are pure scaffolding once stripped) -- so there is nothing
  // left even to suppress. candidateAlternatives' own suppression mechanism
  // is proven separately, on a case engineered to still clear the fuzzy
  // floor on genuine (non-stopword) tokens, below.
  assert.deepEqual(candidateAlternatives, [])
})

test('DIAGNOSTICS/SUPPRESSION: when a genuine (non-stopword) fuzzy candidate WOULD independently clear the floor, an exact match elsewhere in the message still suppresses it from `matches` -- and it stays provable via candidateAlternatives', () => {
  const projects = [
    { id: 'niners-war-room', displayName: 'Niners-War-Room' },
    { id: 'tsf-orca', displayName: 'TSF_ORCA' }
  ]
  const { matches, candidateAlternatives } = resolveProjectsFromText(
    'fix niners-war-room, curious about tsf orca status too',
    projects
  )
  assert.deepEqual(
    ids(matches),
    ['niners-war-room'],
    'the unrelated fuzzy tsf-orca match must not ride along with the exact match'
  )
  assert.ok(
    candidateAlternatives.some((c) => c.projectId === 'tsf-orca' && c.matchedOn === 'fuzzy'),
    'the suppressed fuzzy candidate remains visible in diagnostics, not silently discarded'
  )
})

test('REPRODUCTION at the respondCommand level: the fleet-status text and resolvedProjectIds for the live failing message never mention whats-the-func', async () => {
  const projects = REAL_PROJECTS.map((p) => ({
    ...p,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }))
  const result = await respondCommand({
    message: 'whats the current state of nytheria/worldforge',
    projects,
    opState: { keepGoingRuns: {} },
    clock: () => new Date('2026-09-04T00:00:00.000Z')
  })
  assert.deepEqual(result.resolvedProjectIds, ['worldforge-sablewake-live-runtime-repair-v3'])
  assert.equal(
    result.text.includes('whats-the-func'),
    false,
    'the response text must never report on the unrelated fuzzy-matched project'
  )
})

// --- Required test matrix (from the target-resolution blocker report) ------

const MATRIX = [
  {
    message: 'whats the current state of nytheria/worldforge',
    expect: ['worldforge-sablewake-live-runtime-repair-v3']
  },
  {
    message: "what's going on with Nytheria?",
    expect: ['worldforge-sablewake-live-runtime-repair-v3']
  },
  {
    message: 'what is the state of WorldForge?',
    expect: ['worldforge-sablewake-live-runtime-repair-v3']
  },
  { message: "what's the current state of NWR?", expect: ['niners-war-room'] },
  { message: "what's going on with Niners War Room?", expect: ['niners-war-room'] },
  { message: "what's running right now?", expect: [] },
  {
    message: 'Run Nytheria using TSF/Orca',
    expect: ['worldforge-sablewake-live-runtime-repair-v3']
  },
  {
    message: 'Run WorldForge. Do not touch TSF.',
    expect: ['worldforge-sablewake-live-runtime-repair-v3']
  },
  { message: "what's going on with whats-the-func?", expect: ['whats-the-func'] },
  { message: 'whats the deal with everything today', expect: [] }
]

for (const { message, expect } of MATRIX) {
  test(`MATRIX: ${JSON.stringify(message)} -> ${JSON.stringify(expect)}`, () => {
    const { matches } = resolveProjectsFromText(message, REAL_PROJECTS)
    assert.deepEqual(ids(matches), expect)
  })
}

// --- Adversarial punctuation / casing / slash / comma / conjunction / typo -

test('ADVERSARIAL: uppercase and mixed punctuation around the alias still resolves cleanly, no fuzzy leak', () => {
  const { matches } = resolveProjectsFromText('WHATS THE STATE OF NYTHERIA?!', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
})

test('ADVERSARIAL: comma- and conjunction-joined generic question phrasing does not fuzzy-leak', () => {
  const { matches } = resolveProjectsFromText(
    "what's up, and what is the current running status of worldforge, please?",
    REAL_PROJECTS
  )
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
})

test('ADVERSARIAL: both aliases for the SAME canonical project in one message collapse to a single match, not two', () => {
  const { matches } = resolveProjectsFromText(
    'nytheria and worldforge status please',
    REAL_PROJECTS
  )
  assert.equal(matches.length, 1, 'must collapse to exactly one match, not one per alias')
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
})

test("ADVERSARIAL: a slash-separated pair of DIFFERENT projects' aliases both resolve, collapsed per canonical project", () => {
  const { matches } = resolveProjectsFromText('status on nytheria/nwr', REAL_PROJECTS)
  assert.deepEqual(
    ids(matches).sort(),
    ['niners-war-room', 'worldforge-sablewake-live-runtime-repair-v3'].sort()
  )
  assert.equal(matches.length, 2, 'two distinct canonical projects, not duplicated per alias')
})

test("ADVERSARIAL: a near-miss typo of the project's own real name does not fuzzy-match past the confidence floor", () => {
  // "whats-the-func" typo'd as a single stray unrelated word ("funk") shares
  // no real token with the project's actual name at all once stopwords are
  // stripped -- must not match.
  const { matches } = resolveProjectsFromText('hows the funk project doing', REAL_PROJECTS)
  assert.equal(ids(matches).includes('whats-the-func'), false)
})

test('ADVERSARIAL: an arbitrary message containing the bare stopword "whats" but genuinely about nothing must resolve to nothing, not whats-the-func', () => {
  const { matches } = resolveProjectsFromText(
    'whats up? just checking in, nothing specific',
    REAL_PROJECTS
  )
  assert.deepEqual(matches, [])
})

// --- whats-the-func remains legitimately reachable by its own real name ---

test("whats-the-func is still reachable by its own literal id -- the stopword fix only strips scaffolding tokens from OTHER projects' fuzzy scoring, never a project's own real name match", () => {
  const { matches } = resolveProjectsFromText('any update on whats-the-func today?', REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['whats-the-func'])
  assert.equal(matches[0].matchedOn, 'id')
})

// --- Diagnostics: canonicalTarget / matchedPhrase / matchType / confidence /
// candidateAlternatives, sufficient for dev/test without cluttering the
// operator-facing response (command-responder.mjs's text/resolvedProjectIds
// never surface these fields to the UI). ------------------------------------

test('DIAGNOSTICS: a resolved match carries matchType, confidence, and the literal matchedPhrase', () => {
  const { matches } = resolveProjectsFromText('status on NWR', REAL_PROJECTS)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].matchedOn, 'alias')
  assert.equal(matches[0].confidence, 1)
  assert.equal(matches[0].matchedPhrase, 'nwr')
})

test('DIAGNOSTICS: candidateAlternatives is empty when nothing was suppressed', () => {
  const { candidateAlternatives } = resolveProjectsFromText('status on NWR', REAL_PROJECTS)
  assert.deepEqual(candidateAlternatives, [])
})

// --- Low-confidence resolution never silently chooses an unrelated project;
// a genuinely ambiguous fuzzy-only case still surfaces as ambiguous rather
// than guessing (pre-existing behavior, pinned here as part of this
// blocker's own required contract, not newly introduced). ------------------

test('an ambiguous fuzzy-only case (no exact/alias/displayName signal at all) is still reported as ambiguous, never silently resolved to one guess', () => {
  // Neither project's literal id/displayName appears verbatim in the
  // message (both include "Platform", which the message never says) --
  // both can only be reached via genuine token-overlap fuzzy scoring, which
  // is exactly the "no confident signal at all" case this pins.
  const projects = [
    { id: 'alpha-widgets-platform', displayName: 'Alpha Widgets Platform' },
    { id: 'alpha-gadgets-platform', displayName: 'Alpha Gadgets Platform' }
  ]
  const { matches, ambiguous } = resolveProjectsFromText(
    'please check on the alpha widgets side or the alpha gadgets side, unsure which one',
    projects,
    { aliases: {} }
  )
  assert.equal(ambiguous, true)
  assert.equal(matches.length, 2)
  assert.ok(matches.every((m) => m.matchedOn === 'fuzzy'))
})
