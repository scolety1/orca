// Wave 0 preflight, item B: closes the "plain-object hand-splice" caveat
// the independent verifier disclosed against the canonicalization
// invariant. Confirms a CanonicalFact with invalid/missing/inconsistent
// ReconciliationDecision lineage -- however it got into the structure --
// is quarantined at the load/export boundary, never emitted as canonical.
import assert from 'node:assert/strict'
import test from 'node:test'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { integrityCheckedMission, verifyCanonicalFactLineage } from '../domain/research-integrity.mjs'
import { buildResearchProvenancePackage, canonicalOutputToCsv } from '../domain/research-provenance.mjs'
import { computeCompletenessMetrics } from '../domain/research-completeness.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-09-20T09:00:00.000Z')

function missionWithLegitimateFact() {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  // A claim admitted via the real ladder isn't required for this test --
  // decideReconciliation only requires ACCEPT_SINGLE_VERIFIED_CLAIM to
  // reference a real VERIFIED claim, so use ACCEPT_DERIVED_VALUE (no claim
  // precondition) to keep this fixture minimal and focused on the
  // reconciliation-decision <-> CanonicalFact lineage itself.
  mission = decideReconciliation(
    mission,
    'node:x',
    { fieldName: 'yards', decisionType: 'ACCEPT_DERIVED_VALUE', decidedValue: 42, rationale: 'test fixture derived value', decidedBy: 'TIM' },
    clock,
    mission.revision
  )
  const decisionId = mission.nodes[0].reconciliationDecisions[0].id
  mission = admitReconciliationDecision(mission, 'node:x', decisionId, clock, mission.revision)
  return mission
}

test('a legitimate CanonicalFact (real decision, matching field, valid decisionType) passes integrity checking', () => {
  const mission = missionWithLegitimateFact()
  const { valid, quarantined } = verifyCanonicalFactLineage(mission.nodes[0])
  assert.equal(valid.length, 1)
  assert.equal(quarantined.length, 0)
})

test('a hand-spliced CanonicalFact with no reconciliationDecisionId at all is quarantined', () => {
  const mission = missionWithLegitimateFact()
  const forged = { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'forged-1', fieldName: 'yards', value: 999999, temporalScope: null, reconciliationDecisionId: null, derivationLineage: null, canonicalizedAt: clock().toISOString() }
  const corruptedMission = { ...mission, nodes: [{ ...mission.nodes[0], canonicalFacts: [...mission.nodes[0].canonicalFacts, forged] }] }
  const { valid, quarantined } = verifyCanonicalFactLineage(corruptedMission.nodes[0])
  assert.equal(valid.length, 1, 'the one legitimate fact still passes')
  assert.equal(quarantined.length, 1)
  assert.equal(quarantined[0].reason, 'MISSING_RECONCILIATION_DECISION_ID')
})

test('a hand-spliced CanonicalFact pointing at a nonexistent decision id is quarantined', () => {
  const mission = missionWithLegitimateFact()
  const forged = { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'forged-2', fieldName: 'yards', value: 999999, temporalScope: null, reconciliationDecisionId: 'sha256-of-nothing-real', derivationLineage: null, canonicalizedAt: clock().toISOString() }
  const corruptedMission = { ...mission, nodes: [{ ...mission.nodes[0], canonicalFacts: [...mission.nodes[0].canonicalFacts, forged] }] }
  const { quarantined } = verifyCanonicalFactLineage(corruptedMission.nodes[0])
  assert.equal(quarantined.length, 1)
  assert.equal(quarantined[0].reason, 'RECONCILIATION_DECISION_NOT_FOUND')
})

test('a CanonicalFact whose fieldName disagrees with its own decision is quarantined (field-name mismatch)', () => {
  const mission = missionWithLegitimateFact()
  const realDecisionId = mission.nodes[0].reconciliationDecisions[0].id
  const forged = { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'forged-3', fieldName: 'someOtherField', value: 999999, temporalScope: null, reconciliationDecisionId: realDecisionId, derivationLineage: null, canonicalizedAt: clock().toISOString() }
  const corruptedMission = { ...mission, nodes: [{ ...mission.nodes[0], canonicalFacts: [...mission.nodes[0].canonicalFacts, forged] }] }
  const { quarantined } = verifyCanonicalFactLineage(corruptedMission.nodes[0])
  assert.equal(quarantined.length, 1)
  assert.equal(quarantined[0].reason, 'FIELD_NAME_MISMATCH')
})

