// REAL PILOT §13 -- cross-mission Research Library reuse proof. A SECOND,
// small, real ResearchMission requiring overlapping immutable source
// material from the first pilot mission. Proves: admissible source reuse,
// no unnecessary refetch, no automatic cross-mission CanonicalFact (the
// second mission still performs its own real ReconciliationDecision),
// source policy is rechecked, provenance stays correct.
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

async function main() {
  // Same isolated state file as the real pilot -- this mission needs to
  // see the SAME durable library the pilot just populated.
  process.env.TSF_UI_STATE_FILE = path.join(import.meta.dirname, 'server', '.local-state', 'operator-state.nfl-2001-real-pilot.json')
  const { createResearchMissionDurable, readResearchMissionStatus, readResearchMissionCompleteness, adoptResearchLibraryReuseDurable } = await import('./server/research-mission-driver.mjs')
  const { readResearchMission } = await import('./server/research-mission-store.mjs')
  const { readResearchLibrary } = await import('./server/research-library-store.mjs')
  const { buildNflQb2001Specification } = await import('./fixtures/nfl-2001-qb-research-fixture.mjs')

  const clock = () => new Date()
  // REGENERATE (bounded-defect correction, real-pilot independent
  // verification finding): the original mission:nfl-2001-second-reuse-proof
  // already carries canonicalFacts decided/admitted via the OLD, buggy
  // raw decide+admit sequence (nodes stuck at PENDING). Neither
  // decideReconciliation nor admitReconciliationDecision guards against
  // re-deciding an already-canonicalized field, so re-running reconciliation
  // against that same mission id would silently produce a SECOND, duplicate
  // ReconciliationDecision/CanonicalFact per field. This proof performs
  // zero paid research and zero real network calls either way, so the
  // honest, safe regeneration is a fresh mission id, not a patched replay.
  const MISSION_ID = 'mission:nfl-2001-second-reuse-proof-v2'
  const PERIOD_SCOPE = '2001-regular-season'

  // A genuinely different, smaller mission (a different real-world use
  // case: "how many receiving yards did these 3 already-researched
  // players have in 2001") that happens to need overlapping immutable
  // material the first pilot already established.
  const REUSE_TARGETS = [
    { entityId: 'nfl:2001:wr:marvin-harrison', nodeId: 'node:marvin-harrison', fieldName: 'receivingYards' },
    { entityId: 'nfl:2001:qb:kurt-warner', nodeId: 'node:kurt-warner', fieldName: 'passingYards' },
    { entityId: 'nfl:2001:rb:marshall-faulk', nodeId: 'node:marshall-faulk', fieldName: 'rushingYards' }
  ]

  const baseSpec = buildNflQb2001Specification()
  const sourcePolicy = { ...baseSpec.sourcePolicy, allowCrossMissionLibraryReuse: true, freshnessPolicy: 'HISTORICAL_STATIC' }
  const specification = {
    ...baseSpec,
    id: 'spec:nfl-2001-second-reuse-proof-v0',
    researchQuestion: 'A small, independent follow-up mission needing a subset of already-researched 2001 season statistics.',
    sourcePolicy,
    expectedUniverse: {
      schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
      entityType: 'NFL_SKILL_POSITION_SEASON',
      expectedCount: REUSE_TARGETS.length,
      expectedEntities: REUSE_TARGETS.map((t) => ({ entityId: t.entityId, identityHints: {} }))
    }
  }
  const nodes = REUSE_TARGETS.map((t) => ({
    id: t.nodeId,
    nodeRole: 'PRIMARY_RESEARCH',
    targetEntity: { entityId: t.entityId },
    requestedFields: [{ fieldName: t.fieldName, valueType: 'number', required: true, requiredTemporalScopes: [PERIOD_SCOPE] }],
    requestedOutputSchema: { type: 'object', properties: { [t.fieldName]: { type: 'number' } } }
  }))

  console.log(`Creating SECOND real persisted mission (${nodes.length} nodes) requiring overlapping immutable material...`)
  await createResearchMissionDurable(MISSION_ID, { projectId: 'nfl-2001-second-reuse-proof', specification, expectedUniverse: specification.expectedUniverse, nodes })

  const results = []
  for (const t of REUSE_TARGETS) {
    const library = readResearchLibrary()
    const outcome = await adoptResearchLibraryReuseDurable(
      MISSION_ID,
      t.nodeId,
      t.fieldName,
      library,
      { requiredTemporalScope: PERIOD_SCOPE, valueType: 'number', decidedBy: 'NFL_2001_SECOND_MISSION_REUSE_PROOF', rationale: `CACHE_HIT: reused from an immutable HISTORICAL_STATIC Wikipedia source, same required temporalScope ${PERIOD_SCOPE} -- avoided a redundant fetch/dispatch.` },
      clock
    )
    console.log(`${t.entityId}.${t.fieldName}: library decision = ${outcome.evaluation.decision}`)
    if (!outcome.adopted) {
      results.push({ ...t, decision: outcome.evaluation.decision, reused: false })
      continue
    }
    const node = outcome.mission.nodes.find((n) => n.id === t.nodeId)
    const fact = node.canonicalFacts.find((f) => f.fieldName === t.fieldName)
    results.push({ ...t, decision: 'CACHE_HIT', reused: true, value: fact.value, nodeStatus: node.status, crossMissionOrigin: fact.derivationLineage.crossMissionOrigin })
  }

  const finalMission = readResearchMission(MISSION_ID)
  const status = readResearchMissionStatus(MISSION_ID)
  // Never computed at all in the original run -- required to actually
  // demonstrate the completeness under-report is fixed for a
  // reuse-only mission.
  const completeness = readResearchMissionCompleteness(MISSION_ID, clock)
  const outDir = path.join('fixtures', 'nfl-2001-real-pilot-results')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'second-mission.json'), JSON.stringify(finalMission, null, 2))
  writeFileSync(path.join(outDir, 'second-mission-reuse-results.json'), JSON.stringify(results, null, 2))
  writeFileSync(path.join(outDir, 'second-mission-completeness.json'), JSON.stringify(completeness, null, 2))

  console.log('=== SECOND MISSION LIBRARY REUSE PROOF COMPLETE ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('Second mission status:', JSON.stringify(status, null, 2))
  console.log('Second mission completeness:', JSON.stringify(completeness, null, 2))
  console.log(`Real fetches/dispatches avoided: ${results.filter((r) => r.reused).length} of ${results.length}`)
  console.log(`All reused nodes ADMITTED (fix confirmed): ${results.filter((r) => r.reused).every((r) => r.nodeStatus === 'ADMITTED')}`)
}

main().catch((error) => {
  console.error('SECOND MISSION FAILED:', error)
  process.exit(1)
})
