// Phase 13: turns each TSF_RESEARCH_GOLDEN_PATH_EVAL case into a real
// actual output by ACTUALLY driving the real production research pipeline
// -- never a hand-inlined stand-in. Only the two provider boundaries are
// dependency-injected (a deterministic fake worker, and the real
// llm-latent-knowledge-research-worker.mjs's own established
// invokeLiveStructuredAnalysisFn seam -- never a live paid call). Dispatch,
// admission, conflict detection, reconciliation, the real autonomous
// driver (driveOneCycle), the durable Research Library store, and the
// real Learning Ledger are all real, unmodified production code.
//
// Both pack cases are proven from ONE real mission build (buildScenario,
// below) -- cheap and correct, since re-running the whole mission twice
// would duplicate work without adding signal; the two case ids simply read
// different facts off the same real run.
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import {
  createLlmLatentKnowledgeResearchWorker,
  LLM_LATENT_KNOWLEDGE_PROVIDER_ID
} from '../adapters/llm-latent-knowledge-research-worker.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'
import { resolveResearchNeedsYou } from '../domain/research-mission.mjs'
import { admitReconciliationDecision, decideReconciliation } from '../domain/research-reconciliation.mjs'
import { createResearchLibrary, evaluateResearchLibraryReuse, indexCanonicalFact } from '../domain/research-library.mjs'
import {
  createResearchMissionDurable,
  dispatchResearchNodeDurable,
  pollAndAdmitResearchNodeDurable,
  readResearchMissionReviewItems,
  verifyAndReconcileResearchNodeFieldDurable
} from './research-mission-driver.mjs'
import { readResearchMission, withResearchMission } from './research-mission-store.mjs'
import { withResearchLibrary, readResearchLibrary } from './research-library-store.mjs'
import { driveOneCycle } from './research-mission-fleet-driver.mjs'
import { readPlatformLearningLedger } from './platform-learning-ledger-store.mjs'

const FAKE_PROVIDER_ID = 'GOLDEN_PATH_FIXTURE_PROVIDER'
const NODE_ID = 'node:golden-path-fixture-entity'
const FIELD_NAME = 'yards'
const FAKE_VALUE = 2843
const DEFAULT_LLM_VALUE = 2900
// Both providers' claims must share the SAME temporalScope for
// detectResearchConflicts (research-verification.mjs) to group them
// together at all -- it buckets by (fieldName, temporalScope) and two
// claims in different buckets can never conflict, no matter how much their
// values disagree. The LLM worker itself always derives its claim's
// temporalScope from request.temporalRequirements.periodScope (never
// null when the mission declares one), so the fake worker's script below
// must use the exact same value, not an unscoped null.
const PERIOD_SCOPE = 'GOLDEN_PATH_FIXTURE_PERIOD'

// Every scenario build gets its own missionId AND entityId -- the Research
// Library is a real, singleton, cross-mission durable store, so reusing a
// fixed entityId across builds (a fixed clock() value, or multiple builds
// in one process for baseline-vs-regressed comparison) would make a LATER
// build's "genuine CACHE_MISS before indexing" proof vacuously false from
// a prior build's leftover entry, not from this build's own real behavior.
let scenarioCounter = 0
function nextScenarioId() {
  scenarioCounter += 1
  return `${Date.now()}-${process.pid}-${scenarioCounter}`
}

