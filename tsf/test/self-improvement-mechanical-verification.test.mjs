import assert from 'node:assert/strict'
import test from 'node:test'
import { createFinding } from '../domain/self-improvement-finding.mjs'
import { applyMechanicalVerification, classifyMechanicalVerification } from '../domain/self-improvement-mechanical-verification.mjs'

const clock = () => new Date('2026-09-07T12:00:00.000Z')

function baseRaw(overrides = {}) {
  return {
    sourceDetector: 'RUNTIME_ASSERTION',
    severity: 'P2',
    evidence: { observed: 2, expected: 1 },
    reproduction: { command: 'node --test some.test.mjs' },
    affectedSurface: 'some-module#someFn',
    confidence: 0.95,
    verificationMethod: 'node --test some.test.mjs exits 0',
    ...overrides
  }
}

test('classifyMechanicalVerification: no reproduction.command fails closed, unverifiable', () => {
  const finding = createFinding(baseRaw({ reproduction: { steps: ['manual'] } }), clock)
  const result = classifyMechanicalVerification(finding, { passed: false })
  assert.equal(result.verifiable, false)
  assert.equal(result.reason, 'NO_MECHANICAL_REPRODUCTION_COMMAND')
})

test('classifyMechanicalVerification: a genuinely failing reproduction verifies the finding', () => {
  const finding = createFinding(baseRaw(), clock)
  const result = classifyMechanicalVerification(finding, { passed: false, exitCode: 1 })
  assert.deepEqual(result, { verifiable: true, status: 'VERIFIED', reason: 'MECHANICAL_REPRODUCTION_CONFIRMED_FAILING' })
})

test('classifyMechanicalVerification: a reproduction that already passes is a false positive', () => {
  const finding = createFinding(baseRaw(), clock)
  const result = classifyMechanicalVerification(finding, { passed: true, exitCode: 0 })
  assert.deepEqual(result, { verifiable: true, status: 'REJECTED_FALSE_POSITIVE', reason: 'REPRODUCTION_DID_NOT_FAIL' })
})

test('applyMechanicalVerification: real transition to VERIFIED, audit trail carries the exit code', () => {
  const finding = createFinding(baseRaw(), clock)
  const verified = applyMechanicalVerification(finding, { passed: false, exitCode: 1 }, clock)
  assert.equal(verified.status, 'VERIFIED')
  assert.equal(verified.revision, 1)
  assert.deepEqual(verified.transitions.at(-1), {
    from: 'DETECTED',
    to: 'VERIFIED',
    reason: 'MECHANICAL_REPRODUCTION_CONFIRMED_FAILING',
    evidence: [{ exitCode: 1 }],
    at: verified.updatedAt
  })
})

test('applyMechanicalVerification: real transition to REJECTED_FALSE_POSITIVE when reproduction never failed', () => {
  const finding = createFinding(baseRaw(), clock)
  const rejected = applyMechanicalVerification(finding, { passed: true, exitCode: 0 }, clock)
  assert.equal(rejected.status, 'REJECTED_FALSE_POSITIVE')
})

test('applyMechanicalVerification: throws TSF_SELF_IMPROVEMENT_NOT_MECHANICALLY_VERIFIABLE when unverifiable', () => {
  const finding = createFinding(baseRaw({ reproduction: { steps: ['manual'] } }), clock)
  assert.throws(
    () => applyMechanicalVerification(finding, { passed: false }, clock),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_NOT_MECHANICALLY_VERIFIABLE'
  )
})
