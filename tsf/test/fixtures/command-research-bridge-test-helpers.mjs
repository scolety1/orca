// Shared fixture/helper functions for the Command <-> Dataset Research
// bridge tests (test/command-research-bridge.test.mjs and
// test/command-research-bridge-context.test.mjs) -- extracted so the
// original file's own max-lines ceiling isn't blown past 600 by an
// unrelated fix, per AGENTS.md's "genuinely reduce the file's line
// count" rule. Each caller still owns its OWN isolated TSF_UI_STATE_FILE
// (set before importing this module or server/data-store.mjs at all,
// same convention every other test file in this repo already uses) --
// this module has no state-file opinion of its own.
import { rmSync } from 'node:fs'
import { loadState, saveState } from '../../server/data-store.mjs'
import { addResearchNode, createResearchMission } from '../../domain/research-mission.mjs'
import {
  buildBoundedResearchRequest,
  markResearchNodeReady,
  recordResearchNodeDispatch,
  recordResearchNodeResult
} from '../../domain/research-node.mjs'
import { admitBoundedResearchResult } from '../../domain/research-admission.mjs'
import {
  admitReconciliationDecision,
  decideReconciliation
} from '../../domain/research-reconciliation.mjs'

export const CLOCK = () => new Date('2026-11-01T09:00:00.000Z')

export function cleanupStateFile(stateFile) {
  for (const suffix of ['', '.tmp', '.research.lock', '.research-library.lock']) {
    rmSync(`${stateFile}${suffix}`, { force: true })
  }
}

// Simulates what http-server.mjs actually does per request: load fresh
// state from disk, then call the bridge with it -- never a stale
// in-memory opState carried across turns, exactly like production.
export function freshOpState() {
  return loadState()
}

// Mirrors http-server.mjs's own real chat-save exactly (see that file's
// comment on the bounded semantic record) -- callers invoke
// respondResearchCommand directly, bypassing the HTTP layer that would
// normally persist this after every real turn.
export async function persistCommandTurn(reply) {
  const state = loadState()
  const threads = { ...state.chatThreads }
  threads.__command__ = [
    ...(threads.__command__ ?? []),
    {
      role: 'assistant',
      content: reply.text,
      at: CLOCK().toISOString(),
      decisionClass: reply.decisionClass,
      intent: reply.intent,
      resolvedProjectIds: reply.resolvedProjectIds ?? [],
      researchMissionId: reply.researchMissionId ?? null,
      scope: reply.scope
    }
  ]
  saveState({ ...state, chatThreads: threads })
}

// A caller's tests persist real __command__ chat context into the shared
// on-disk state (same pattern production uses); a test that means to
// prove the "no conversational context at all" case has to actually
// clear that, not just assume it -- otherwise it's testing leftover
// context from whatever ran before it, not the no-context case its name
// claims.
export async function clearCommandThread() {
  const state = loadState()
  saveState({ ...state, chatThreads: { ...state.chatThreads, __command__: [] } })
}

// Same reasoning as clearCommandThread: a caller's tests share one
// on-disk state, so missions from earlier tests really do accumulate --
// a test that means to prove the genuinely-zero-missions case has to
// wipe this too, or it's testing "many missions, no context" instead.
export async function clearAllResearchMissions() {
  const state = loadState()
  saveState({ ...state, researchMissions: {} }, { writerCollection: 'researchMissions' })
}

