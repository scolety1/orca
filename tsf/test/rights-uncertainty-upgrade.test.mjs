// Regression coverage proving RIGHTS uncertainty cannot be silently
// upgraded. Same scope distinction as temporal-uncertainty-upgrade.test
// .mjs: whether a real source's rights truth is actually clear requires
// real external research (finding a real LICENSE file, reading a real
// ToS page) -- NOT tested here. What IS tested: the engine-level
// PROPAGATION rule -- a rights status must never advance to a stronger
// admission tier without explicit, real evidence. All status labels are
// this evaluation corpus's own real, established vocabulary; no private
// customer content is used.
import assert from 'node:assert/strict'
import test from 'node:test'
import { attemptStatusUpgrade, RIGHTS_CONFIDENCE_LEVELS } from '../domain/evidence-gated-status-upgrade.mjs'

test('NAIVE failure mode reproduced: a naive assignment would silently upgrade BLOCKED_RIGHTS straight to ADMITTED with zero evidence', () => {
  function naiveSetRights(_current, requested) { return requested }
  const naiveResult = naiveSetRights('BLOCKED_RIGHTS', 'ADMITTED')
  assert.equal(naiveResult, 'ADMITTED', 'THE BUG: a naive assignment grants full admission with no rights evidence at all')
})

test('CORRECTED behavior: attemptStatusUpgrade REFUSES BLOCKED_RIGHTS -> ADMITTED with no evidence', () => {
  const result = attemptStatusUpgrade('BLOCKED_RIGHTS', 'ADMITTED', RIGHTS_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, false)
  assert.equal(result.appliedStatus, 'BLOCKED_RIGHTS')
})

test('CORRECTED behavior: the same upgrade succeeds only with real, explicit evidence attached', () => {
  const result = attemptStatusUpgrade('BLOCKED_RIGHTS', 'ADMITTED', RIGHTS_CONFIDENCE_LEVELS, {
    evidenceProvided: true,
    evidenceDescription: 'synthetic stand-in for a real, confirmed permissive LICENSE file'
  })
  assert.equal(result.upgraded, true)
  assert.equal(result.appliedStatus, 'ADMITTED')
})

test('a partial upgrade (CANDIDATE_PENDING_RIGHTS -> ADMITTED_PRIVATE_RESEARCH_ONLY) is gated identically -- no "smaller upgrades are fine" exception', () => {
  const blocked = attemptStatusUpgrade('CANDIDATE_PENDING_RIGHTS', 'ADMITTED_PRIVATE_RESEARCH_ONLY', RIGHTS_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(blocked.upgraded, false)
  const allowed = attemptStatusUpgrade('CANDIDATE_PENDING_RIGHTS', 'ADMITTED_PRIVATE_RESEARCH_ONLY', RIGHTS_CONFIDENCE_LEVELS, { evidenceProvided: true, evidenceDescription: 'synthetic owner-authorization evidence' })
  assert.equal(allowed.upgraded, true)
})

test('a rights DOWNGRADE (real evidence later found to be unfavorable, e.g. a real ToS ownership clause) is always allowed regardless of evidence flag', () => {
  const result = attemptStatusUpgrade('ADMITTED_PRIVATE_RESEARCH_ONLY', 'BLOCKED_RIGHTS', RIGHTS_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, true, 'discovering a source is LESS rights-clear than assumed must never be blocked by the evidence gate')
})

test('REGRESSION (independent verifier finding): an unrecognized requested status is refused, not silently treated as a no-op upgrade', () => {
  const result = attemptStatusUpgrade('BLOCKED_RIGHTS', 'TOTALLY_MADE_UP_STATUS', RIGHTS_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, false)
  assert.equal(result.appliedStatus, 'BLOCKED_RIGHTS')
})

test('requesting the SAME status as current is a no-op, not treated as an upgrade attempt requiring evidence', () => {
  const result = attemptStatusUpgrade('CANDIDATE_PENDING_RIGHTS', 'CANDIDATE_PENDING_RIGHTS', RIGHTS_CONFIDENCE_LEVELS, { evidenceProvided: false })
  assert.equal(result.upgraded, true)
  assert.equal(result.appliedStatus, 'CANDIDATE_PENDING_RIGHTS')
})
