// TSF Owner Dogfood/Critique Loop V1, Chunk 2: reads an ENDED dogfood
// session's transcript, calls the real planner (invokeLiveStructuredAnalysis,
// same bridge command-research-spec-synthesis.mjs and wbs-generation.mjs
// reuse -- REUSE_DIRECTLY, never a second LLM-call path) to classify it
// into the owner's 10-category taxonomy with retraction-aware settled
// descriptions, then dedupes actionable observations directly into the
// REAL self-improvement finding store (recordFindingDetection) -- reusing
// its existing content-addressed dedup and downstream eligibility/
// implementation-handoff machinery rather than building a second one.
import { invokeLiveStructuredAnalysis } from './live-planner.mjs'
import { classifyDispatchAdmission } from '../domain/resource-pressure-governor.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'
import {
  DOGFOOD_SYNTHESIS_SCHEMA,
  DOGFOOD_SYNTHESIS_SCHEMA_VERSION,
  DOGFOOD_SYNTHESIS_SYSTEM_PROMPT,
  groupObservationsIntoBatches,
  isActionableObservation,
  validateDogfoodSynthesis
} from '../domain/dogfood-synthesis.mjs'
import { transitionFinding } from '../domain/self-improvement-finding.mjs'
import { recordFindingDetection, withFinding } from './self-improvement-finding-store.mjs'

function transcriptPrompt(session) {
  const ownerTurns = session.transcript.filter((t) => t.role === 'OWNER')
  const lines = ownerTurns.map((t, i) => `${i}. [${t.route ?? 'unknown route'}] ${t.content}`)
  return [
    `Dogfood session for ${session.projectId ? `project ${session.projectId}` : 'the whole product (no single project)'}, ${ownerTurns.length} owner turn(s):`,
    '',
    ...lines
  ].join('\n')
}

// Maps one actionable, validated observation into the raw shape
// self-improvement-finding.mjs's createFinding/recordFindingDetection
// requires. severity/confidence are honest, conservative defaults --
// disposition is carried separately in the dogfood synthesis result
// itself (owner-facing), not folded into this record's own fields.
function toSelfImprovementFindingRaw(observation, session) {
  return {
    sourceDetector: 'COMMAND_DOGFOOD',
    severity: observation.severity,
    projectId: session.projectId,
    affectedSurface: observation.route ?? session.projectId ?? 'UNSPECIFIED',
    evidence: {
      dogfoodSessionId: session.id,
      evidenceTurnIndexes: observation.evidenceTurnIndexes
    },
    reproduction: observation.settledDescription,
    // Conservative: the planner classified this from a rant, not a
    // verified reproduction -- a real detector confidence, not a
    // near-certain one. Downstream eligibility (self-improvement-autofix-
    // eligibility.mjs) requires >=0.7 for auto-implementation; a dogfood-
    // sourced finding starts below that on purpose, matching the same
    // discipline candidateFixScope already applies -- a real human
    // observation still gets independently verified before it can ever
    // auto-implement, never trusted at face value.
    confidence: 0.5,
    verificationMethod: 'OWNER_DOGFOOD_TRANSCRIPT_REVIEW',
    candidateFixScope:
      observation.category === 'BUG' && observation.disposition === 'SAFE_TO_IMPLEMENT'
        ? { kind: 'BOUNDED_BUG_FIX', summary: observation.settledDescription, filesHint: [] }
        : null
  }
}

// Stage 9 (implementation handoff, real entry point): a dogfood-sourced
// finding is a genuine, directly-reported human observation -- not a
// mechanical reproduction -- so it moves DETECTED -> VERIFIED with an
// explicit, distinct reason (never confused with
// self-improvement-mechanical-verification.mjs's own
// MECHANICAL_REPRODUCTION_CONFIRMED_FAILING), then straight to the REAL,
// already-existing NEEDS_OWNER status for owner review -- the correct
// existing entry point (self-improvement-finding-disposition.mjs's
// start-fix path already operates on NEEDS_OWNER/ELIGIBLE_FOR_AUTOFIX
// findings), not a new pipeline stage. Only runs for a genuinely NEW
// detection (status still DETECTED) -- a recurring detection of an
// already-VERIFIED/NEEDS_OWNER finding is left exactly where it already
// is, never re-transitioned (the status machine has no self-loop, and
// re-verifying an already-reviewed finding on every repeat rant would be
// wrong anyway).
async function verifyAndRouteToOwner(finding, disposition, clock) {
  if (finding.status !== 'DETECTED') {
    return finding
  }
  return withFinding(finding.findingId, (current) => {
    const verified = transitionFinding(
      current,
      'VERIFIED',
      { reason: 'OWNER_DOGFOOD_DIRECT_REPORT' },
      clock
    )
    return transitionFinding(
      verified,
      'NEEDS_OWNER',
      { reason: `DOGFOOD_DISPOSITION_${disposition}` },
      clock
    )
  })
}

// Resource Pressure Governor gate (same category chat-dispatch-bridge.mjs
// and command-research-spec-synthesis.mjs already gate real PLANNER_DEEP
// dispatch on -- REUSE_DIRECTLY), checked before the real heavyweight LLM
// call. Returns { ok, reason, detail?, observations?, findingIds? }.
export async function synthesizeDogfoodSession(
  session,
  { clock = () => new Date(), deps = {} } = {}
) {
  const readHostMemory = deps.collectHostMemoryEvidence ?? collectHostMemoryEvidence
  const admission = classifyDispatchAdmission(readHostMemory(), 'newHeavyweightWorkerDispatch')
  if (!admission.admitted) {
    return {
      ok: false,
      reason: 'RESOURCE_PRESSURE_REFUSED',
      detail: admission.reason,
      tier: admission.tier
    }
  }
  const ownerTurnCount = session.transcript.filter((t) => t.role === 'OWNER').length
  if (ownerTurnCount === 0) {
    return { ok: false, reason: 'NOTHING_CAPTURED' }
  }
  const invoke = deps.invokeLiveStructuredAnalysis ?? invokeLiveStructuredAnalysis
  const live = await invoke({
    systemPrompt: DOGFOOD_SYNTHESIS_SYSTEM_PROMPT,
    prompt: transcriptPrompt(session),
    jsonSchema: DOGFOOD_SYNTHESIS_SCHEMA,
    timeoutOverrideMs: 90000
  })
  if (!live.ok) {
    return { ok: false, reason: 'PLANNER_UNAVAILABLE', detail: live.reason }
  }
  if (live.data?.schemaVersion !== DOGFOOD_SYNTHESIS_SCHEMA_VERSION) {
    return { ok: false, reason: 'NEEDS_INPUT', detail: 'unexpected synthesis schema version' }
  }
  const observations = validateDogfoodSynthesis(live.data, session.transcript.length)
  if (!observations) {
    return {
      ok: false,
      reason: 'NEEDS_INPUT',
      detail: 'synthesis did not produce a structurally valid observation list'
    }
  }

  const recordDetection = deps.recordFindingDetection ?? recordFindingDetection
  const actionableObservations = []
  const findingIds = []
  for (const observation of observations) {
    if (!isActionableObservation(observation) || observation.disposition === 'DO_NOT_ACT') {
      continue
    }
    const created = await recordDetection(toSelfImprovementFindingRaw(observation, session), clock)
    const routed = await verifyAndRouteToOwner(created, observation.disposition, clock)
    findingIds.push(routed.findingId)
    actionableObservations.push(observation)
  }

  return {
    ok: true,
    observations,
    findingIds,
    batches: groupObservationsIntoBatches(actionableObservations)
  }
}
