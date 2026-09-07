// REQ-002 (DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md): a generic,
// cross-mission Platform Learning Ledger. Real need: missions repeatedly
// re-discover the same platform-level lessons (source reliability, provider
// failures, identity ambiguity, completeness gaps) with nowhere durable and
// generic for that knowledge to accumulate for the NEXT mission. Reconciled
// against research-dispatch-bookkeeping.mjs's attempt ledger (per-node
// dispatch-delivery bookkeeping, not mission-level learning),
// research-library.mjs (indexes VERIFIED/canonical facts+sources for direct
// reuse, a different concern entirely), and project-memory.mjs (a real
// sibling append-only EXPERIENCE-record pattern, but scoped per-Orca-project
// for the live planner/chat surface, not cross-mission research-system
// knowledge) -- none is a real match; this is new.
//
// CRITICAL EPISTEMIC RULE, enforced structurally, not just documented: "A
// lesson is system guidance, not a canonical fact about the researched
// world." createLessonRecord has no parameter that can set epistemicKind to
// anything but the one frozen SYSTEM_GUIDANCE constant below, and a
// LessonRecord's shape has no fieldName/value/entityId -- nothing that could
// be mistaken for a Claim or CanonicalFact (research-admission.mjs /
// research-reconciliation.mjs, which this module never imports from or
// writes to). retrieveLessonGuidance stamps every returned lesson with
// advisoryOnly/neverOverridesVerifiedEvidence flags so a caller wiring
// lessons into a strategy decision sees the guard on the data itself, not
// only in a comment.
import { isoNow, sha256 } from './canonical.mjs'
import { computeCompletenessMetrics } from './research-completeness.mjs'

export const LESSON_CATEGORIES = Object.freeze([
  'PROVIDER_RELIABILITY_SIGNAL', // which acquisition mode/provider failed
  'RECURRING_DISPATCH_FAILURE', // a node that failed repeatedly before resolving
  'IDENTITY_AMBIGUITY_PATTERN', // a node whose target-entity identity was AMBIGUOUS/UNRESOLVED
  'COMPLETENESS_GAP_PATTERN', // typed-missingness reasons a mission ended with
  'SOURCE_RELIABILITY_SIGNAL', // a source linked to FAILed claim verifications
  'VERIFIED_CORRECTION_PATTERN' // a real, rationale-bearing conflict resolution
])

export const LESSON_CONFIDENCE_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH'])

// The one and only epistemicKind a LessonRecord can ever carry -- not a
// parameter, so no caller can override it.
export const LESSON_EPISTEMIC_KIND = 'SYSTEM_GUIDANCE'

// Honest confidence from real sample size -- never a flat default. A single
// occurrence is a real, worth-recording signal, but LOW confidence, not the
// same as a pattern seen 10+ times.
function confidenceForSampleSize(n) {
  if (n >= 10) {
    return 'HIGH'
  }
  if (n >= 3) {
    return 'MEDIUM'
  }
  return 'LOW'
}

function createLessonRecord({ category, statement, evidenceSummary, confidence, sourceMissionIds }, clock) {
  if (!LESSON_CATEGORIES.includes(category)) {
    throw new Error(`unknown lesson category: ${category} (must be one of ${LESSON_CATEGORIES.join(', ')})`)
  }
  if (!statement?.trim()) {
    throw new Error('a lesson requires a non-empty statement')
  }
  if (!evidenceSummary?.trim()) {
    throw new Error('a lesson requires a non-empty evidenceSummary -- system guidance must cite the real evidence it is drawn from, never asserted bare')
  }
  if (!LESSON_CONFIDENCE_LEVELS.includes(confidence)) {
    throw new Error(`unknown lesson confidence: ${confidence} (must be one of ${LESSON_CONFIDENCE_LEVELS.join(', ')})`)
  }
  if (!Array.isArray(sourceMissionIds) || sourceMissionIds.length === 0) {
    throw new Error('a lesson requires at least one sourceMissionIds entry -- it must trace back to a real mission, never invented')
  }
  const body = {
    schemaVersion: 'TSF_LESSON_RECORD_V1',
    category,
    epistemicKind: LESSON_EPISTEMIC_KIND,
    confidence,
    statement,
    evidenceSummary,
    sourceMissionIds: [...sourceMissionIds]
  }
  return { ...body, id: sha256(body), recordedAt: isoNow(clock) }
}

