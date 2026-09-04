// Re-fetches the 3 already-completed Exa runs from the live bake-off (GET
// only -- zero additional cost, no new dispatch) and reprocesses them
// through the FIXED parseCompletedRun, replacing the buggy captured
// mission's Exa claims/evidence in place. Then rebuilds the full
// admission/verification/conflict pipeline from scratch on a fresh
// mission so the corrected results are genuinely re-admitted through the
// real domain functions, not hand-patched.
import { readFileSync, writeFileSync } from 'node:fs'
import { createExaHttpTransport } from './adapters/exa-http-transport.mjs'
import { parseCompletedRun } from './adapters/exa-research-worker.mjs'
import { buildNflQb2001Mission } from './fixtures/nfl-2001-qb-research-fixture.mjs'
import { buildBoundedResearchRequest, markResearchNodeReady, recordResearchNodeDispatch, recordResearchNodeResult } from './domain/research-node.mjs'
import { admitBoundedResearchResult } from './domain/research-admission.mjs'
import { detectResearchConflicts, verifyResearchClaim } from './domain/research-verification.mjs'

const clock = () => new Date('2026-09-03T10:00:00.000Z')
const callLog = JSON.parse(readFileSync('fixtures/captured-bakeoff-results/call-log.json', 'utf8'))
const oldMission = JSON.parse(readFileSync('fixtures/captured-bakeoff-results/mission.json', 'utf8'))

const transport = createExaHttpTransport({ apiKey: process.env.EXA_API_KEY })
let mission = buildNflQb2001Mission(clock)

for (const node of oldMission.nodes) {
  // --- PARALLEL: replay the durably-captured result verbatim (no re-fetch needed, already correctly parsed) ---
  const parallelEntry = callLog.find((e) => e.nodeId === node.id && e.providerId === 'PARALLEL')
  const parallelRawResult = node.rawResults.find((r) => r.result.provider === 'PARALLEL')?.result
  mission = markResearchNodeReady(mission, node.id, clock, mission.revision)
  const parallelRequest = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === node.id), 'PARALLEL', clock)
  mission = recordResearchNodeDispatch(mission, node.id, { taskFingerprint: parallelRequest.taskFingerprint, workerRunRef: parallelEntry.workerRunRef }, clock, mission.revision)
  mission = recordResearchNodeResult(mission, node.id, { ...parallelRawResult, taskFingerprint: parallelRequest.taskFingerprint }, clock, mission.revision)
  let digest = mission.nodes.find((n) => n.id === node.id).rawResults.at(-1).digest
  mission = admitBoundedResearchResult(mission, node.id, digest, clock, mission.revision)

  // --- EXA: re-fetch by run id (GET only, $0) and reprocess through the fixed parser ---
  const exaEntry = callLog.find((e) => e.nodeId === node.id && e.providerId === 'EXA')
  const rawRun = await transport.getAgentRun(exaEntry.workerRunRef.providerRunId)
  mission = markResearchNodeReady(mission, node.id, clock, mission.revision)
  const exaRequest = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === node.id), 'EXA', clock)
  const reparsed = parseCompletedRun(exaRequest, rawRun)
  mission = recordResearchNodeDispatch(mission, node.id, { taskFingerprint: exaRequest.taskFingerprint, workerRunRef: exaEntry.workerRunRef }, clock, mission.revision)
  mission = recordResearchNodeResult(mission, node.id, reparsed, clock, mission.revision)
  digest = mission.nodes.find((n) => n.id === node.id).rawResults.at(-1).digest
  mission = admitBoundedResearchResult(mission, node.id, digest, clock, mission.revision)
}

for (const node of mission.nodes) mission = detectResearchConflicts(mission, node.id, clock, mission.revision)
for (const node of mission.nodes) {
  for (const claim of [...node.claims]) mission = verifyResearchClaim(mission, node.id, claim.id, clock, mission.revision)
}

writeFileSync('fixtures/captured-bakeoff-results/mission.json', JSON.stringify(mission, null, 2))
console.log('Reprocessed. Nodes:', mission.nodes.map((n) => ({ id: n.id, claims: n.claims.length, evidence: n.evidence.length, conflicts: n.conflicts.length })))
