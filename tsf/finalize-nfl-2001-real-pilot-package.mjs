// Assembles the 12-item real pilot output package (REAL PILOT §15) from
// the already-produced, real fixtures/nfl-2001-real-pilot-results/mission.json.
// Pure post-processing/reporting -- no new dispatch, no new spend, reads
// only durable, already-canonicalized real data.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { canonicalOutputToCsv } from './domain/research-provenance.mjs'
import { integrityCheckedMission } from './domain/research-integrity.mjs'

const OUT_DIR = path.join(import.meta.dirname, 'fixtures', 'nfl-2001-real-pilot-results')
const clock = () => new Date()

const mission = JSON.parse(readFileSync(path.join(OUT_DIR, 'mission.json'), 'utf8'))
const { mission: integrityChecked, integrityReport } = integrityCheckedMission(mission, clock)

// 1. Canonical CSV
const csv = canonicalOutputToCsv(integrityChecked, clock)
writeFileSync(path.join(OUT_DIR, 'canonical-output.csv'), csv)

// 2. Canonical machine-readable dataset (JSON, one row per entity/field)
const canonicalDataset = []
for (const node of integrityChecked.nodes) {
  for (const fact of node.canonicalFacts) {
    canonicalDataset.push({
      entityId: node.targetEntity?.entityId ?? null,
      entityName: node.targetEntity?.name ?? null,
      nodeId: node.id,
      fieldName: fact.fieldName,
      value: fact.value,
      temporalScope: fact.temporalScope,
      reconciliationDecisionId: fact.reconciliationDecisionId,
      canonicalizedAt: fact.canonicalizedAt
    })
  }
  for (const missing of node.typedMissingness) {
    canonicalDataset.push({
      entityId: node.targetEntity?.entityId ?? null,
      entityName: node.targetEntity?.name ?? null,
      nodeId: node.id,
      fieldName: missing.fieldName,
      value: null,
      missingnessType: missing.missingnessType,
      temporalScope: missing.temporalScope,
      canonicalizedAt: null
    })
  }
}
writeFileSync(path.join(OUT_DIR, 'canonical-dataset.json'), JSON.stringify(canonicalDataset, null, 2))

// 3. Provenance/evidence ledger (real, per-node evidence + verification + reconciliation chain)
const evidenceLedger = mission.nodes.map((node) => ({
  nodeId: node.id,
  entityId: node.targetEntity?.entityId,
  sourceReferences: node.sourceReferences,
  evidence: node.evidence,
  verifications: node.verifications.map((v) => ({ id: v.id, claimId: v.claimId, verdict: v.verdict, evidenceLineage: v.evidenceLineage, verifiedAt: v.verifiedAt })),
  reconciliationDecisions: node.reconciliationDecisions.map((d) => ({ id: d.id, fieldName: d.fieldName, decisionType: d.decisionType, decidedValue: d.decidedValue, rationale: d.rationale, decidedBy: d.decidedBy, decidedAt: d.decidedAt }))
}))
writeFileSync(path.join(OUT_DIR, 'evidence-ledger.json'), JSON.stringify(evidenceLedger, null, 2))

// 4. Source manifest
const sourceManifest = []
const seenSources = new Set()
for (const node of mission.nodes) {
  for (const src of node.sourceReferences) {
    const key = `${node.id}:${src.id}`
    if (seenSources.has(key)) continue
    seenSources.add(key)
    sourceManifest.push({
      nodeId: node.id,
      entityId: node.targetEntity?.entityId,
      sourceRef: src.sourceRef,
      url: src.url,
      publisher: src.publisher,
      retrievedAt: src.retrievedAt,
      sourceQualityClass: src.sourceQualityClass ?? null,
      independenceState: src.independenceState ?? 'UNKNOWN',
      upstreamSourceId: src.upstreamSourceId ?? null
    })
  }
}
writeFileSync(path.join(OUT_DIR, 'source-manifest.json'), JSON.stringify(sourceManifest, null, 2))

