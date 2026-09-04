// HQ §22 -- non-NFL genericity proof. Runs the SAME generic engine code
// used for the real NFL 2001 pilot (server/research-mission-driver.mjs,
// unmodified) against a completely different real-world domain: public
// GitHub repository metadata. Zero lines of domain/*.mjs or server/*.mjs
// were changed to support this -- only fixtures/github-repos-genericity-
// fixture.mjs (domain-specific naming/fields) and this orchestration
// script exist, exactly mirroring how nfl-2001-real-pilot-data.mjs +
// run-nfl-2001-real-pilot.mjs relate to the NFL domain.
//
// Real, deterministic, $0 acquisition: the GitHub REST API
// (api.github.com, public, unauthenticated GET /repos/{owner}/{repo}),
// fetched live by this script at runtime -- not a pre-baked fixture. No
// paid research provider is dispatched; if the GitHub API genuinely omits
// a field for a real repo (e.g. no SPDX license id), that is recorded as
// honest typed missingness, not manufactured or paid around, per the
// "prefer $0" instruction.
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { REPOS, EXPECTED_UNIVERSE_SOURCE, FIELD_TYPES, requestedFields, requestedOutputSchema } from './fixtures/github-repos-genericity-fixture.mjs'
import { buildBoundedResearchRequest } from './domain/research-node.mjs'

const clock = () => new Date()
const MISSION_ID = 'mission:github-repos-genericity-proof'
const TEMPORAL_SCOPE = 'as-of-fetch'
const OUT_DIR = path.join('fixtures', 'github-repos-genericity-proof-results')
mkdirSync(OUT_DIR, { recursive: true })
const PROVIDER = 'DETERMINISTIC_GITHUB_API_EXTRACTION'

