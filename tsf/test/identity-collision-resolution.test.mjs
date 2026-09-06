// Regression coverage for the real same-name/same-key identity-collision
// pattern found repeatedly in prior research missions (adapted from
// dataset-research-engine-v0's fixtures/identity-collision-resolver.mjs).
// Uses entirely fictional entities and a fictional disambiguatingFields
// vocabulary, structurally identical to the real collisions originally
// found -- no real person's name is used, and no field vocabulary is
// hardcoded into the module itself (this suite's own `['position',
// 'team', 'providerId']` list is just what THIS suite happens to pass in).
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveIdentityCollision } from '../domain/identity-collision-resolution.mjs'

const FIELDS = ['position', 'team', 'providerId']

// Fictional collision: two distinct fictional entities share a name and
// position-category boundary, disambiguated by position/team/provider-ID.
const FICTIONAL_COLLISION = [
  { entityId: 'fict-001', position: 'QB', team: 'FICTIONAL_HAWKS', providerId: 'PID-9001' },
  { entityId: 'fict-002', position: 'TE', team: 'FICTIONAL_WOLVES', providerId: 'PID-9002' }
]
// A three-way fictional collision where position ALONE does not fully
// disambiguate (two candidates share both name and position, differing
// only by team/provider-ID) -- a harder, more adversarial case.
const THREE_WAY_FICTIONAL_COLLISION = [
  { entityId: 'fict-101', position: 'RB', team: 'FICTIONAL_HAWKS', providerId: 'PID-5001' },
  { entityId: 'fict-102', position: 'RB', team: 'FICTIONAL_WOLVES', providerId: 'PID-5002' },
  { entityId: 'fict-103', position: 'WR', team: 'FICTIONAL_HAWKS', providerId: 'PID-5003' }
]

test('NAIVE failure mode reproduced: name-only matching silently returns the FIRST candidate on a real collision', () => {
  function naiveResolveByNameOnly(candidates) { return candidates[0] } // THE BUG: no disambiguation at all
  const naiveResult = naiveResolveByNameOnly(FICTIONAL_COLLISION)
  assert.equal(naiveResult.entityId, 'fict-001', 'THE BUG: silently picks the first of two real, distinct entities sharing a name -- could easily be the wrong one')
})

test('CORRECTED behavior: position evidence disambiguates the two-way fictional collision correctly', () => {
  const result = resolveIdentityCollision(FICTIONAL_COLLISION, { position: 'TE' }, FIELDS)
  assert.equal(result.status, 'RESOLVED')
  assert.equal(result.resolvedEntityId, 'fict-002')
})

test('CORRECTED behavior: the same collision resolves to the OTHER candidate when position evidence points the other way', () => {
  const result = resolveIdentityCollision(FICTIONAL_COLLISION, { position: 'QB' }, FIELDS)
  assert.equal(result.resolvedEntityId, 'fict-001')
})

test('ADVERSARIAL three-way collision: position alone leaves 2 real candidates -- must be AMBIGUOUS, never a silent guess', () => {
  const result = resolveIdentityCollision(THREE_WAY_FICTIONAL_COLLISION, { position: 'RB' }, FIELDS)
  assert.equal(result.status, 'AMBIGUOUS')
  assert.equal(result.matchingCandidateCount, 2, 'two real candidates still match on position alone')
  assert.equal(result.resolvedEntityId, null, 'must never silently pick one of the two remaining candidates')
})

test('ADVERSARIAL three-way collision: adding provider-ID evidence on top of position fully resolves it', () => {
  const result = resolveIdentityCollision(THREE_WAY_FICTIONAL_COLLISION, { position: 'RB', providerId: 'PID-5002' }, FIELDS)
  assert.equal(result.status, 'RESOLVED')
  assert.equal(result.resolvedEntityId, 'fict-102')
})

test('evidence that matches NONE of the real candidates is UNRESOLVED, never force-matched to the "closest" one', () => {
  const result = resolveIdentityCollision(FICTIONAL_COLLISION, { position: 'RB' }, FIELDS) // neither fictional candidate is an RB
  assert.equal(result.status, 'UNRESOLVED')
  assert.equal(result.matchingCandidateCount, 0)
  assert.equal(result.resolvedEntityId, null)
})

test('no collision at all (a single real candidate) resolves immediately, evidence not even required', () => {
  const soleCandidate = [{ entityId: 'fict-201', position: 'WR', team: 'FICTIONAL_HAWKS', providerId: 'PID-1' }]
  const result = resolveIdentityCollision(soleCandidate, {}, FIELDS)
  assert.equal(result.status, 'RESOLVED')
  assert.equal(result.resolvedEntityId, 'fict-201')
})

test('REGRESSION (independent verifier finding): a SOLE candidate (no real collision) is still checked against contradicting evidence, not blindly resolved', () => {
  const soleCandidate = [{ entityId: 'fict-301', position: 'TE', team: 'FICTIONAL_HAWKS', providerId: 'PID-2' }]
  const result = resolveIdentityCollision(soleCandidate, { position: 'RB' }, FIELDS) // evidence contradicts the one real candidate on file
  assert.equal(result.status, 'UNRESOLVED', 'contradicting evidence on the sole candidate must not be silently ignored')
  assert.equal(result.resolvedEntityId, null)
})

test('a sole candidate with AGREEING evidence still resolves immediately (the fix only blocks contradictions, not confirmations)', () => {
  const soleCandidate = [{ entityId: 'fict-302', position: 'TE', team: 'FICTIONAL_HAWKS', providerId: 'PID-3' }]
  const result = resolveIdentityCollision(soleCandidate, { position: 'TE' }, FIELDS)
  assert.equal(result.status, 'RESOLVED')
  assert.equal(result.resolvedEntityId, 'fict-302')
})

test('an empty candidate list is UNRESOLVED, distinct from a real, ambiguous collision', () => {
  const result = resolveIdentityCollision([], { position: 'QB' }, FIELDS)
  assert.equal(result.status, 'UNRESOLVED')
})

test('REGRESSION (independent verification): a genuine multi-candidate collision with NO evidence at all (undefined, not {}) is AMBIGUOUS, never a crash', () => {
  const result = resolveIdentityCollision(FICTIONAL_COLLISION, undefined, FIELDS)
  assert.equal(result.status, 'AMBIGUOUS', 'zero disambiguating evidence must degrade to AMBIGUOUS (both candidates still match) -- never throw')
  assert.equal(result.resolvedEntityId, null)
})

test('REGRESSION (independent verification): an unrelated evidence key outside disambiguatingFields never blocks an otherwise-uncontested sole candidate', () => {
  const soleCandidate = [{ entityId: 'fict-401', position: 'TE', team: 'FICTIONAL_HAWKS', providerId: 'PID-4' }]
  const result = resolveIdentityCollision(soleCandidate, { jerseyNumber: 99 }, FIELDS) // jerseyNumber is not in FIELDS
  assert.equal(result.status, 'RESOLVED', 'an evidence key outside the caller-declared disambiguatingFields must be ignored, not treated as a contradiction')
  assert.equal(result.resolvedEntityId, 'fict-401')
})

test('disambiguatingFields must be explicitly supplied and non-empty -- never silently hardcoded to one domain', () => {
  assert.throws(() => resolveIdentityCollision(FICTIONAL_COLLISION, { position: 'QB' }, []), /disambiguatingFields/)
  assert.throws(() => resolveIdentityCollision(FICTIONAL_COLLISION, { position: 'QB' }, undefined), /disambiguatingFields/)
})
