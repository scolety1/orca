import assert from 'node:assert/strict'
import test from 'node:test'
import { assertScopeDoesNotOverlapForbidden, buildAuthorityEnvelope, FORBIDDEN_PATH_PREFIXES } from '../domain/self-improvement-authority-envelope.mjs'

function finding(overrides = {}) {
  return {
    status: 'ELIGIBLE_FOR_AUTOFIX',
    findingId: 'finding:abc',
    evidence: { x: 1 },
    reproduction: { command: 'node -e "process.exit(0)"' },
    affectedSurface: 'tsf/domain/fixture.mjs',
    candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['tsf/domain/fixture.mjs'] },
    verificationMethod: 'RECHECK',
    projectId: null,
    ...overrides
  }
}

test('builds a complete envelope with every required field, deep-cloned (not the same reference)', () => {
  const f = finding()
  const envelope = buildAuthorityEnvelope(f, 'mission:selfimprove:abc')
  assert.equal(envelope.missionId, 'mission:selfimprove:abc')
  assert.equal(envelope.findingId, 'finding:abc')
  assert.deepEqual(envelope.allowedScope, ['tsf/domain/fixture.mjs'])
  assert.notEqual(envelope.evidence, f.evidence)
  assert.equal(envelope.adoptionPolicy, 'REQUIRES_OWNER_AUTHORIZATION_GATE_OPEN')
  assert.equal(envelope.verifierRequirements.mustDifferFromWorkerWhenAvailable, true)
})

test('an empty filesHint produces an honest empty allowedScope, never invented', () => {
  const envelope = buildAuthorityEnvelope(finding({ candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: [] } }), 'mission:selfimprove:abc')
  assert.deepEqual(envelope.allowedScope, [])
})

test('every mission-track status can rebuild the identical envelope, not just ELIGIBLE_FOR_AUTOFIX', () => {
  for (const status of ['ELIGIBLE_FOR_AUTOFIX', 'FIX_MISSION_CREATED', 'FIX_IN_PROGRESS', 'READY_FOR_ADOPTION', 'NEEDS_OWNER']) {
    assert.doesNotThrow(() => buildAuthorityEnvelope(finding({ status }), 'mission:selfimprove:abc'))
  }
})

test('a non-mission-track status refuses -- fails closed rather than building a bogus envelope', () => {
  for (const status of ['DETECTED', 'VERIFIED', 'RESOLVED', 'REOPENED', 'REJECTED_FALSE_POSITIVE']) {
    assert.throws(() => buildAuthorityEnvelope(finding({ status }), 'mission:selfimprove:abc'))
  }
})

test('assertScopeDoesNotOverlapForbidden catches a scope that already names a forbidden surface', () => {
  const envelope = buildAuthorityEnvelope(finding({ candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: [FORBIDDEN_PATH_PREFIXES[0]] } }), 'mission:selfimprove:abc')
  assert.throws(() => assertScopeDoesNotOverlapForbidden(envelope), (error) => error.code === 'TSF_SELF_IMPROVEMENT_SCOPE_OVERLAPS_FORBIDDEN')
})

test('assertScopeDoesNotOverlapForbidden passes clean for a genuinely disjoint scope', () => {
  const envelope = buildAuthorityEnvelope(finding(), 'mission:selfimprove:abc')
  assert.doesNotThrow(() => assertScopeDoesNotOverlapForbidden(envelope))
})
