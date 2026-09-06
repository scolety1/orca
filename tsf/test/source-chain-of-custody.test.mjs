// Regression coverage for the real chain-of-custody distinction found in
// this evaluation corpus's 2020-2025 scenario: files that were stable and
// hash-verified across repeated real inventory passes were still
// correctly rated WEAKER chain-of-custody than files that were both
// stable AND organized/logged by the source's own intake process --
// filesystem stability alone must never be reported as strong provenance.
// All hash/label values below are synthetic.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeFilesystemStability,
  computeChainOfCustodyStatus,
  FILESYSTEM_STABILITY,
  PROVENANCE_STRENGTH
} from '../domain/source-chain-of-custody.mjs'

test('computeFilesystemStability: an identical hash across repeated synthetic passes is STABLE', () => {
  const result = computeFilesystemStability(['abc123', 'abc123', 'abc123'])
  assert.equal(result, FILESYSTEM_STABILITY.STABLE)
})

test('REGRESSION (independent verifier finding): a SINGLE hash observation is UNCHECKED, not STABLE -- the doc requires REPEATED checks, one observation is not a repeat', () => {
  const result = computeFilesystemStability(['onlyOneObservation'])
  assert.equal(result, FILESYSTEM_STABILITY.UNCHECKED, 'one observation has never actually been confirmed stable across a repeat -- must not silently count as STABLE')
})

test('REGRESSION follow-through: a single UNCHECKED observation cannot reach GREEN even paired with the strongest provenance', () => {
  const stability = computeFilesystemStability(['onlyOneObservation'])
  const result = computeChainOfCustodyStatus(stability, PROVENANCE_STRENGTH.INDEPENDENTLY_VERIFIED)
  assert.equal(result.overallChainOfCustody, 'RED', 'insufficient real stability evidence must cap the result, exactly like an explicit UNSTABLE reading')
})

test('computeFilesystemStability: a changed hash between passes is UNSTABLE', () => {
  const result = computeFilesystemStability(['abc123', 'abc123', 'def456'])
  assert.equal(result, FILESYSTEM_STABILITY.UNSTABLE)
})

test('NAIVE failure mode (documented, not exported for use): treating filesystem stability alone as chain-of-custody strength', () => {
  // This is the exact real mistake this module exists to prevent, made
  // concrete: a naive check that only looks at stability and reports
  // "provenance: strong" would be wrong for the corpus's real 2020-2025
  // case (stable, but not yet logged by the source's own intake process).
  function naiveChainOfCustody(hashSequence) {
    const stable = computeFilesystemStability(hashSequence) === FILESYSTEM_STABILITY.STABLE
    return stable ? 'STRONG' : 'WEAK' // THE BUG: no provenance input at all
  }
  const naiveResult = naiveChainOfCustody(['h1', 'h1', 'h1'])
  assert.equal(naiveResult, 'STRONG', 'THE BUG: a stability-only check reports STRONG even with zero real provenance evidence')
})

test('CORRECTED behavior: STABLE + ASSERTED_UNLOGGED (the real 2020-2025 case) is RED, not GREEN, despite perfect filesystem stability', () => {
  const stability = computeFilesystemStability(['h1', 'h1', 'h1'])
  const result = computeChainOfCustodyStatus(stability, PROVENANCE_STRENGTH.ASSERTED_UNLOGGED)
  assert.equal(result.filesystemStability, FILESYSTEM_STABILITY.STABLE, 'stability is genuinely strong')
  assert.equal(result.overallChainOfCustody, 'RED', 'but overall chain-of-custody must NOT inherit that strength without real provenance logging')
})

test('CORRECTED behavior: STABLE + ASSERTED_LOGGED (the real 2016-2019 case) is YELLOW -- stronger than unlogged, still not GREEN', () => {
  const stability = computeFilesystemStability(['h2', 'h2'])
  const result = computeChainOfCustodyStatus(stability, PROVENANCE_STRENGTH.ASSERTED_LOGGED)
  assert.equal(result.overallChainOfCustody, 'YELLOW')
})

test('CORRECTED behavior: STABLE + INDEPENDENTLY_VERIFIED is the only path to GREEN', () => {
  const stability = computeFilesystemStability(['h3', 'h3', 'h3'])
  const result = computeChainOfCustodyStatus(stability, PROVENANCE_STRENGTH.INDEPENDENTLY_VERIFIED)
  assert.equal(result.overallChainOfCustody, 'GREEN')
})

test('an UNSTABLE filesystem read caps the result at RED regardless of how strong the provenance claim is', () => {
  const stability = computeFilesystemStability(['h4', 'h5']) // changed between passes
  const result = computeChainOfCustodyStatus(stability, PROVENANCE_STRENGTH.INDEPENDENTLY_VERIFIED)
  assert.equal(result.overallChainOfCustody, 'RED', 'a real provenance claim about bytes that may no longer be the same bytes is not usable')
})

test('both independent axes are always echoed back verbatim -- a caller can never lose the distinction even reading only the combined field\'s neighbors', () => {
  const stability = computeFilesystemStability(['h6', 'h6'])
  const result = computeChainOfCustodyStatus(stability, PROVENANCE_STRENGTH.NONE)
  assert.equal(result.filesystemStability, 'STABLE')
  assert.equal(result.provenanceStrength, 'NONE')
  assert.equal(result.overallChainOfCustody, 'RED')
})
