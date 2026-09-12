import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDetection,
  createFinding,
  FINDING_STATUSES,
  findingIdFor,
  recordFindingRecurrence,
  transitionFinding
} from '../domain/self-improvement-finding.mjs'

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const later = () => new Date('2026-09-07T13:00:00.000Z')

function baseRaw(overrides = {}) {
  return {
    sourceDetector: 'UI_DOGFOOD',
    severity: 'P1',
    evidence: { screenshot: 'ref:1' },
    reproduction: { steps: ['open settings', 'resize to mobile'] },
    affectedSurface: 'settings-page',
    confidence: 0.9,
    verificationMethod: 'DOGFOOD_RESCAN',
    ...overrides
  }
}

test('createFinding builds a DETECTED record with honest defaults', () => {
  const finding = createFinding(baseRaw(), clock)
  assert.equal(finding.schemaVersion, 'TSF_SELF_IMPROVEMENT_FINDING_V1')
  assert.equal(finding.status, 'DETECTED')
  assert.equal(finding.projectId, null, 'no projectId supplied -- must stay honestly null, never fabricated')
  assert.equal(finding.revision, 0)
  assert.equal(finding.occurrences, 1)
  assert.equal(finding.firstSeen, finding.lastSeen)
  assert.equal(finding.authorityRequired, null)
  assert.equal(finding.transitions.length, 1)
  assert.deepEqual(finding.transitions[0], { from: null, to: 'DETECTED', reason: 'FINDING_DETECTED', at: finding.createdAt })
})

test('createFinding fails closed on every required-field gap', () => {
  assert.throws(() => createFinding(baseRaw({ sourceDetector: 'NOT_REAL' }), clock), /unknown sourceDetector/)
  assert.throws(() => createFinding(baseRaw({ severity: 'P9' }), clock), /unknown severity/)
  assert.throws(() => createFinding(baseRaw({ affectedSurface: '' }), clock), /affectedSurface is required/)
  assert.throws(() => createFinding(baseRaw({ evidence: null }), clock), /evidence is required/)
  assert.throws(() => createFinding(baseRaw({ reproduction: undefined }), clock), /reproduction is required/)
  assert.throws(() => createFinding(baseRaw({ confidence: 1.5 }), clock), /confidence must be a number/)
  assert.throws(() => createFinding(baseRaw({ confidence: 'high' }), clock), /confidence must be a number/)
  assert.throws(() => createFinding(baseRaw({ verificationMethod: '' }), clock), /verificationMethod is required/)
  assert.throws(() => createFinding(baseRaw({ projectId: 42 }), clock), /projectId must be a string or null/)
  assert.throws(
    () => createFinding(baseRaw({ candidateFixScope: {} }), clock),
    /candidateFixScope, when present, requires a string kind/
  )
})

test('projectId, when supplied, is preserved verbatim', () => {
  const finding = createFinding(baseRaw({ projectId: 'proj:alpha' }), clock)
  assert.equal(finding.projectId, 'proj:alpha')
})

test('findingIdFor is deterministic and distinguishes distinct symptoms', () => {
  const a = findingIdFor(baseRaw())
  const b = findingIdFor(baseRaw())
  const c = findingIdFor(baseRaw({ reproduction: { steps: ['a different repro'] } }))
  assert.equal(a, b, 'same detector+surface+reproduction must fingerprint identically')
  assert.notEqual(a, c, 'a genuinely different reproduction must not collide')
  assert.equal(createFinding(baseRaw(), clock).findingId, a)
})

// --- Full transition matrix: every legal edge must succeed, every illegal
// edge (including same-state and terminal-state) must throw
// TSF_INVALID_FINDING_TRANSITION. This table is written independently of
// the module's own STATUS_ALLOWED (not imported) so the test is a real
// check against the mission's own status enum, not a tautology.
const EXPECTED_ALLOWED = {
  DETECTED: ['VERIFIED', 'REJECTED_FALSE_POSITIVE', 'ALREADY_SOLVED'],
  VERIFIED: ['ELIGIBLE_FOR_AUTOFIX', 'NEEDS_OWNER', 'REJECTED_FALSE_POSITIVE', 'ALREADY_SOLVED'],
  ELIGIBLE_FOR_AUTOFIX: ['FIX_MISSION_CREATED', 'NEEDS_OWNER', 'REJECTED_FALSE_POSITIVE', 'ALREADY_SOLVED'],
  // Manual Self-Improvement Finding Disposition V1: DISMISSED_BY_OWNER
  // added as a real, legal edge from the same two states the owner's own
  // "Dismiss" action is ever offered from. TSF Reconcile & Upgrade
  // Protocol V1: ALREADY_SOLVED added everywhere REJECTED_FALSE_POSITIVE
  // is legal (DETECTED/VERIFIED/ELIGIBLE_FOR_AUTOFIX/NEEDS_OWNER/REOPENED)
  // -- a sibling "no fix mission needed" terminal outcome -- but never
  // once a real fix mission is already underway (FIX_MISSION_CREATED
  // onward), where RESOLVED/DISMISSED_BY_OWNER are the honest options.
  NEEDS_OWNER: ['FIX_MISSION_CREATED', 'RESOLVED', 'REJECTED_FALSE_POSITIVE', 'DISMISSED_BY_OWNER', 'ALREADY_SOLVED'],
  FIX_MISSION_CREATED: ['FIX_IN_PROGRESS', 'NEEDS_OWNER'],
  FIX_IN_PROGRESS: ['READY_FOR_ADOPTION', 'NEEDS_OWNER'],
  READY_FOR_ADOPTION: ['RESOLVED', 'NEEDS_OWNER', 'DISMISSED_BY_OWNER'],
  RESOLVED: ['REOPENED'],
  REOPENED: ['VERIFIED', 'NEEDS_OWNER', 'REJECTED_FALSE_POSITIVE', 'ALREADY_SOLVED'],
  REJECTED_FALSE_POSITIVE: [],
  DISMISSED_BY_OWNER: [],
  ALREADY_SOLVED: []
}