async function main() {
  // Isolated state file, same rationale/pattern as the NFL real pilot
  // (dynamic import AFTER the env var assignment -- ES module import
  // hoisting would otherwise silently defeat a static top-of-file import).
  process.env.TSF_UI_STATE_FILE = path.join(import.meta.dirname, 'server', '.local-state', 'operator-state.github-genericity-proof.json')
  const {
    createResearchMissionDurable,
    dispatchResearchNodeDurable,
    pollAndAdmitResearchNodeDurable,
    readResearchMissionCompleteness,
    readResearchMissionStatus,
    verifyAndReconcileResearchNodeFieldDurable
  } = await import('./server/research-mission-driver.mjs')
  const { readResearchMission } = await import('./server/research-mission-store.mjs')

  // ---- 1. Generic ResearchSpecification + ExpectedUniverse -- zero NFL concepts ----
  const specification = {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:github-repos-genericity-proof-v0',
    researchQuestion: 'What is the real, current public metadata (stars, forks, open issues, primary language, license, default branch) for each of these well-known open-source repositories?',
    entityType: 'GITHUB_REPOSITORY',
    requestedFields: Object.keys(FIELD_TYPES).map((fieldName) => ({ fieldName, valueType: FIELD_TYPES[fieldName], required: fieldName !== 'licenseSpdxId', derivationRule: null })),
    sourcePolicy: {
      preferredSources: ['api.github.com'],
      disallowedSources: [],
      licensingConstraints: ['GitHub REST API responses are factual metadata, not copyrighted content'],
      freshnessPolicy: 'LIVE_SNAPSHOT',
      requireIndependentSources: false,
      minSourceCount: 1,
      allowCrossMissionLibraryReuse: false
    },
    temporalRequirements: { asOfDate: clock().toISOString().slice(0, 10), periodScope: TEMPORAL_SCOPE },
    budget: { maxCostUsd: 0, maxLatencyMs: 30000, maxToolCallsPerNode: 1 },
    toolPermissions: ['http-source-fetch'],
    expectedUniverse: {
      schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
      entityType: 'GITHUB_REPOSITORY',
      expectedCount: REPOS.length,
      expectedEntities: REPOS.map((r) => ({ entityId: r.entityId, identityHints: { owner: r.owner, repo: r.repo } })),
      source: EXPECTED_UNIVERSE_SOURCE
    }
  }

  const nodes = REPOS.map((r) => ({
    id: `node:${r.owner}-${r.repo}`,
    nodeRole: 'PRIMARY_RESEARCH',
    targetEntity: { entityId: r.entityId, name: `${r.owner}/${r.repo}` },
    requestedFields: requestedFields(),
    requestedOutputSchema: requestedOutputSchema()
  }))

  console.log(`Creating real persisted mission with ${nodes.length} nodes (GITHUB_REPOSITORY entity type -- proves the generic engine needs zero NFL-specific changes)...`)
  await createResearchMissionDurable(MISSION_ID, { projectId: 'github-repos-genericity-proof', specification, expectedUniverse: specification.expectedUniverse, nodes })

  // ---- 2. Real, live, deterministic GitHub API acquisition (no paid research needed) ----
  let populated = 0
  let genuineGaps = 0
  for (const r of REPOS) {
    const nodeId = `node:${r.owner}-${r.repo}`
    const apiUrl = `https://api.github.com/repos/${r.owner}/${r.repo}`
    const response = await fetch(apiUrl, { headers: { 'User-Agent': 'tsf-dataset-research-engine-genericity-proof', Accept: 'application/vnd.github+json' } })
    if (!response.ok) {
      console.error(`REAL GitHub API fetch failed for ${r.owner}/${r.repo}: HTTP ${response.status}`)
      continue
    }
    const repoData = await response.json()
    const retrievedAt = clock().toISOString()
    const fieldValues = {
      stargazersCount: repoData.stargazers_count ?? null,
      forksCount: repoData.forks_count ?? null,
      openIssuesCount: repoData.open_issues_count ?? null,
      primaryLanguage: repoData.language ?? null,
      licenseSpdxId: repoData.license?.spdx_id ?? null,
      defaultBranch: repoData.default_branch ?? null
    }
    const claims = Object.entries(fieldValues).filter(([, v]) => v !== null).map(([fieldName, value]) => ({ fieldName, proposedValue: value, temporalScope: TEMPORAL_SCOPE, providerConfidence: 1.0, providerReasoning: `real GET ${apiUrl} response field` }))
    const missingClaims = Object.entries(fieldValues).filter(([, v]) => v === null).map(([fieldName]) => ({ fieldName, proposedValue: null, temporalScope: TEMPORAL_SCOPE, providerConfidence: null, providerReasoning: `GitHub API returned null/absent for this field on ${r.owner}/${r.repo} -- a real, disclosed gap, not manufactured` }))
    if (missingClaims.length > 0) { genuineGaps += missingClaims.length; console.log(`  Genuine gap on ${r.owner}/${r.repo}: ${missingClaims.map((m) => m.fieldName).join(', ')}`) }

    const result = {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId,
      taskFingerprint: null,
      provider: PROVIDER,
      providerRunRef: { provider: PROVIDER, providerRunId: `github-api-${r.owner}-${r.repo}`, dispatchedAt: retrievedAt },
      status: 'SUCCEEDED',
      observations: [{ rawContent: `Real GitHub REST API response for ${r.owner}/${r.repo}`, extractedAt: retrievedAt, providerConfidence: 1.0, providerReasoning: 'direct API field read, no interpretation' }],
      proposedClaims: [...claims, ...missingClaims],
      evidence: claims.map((c) => ({ claimFieldName: c.fieldName, sourceRef: apiUrl, snippet: `${r.owner}/${r.repo} repository metadata`, supportsClaim: true })),
      sourceReferences: [{ sourceRef: apiUrl, url: apiUrl, publisher: 'GitHub REST API', retrievedAt }],
      sourceSnapshotsOrSnapshotRefs: [],
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: null, providerReportedCostUsd: 0 },
      failureDetails: null
    }
    const missionForRequest = readResearchMission(MISSION_ID)
    const request = buildBoundedResearchRequest(missionForRequest, missionForRequest.nodes.find((n) => n.id === nodeId), PROVIDER, clock)
    result.taskFingerprint = request.taskFingerprint

    const deterministicWorker = {
      dispatch: async () => ({ ok: true, workerRunRef: result.providerRunRef }),
      fetchResult: async () => ({ ok: true, status: 'READY', result })
    }
    const dispatched = await dispatchResearchNodeDurable(MISSION_ID, nodeId, PROVIDER, deterministicWorker, clock)
    if (!dispatched.ok) { console.error(`DISPATCH FAILED for ${nodeId}:`, dispatched); continue }
    const polled = await pollAndAdmitResearchNodeDurable(MISSION_ID, nodeId, deterministicWorker, clock)
    if (!polled.ok) { console.error(`ADMIT FAILED for ${nodeId}:`, polled); continue }
    populated += 1
  }
  console.log(`Real GitHub API acquisition complete: ${populated}/${REPOS.length} repos fetched, ${genuineGaps} genuine field gap(s) (no paid research dispatched -- real spend $0.00).`)

  // ---- 3. Verify + reconcile every field on every node (same generic path) ----
  let canonicalizedCount = 0
  let escalatedCount = 0
  for (const r of REPOS) {
    const nodeId = `node:${r.owner}-${r.repo}`
    const node = readResearchMission(MISSION_ID).nodes.find((n) => n.id === nodeId)
    if (!node) continue
    const fieldNames = [...new Set(node.claims.map((c) => c.fieldName))]
    for (const fieldName of fieldNames) {
      const result = await verifyAndReconcileResearchNodeFieldDurable(MISSION_ID, nodeId, fieldName, 'GITHUB_GENERICITY_PROOF', clock)
      if (result.canonicalized) canonicalizedCount += 1
      if (result.escalated) escalatedCount += 1
    }
  }
  console.log(`Verification/reconciliation complete: ${canonicalizedCount} fields canonicalized, ${escalatedCount} escalated.`)

  // ---- 4. Final metrics + output ----
  const finalMission = readResearchMission(MISSION_ID)
  const status = readResearchMissionStatus(MISSION_ID)
  const completeness = readResearchMissionCompleteness(MISSION_ID, clock)
  writeFileSync(path.join(OUT_DIR, 'mission.json'), JSON.stringify(finalMission, null, 2))
  writeFileSync(path.join(OUT_DIR, 'status.json'), JSON.stringify(status, null, 2))
  writeFileSync(path.join(OUT_DIR, 'completeness.json'), JSON.stringify(completeness, null, 2))

  console.log('=== GITHUB REPOS GENERICITY PROOF COMPLETE ===')
  console.log('Status:', JSON.stringify(status, null, 2))
  console.log('Completeness:', JSON.stringify(completeness, null, 2))
  console.log('Real spend: $0.00 (deterministic GitHub REST API acquisition only, zero paid provider dispatch)')
}

main().catch((error) => {
  console.error('GENERICITY PROOF FAILED:', error)
  process.exit(1)
})