export function fieldSpec(fieldNames, { allowLibraryReuse = true } = {}) {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: 'spec:bridge-test',
    researchQuestion: 'bridge test',
    entityType: 'TEST_ENTITY',
    requestedFields: fieldNames.map((f) => ({ fieldName: f, valueType: 'number', required: true })),
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: allowLibraryReuse
    },
    temporalRequirements: { asOfDate: '2026-11-01T09:00:00.000Z', periodScope: 'test-period' },
    budget: { maxCostUsd: null, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

export function universe(entityId) {
  return {
    schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
    entityType: 'TEST_ENTITY',
    expectedCount: 1,
    expectedEntities: [{ entityId, identityHints: {} }],
    source: 'test fixture'
  }
}

// Real donor mission with a genuine, fully-reconciled CanonicalFact --
// mirrors test/research-library.test.mjs's own missionWithCanonicalFact
// helper exactly (that file's the canonical worked example for how a
// real CanonicalFact is built end to end, not something this file
// reinvents).
export function donorMissionWithCanonicalFact({
  entityId,
  fieldName,
  value,
  temporalScope = 'test-period'
}) {
  const spec = fieldSpec([fieldName])
  let mission = createResearchMission(
    {
      id: 'mission:donor',
      projectId: 'test',
      specification: spec,
      expectedUniverse: universe(entityId)
    },
    CLOCK
  )
  mission = addResearchNode(
    mission,
    {
      id: 'donor-node',
      nodeRole: 'PRIMARY_RESEARCH',
      targetEntity: { entityId },
      requestedFields: [{ fieldName, valueType: 'number', required: true }],
      requestedOutputSchema: { type: 'object' }
    },
    CLOCK
  )
  const request = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE', CLOCK)
  mission = markResearchNodeReady(mission, 'donor-node', CLOCK, mission.revision)
  const workerRunRef = {
    provider: 'FAKE',
    providerRunId: 'r1',
    dispatchedAt: CLOCK().toISOString()
  }
  mission = recordResearchNodeDispatch(
    mission,
    'donor-node',
    { taskFingerprint: request.taskFingerprint, workerRunRef },
    CLOCK,
    mission.revision
  )
  mission = recordResearchNodeResult(
    mission,
    'donor-node',
    {
      schemaVersion: 'TSF_BOUNDED_RESEARCH_RESULT_V1',
      nodeId: 'donor-node',
      taskFingerprint: request.taskFingerprint,
      provider: 'FAKE',
      providerRunRef: workerRunRef,
      status: 'SUCCEEDED',
      observations: [
        {
          rawContent: 'raw',
          extractedAt: CLOCK().toISOString(),
          providerConfidence: 0.9,
          providerReasoning: 'r'
        }
      ],
      proposedClaims: [
        {
          fieldName,
          proposedValue: value,
          temporalScope,
          providerConfidence: 0.9,
          providerReasoning: 'r'
        }
      ],
      evidence: [
        { claimFieldName: fieldName, sourceRef: 'src:1', snippet: 's', supportsClaim: true }
      ],
      sourceReferences: [
        {
          sourceRef: 'src:1',
          url: 'https://example.invalid',
          publisher: 'pub',
          retrievedAt: CLOCK().toISOString()
        }
      ],
      sourceSnapshotsOrSnapshotRefs: [
        { sourceRef: 'src:1', contentHash: 'sha256:x', rawContentRef: 'fixture://x' }
      ],
      newGapProposals: [],
      warnings: [],
      unresolvedQuestions: [],
      usage: { requestCount: 1, tokensOrUnits: 5, providerReportedCostUsd: 0 },
      failureDetails: null
    },
    CLOCK,
    mission.revision
  )
  const digest = mission.nodes[0].rawResults.at(-1).digest
  mission = admitBoundedResearchResult(mission, 'donor-node', digest, CLOCK, mission.revision)
  mission = decideReconciliation(
    mission,
    'donor-node',
    {
      fieldName,
      decisionType: 'ACCEPT_DERIVED_VALUE',
      decidedValue: value,
      temporalScope,
      rationale: 'test setup',
      decidedBy: 'TEST'
    },
    CLOCK,
    mission.revision
  )
  const decisionId = mission.nodes[0].reconciliationDecisions.at(-1).id
  mission = admitReconciliationDecision(mission, 'donor-node', decisionId, CLOCK, mission.revision)
  return { mission, canonicalFactId: mission.nodes[0].canonicalFacts[0].id }
}
