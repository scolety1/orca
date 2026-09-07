import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildVerifierVerdict,
  checkAuthorityEnvelopeRespected,
  checkDuplicateArchitectureHeuristic,
  checkForbiddenSurfaceTouched,
  checkVerifierIndependence
} from '../domain/self-improvement-verifier-checks.mjs'

test('checkForbiddenSurfaceTouched catches a fake worker diff that touches a forbidden path', () => {
  const forbidden = ['tsf/server/cleanup-owner-authorization-gate.mjs']
  const clean = checkForbiddenSurfaceTouched(['tsf/domain/fixture.mjs'], forbidden)
  assert.equal(clean.pass, true)
  const dirty = checkForbiddenSurfaceTouched(['tsf/domain/fixture.mjs', 'tsf/server/cleanup-owner-authorization-gate.mjs'], forbidden)
  assert.equal(dirty.pass, false)
  assert.deepEqual(dirty.violations, ['tsf/server/cleanup-owner-authorization-gate.mjs'])
})

test('checkForbiddenSurfaceTouched catches a file NESTED under a forbidden prefix', () => {
  const result = checkForbiddenSurfaceTouched(['tsf/domain/cleanup-protected-registry.mjs/evil.mjs'], ['tsf/domain/cleanup-protected-registry.mjs'])
  assert.equal(result.pass, false)
})

test('checkAuthorityEnvelopeRespected: a declared scope blocks anything outside it', () => {
  const inScope = checkAuthorityEnvelopeRespected(['tsf/domain/fixture.mjs'], ['tsf/domain/fixture.mjs'])
  assert.equal(inScope.pass, true)
  const outOfScope = checkAuthorityEnvelopeRespected(['tsf/domain/other.mjs'], ['tsf/domain/fixture.mjs'])
  assert.equal(outOfScope.pass, false)
  assert.deepEqual(outOfScope.violations, ['tsf/domain/other.mjs'])
})

test('checkAuthorityEnvelopeRespected: an empty scope is honestly not mechanically checkable, not a free pass claim', () => {
  const result = checkAuthorityEnvelopeRespected(['tsf/domain/anything.mjs'], [])
  assert.equal(result.pass, true)
  assert.ok(result.note)
})

test('checkDuplicateArchitectureHeuristic flags a near-identical new filename', () => {
  const result = checkDuplicateArchitectureHeuristic(['tsf/domain/self-improvement-finding2.mjs'], ['self-improvement-finding.mjs'])
  assert.equal(result.pass, false)
  assert.equal(result.suspects[0].resemblesExisting, 'self-improvement-finding.mjs')
})

test('checkDuplicateArchitectureHeuristic does not flag a genuinely distinct name', () => {
  const result = checkDuplicateArchitectureHeuristic(['tsf/domain/wildly-different-concept.mjs'], ['self-improvement-finding.mjs'])
  assert.equal(result.pass, true)
})

test('checkVerifierIndependence: required and divergent passes; required and non-divergent fails', () => {
  assert.equal(checkVerifierIndependence({ requiredIndependence: true, divergent: true }).pass, true)
  assert.equal(checkVerifierIndependence({ requiredIndependence: true, divergent: false }).pass, false)
  assert.equal(checkVerifierIndependence({ requiredIndependence: false, divergent: false }).pass, true)
})

function baseChecks(overrides = {}) {
  return {
    reproductionPassed: true,
    regressionTargetResolved: true,
    regressionTestsPassed: true,
    forbiddenSurfaceCheck: { pass: true, violations: [] },
    scopeCheck: { pass: true, violations: [] },
    duplicateArchitectureCheck: { pass: true, suspects: [] },
    independenceCheck: { pass: true },
    ...overrides
  }
}

test('buildVerifierVerdict: every check passing -> VERIFIED_PASS with zero reasons', () => {
  const { verdict, reasons } = buildVerifierVerdict(baseChecks())
  assert.equal(verdict, 'VERIFIED_PASS')
  assert.deepEqual(reasons, [])
})

test('buildVerifierVerdict: never a vague pass -- each failing check contributes a specific named reason', () => {
  const { verdict, reasons } = buildVerifierVerdict(
    baseChecks({
      reproductionPassed: false,
      forbiddenSurfaceCheck: { pass: false, violations: ['tsf/server/cleanup-owner-authorization-gate.mjs'] },
      independenceCheck: { pass: false }
    })
  )
  assert.equal(verdict, 'VERIFIED_FAIL')
  assert.ok(reasons.includes('REPRODUCTION_STILL_FAILS'))
  assert.ok(reasons.some((r) => r.startsWith('FORBIDDEN_SURFACE_TOUCHED')))
  assert.ok(reasons.includes('VERIFIER_NOT_INDEPENDENT_FROM_WORKER'))
})

test('buildVerifierVerdict: no resolvable regression target fails closed, never silently passes', () => {
  const { verdict, reasons } = buildVerifierVerdict(baseChecks({ regressionTargetResolved: false }))
  assert.equal(verdict, 'VERIFIED_FAIL')
  assert.ok(reasons.includes('NO_TARGETED_REGRESSION_TEST_RESOLVABLE'))
})