test('transitionFinding: every legal transition in the full status matrix succeeds', async (t) => {
  for (const from of FINDING_STATUSES) {
    for (const to of EXPECTED_ALLOWED[from]) {
      await t.test(`${from} -> ${to}`, () => {
        const finding = { ...createFinding(baseRaw(), clock), status: from, revision: 3 }
        const next = transitionFinding(finding, to, { reason: 'TEST' }, later)
        assert.equal(next.status, to)
        assert.equal(next.revision, 4)
        assert.equal(next.updatedAt, later().toISOString())
        assert.deepEqual(next.transitions.at(-1), {
          from,
          to,
          reason: 'TEST',
          evidence: [],
          at: later().toISOString()
        })
      })
    }
  }
})

test('transitionFinding: every illegal transition in the full status matrix throws TSF_INVALID_FINDING_TRANSITION', async (t) => {
  for (const from of FINDING_STATUSES) {
    for (const to of FINDING_STATUSES) {
      if (EXPECTED_ALLOWED[from].includes(to)) { continue }
      await t.test(`${from} -> ${to} is illegal`, () => {
        const finding = { ...createFinding(baseRaw(), clock), status: from }
        assert.throws(
          () => transitionFinding(finding, to, {}, later),
          (error) => error.code === 'TSF_INVALID_FINDING_TRANSITION'
        )
      })
    }
  }
})

test('transitionFinding rejects an unknown status string outright', () => {
  const finding = createFinding(baseRaw(), clock)
  assert.throws(() => transitionFinding(finding, 'NOT_A_STATUS', {}, clock), /unknown status/)
})

test('recordFindingRecurrence bumps lastSeen/occurrences without a status change on an open finding', () => {
  const finding = createFinding(baseRaw(), clock)
  const recurred = recordFindingRecurrence(finding, later)
  assert.equal(recurred.status, 'DETECTED')
  assert.equal(recurred.occurrences, 2)
  assert.equal(recurred.lastSeen, later().toISOString())
  assert.equal(recurred.firstSeen, finding.firstSeen, 'firstSeen must never move')
})

test('recordFindingRecurrence reopens a RESOLVED finding as a real regression', () => {
  let finding = createFinding(baseRaw(), clock)
  finding = transitionFinding(finding, 'VERIFIED', {}, clock)
  finding = transitionFinding(finding, 'NEEDS_OWNER', {}, clock)
  finding = transitionFinding(finding, 'RESOLVED', {}, clock)
  const recurred = recordFindingRecurrence(finding, later)
  assert.equal(recurred.status, 'REOPENED')
  assert.equal(recurred.occurrences, 2)
  assert.equal(recurred.transitions.at(-1).reason, 'RECURRED_AFTER_RESOLUTION')
})

test('applyDetection creates on first sighting and recurs thereafter', () => {
  const raw = baseRaw()
  const first = applyDetection(null, raw, clock)
  assert.equal(first.status, 'DETECTED')
  assert.equal(first.occurrences, 1)
  const second = applyDetection(first, raw, later)
  assert.equal(second.occurrences, 2)
  assert.equal(second.findingId, first.findingId)
})

test('applyDetection never auto-reopens a human-rejected false positive', () => {
  let finding = createFinding(baseRaw(), clock)
  finding = transitionFinding(finding, 'REJECTED_FALSE_POSITIVE', { reason: 'OWNER_CALL' }, clock)
  const recurred = applyDetection(finding, baseRaw(), later)
  assert.equal(recurred.status, 'REJECTED_FALSE_POSITIVE', 'a rejected false positive must stay rejected')
  assert.equal(recurred.occurrences, 2, 'the recurrence must still be visible via occurrences')
})