export function emptyPlatformLearningLedger() {
  return { schemaVersion: 'TSF_PLATFORM_LEARNING_LEDGER_V1', lessons: [] }
}

// Idempotent by id (content hash) -- re-recording the same lesson from a
// re-run extraction is a no-op, matching this codebase's established
// digest-dedupe convention.
export function addLessonRecord(ledger, input, clock) {
  const record = createLessonRecord(input, clock)
  if (ledger.lessons.some((l) => l.id === record.id)) {
    return ledger
  }
  return { ...ledger, lessons: [...ledger.lessons, record] }
}

function mergeLessonsIntoLedger(ledger, lessonRecords) {
  let next = ledger
  for (const record of lessonRecords) {
    if (next.lessons.some((l) => l.id === record.id)) {
      continue
    }
    next = { ...next, lessons: [...next.lessons, record] }
  }
  return next
}

// Bounded, advisory-only retrieval -- the ONE consumption surface a caller
// should read lessons through. Every returned entry is explicitly flagged
// so a caller biasing a strategy decision (e.g. deprioritizing a source
// class) cannot mistake it for verified, current evidence about a
// researched entity.
export function retrieveLessonGuidance(ledger, category, limit = 5) {
  if (!LESSON_CATEGORIES.includes(category)) {
    throw new Error(`unknown lesson category: ${category}`)
  }
  return (ledger?.lessons ?? [])
    .filter((l) => l.category === category)
    .slice(-limit)
    .map((l) => ({
      statement: l.statement,
      confidence: l.confidence,
      evidenceSummary: l.evidenceSummary,
      sourceMissionIds: l.sourceMissionIds,
      recordedAt: l.recordedAt,
      advisoryOnly: true,
      neverOverridesVerifiedEvidence: true
    }))
}

function latestVerificationVerdict(node, claimId) {
  const verdicts = node.verifications.filter((v) => v.claimId === claimId)
  return verdicts.length ? verdicts.at(-1).verdict : null
}

