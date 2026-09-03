import { readFileSync, writeFileSync } from 'node:fs'
import { detectResearchConflicts, verifyResearchClaim } from './domain/research-verification.mjs'
import { computeCompletenessMetrics } from './domain/research-completeness.mjs'
import { computeBakeoffQualityDimensions, buildBakeoffReport } from './domain/research-bakeoff-harness.mjs'
import { buildResearchProvenancePackage, canonicalOutputToCsv } from './domain/research-provenance.mjs'
import { integrityCheckedMission } from './domain/research-integrity.mjs'
import { bakeoffPreferredSourceHosts, bakeoffDisallowedSourceHosts, bakeoffExpectedEntityIdByNodeId } from './fixtures/nfl-2001-qb-bakeoff-package.mjs'

const clock = () => new Date('2026-09-03T10:00:00.000Z')
let mission = JSON.parse(readFileSync('fixtures/captured-bakeoff-results/mission.json', 'utf8'))
const callLog = JSON.parse(readFileSync('fixtures/captured-bakeoff-results/call-log.json', 'utf8'))

// Run every node through real conflict detection + verification (the SAME
// domain functions the deterministic fixture test uses).
for (const node of mission.nodes) {
  mission = detectResearchConflicts(mission, node.id, clock, mission.revision)
}
for (const node of mission.nodes) {
  for (const claim of [...node.claims]) {
    mission = verifyResearchClaim(mission, node.id, claim.id, clock, mission.revision)
  }
}

const completeness = computeCompletenessMetrics(mission, clock)
const preferredSourceHosts = bakeoffPreferredSourceHosts()
const disallowedSourceHosts = bakeoffDisallowedSourceHosts()
const expectedEntityIdByNodeId = bakeoffExpectedEntityIdByNodeId(mission)
const quality = computeBakeoffQualityDimensions(mission, { preferredSourceHosts, disallowedSourceHosts, expectedEntityIdByNodeId })

const instrumentation = callLog.map((e) => ({ providerFailed: !e.ok, failureReason: e.failureReason, latencyMs: e.latencyMs, requestCount: 1, cost: e.providerReportedCostUsd?.total ?? e.providerReportedCostUsd ?? null }))
const parallelInstr = instrumentation.filter((_, i) => callLog[i].providerId === 'PARALLEL')
const exaInstr = instrumentation.filter((_, i) => callLog[i].providerId === 'EXA')

const parallelReport = buildBakeoffReport(
  { ...mission, nodes: mission.nodes.map((n) => ({ ...n, claims: n.claims.filter((c) => c.provider === 'PARALLEL'), verifications: n.verifications.filter((v) => n.claims.find((c) => c.id === v.claimId)?.provider === 'PARALLEL'), evidence: n.evidence.filter((e) => n.claims.find((c) => c.id === e.claimId)?.provider === 'PARALLEL') })) },
  { instrumentation: parallelInstr, preferredSourceHosts, disallowedSourceHosts, expectedEntityIdByNodeId, clock }
)
const exaReport = buildBakeoffReport(
  { ...mission, nodes: mission.nodes.map((n) => ({ ...n, claims: n.claims.filter((c) => c.provider === 'EXA'), verifications: n.verifications.filter((v) => n.claims.find((c) => c.id === v.claimId)?.provider === 'EXA'), evidence: n.evidence.filter((e) => n.claims.find((c) => c.id === e.claimId)?.provider === 'EXA') })) },
  { instrumentation: exaInstr, preferredSourceHosts, disallowedSourceHosts, expectedEntityIdByNodeId, clock }
)

console.log('=== Mission-wide completeness ===')
console.log(JSON.stringify(completeness, null, 2))
console.log('=== Mission-wide quality dimensions ===')
console.log(JSON.stringify(quality, null, 2))
console.log('=== PARALLEL-only report ===')
console.log(JSON.stringify(parallelReport, null, 2))
console.log('=== EXA-only report ===')
console.log(JSON.stringify(exaReport, null, 2))
console.log('=== Conflicts ===')
for (const node of mission.nodes) {
  for (const c of node.conflicts) console.log(node.id, JSON.stringify(c))
}
console.log('=== Verifications ===')
for (const node of mission.nodes) {
  for (const v of node.verifications) {
    const claim = node.claims.find((c) => c.id === v.claimId)
    console.log(node.id, claim.provider, claim.fieldName, '=>', v.verdict)
  }
}

const { mission: checked, integrityReport } = integrityCheckedMission(mission, clock)
console.log('=== Integrity report ===', JSON.stringify(integrityReport))

writeFileSync('fixtures/captured-bakeoff-results/evaluated-mission.json', JSON.stringify(mission, null, 2))
writeFileSync('fixtures/captured-bakeoff-results/evaluation-summary.json', JSON.stringify({ completeness, quality, parallelReport, exaReport, integrityReport }, null, 2))