function specificationFor(missionId) {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${missionId}`,
    researchQuestion: 'Golden-path fixture: a single field, dispatched to two real, different provider adapters.',
    entityType: 'GOLDEN_PATH_FIXTURE',
    requestedFields: [{ fieldName: FIELD_NAME, valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: {
      preferredSources: [],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 0,
      allowCrossMissionLibraryReuse: true
    },
    temporalRequirements: { asOfDate: '2026-09-08', periodScope: PERIOD_SCOPE },
    budget: { maxCostUsd: 0, maxLatencyMs: null, maxToolCallsPerNode: null },
    toolPermissions: []
  }
}

// The real llm-latent-knowledge-research-worker.mjs, with only its own
// established test seam (invokeLiveStructuredAnalysisFn) overridden --
// never a live provider call. llmValue defaults to a genuinely DIFFERENT
// value than the fake worker below, so the mission has a real conflict to
// reconcile, not a contrived always-agreeing pair; the dedicated
// break-it-and-confirm-it-catches regression test overrides it to the SAME
// value as the fake worker, modeling a real "two providers silently agree
// when they shouldn't" defect.
function makeLlmLatentKnowledgeWorker(clock, llmValue) {
  return createLlmLatentKnowledgeResearchWorker({
    clock,
    invokeLiveStructuredAnalysisFn: async () => ({
      ok: true,
      data: {
        answers: [
          {
            fieldName: FIELD_NAME,
            status: 'KNOWN',
            value: llmValue,
            confidence: 0.5,
            reasoning: 'golden-path fixture: recalled from latent knowledge',
            rememberedSourceContext: null
          }
        ]
      },
      providerId: LLM_LATENT_KNOWLEDGE_PROVIDER_ID,
      agentId: null,
      model: 'golden-path-fixture-model',
      role: 'PLANNER_DEEP',
      costUsd: 0
    })
  })
}

// Builds and drives ONE real mission through both provider adapters, a
// genuine conflict, reconciliation, and real driveOneCycle completion.
// TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED is a process-wide env var
// this worker reads at call time (never cached at import time), so it's
// safe to toggle around just this call and restore, matching this
// codebase's own established save/restore convention for such toggles.
export async function buildResearchGoldenPathScenario(clock, { llmValue = DEFAULT_LLM_VALUE } = {}) {
  const scenarioId = nextScenarioId()
  const missionId = `mission:golden-path-fixture-${scenarioId}`
  const entityId = `golden-path:fixture-entity-${scenarioId}`
  const script = new Map()
  const fakeWorker = createDeterministicFakeResearchWorker({ provider: FAKE_PROVIDER_ID, clock, script })

  await createResearchMissionDurable(
    missionId,
    {
      projectId: 'golden-path-fixture-project',
      specification: specificationFor(missionId),
      expectedUniverse: {
        schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1',
        entityType: 'GOLDEN_PATH_FIXTURE',
        expectedCount: 1,
        expectedEntities: [{ entityId, identityHints: {} }]
      },
      nodes: [
        {
          id: NODE_ID,
          nodeRole: 'PRIMARY_RESEARCH',
          targetEntity: { entityId, name: 'Golden Path Fixture Entity' },
          requestedFields: [{ fieldName: FIELD_NAME, valueType: 'number', required: true }],
          requestedOutputSchema: { type: 'object', properties: { [FIELD_NAME]: { type: 'number' } } }
        }
      ]
    },
    clock
  )

  // Provider 1: a deterministic fake worker (the same seam every other
  // research test uses for the $0 acquisition boundary).
  const missionBeforeReq = readResearchMission(missionId)
  const req = buildBoundedResearchRequest(missionBeforeReq, missionBeforeReq.nodes[0], FAKE_PROVIDER_ID, clock)
  script.set(req.taskFingerprint, {
    proposedClaims: [{ fieldName: FIELD_NAME, proposedValue: FAKE_VALUE, temporalScope: PERIOD_SCOPE, providerConfidence: 0.9, providerReasoning: 'golden-path fixture: primary source' }],
    evidence: [{ claimFieldName: FIELD_NAME, sourceRef: 'src:golden-path-fixture', snippet: 'fixture evidence', supportsClaim: true }],
    sourceReferences: [{ sourceRef: 'src:golden-path-fixture', url: 'https://example.invalid/golden-path', publisher: 'golden-path-fixture-publisher', retrievedAt: clock().toISOString() }],
    sourceSnapshotsOrSnapshotRefs: []
  })
  const dispatch1 = await dispatchResearchNodeDurable(missionId, NODE_ID, FAKE_PROVIDER_ID, fakeWorker, clock)
  const poll1 = await pollAndAdmitResearchNodeDurable(missionId, NODE_ID, fakeWorker, clock)

  // Provider 2: the real llm-latent-knowledge-research-worker.mjs -- the
  // capability with solid unit tests but, until this pack, zero coverage
  // inside a real, composed, multi-provider ResearchMission.
  const priorLatentEnv = process.env.TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED
  process.env.TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED = '1'
  let dispatch2
  let poll2
  try {
    const llmWorker = makeLlmLatentKnowledgeWorker(clock, llmValue)
    dispatch2 = await dispatchResearchNodeDurable(missionId, NODE_ID, LLM_LATENT_KNOWLEDGE_PROVIDER_ID, llmWorker, clock)
    poll2 = await pollAndAdmitResearchNodeDurable(missionId, NODE_ID, llmWorker, clock)
  } finally {
    if (priorLatentEnv === undefined) {
      delete process.env.TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED
    } else {
      process.env.TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED = priorLatentEnv
    }
  }

  // Two disagreeing claims for the same field, from two real different
  // providers, must escalate -- never be silently auto-resolved.
  const verify = await verifyAndReconcileResearchNodeFieldDurable(missionId, NODE_ID, FIELD_NAME, 'GOLDEN_PATH_EVAL', clock)

  // A human/operator-equivalent decision picks the fake worker's grounded,
  // cited value over the ungrounded latent-recall one -- a real,
  // rationale-bearing RESOLVE_CONFLICT decision, exactly the shape
  // VERIFIED_CORRECTION_PATTERN (platform-learning-ledger.mjs) looks for.
  const afterVerify = readResearchMission(missionId)
  const node = afterVerify.nodes.find((n) => n.id === NODE_ID)
  const conflict = node.conflicts.find((c) => c.fieldName === FIELD_NAME && c.status === 'OPEN')
  const winningClaim = node.claims.find((c) => conflict?.conflictingClaimIds.includes(c.id) && c.proposedValue === FAKE_VALUE)
  let resolved = afterVerify
  if (conflict && winningClaim) {
    // The escalation above also raised a real Needs You entry -- resolving
    // it (never silently left open) is what returns the mission to ACTIVE
    // so the real autonomous driver can pick it back up, exactly mirroring
    // research-e2e-normal-mission.test.mjs's own step 9 ordering.
    const openItem = readResearchMissionReviewItems(missionId).find((i) => i.nodeId === NODE_ID)
    if (openItem) {
      await withResearchMission(missionId, (m) =>
        resolveResearchNeedsYou(m, openItem.id, 'golden-path fixture: resolved by GOLDEN_PATH_EVAL', clock, m.revision)
      )
    }
    resolved = await withResearchMission(missionId, (m) =>
      decideReconciliation(
        m,
        NODE_ID,
        {
          fieldName: FIELD_NAME,
          decisionType: 'RESOLVE_CONFLICT',
          conflictId: conflict.id,
          selectedClaimId: winningClaim.id,
          consideredClaimIds: conflict.conflictingClaimIds,
          decidedValue: FAKE_VALUE,
          temporalScope: PERIOD_SCOPE,
          rationale: 'golden-path fixture: the grounded, cited fake-worker claim is preferred over the ungrounded latent-recall claim',
          decidedBy: 'GOLDEN_PATH_EVAL'
        },
        clock,
        m.revision
      )
    )
    const decisionId = resolved.nodes.find((n) => n.id === NODE_ID).reconciliationDecisions.at(-1).id
    resolved = await withResearchMission(missionId, (m) => admitReconciliationDecision(m, NODE_ID, decisionId, clock, m.revision))
  }

  // Real durable-store CACHE_MISS proof, taken BEFORE any indexing --
  // guards against a vacuously-true CACHE_HIT later (e.g. a prior run's
  // leftover state, or a bug that always reports a hit).
  await withResearchLibrary((current) => current ?? createResearchLibrary(clock))
  const libraryBeforeIndexing = readResearchLibrary()
  const missBefore = evaluateResearchLibraryReuse(libraryBeforeIndexing, {
    sourcePolicy: specificationFor(missionId).sourcePolicy,
    entityId,
    fieldName: FIELD_NAME,
    valueType: 'number'
  })

  // Drive to real COMPLETE through the real autonomous driver -- never a
  // hand-inlined completeResearchMission call.
  let finalTickResult = null
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- autonomous driver ticks are inherently sequential
    const [result] = await driveOneCycle([missionId], clock, {})
    finalTickResult = result
    if (result.action === 'COMPLETED' || result.action === 'ESCALATED') {
      break
    }
  }

  const completedMission = readResearchMission(missionId)
  const canonicalFact = completedMission.nodes
    .find((n) => n.id === NODE_ID)
    ?.canonicalFacts.find((f) => f.fieldName === FIELD_NAME)

  // The real production write this pack proves is missing from the
  // autonomous driver: nothing else in this process indexes a completed
  // mission's facts into the durable Research Library, so this pack
  // performs the same real, explicit call a real operator/automation would
  // have to make -- proving the durable write/read-back genuinely works,
  // not merely that it theoretically could.
  let hitAfter = null
  if (canonicalFact) {
    await withResearchLibrary((current) =>
      indexCanonicalFact(current, completedMission, NODE_ID, canonicalFact.id, clock, current.revision)
    )
    hitAfter = evaluateResearchLibraryReuse(readResearchLibrary(), {
      sourcePolicy: specificationFor(missionId).sourcePolicy,
      entityId,
      fieldName: FIELD_NAME,
      valueType: 'number'
    })
  }

  const ledger = readPlatformLearningLedger()
  const correctionLesson = ledger?.lessons?.find(
    (l) => l.category === 'VERIFIED_CORRECTION_PATTERN' && l.sourceMissionIds.includes(missionId)
  )

  return {
    dispatch1,
    poll1,
    dispatch2,
    poll2,
    verify,
    conflict,
    resolvedNode: resolved.nodes.find((n) => n.id === NODE_ID),
    finalTickResult,
    completedMission,
    canonicalFact,
    missBefore,
    hitAfter,
    correctionLesson
  }
}

function caseOutputFor(kind, scenario) {
  if (kind === 'CROSS_PROVIDER_CONFLICT_TO_COMPLETE') {
    return {
      twoDistinctProvidersRealDispatched: scenario.dispatch1?.ok === true && scenario.dispatch2?.ok === true,
      genuineConflictWasEscalated: scenario.verify?.escalated === true,
      reconciliationProducedCorrectCanonicalFact: scenario.canonicalFact?.value === FAKE_VALUE,
      missionReachedRealCompleteViaAutonomousDriver:
        scenario.finalTickResult?.action === 'COMPLETED' && scenario.completedMission?.state === 'COMPLETE'
    }
  }
  if (kind === 'DURABLE_LIBRARY_AND_LEDGER_PROOF') {
    return {
      libraryCacheMissBeforeIndexing: scenario.missBefore?.decision === 'CACHE_MISS',
      libraryCacheHitAfterDurableIndexing: scenario.hitAfter?.decision === 'CACHE_HIT',
      indexedValueMatchesReconciledCanonicalFact: scenario.hitAfter?.hit?.value === FAKE_VALUE,
      learningLedgerRecordedARealCorrectionLessonForThisMission: Boolean(scenario.correctionLesson)
    }
  }
  throw new Error(`unknown research golden path eval case input kind: ${kind}`)
}

export async function runResearchGoldenPathEvalCase(evalCase, clock = () => new Date()) {
  const scenario = await buildResearchGoldenPathScenario(clock, { llmValue: evalCase.input.llmValue })
  return caseOutputFor(evalCase.input.kind, scenario)
}

export async function runResearchGoldenPathEvalPack(pack, clock = () => new Date()) {
  // One real scenario shared by both cases (efficient and correct: every
  // scenario is already uniquely id'd, so it's also safe to build a
  // separate one per case, which the dedicated regression test does).
  const scenario = await buildResearchGoldenPathScenario(clock)
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = caseOutputFor(evalCase.input.kind, scenario)
  }
  return actualOutputsByCaseId
}