// 5. Expected-universe report
const expectedUniverseReport = {
  source: mission.expectedUniverse.source ?? null,
  expectedCount: mission.expectedUniverse.expectedCount,
  entities: mission.expectedUniverse.expectedEntities.map((e) => {
    const node = mission.nodes.find((n) => n.targetEntity?.entityId === e.entityId)
    let status = 'MISSING'
    if (node) {
      const requiredFields = node.requestedFields.filter((f) => f.required)
      const allResolved = requiredFields.every((rf) => {
        const scopes = rf.requiredTemporalScopes?.length ? rf.requiredTemporalScopes : [null]
        return scopes.every((scope) => node.canonicalFacts.some((f) => f.fieldName === rf.fieldName && (scope === null || f.temporalScope === scope)) || node.typedMissingness.some((m) => m.fieldName === rf.fieldName && (scope === null || m.temporalScope === scope)))
      })
      status = allResolved ? 'RESOLVED' : 'BLOCKED'
    }
    return { entityId: e.entityId, identityHints: e.identityHints, status }
  })
}
writeFileSync(path.join(OUT_DIR, 'expected-universe-report.json'), JSON.stringify(expectedUniverseReport, null, 2))

// 6. Completeness report -- already produced by the driver (completeness.json)

// 7. Conflict report
const conflictReport = mission.nodes.flatMap((node) => node.conflicts.map((c) => ({ nodeId: node.id, entityId: node.targetEntity?.entityId, ...c })))
writeFileSync(path.join(OUT_DIR, 'conflict-report.json'), JSON.stringify(conflictReport, null, 2))

// 8. Typed missingness report
const typedMissingnessReport = mission.nodes.flatMap((node) => node.typedMissingness.map((m) => ({ nodeId: node.id, entityId: node.targetEntity?.entityId, entityName: node.targetEntity?.name, ...m })))
writeFileSync(path.join(OUT_DIR, 'typed-missingness-report.json'), JSON.stringify(typedMissingnessReport, null, 2))

// 9. Identity-resolution report
const identityReport = mission.nodes.map((node) => ({ nodeId: node.id, entityId: node.targetEntity?.entityId, entityName: node.targetEntity?.name, identityResolutionState: node.identityResolutionState }))
writeFileSync(path.join(OUT_DIR, 'identity-resolution-report.json'), JSON.stringify(identityReport, null, 2))

// 10. Verification report
const verificationReport = mission.nodes.flatMap((node) => node.verifications.map((v) => ({ nodeId: node.id, entityId: node.targetEntity?.entityId, ...v })))
writeFileSync(path.join(OUT_DIR, 'verification-report.json'), JSON.stringify(verificationReport, null, 2))

// 11. Reproducibility manifest
const reproducibilityManifest = {
  generatedAt: clock().toISOString(),
  scripts: ['run-nfl-2001-real-pilot.mjs', 'run-nfl-2001-second-mission-library-proof.mjs', 'backfill-nfl-2001-source-independence.mjs', 'resnapshot-nfl-2001-real-pilot.mjs', 'finalize-nfl-2001-real-pilot-package.mjs'],
  sourceDataModule: 'fixtures/nfl-2001-real-pilot-data.mjs',
  missionId: mission.id,
  missionRevision: mission.revision,
  realProviderCallsMade: 2,
  realProvider: 'PARALLEL (core processor)',
  deterministicAcquisitionSource: 'Wikipedia (en.wikipedia.org), CC-BY-SA, fetched via real WebFetch tool calls this session',
  integrityCheck: integrityReport,
  note: 'Re-running run-nfl-2001-real-pilot.mjs against the same fixtures/nfl-2001-real-pilot-data.mjs will re-admit the SAME 31 deterministic results byte-for-byte (idempotent, content-hash-keyed) and will re-dispatch the 2 real Parallel gaps again (a genuinely new real network call each time, not idempotent -- the pilot script itself does not cache across runs; only the durable store own digest-based idempotency prevents duplicate admission of a result already recorded in the SAME mission).'
}
writeFileSync(path.join(OUT_DIR, 'reproducibility-manifest.json'), JSON.stringify(reproducibilityManifest, null, 2))

