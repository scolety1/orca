// REAL PILOT -- NFL Historical Base Data, 2001 season, QB/RB/WR/TE.
// Runs through the ACTUAL persisted TSF research lifecycle
// (server/research-mission-driver.mjs), never the old in-memory demo.
// Real credentials, real (bounded) provider spend, real Wikipedia-sourced
// bulk acquisition. Not a test -- an executable script, run once under
// explicit HQ authorization (REAL PILOT + ADOPTION GATE mission).
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createResearchLibrary, evaluateResearchLibraryReuse, indexCanonicalFact } from './domain/research-library.mjs'
import { recordSourceIndependenceMetadata } from './domain/research-source-independence.mjs'
import { createParallelHttpTransport } from './adapters/parallel-http-transport.mjs'
import { createParallelResearchWorker, PARALLEL_PROVIDER_ID } from './adapters/parallel-research-worker.mjs'
import { authorizeMeteredExecution } from './domain/research-cost-governance.mjs'
import { PILOT_PLAYERS, EXPECTED_UNIVERSE_SOURCE, STATS_RETRIEVED_AT, requestedFieldsForPosition, requestedOutputSchemaForPosition } from './fixtures/nfl-2001-real-pilot-data.mjs'
import { buildBoundedResearchRequest } from './domain/research-node.mjs'

const clock = () => new Date()
const MISSION_ID = 'mission:nfl-2001-real-pilot'
const PERIOD_SCOPE = '2001-regular-season'
const OUT_DIR = path.join('fixtures', 'nfl-2001-real-pilot-results')
mkdirSync(OUT_DIR, { recursive: true })

// Provider disposition: the completed bake-off (6/6 real calls, 3
// Parallel + 3 Exa, ALL succeeded) is genuinely INSUFFICIENT_EVIDENCE to
// declare a quality winner -- disclosed honestly, not invented. Using the
// safest bounded configuration: Parallel as the default for targeted
// dispatch (core processor, 4x cheaper list price: $0.025/call vs Exa's
// $0.10/call, identical observed success rate in the prior sample).
const PRICING_POLICY = { [PARALLEL_PROVIDER_ID]: { costPerRequestUsd: 0.025 } }
const MAX_APPROVED_SPEND_USD = 15.0
const MAX_TOTAL_REQUESTS = 20

const spendLedger = []
function logSpend(entry) {
  spendLedger.push({ at: clock().toISOString(), ...entry })
  console.log(`[SPEND] ${JSON.stringify(entry)}`)
}