// Pure: computes real, evidenced LessonRecords from ONE completed mission's
// own durable state. Never fabricates a category with no real signal --
// each block below only emits when the underlying count is genuinely > 0.
// Requires mission.state === 'COMPLETE': a still-running mission's own
// state is not yet a settled outcome to learn from.
export function extractLessonsFromCompletedMission(mission, clock) {
  if (mission?.state !== 'COMPLETE') {
    const error = new Error(`extractLessonsFromCompletedMission requires a COMPLETE mission, got state=${mission?.state}`)
    error.code = 'TSF_LEARNING_LEDGER_MISSION_NOT_COMPLETE'
    throw error
  }
  const missionId = mission.id
  const lessons = []
  const make = (fields) => lessons.push(createLessonRecord({ ...fields, sourceMissionIds: [missionId] }, clock))

  // PROVIDER_RELIABILITY_SIGNAL -- grouped from real BoundedResearchResult
  // provider/status pairs already durably recorded on every node.
  const byProvider = new Map()
  for (const node of mission.nodes) {
    for (const raw of node.rawResults ?? []) {
      const provider = raw.result?.provider
      if (!provider) {
        continue
      }
      const entry = byProvider.get(provider) ?? { success: 0, failed: 0, total: 0 }
      entry.total += 1
      if (raw.result.status === 'FAILED') {
        entry.failed += 1
      } else {
        entry.success += 1
      }
      byProvider.set(provider, entry)
    }
  }
  for (const [provider, counts] of byProvider) {
    if (counts.failed === 0) {
      continue
    }
    make({
      category: 'PROVIDER_RELIABILITY_SIGNAL',
      statement: `Provider ${provider} failed ${counts.failed} of ${counts.total} dispatch result(s) in mission ${missionId}.`,
      evidenceSummary: `rawResults grouped by provider/status: ${JSON.stringify(counts)}`,
      confidence: confidenceForSampleSize(counts.total)
    })
  }

  // RECURRING_DISPATCH_FAILURE -- a node with 2+ FAILED raw results before
  // its execution status settled.
  const recurringNodes = mission.nodes.filter((n) => (n.rawResults ?? []).filter((r) => r.result?.status === 'FAILED').length >= 2)
  if (recurringNodes.length > 0) {
    make({
      category: 'RECURRING_DISPATCH_FAILURE',
      statement: `${recurringNodes.length} node(s) in mission ${missionId} received 2+ FAILED dispatch results before their execution status settled.`,
      evidenceSummary: `nodeIds: ${recurringNodes.map((n) => n.id).join(', ')}`,
      confidence: confidenceForSampleSize(recurringNodes.length)
    })
  }

  // IDENTITY_AMBIGUITY_PATTERN -- a real, recorded identityResolutionState.
  const ambiguousNodes = mission.nodes.filter((n) => n.identityResolutionState?.status === 'AMBIGUOUS' || n.identityResolutionState?.status === 'UNRESOLVED')
  if (ambiguousNodes.length > 0) {
    make({
      category: 'IDENTITY_AMBIGUITY_PATTERN',
      statement: `${ambiguousNodes.length} node(s) in mission ${missionId} recorded an AMBIGUOUS or UNRESOLVED target-entity identityResolutionState.`,
      evidenceSummary: `nodeIds: ${ambiguousNodes.map((n) => n.id).join(', ')}`,
      confidence: confidenceForSampleSize(ambiguousNodes.length)
    })
  }

  // COMPLETENESS_GAP_PATTERN -- reuses computeCompletenessMetrics directly
  // (REUSE_DIRECTLY), never re-derives typed-missingness breakdown.
  const completeness = computeCompletenessMetrics(mission, clock)
  if (completeness.typedMissingnessCount > 0) {
    make({
      category: 'COMPLETENESS_GAP_PATTERN',
      statement: `Mission ${missionId} ended with ${completeness.typedMissingnessCount} typed-missing field(s).`,
      evidenceSummary: `TSF_COMPLETENESS_METRICS_V1.typedMissingnessByReason: ${JSON.stringify(completeness.typedMissingnessByReason)}`,
      confidence: confidenceForSampleSize(completeness.typedMissingnessCount)
    })
  }

  // SOURCE_RELIABILITY_SIGNAL -- claims' real verification verdicts, traced
  // through their evidence to the SourceReference that supported them.
  const bySource = new Map()
  for (const node of mission.nodes) {
    for (const claim of node.claims) {
      const verdict = latestVerificationVerdict(node, claim.id)
      if (!verdict) {
        continue
      }
      const sourceIds = new Set(node.evidence.filter((e) => e.claimId === claim.id).map((e) => e.sourceReferenceId))
      for (const sid of sourceIds) {
        const source = node.sourceReferences.find((s) => s.id === sid)
        const key = source?.publisher ?? source?.url ?? source?.sourceRef ?? sid
        const entry = bySource.get(key) ?? { pass: 0, fail: 0, total: 0 }
        entry.total += 1
        if (verdict === 'FAIL') {
          entry.fail += 1
        } else if (verdict === 'PASS') {
          entry.pass += 1
        }
        bySource.set(key, entry)
      }
    }
  }
  for (const [source, counts] of bySource) {
    if (counts.fail === 0) {
      continue
    }
    make({
      category: 'SOURCE_RELIABILITY_SIGNAL',
      statement: `Source "${source}" was linked to ${counts.fail} FAILed claim verification(s) out of ${counts.total} verified claim(s) it supported, in mission ${missionId}.`,
      evidenceSummary: `verification verdicts by source: ${JSON.stringify(counts)}`,
      confidence: confidenceForSampleSize(counts.total)
    })
  }

  // VERIFIED_CORRECTION_PATTERN -- a real, rationale-bearing RESOLVE_CONFLICT
  // reconciliation decision.
  const corrections = mission.nodes.flatMap((n) => n.reconciliationDecisions.filter((d) => d.decisionType === 'RESOLVE_CONFLICT'))
  if (corrections.length > 0) {
    make({
      category: 'VERIFIED_CORRECTION_PATTERN',
      statement: `${corrections.length} field-level conflict(s) were resolved via an explicit, rationale-bearing reconciliation decision in mission ${missionId}.`,
      evidenceSummary: `reconciliationDecisionIds: ${corrections.map((d) => d.id).join(', ')}`,
      confidence: confidenceForSampleSize(corrections.length)
    })
  }

  return lessons
}

// The one real wiring entry point: extract + durably merge in one call.
// Returns the updated ledger and how many NEW lessons were actually added
// (0 is a legitimate, honest outcome for a clean mission with nothing to
// learn -- never padded).
export function recordLessonsFromCompletedMission(ledger, mission, clock) {
  const before = ledger.lessons.length
  const lessonRecords = extractLessonsFromCompletedMission(mission, clock)
  const merged = mergeLessonsIntoLedger(ledger, lessonRecords)
  return { ledger: merged, lessonsRecorded: merged.lessons.length - before }
}