// 12. Concise research summary
const completeness = JSON.parse(readFileSync(path.join(OUT_DIR, 'completeness.json'), 'utf8'))
const usage = JSON.parse(readFileSync(path.join(OUT_DIR, 'provider-usage.json'), 'utf8'))
const summary = {
  mission: 'NFL Historical Base Data, 2001 season, QB/RB/WR/TE (2002 Pro Bowl selections)',
  expectedEntities: mission.expectedUniverse.expectedCount,
  presentEntities: mission.nodes.filter((n) => n.status === 'ADMITTED' || n.status === 'COMPLETED').length,
  canonicalFactsCreated: mission.nodes.reduce((a, n) => a + n.canonicalFacts.length, 0),
  typedMissingnessCount: mission.nodes.reduce((a, n) => a + n.typedMissingness.length, 0),
  conflictsDiscovered: mission.nodes.reduce((a, n) => a + n.conflicts.length, 0),
  needsYouRaised: mission.needsYou.length,
  fieldCoverage: completeness.fieldCoverage,
  verifiedCoverage: completeness.verifiedCoverage,
  realPaidProviderCalls: usage.byProvider.PARALLEL?.requests ?? 0,
  deterministicAcquisitionCalls: usage.byProvider.DETERMINISTIC_WIKIPEDIA_EXTRACTION?.requests ?? 0,
  integrityStatus: integrityReport.status,
  genuineDefectsFoundAndFixedDuringThisRealPilot: [
    'Parallel API real-schema validation requires output_schema.properties -- a bare {type:"object"} placeholder (only ever exercised against the deterministic fake worker previously) was rejected with HTTP 422. Fixed in fixtures/nfl-2001-real-pilot-data.mjs (requestedOutputSchemaForPosition).',
    'ES module import hoisting: a script-level process.env.TSF_UI_STATE_FILE assignment placed textually before static imports did NOT actually run before those imports (all top-level imports are hoisted ahead of any other top-level statement), silently writing pilot mission/library data to the real default operator-state.json for two run attempts instead of an isolated file. Caught via Test-Path plus inspecting the real files actual content (confirmed it held nothing but this pilots own accidental writes plus untouched framework defaults -- no real data lost), reset to pristine, and fixed by switching to the dynamic await import() pattern already used by every test file in this codebase.',
    'Independent-verification finding: a node resolved entirely via cross-mission Research Library reuse (zero real dispatch) stayed stuck at PENDING/READY forever despite having a genuine CanonicalFact, under-reporting presentEntityCoverage/evidenceCoverage/verifiedCoverage for a reuse-only mission. Fixed with a new, narrowly-guarded ADMITTED transition (markResearchNodeAdmittedViaLibraryReuse, reachable only for a node with zero real dispatch/result history) plus a new durable driver function (adoptResearchLibraryReuseDurable) combining evaluate-decide-admit-mark as one complete sequence. Regression-tested (2 new domain tests, 1 new driver test) and the second-mission library-reuse proof was regenerated end to end (mission:nfl-2001-second-reuse-proof-v2): all 3 reused nodes now correctly show status ADMITTED with presentEntityCoverage/fieldCoverage of 1.',
    'Independent-verification finding: the pilots source-independence classification loop matched only the exact publisher string "Wikipedia" (what the synthetic deterministic-acquisition worker sets), missing the two REAL Parallel-dispatched sources (Brady, Favre) whose real citation extraction returns the page title instead (e.g. "Tom Brady - Wikipedia"). Both are genuinely the same source type (en.wikipedia.org). Fixed by matching on URL domain instead of an exact publisher string, and backfilled onto the already-completed real mission with zero new network calls/spend (backfill-nfl-2001-source-independence.mjs) -- all 34 real source references are now classified (0 remaining unset).'
  ]
}
writeFileSync(path.join(OUT_DIR, 'research-summary.json'), JSON.stringify(summary, null, 2))

console.log('Output package finalized in', OUT_DIR)
console.log(JSON.stringify(summary, null, 2))