async function main() {
  // Isolated state file -- never touches the real/live operator state file
  // (a human operator, another Claude session, or a live TSF dev server in
  // THIS worktree could have one open). Set BEFORE any dynamic import of
  // data-store.mjs-dependent modules -- a STATIC top-of-file import would
  // NOT work here: ES module import hoisting evaluates every top-level
  // `import` (in dependency order) before any other top-level statement in
  // this file runs, so an env-var assignment placed textually before a
  // static import still loses the race. Discovered live, this run: the
  // first two pilot attempts silently wrote to the REAL default
  // server/.local-state/operator-state.json instead of an isolated file
  // because of exactly this -- confirmed via Test-Path (no isolated file
  // ever existed) and by inspecting the real default file's content (nothing
  // but this pilot's own accidental writes + untouched framework defaults,
  // so no real data was lost); the default file was reset to pristine
  // afterward. Every test file in this codebase already avoids this via a
  // dynamic `await import(...)` after the env var is set -- this script
  // now follows the same, already-established, correct pattern.
  process.env.TSF_UI_STATE_FILE = path.join(import.meta.dirname, 'server', '.local-state', 'operator-state.nfl-2001-real-pilot.json')
  const {
    createResearchMissionDurable,
    dispatchResearchNodeDurable,
    pollAndAdmitResearchNodeDurable,
    readResearchMissionArtifacts,
    readResearchMissionCompleteness,
    readResearchMissionProviderUsage,
    readResearchMissionReviewItems,
    readResearchMissionStatus,
    verifyAndReconcileResearchNodeFieldDurable
  } = await import('./server/research-mission-driver.mjs')
  const { readResearchMission, withResearchMission } = await import('./server/research-mission-store.mjs')
  const { readResearchLibrary, withResearchLibrary } = await import('./server/research-library-store.mjs')

  const missingRequired = ['PARALLEL_API_KEY'].filter((k) => !process.env[k])
  if (missingRequired.length > 0) {
    console.error(`NEEDS_SECURE_PROVIDER_CREDENTIALS: ${missingRequired.join(', ')} not present in process.env`)
    process.exit(1)
  }

  // ---- 1. ResearchSpecification + ExpectedUniverse (real, independent oracle) ----
  const allFieldNames = new Set()
  for (const pos of ['QB', 'RB', 'WR', 'TE']) for (const f of requestedFieldsForPosition(pos)) allFieldNames.add(f.fieldName)
  const specification = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:nfl-2001-real-pilot-v0',
    researchQuestion: 'What were the real 2001 NFL regular-season statistics for each 2002 Pro Bowl selection at QB, RB, WR, and TE?',
    entityType: 'NFL_SKILL_POSITION_SEASON',
    requestedFields: [...allFieldNames].map((fieldName) => ({ fieldName, valueType: 'number', required: false, derivationRule: null })),
    sourcePolicy: {
      preferredSources: ['en.wikipedia.org'],
      disallowedSources: ['pro-football-reference.com'], // ToS prohibits automated access -- confirmed earlier this mission
      licensingConstraints: ['Wikipedia content is CC-BY-SA'],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 1,
      allowCrossMissionLibraryReuse: true
    },
    temporalRequirements: { asOfDate: '2002-02-01', periodScope: PERIOD_SCOPE },
    budget: { maxCostUsd: null, maxLatencyMs: 120000, maxToolCallsPerNode: 3 },
    toolPermissions: ['http-source-fetch', 'parallel-research-worker'],
    expectedUniverse: {
      schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
      entityType: 'NFL_SKILL_POSITION_SEASON',
      expectedCount: PILOT_PLAYERS.length,
      expectedEntities: PILOT_PLAYERS.map((p) => ({ entityId: p.entityId, identityHints: { team: p.team, position: p.position, name: p.name } })),
      source: EXPECTED_UNIVERSE_SOURCE
    }
  }

  const nodes = PILOT_PLAYERS.map((p) => ({
    id: `node:${p.entityId.split(':').slice(2).join(':')}`,
    nodeRole: 'PRIMARY_RESEARCH',
    targetEntity: { entityId: p.entityId, name: p.name },
    requestedFields: requestedFieldsForPosition(p.position),
    requestedOutputSchema: requestedOutputSchemaForPosition(p.position)
  }))

  console.log(`Creating real persisted mission with ${nodes.length} nodes (expected universe: 2002 Pro Bowl QB/RB/WR/TE)...`)
  await createResearchMissionDurable(MISSION_ID, { projectId: 'nfl-2001-real-pilot', specification, expectedUniverse: specification.expectedUniverse, nodes })

  // ---- 2. Research Library: consult BEFORE any acquisition ----
  await withResearchLibrary((current) => current ?? createResearchLibrary(clock))
  const cacheOutcomes = { CACHE_HIT: 0, CACHE_MISS: 0, CACHE_REJECTED_POLICY: 0, CACHE_REJECTED_TEMPORAL: 0, CACHE_REJECTED_SCHEMA: 0, CACHE_REJECTED_FRESHNESS: 0 }
  for (const p of PILOT_PLAYERS) {
    const library = readResearchLibrary()
    const evalResult = evaluateResearchLibraryReuse(library, { sourcePolicy: specification.sourcePolicy, entityId: p.entityId, fieldName: 'receivingYards', requiredTemporalScope: PERIOD_SCOPE, valueType: 'number' })
    cacheOutcomes[evalResult.decision] = (cacheOutcomes[evalResult.decision] ?? 0) + 1
  }
  console.log('Library lookups before acquisition (a first-ever pilot -- all expected CACHE_MISS):', cacheOutcomes)

  // ---- 3. Bulk deterministic acquisition (Wikipedia, real, already fetched this session) ----
  const gapEntities = []
  for (const p of PILOT_PLAYERS) {
    const nodeId = `node:${p.entityId.split(':').slice(2).join(':')}`
    if (!p.stats) {
      gapEntities.push(p)
      continue
    }
    const sourceUrl = `https://en.wikipedia.org/wiki/${p.wikiTitle}`
    const claims = Object.entries(p.stats)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([fieldName, value]) => ({ fieldName, proposedValue: value, temporalScope: PERIOD_SCOPE, providerConfidence: 0.85, providerReasoning: `deterministic extraction from ${p.name}'s Wikipedia career-statistics table, 2001 season row` }))
    const missingClaims = Object.entries(p.stats).filter(([, v]) => v === null).map(([fieldName]) => ({ fieldName, proposedValue: null, temporalScope: PERIOD_SCOPE, providerConfidence: null, providerReasoning: 'not confidently extracted from the Wikipedia stats table for this player' }))
    const result = {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId,
      taskFingerprint: null, // set below via request
      provider: 'DETERMINISTIC_WIKIPEDIA_EXTRACTION',
      providerRunRef: { provider: 'DETERMINISTIC_WIKIPEDIA_EXTRACTION', providerRunId: `wiki-${p.entityId}`, dispatchedAt: STATS_RETRIEVED_AT },
      status: 'SUCCEEDED',
      observations: [{ rawContent: `${p.name} (${p.team}, ${p.position}) 2001 season career-statistics table row, fetched from ${sourceUrl}`, extractedAt: STATS_RETRIEVED_AT, providerConfidence: 0.85, providerReasoning: 'real Wikipedia career-statistics table' }],
      proposedClaims: [...claims, ...missingClaims],
      evidence: claims.map((c) => ({ claimFieldName: c.fieldName, sourceRef: sourceUrl, snippet: `${p.name} 2001 season row`, supportsClaim: true })),
      sourceReferences: [{ sourceRef: sourceUrl, url: sourceUrl, publisher: 'Wikipedia', retrievedAt: STATS_RETRIEVED_AT }],
      sourceSnapshotsOrSnapshotRefs: [],
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: null, providerReportedCostUsd: 0 },
      failureDetails: null
    }
    // The REAL taskFingerprint dispatchResearchNodeDurable will compute
    // internally (via buildBoundedResearchRequest, the same call it makes)
    // -- computed here identically so the canned result this deterministic
    // worker returns carries the SAME fingerprint the dispatch actually
    // used, keeping the durable bookkeeping honest rather than inventing a
    // second, unrelated one.
    const missionForRequest = readResearchMission(MISSION_ID)
    const request = buildBoundedResearchRequest(missionForRequest, missionForRequest.nodes.find((n) => n.id === nodeId), 'DETERMINISTIC_WIKIPEDIA_EXTRACTION', clock)
    result.taskFingerprint = request.taskFingerprint

    const deterministicWorker = {
      dispatch: async () => ({ ok: true, workerRunRef: result.providerRunRef }),
      fetchResult: async () => ({ ok: true, status: 'READY', result })
    }
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, nodeId, 'DETERMINISTIC_WIKIPEDIA_EXTRACTION', deterministicWorker, clock)
    if (!dispatched.ok) { console.error(`DISPATCH FAILED for ${nodeId}:`, dispatched); continue }
    const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, nodeId, deterministicWorker, clock)
    if (!polled.ok) { console.error(`ADMIT FAILED for ${nodeId}:`, polled); continue }
  }
  console.log(`Bulk deterministic acquisition complete: ${PILOT_PLAYERS.length - gapEntities.length} entities populated from Wikipedia, ${gapEntities.length} genuine gap(s): ${gapEntities.map((g) => g.name).join(', ')}`)

  // ---- 4. Genuine gaps -> real, targeted, governed paid research ----
  const parallelTransport = createParallelHttpTransport({ apiKey: process.env.PARALLEL_API_KEY })
  const parallelWorker = createParallelResearchWorker({ transport: parallelTransport, clock })
  let totalDispatched = 0
  let cumulativeSpendUsd = 0
  for (const p of gapEntities) {
    const nodeId = `node:${p.entityId.split(':').slice(2).join(':')}`
    const decision = authorizeMeteredExecution({ providerId: PARALLEL_PROVIDER_ID, pricingPolicy: PRICING_POLICY, plannedRequestCount: totalDispatched + 1, maxApprovedSpendUsd: MAX_APPROVED_SPEND_USD }, clock)
    logSpend({ purpose: `targeted gap research: ${p.name} 2001 passing stats`, provider: 'PARALLEL', tier: 'core', projectedPriceUsd: PRICING_POLICY[PARALLEL_PROVIDER_ID].costPerRequestUsd, remainingBudgetUsd: MAX_APPROVED_SPEND_USD - cumulativeSpendUsd, classification: 'PLANNED_RESEARCH' })
    if (!decision.authorized || totalDispatched >= MAX_TOTAL_REQUESTS) {
      console.error(`COST GATE REFUSED dispatch for ${nodeId}:`, decision)
      continue
    }
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, nodeId, PARALLEL_PROVIDER_ID, parallelWorker, clock, { costGovernance: { pricingPolicy: PRICING_POLICY, maxApprovedSpendUsd: MAX_APPROVED_SPEND_USD } })
    if (!dispatched.ok) { console.error(`REAL DISPATCH FAILED for ${nodeId}:`, dispatched); continue }
    totalDispatched += 1
    cumulativeSpendUsd += PRICING_POLICY[PARALLEL_PROVIDER_ID].costPerRequestUsd
    let polled = { ok: true, ready: false }
    for (let i = 0; i < 30 && !polled.ready; i += 1) {
      polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, nodeId, parallelWorker, clock)
      if (!polled.ready) await new Promise((r) => setTimeout(r, 2000))
    }
    logSpend({ purpose: `targeted gap research result: ${p.name}`, provider: 'PARALLEL', ok: polled.ok, ready: polled.ready, actualBilledCostUsd: 'unknown (Parallel reports no usage cost)', listPriceCostUsd: PRICING_POLICY[PARALLEL_PROVIDER_ID].costPerRequestUsd, classification: 'PLANNED_RESEARCH' })
  }

  // ---- 5. Verify + reconcile every field on every node ----
  let escalatedCount = 0
  let canonicalizedCount = 0
  for (const p of PILOT_PLAYERS) {
    const nodeId = `node:${p.entityId.split(':').slice(2).join(':')}`
    const node = readResearchMission(MISSION_ID).nodes.find((n) => n.id === nodeId)
    if (!node) continue
    const fieldNames = [...new Set(node.claims.map((c) => c.fieldName))]
    for (const fieldName of fieldNames) {
      const result = await verifyAndReconcileResearchNodeFieldDurable(MISSION_ID, nodeId, fieldName, 'NFL_2001_REAL_PILOT', clock)
      if (result.escalated) escalatedCount += 1
      if (result.canonicalized) canonicalizedCount += 1
    }
  }
  console.log(`Verification/reconciliation complete: ${canonicalizedCount} fields canonicalized, ${escalatedCount} escalated to Needs You.`)

  // ---- 6. Source independence: record what we actually know ----
  // Every deterministic-acquisition claim in this pilot has exactly ONE
  // cited source (Wikipedia) -- honestly UNKNOWN independence beyond that
  // single citation unless a second, real, disagreeing/agreeing source
  // was also consulted (true for the two real-dispatch gap resolutions,
  // recorded below once their sources are known).
  //
  // Bounded-defect fix (independent-verification finding on the first real
  // run): this matched only the literal publisher string 'Wikipedia',
  // which is what the synthetic deterministic-acquisition worker sets --
  // but the REAL Parallel worker's own citation extraction returns the
  // page title instead (e.g. "Tom Brady - Wikipedia"), so the two real
  // paid-research sources (Brady, Favre) were silently left unclassified.
  // Both are genuinely the same source type (en.wikipedia.org); matched by
  // URL domain now, which is robust to either provider's publisher-string
  // formatting.
  const isWikipediaSource = (src) => /(^|\.)wikipedia\.org(\/|$)/i.test(src.url ?? '')
  for (const p of PILOT_PLAYERS) {
    const nodeId = `node:${p.entityId.split(':').slice(2).join(':')}`
    const node = readResearchMission(MISSION_ID).nodes.find((n) => n.id === nodeId)
    if (!node) continue
    for (const src of node.sourceReferences) {
      if (isWikipediaSource(src)) {
        await withResearchMission(MISSION_ID, (m) => recordSourceIndependenceMetadata(m, nodeId, src.id, { sourceQualityClass: 'AGGREGATOR', independenceState: 'UNKNOWN' }, clock, m.revision))
      }
    }
  }

  // ---- 7. Index every real CanonicalFact into the library ----
  let indexedCount = 0
  for (const p of PILOT_PLAYERS) {
    const nodeId = `node:${p.entityId.split(':').slice(2).join(':')}`
    const node = readResearchMission(MISSION_ID).nodes.find((n) => n.id === nodeId)
    if (!node) continue
    for (const fact of node.canonicalFacts) {
      await withResearchLibrary((current) => indexCanonicalFact(current, readResearchMission(MISSION_ID), nodeId, fact.id, clock, current.revision))
      indexedCount += 1
    }
  }
  console.log(`Indexed ${indexedCount} real CanonicalFacts into the research library.`)

  // ---- 8. Final metrics + output package ----
  const finalMission = readResearchMission(MISSION_ID)
  const status = readResearchMissionStatus(MISSION_ID)
  const completeness = readResearchMissionCompleteness(MISSION_ID, clock)
  const reviewItems = readResearchMissionReviewItems(MISSION_ID)
  const artifacts = readResearchMissionArtifacts(MISSION_ID, clock)
  const usage = readResearchMissionProviderUsage(MISSION_ID)

  writeFileSync(path.join(OUT_DIR, 'mission.json'), JSON.stringify(finalMission, null, 2))
  writeFileSync(path.join(OUT_DIR, 'status.json'), JSON.stringify(status, null, 2))
  writeFileSync(path.join(OUT_DIR, 'completeness.json'), JSON.stringify(completeness, null, 2))
  writeFileSync(path.join(OUT_DIR, 'review-items.json'), JSON.stringify(reviewItems, null, 2))
  writeFileSync(path.join(OUT_DIR, 'provenance-package.json'), JSON.stringify(artifacts, null, 2))
  writeFileSync(path.join(OUT_DIR, 'provider-usage.json'), JSON.stringify(usage, null, 2))
  writeFileSync(path.join(OUT_DIR, 'spend-ledger.json'), JSON.stringify(spendLedger, null, 2))
  writeFileSync(path.join(OUT_DIR, 'cache-outcomes.json'), JSON.stringify(cacheOutcomes, null, 2))

  console.log('=== REAL PILOT COMPLETE ===')
  console.log('Status:', JSON.stringify(status, null, 2))
  console.log('Completeness:', JSON.stringify(completeness, null, 2))
  console.log('Provider usage:', JSON.stringify(usage, null, 2))
  console.log(`Total real paid dispatches: ${totalDispatched}, cumulative list-price spend: $${cumulativeSpendUsd.toFixed(3)}`)
}

main().catch((error) => {
  console.error('REAL PILOT FAILED:', error)
  process.exit(1)
})
