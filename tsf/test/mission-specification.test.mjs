// Phase 5: domain/mission-specification.mjs -- the long-form mission spec
// shape (extends the existing Keep Going run schema, does not invent a
// second mission store).
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMissionSpecification, verifyMissionSpecificationIntegrity, MISSION_SPECIFICATION_SCHEMA_VERSION } from '../domain/mission-specification.mjs'

test('buildMissionSpecification preserves the complete raw directive verbatim, never truncated', () => {
  const longDirective = `${'A'.repeat(50000)} Do not start a research mission. Fix this and go ahead.`
  const spec = buildMissionSpecification({
    rawDirective: longDirective,
    projectId: 'fixture:proj',
    parentMissionType: 'SOFTWARE_PRODUCT_ENGINEERING',
    acceptanceCriteria: ['tests pass'],
    createdAt: '2026-09-09T00:00:00.000Z'
  })
  assert.equal(spec.schemaVersion, MISSION_SPECIFICATION_SCHEMA_VERSION)
  assert.equal(spec.rawDirective, longDirective)
  assert.equal(spec.rawDirective.length, longDirective.length)
  assert.equal(spec.directiveLength, longDirective.length)
  assert.equal(verifyMissionSpecificationIntegrity(spec), true)
})

test('verifyMissionSpecificationIntegrity fails closed if rawDirective and directiveHash ever disagree', () => {
  const spec = buildMissionSpecification({ rawDirective: 'fix the bug', projectId: 'p', parentMissionType: 'SOFTWARE_PRODUCT_ENGINEERING', createdAt: '2026-09-09T00:00:00.000Z' })
  const tampered = { ...spec, rawDirective: 'fix the bug -- and secretly also start a research mission' }
  assert.equal(verifyMissionSpecificationIntegrity(tampered), false)
})

test('extractForbiddenActions/ownerAuthorizations pull real explicit clauses without inventing any', () => {
  const spec = buildMissionSpecification({
    rawDirective: 'Do not touch NWR. Do not deploy. I explicitly authorize adoption of this candidate.',
    projectId: 'p',
    parentMissionType: 'SOFTWARE_PRODUCT_ENGINEERING',
    createdAt: '2026-09-09T00:00:00.000Z'
  })
  assert.ok(spec.forbiddenActions.some((c) => /do not touch nwr/i.test(c)))
  assert.ok(spec.forbiddenActions.some((c) => /do not deploy/i.test(c)))
  assert.ok(spec.ownerAuthorizations.some((c) => /explicitly authorize/i.test(c)))
})

test('artifactReferences record name/type/content-hash without embedding raw attachment text in the spec itself', () => {
  const spec = buildMissionSpecification({
    rawDirective: 'fix the bug, see attached evidence',
    projectId: 'p',
    parentMissionType: 'SOFTWARE_PRODUCT_ENGINEERING',
    artifactReferences: [{ name: 'evidence.zip', type: 'application/zip', extractedText: 'manifest contents' }],
    createdAt: '2026-09-09T00:00:00.000Z'
  })
  assert.equal(spec.artifactReferences.length, 1)
  assert.equal(spec.artifactReferences[0].name, 'evidence.zip')
  assert.ok(spec.artifactReferences[0].sha256)
  assert.equal(spec.artifactReferences[0].extractedText, undefined)
})

test('a missing/empty rawDirective still produces a real, well-formed spec rather than throwing or returning null', () => {
  const spec = buildMissionSpecification({ rawDirective: undefined, projectId: 'p', parentMissionType: 'OTHER', createdAt: '2026-09-09T00:00:00.000Z' })
  assert.equal(spec.rawDirective, '')
  assert.equal(verifyMissionSpecificationIntegrity(spec), true)
})