test('a hand-spliced fake ACCEPT_TYPED_MISSING-backed CanonicalFact is quarantined even though its decision id resolves', () => {
  const mission = missionWithLegitimateFact()
  // Hand-splice a decision AND a fact that references it, bypassing
  // admitReconciliationDecision's own real-time assertion entirely --
  // simulates data that reached this shape by some other (buggy/malicious)
  // path, which is exactly the caveat this module exists to catch.
  const forgedDecision = { schemaVersion: 'TSF_RECONCILIATION_DECISION_V1', id: 'forged-decision', fieldName: 'signingBonusUsd', decidedValue: null, decisionType: 'ACCEPT_TYPED_MISSING', selectedClaimId: null, consideredClaimIds: [], verificationIds: [], conflictId: null, rationale: 'forged', decidedBy: 'ATTACKER', binding: 'x', decidedAt: clock().toISOString() }
  const forgedFact = { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'forged-4', fieldName: 'signingBonusUsd', value: 50000, temporalScope: null, reconciliationDecisionId: 'forged-decision', derivationLineage: null, canonicalizedAt: clock().toISOString() }
  const corruptedMission = {
    ...mission,
    nodes: [{ ...mission.nodes[0], reconciliationDecisions: [...mission.nodes[0].reconciliationDecisions, forgedDecision], canonicalFacts: [...mission.nodes[0].canonicalFacts, forgedFact] }]
  }
  const { quarantined } = verifyCanonicalFactLineage(corruptedMission.nodes[0])
  assert.equal(quarantined.length, 1)
  assert.equal(quarantined[0].reason, 'INVALID_DECISION_TYPE_FOR_CANONICAL_FACT')
})

test('integrityCheckedMission never mutates the raw input mission, and reports FINDINGS status with remediation', () => {
  const mission = missionWithLegitimateFact()
  const forged = { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'forged-5', fieldName: 'yards', value: -1, temporalScope: null, reconciliationDecisionId: null, derivationLineage: null, canonicalizedAt: clock().toISOString() }
  const corruptedMission = { ...mission, nodes: [{ ...mission.nodes[0], canonicalFacts: [...mission.nodes[0].canonicalFacts, forged] }] }
  const before = JSON.stringify(corruptedMission)
  const { mission: checked, integrityReport } = integrityCheckedMission(corruptedMission, clock)
  assert.equal(JSON.stringify(corruptedMission), before, 'the raw input object must never be mutated by the integrity check')
  assert.equal(integrityReport.status, 'FINDINGS')
  assert.equal(integrityReport.authority, 'ADVISORY_ONLY')
  assert.equal(integrityReport.findings[0].code, 'CANONICAL_FACT_LINEAGE_INVALID')
  assert.ok(integrityReport.findings[0].remediation.length > 0)
  assert.equal(checked.nodes[0].canonicalFacts.length, 1, 'the checked projection excludes the quarantined fact from canonicalFacts')
  assert.equal(checked.nodes[0].quarantinedCanonicalFacts.length, 1, 'but preserves it, visibly, as quarantined -- never silently deleted')
})

test('the artifact-export boundary (provenance package + CSV) never emits a quarantined fact as canonical', () => {
  const mission = missionWithLegitimateFact()
  const forged = { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'forged-6', fieldName: 'yards', value: -999, temporalScope: null, reconciliationDecisionId: null, derivationLineage: null, canonicalizedAt: clock().toISOString() }
  const corruptedMission = { ...mission, nodes: [{ ...mission.nodes[0], canonicalFacts: [...mission.nodes[0].canonicalFacts, forged] }] }

  const { packageBody } = buildResearchProvenancePackage(corruptedMission, { clock })
  assert.equal(packageBody.integrityReport.status, 'FINDINGS')
  assert.equal(packageBody.nodes[0].canonicalFacts.some((f) => f.value === -999), false, 'the forged value must never appear as canonical in the exported package')
  assert.equal(packageBody.nodes[0].canonicalFacts.some((f) => f.value === 42), true, 'the legitimate fact still exports normally')

  const csv = canonicalOutputToCsv(corruptedMission, clock)
  assert.ok(!csv.includes('-999'), 'the forged value must never appear in the CSV export')
  assert.ok(csv.includes('42'))
})

test('completeness metrics computed on an integrity-checked mission do not count a quarantined fact as field coverage', () => {
  const mission = missionWithLegitimateFact()
  const forged = { schemaVersion: 'TSF_CANONICAL_FACT_V1', id: 'forged-7', fieldName: 'anotherField', value: 1, temporalScope: null, reconciliationDecisionId: null, derivationLineage: null, canonicalizedAt: clock().toISOString() }
  const corruptedMission = {
    ...mission,
    nodes: [{ ...mission.nodes[0], requestedFields: [{ fieldName: 'anotherField', valueType: 'number', required: true }], canonicalFacts: [...mission.nodes[0].canonicalFacts, forged] }]
  }
  const { mission: checked } = integrityCheckedMission(corruptedMission, clock)
  const metrics = computeCompletenessMetrics(checked, clock)
  // anotherField has no legitimate CanonicalFact and no typedMissingness
  // once the forged one is excluded -- it must count as unresolved.
  assert.ok(metrics.fieldCoverage < 1)
})
