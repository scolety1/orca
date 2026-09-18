// TSF Research-Driven Development V1: the ONE real gap the discovery pass
// found between ResearchMission (mature, independently tested -- state
// machine, Needs You, restart-durability, verification, learning-ledger
// wiring all already real) and Keep Going (mature, independently tested --
// dispatch/settle, resource governor, execution holds, zero-relay worker-
// ask escalation all already real): nothing bridges a completed, verified
// ResearchMission's own output into a Keep Going run's spec. This module
// is that bridge's pure half -- no I/O, no dispatch, no new state machine.
// It takes the SAME `packageBody` readResearchMissionArtifacts already
// produces (integrity-checked: a lineage-invalid CanonicalFact never
// reaches it, per research-provenance.mjs's own fail-closed boundary) and
// turns it into the SAME missionSpec shape createOvernightRun already
// accepts (domain/mission-specification.mjs) -- extending, not duplicating.
import { sha256, canonicalJson } from './canonical.mjs'
import { buildMissionSpecification } from './mission-specification.mjs'

export const RESEARCH_DRIVEN_MISSION_TYPE = 'RESEARCH_DRIVEN_DEVELOPMENT_V1'

// A node only contributes if it actually reached a real CanonicalFact --
// COMPLETED alone is not enough (a node can complete with only typed
// missingness, no canonical output at all). Never fabricates a fact from
// an incomplete/unverified node.
function groundedNodes(packageBody) {
  return (packageBody.nodes ?? []).filter((n) => (n.canonicalFacts ?? []).length > 0)
}

// SPEC_TRACEABILITY: every acceptance criterion this produces cites the
// exact CanonicalFact id it came from, and the criterion text itself
// embeds that id -- a human or a later automated check can always walk
// from "why must the build satisfy this" back to the one real, integrity-
// checked research finding that grounded it, never an invented one.
// A string fact.value is rendered as-is (this criterion is prose a human or
// a worker reads and later transcribes verbatim into a verification verdict
// -- see settled-run-reconciler.mjs's exact-match verdict gate); wrapping it
// in JSON.stringify would escape any quote characters already inside the
// fact's own text (e.g. a quoted example date), producing a criterion whose
// literal `\"` a worker naturally normalizes back to `"` when transcribing
// it, breaking that exact-match gate on a real, live-discovered run (never a
// hypothetical). Non-string values still need JSON.stringify -- there's no
// other unambiguous generic rendering for a number/boolean/object.
function renderFactValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function acceptanceCriteriaFromResearch(packageBody) {
  const criteria = []
  for (const node of groundedNodes(packageBody)) {
    for (const fact of node.canonicalFacts) {
      const entity =
        node.targetEntity?.name ?? node.targetEntity?.entityId ?? node.targetEntity?.id ?? node.id
      criteria.push(
        `[FACT:${fact.id}] ${entity} -- ${fact.fieldName}: ${renderFactValue(fact.value)}`
      )
    }
  }
  return criteria
}

// One artifactReference per contributing CanonicalFact (hashed by
// buildMissionSpecification, same as any other attachment) -- this is the
// durable, hash-verified half of traceability: the acceptance criterion
// TEXT above is a rendering; this is the actual, tamper-evident source
// record it was rendered from. Real adversarial-review finding: plain
// JSON.stringify is key-insertion-order-sensitive -- two calls building
// the SAME logical fact from differently-ordered object literals hashed
// to two different values, silently breaking "same fact, same reference"
// traceability. canonicalJson (this module's own established convention
// for anything that gets hashed) sorts keys first, so the hash depends
// only on the real content, never incidental construction order.
function researchArtifactReferences(packageBody) {
  const refs = []
  for (const node of groundedNodes(packageBody)) {
    for (const fact of node.canonicalFacts) {
      refs.push({
        name: `canonical-fact:${fact.id}`,
        type: 'RESEARCH_CANONICAL_FACT',
        extractedText: canonicalJson({ nodeId: node.id, targetEntity: node.targetEntity, fact })
      })
    }
  }
  return refs
}

// Real Codex adversarial review of the PROPOSED spec runs between research
// grounding and build (the CHALLENGE step) -- its findings, once resolved,
// become part of what the build is actually held to. `resolvedFindings`
// is the CHALLENGE step's own output after any MUST_FIX items were
// incorporated; never silently dropped.
function acceptanceCriteriaFromChallenge(resolvedFindings) {
  return (resolvedFindings ?? [])
    .filter((f) => f.severity === 'MUST_FIX')
    .map((f) => `[CHALLENGE:${f.id ?? sha256(f.summary)}] ${f.summary}`)
}

// Pure. Throws honestly (never returns a fabricated spec) if the research
// mission produced nothing grounded to build from -- a Research-Driven
// run must never start from zero real findings.
export function buildResearchDrivenMissionSpec({
  researchMissionId,
  projectId,
  researchPackageBody,
  resolvedChallengeFindings = [],
  originalGoalSummary,
  createdAt
}) {
  if (!researchMissionId?.trim()) {
    throw new Error('buildResearchDrivenMissionSpec requires researchMissionId')
  }
  const grounded = groundedNodes(researchPackageBody)
  if (grounded.length === 0) {
    throw new Error(
      `research mission ${researchMissionId} has no CanonicalFacts to build from -- refusing to start an ungrounded Research-Driven run`
    )
  }
  const researchCriteria = acceptanceCriteriaFromResearch(researchPackageBody)
  const challengeCriteria = acceptanceCriteriaFromChallenge(resolvedChallengeFindings)
  const acceptanceCriteria = [...researchCriteria, ...challengeCriteria]
  const rawDirective = [
    `Research-Driven Development V1 build, grounded in research mission ${researchMissionId}.`,
    originalGoalSummary?.trim() ? `Goal: ${originalGoalSummary.trim()}` : null,
    `Grounded in ${grounded.length} research node(s) / ${researchCriteria.length} real canonical fact(s).`,
    resolvedChallengeFindings.length > 0
      ? `Challenge review raised ${resolvedChallengeFindings.length} finding(s), ${challengeCriteria.length} MUST_FIX.`
      : 'Challenge review raised no findings.',
    'Every acceptance criterion below cites the exact research canonical fact or challenge finding it came from -- do not add unsourced requirements.'
  ]
    .filter(Boolean)
    .join(' ')
  const missionSpec = buildMissionSpecification({
    rawDirective,
    projectId,
    parentMissionType: RESEARCH_DRIVEN_MISSION_TYPE,
    acceptanceCriteria,
    artifactReferences: researchArtifactReferences(researchPackageBody),
    createdAt
  })
  return {
    ...missionSpec,
    // Additive, own-purpose field (not part of MISSION_SPECIFICATION_SCHEMA_VERSION's
    // generic shape) -- the one place a caller can find the research
    // mission this run came from without re-deriving it from
    // artifactReferences' own opaque hashes.
    researchDrivenProvenance: {
      researchMissionId,
      groundedNodeCount: grounded.length,
      researchCriteriaCount: researchCriteria.length,
      challengeFindingCount: resolvedChallengeFindings.length,
      challengeMustFixCount: challengeCriteria.length
    }
  }
}
