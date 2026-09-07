import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAutofixEligibility,
  classifyAutofixEligibility,
  classifyFinding,
  ELIGIBLE_FIX_KINDS,
  MIN_CONFIDENCE_FOR_AUTOFIX,
  NOT_ELIGIBLE_FIX_KINDS
} from '../domain/self-improvement-autofix-eligibility.mjs'
import { createFinding, transitionFinding } from '../domain/self-improvement-finding.mjs'

const clock = () => new Date('2026-09-07T12:00:00.000Z')

function baseRaw(overrides = {}) {
  return {
    sourceDetector: 'UI_DOGFOOD',
    severity: 'P1',
    evidence: { screenshot: 'ref:1' },
    reproduction: { steps: ['open settings'] },
    affectedSurface: 'settings-page',
    confidence: 0.95,
    verificationMethod: 'DOGFOOD_RESCAN',
    ...overrides
  }
}

function findingWithScope(kind, overrides = {}) {
  return createFinding(baseRaw({ candidateFixScope: { kind, summary: 'x' }, ...overrides }), clock)
}

test('every ELIGIBLE_FIX_KINDS candidate classifies as eligible when confidence and shape are otherwise clean', async (t) => {
  for (const kind of ELIGIBLE_FIX_KINDS) {
    await t.test(kind, () => {
      const finding = findingWithScope(kind)
      const result = classifyAutofixEligibility(finding)
      assert.equal(result.eligible, true, `${kind} must be eligible`)
      assert.equal(result.reason, null)
      assert.deepEqual(classifyFinding(finding), { status: 'ELIGIBLE_FOR_AUTOFIX', authorityRequired: null })
    })
  }
})

test('every NOT_ELIGIBLE_FIX_KINDS reason always classifies as NEEDS_OWNER, even at max confidence', async (t) => {
  for (const kind of NOT_ELIGIBLE_FIX_KINDS) {
    await t.test(kind, () => {
      const finding = findingWithScope(kind, { confidence: 1 })
      const result = classifyAutofixEligibility(finding)
      assert.equal(result.eligible, false, `${kind} must never be eligible regardless of confidence`)
      assert.equal(result.reason, kind, 'the reason code must name the exact NOT_ELIGIBLE kind')
      assert.deepEqual(classifyFinding(finding), { status: 'NEEDS_OWNER', authorityRequired: kind })
    })
  }
})

test('fail closed: unrecognized sourceDetector never reaches eligible', () => {
  const finding = { ...findingWithScope('BOUNDED_CODE_DEFECT'), sourceDetector: 'NOT_A_REAL_DETECTOR' }
  const result = classifyAutofixEligibility(finding)
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'UNRECOGNIZED_SOURCE_DETECTOR')
})

test('fail closed: unclassifiable severity never reaches eligible', () => {
  const finding = { ...findingWithScope('BOUNDED_CODE_DEFECT'), severity: 'P9-not-real' }
  const result = classifyAutofixEligibility(finding)
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'UNCLASSIFIABLE_SEVERITY')
})

test('fail closed: no candidateFixScope at all never reaches eligible', () => {
  const finding = createFinding(baseRaw(), clock)
  const result = classifyAutofixEligibility(finding)
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'UNCLASSIFIABLE_FIX_KIND')
})

test('fail closed: an unrecognized candidateFixScope.kind never reaches eligible', () => {
  const finding = findingWithScope('SOME_KIND_THIS_POLICY_HAS_NEVER_SEEN')
  const result = classifyAutofixEligibility(finding)
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'UNCLASSIFIABLE_FIX_KIND')
})

test('fail closed: confidence below MIN_CONFIDENCE_FOR_AUTOFIX never reaches eligible, exactly at the boundary is eligible', () => {
  const belowBoundary = findingWithScope('BOUNDED_CODE_DEFECT', { confidence: MIN_CONFIDENCE_FOR_AUTOFIX - 0.01 })
  assert.deepEqual(classifyAutofixEligibility(belowBoundary), { eligible: false, reason: 'LOW_CONFIDENCE' })

  const atBoundary = findingWithScope('BOUNDED_CODE_DEFECT', { confidence: MIN_CONFIDENCE_FOR_AUTOFIX })
  assert.equal(classifyAutofixEligibility(atBoundary).eligible, true, 'the documented floor itself must be eligible')
})

test('ELIGIBLE_FIX_KINDS and NOT_ELIGIBLE_FIX_KINDS never overlap', () => {
  const overlap = ELIGIBLE_FIX_KINDS.filter((kind) => NOT_ELIGIBLE_FIX_KINDS.includes(kind))
  assert.deepEqual(overlap, [])
})

test('applyAutofixEligibility requires the finding to already be VERIFIED', () => {
  const finding = findingWithScope('BOUNDED_CODE_DEFECT')
  assert.throws(
    () => applyAutofixEligibility(finding, clock),
    (error) => error.code === 'TSF_INVALID_FINDING_TRANSITION',
    'an unverified finding must never receive an eligibility verdict'
  )
})

test('applyAutofixEligibility transitions a VERIFIED eligible finding to ELIGIBLE_FOR_AUTOFIX with no authorityRequired', () => {
  let finding = findingWithScope('UI_CLIPPING_OVERFLOW')
  finding = transitionFinding(finding, 'VERIFIED', {}, clock)
  const classified = applyAutofixEligibility(finding, clock)
  assert.equal(classified.status, 'ELIGIBLE_FOR_AUTOFIX')
  assert.equal(classified.authorityRequired, null)
  assert.equal(classified.revision, finding.revision + 1)
})

test('applyAutofixEligibility transitions a VERIFIED not-eligible finding to NEEDS_OWNER with the reason stamped', () => {
  let finding = findingWithScope('CREDENTIALS_AUTHENTICATION')
  finding = transitionFinding(finding, 'VERIFIED', {}, clock)
  const classified = applyAutofixEligibility(finding, clock)
  assert.equal(classified.status, 'NEEDS_OWNER')
  assert.equal(classified.authorityRequired, 'CREDENTIALS_AUTHENTICATION')
})