// Manual Self-Improvement Finding Disposition V1, test #10 (owner's own
// list): unchanged evidence must never immediately recreate/resurrect a
// dismissed finding -- the SAME real mechanism that already protects
// REJECTED_FALSE_POSITIVE (recordFindingRecurrence only special-cases
// RESOLVED) covers this for free, verified explicitly here rather than
// just assumed.
test('applyDetection never auto-resurrects an owner-dismissed finding on unchanged evidence', () => {
  let finding = createFinding(baseRaw(), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'MECHANICAL_REPRODUCTION_CONFIRMED_FAILING' }, clock)
  finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  finding = transitionFinding(finding, 'DISMISSED_BY_OWNER', { reason: 'OWNER_DISMISSED' }, clock)
  const recurred = applyDetection(finding, baseRaw(), later)
  assert.equal(recurred.status, 'DISMISSED_BY_OWNER', 'a dismissed finding must stay dismissed on unchanged evidence')
  assert.equal(recurred.occurrences, 2, 'the recurrence must still be visible via occurrences')
  // Genuinely different evidence (a different reproduction) fingerprints
  // to a DIFFERENT findingId entirely (findingIdFor's own content-
  // addressed identity) -- it can never touch this dismissed record at
  // all, so "materially different evidence creates a new finding" is
  // already the real, existing policy, not something this feature adds.
  const differentFindingId = findingIdFor(baseRaw({ reproduction: { steps: ['a genuinely different repro'] } }))
  assert.notEqual(differentFindingId, finding.findingId)
})

// TSF Reconcile & Upgrade Protocol V1: ALREADY_SOLVED is a real, honest,
// distinct terminal outcome -- "the claim was real, but something else
// already fixed it" -- never conflated with REJECTED_FALSE_POSITIVE
// ("never a real defect") or RESOLVED ("we fixed it ourselves").
test('transitionFinding: ALREADY_SOLVED is reachable from DETECTED/VERIFIED/ELIGIBLE_FOR_AUTOFIX/NEEDS_OWNER/REOPENED, terminal, and distinct from REJECTED_FALSE_POSITIVE', () => {
  let finding = createFinding(baseRaw(), clock)
  finding = transitionFinding(finding, 'ALREADY_SOLVED', { reason: 'RECONCILIATION_FOUND_EXISTING_FIX' }, clock)
  assert.equal(finding.status, 'ALREADY_SOLVED')
  assert.notEqual(finding.status, 'REJECTED_FALSE_POSITIVE')
  assert.throws(
    () => transitionFinding(finding, 'RESOLVED', {}, clock),
    (error) => error.code === 'TSF_INVALID_FINDING_TRANSITION'
  )
})

// A real, verified fix mission already underway must never be honestly
// describable as "already solved" -- that would let a real, in-progress
// mission silently vanish from the fleet's own accounting.
test('transitionFinding: ALREADY_SOLVED is illegal once a real fix mission is underway (FIX_MISSION_CREATED/FIX_IN_PROGRESS/READY_FOR_ADOPTION)', () => {
  for (const inFlightStatus of ['FIX_MISSION_CREATED', 'FIX_IN_PROGRESS', 'READY_FOR_ADOPTION']) {
    const finding = { ...createFinding(baseRaw(), clock), status: inFlightStatus }
    assert.throws(
      () => transitionFinding(finding, 'ALREADY_SOLVED', {}, clock),
      (error) => error.code === 'TSF_INVALID_FINDING_TRANSITION'
    )
  }
})

// NOT_A_BUG (the protocol's own vocabulary) deliberately reuses
// REJECTED_FALSE_POSITIVE rather than a fourth status -- both mean "this
// finding's claim doesn't represent a real defect," just discovered by
// design-intent review instead of a detector being wrong from the start.
// This test documents/proves that mapping stays real and callable, not
// just asserted in a comment.
test('transitionFinding: "not a bug / working as designed" maps onto the real, existing REJECTED_FALSE_POSITIVE status with an honest reason code', () => {
  let finding = createFinding(baseRaw(), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  finding = transitionFinding(finding, 'REJECTED_FALSE_POSITIVE', { reason: 'WORKING_AS_DESIGNED' }, clock)
  assert.equal(finding.status, 'REJECTED_FALSE_POSITIVE')
  assert.equal(finding.transitions.at(-1).reason, 'WORKING_AS_DESIGNED')
})

// Mirrors the DISMISSED_BY_OWNER precedent exactly: unchanged evidence
// must never auto-resurrect an ALREADY_SOLVED finding.
test('applyDetection never auto-resurrects an ALREADY_SOLVED finding on unchanged evidence', () => {
  let finding = createFinding(baseRaw(), clock)
  finding = transitionFinding(finding, 'ALREADY_SOLVED', { reason: 'RECONCILIATION_FOUND_EXISTING_FIX' }, clock)
  const recurred = applyDetection(finding, baseRaw(), later)
  assert.equal(recurred.status, 'ALREADY_SOLVED', 'must stay ALREADY_SOLVED on unchanged evidence')
  assert.equal(recurred.occurrences, 2, 'the recurrence must still be visible via occurrences')
})
