// Regression coverage proving TEMPORAL uncertainty cannot be silently
// upgraded. Scope, deliberately: whether a real source's temporal truth
// is actually strong requires real external research (this is NOT what
// is tested here). What IS tested: the engine-level PROPAGATION rule --
// an uncertain temporal status must never advance to a stronger one
// without explicit, real evidence accompanying the request. All status
// labels below are this evaluation corpus's own real, established
// vocabulary; no private customer content is used.
import assert from 'node:assert/strict'
import test from 'node:test'
import { attemptStatusUpgrade, TEMPORAL_CONFIDENCE_LEVELS } from '../domain/evidence-gated-status-upgrade.mjs'

test('NAIVE failure mode reproduced: an upgrade request with NO evidence would silently succeed under a naive "just set the field" implementation', () => {
  // The naive anti-pattern this module exists to prevent, made concrete:
  // a caller simply assigns the requested (stronger) status with no gate
  // at all.
  function naiveSetStatus(_current, requested) { return requested }
  const naiveResult = naiveSetStatus('TEMPORALLY_UNVERIFIED', 'PROVEN_CONTEMPORANEOUS_PRESEASON')
  assert.equal(naiveResult, 'PROVEN_CONTEMPORANEOUS_PRESEASON', 'THE BUG: a naive assignment upgrades temporal confidence with zero evidence check')
})

test('CORRECTED behavior: attemptStatusUpgrade REFUSES the same upgrade with no evidence -- status stays TEMPORALLY_UNVERIFIED', () => {
  const result = attemptStatusUpgrade('TEMPORALLY_UNVERIFIED', 'PROVEN_CONTEMPORANEOUS_PRESEASON', TEMPORAL_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, false)
  assert.equal(result.appliedStatus, 'TEMPORALLY_UNVERIFIED', 'the status must remain exactly where it was, never silently advanced')
})

test('CORRECTED behavior: the same upgrade SUCCEEDS when real, explicit evidence is provided', () => {
  const result = attemptStatusUpgrade('TEMPORALLY_UNVERIFIED', 'PROVEN_CONTEMPORANEOUS_PRESEASON', TEMPORAL_CONFIDENCE_LEVELS, {
    evidenceProvided: true,
    evidenceDescription: 'synthetic stand-in for a real, independently-dated commit history predating the target season'
  })
  assert.equal(result.upgraded, true)
  assert.equal(result.appliedStatus, 'PROVEN_CONTEMPORANEOUS_PRESEASON')
})

test('a request that omits the evidence object entirely (not just evidenceProvided: false) is also refused -- no silent default-to-permissive path', () => {
  const result = attemptStatusUpgrade('TEMPORALLY_UNVERIFIED', 'BOUNDED_CONTEMPORANEOUS_PRESEASON', TEMPORAL_CONFIDENCE_LEVELS, undefined)
  assert.equal(result.upgraded, false)
})

test('a real DOWNGRADE (e.g. new evidence reveals a source is actually weaker than previously thought) is always allowed, with or without an evidence flag -- the gate only protects upgrades', () => {
  const result = attemptStatusUpgrade('BOUNDED_CONTEMPORANEOUS_PRESEASON', 'TEMPORALLY_UNVERIFIED', TEMPORAL_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, true, 'a downgrade is never blocked -- honesty about weaker-than-thought evidence must never be gated')
})

test('REGRESSION (independent verifier finding): an unrecognized requested status can no longer bypass the evidence gate via an indexOf(-1) loophole', () => {
  const result = attemptStatusUpgrade('TEMPORALLY_UNVERIFIED', 'TOTALLY_MADE_UP_SUPER_STRONG_STATUS', TEMPORAL_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, false, 'an unrecognized status must be refused, never silently treated as a no-op upgrade')
  assert.equal(result.appliedStatus, 'TEMPORALLY_UNVERIFIED')
})

test('REGRESSION (independent verifier finding): a real status from the SIBLING vocabulary (rights, not temporal) is refused, not silently accepted', () => {
  const result = attemptStatusUpgrade('TEMPORALLY_UNVERIFIED', 'ADMITTED', TEMPORAL_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, false, "'ADMITTED' is a real RIGHTS_CONFIDENCE_LEVELS value, not a temporal one -- must not sail through evidence-unchecked")
})

test('a partial, intermediate upgrade (not straight to the strongest level) is gated exactly the same way as a full jump', () => {
  const blocked = attemptStatusUpgrade('TEMPORALLY_UNVERIFIED', 'RETROSPECTIVE_RECONSTRUCTION', TEMPORAL_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(blocked.upgraded, false)
  const allowed = attemptStatusUpgrade('TEMPORALLY_UNVERIFIED', 'RETROSPECTIVE_RECONSTRUCTION', TEMPORAL_CONFIDENCE_LEVELS, { evidenceProvided: true, evidenceDescription: 'synthetic evidence' })
  assert.equal(allowed.upgraded, true)
})
