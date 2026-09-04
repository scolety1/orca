// Trust + Scale Hardening (Phase 7, V0): durable cross-mission research
// library. A separate durable index over already-canonicalized facts from
// EVERY mission, keyed by (entityId, fieldName, temporalScope), so a NEW
// mission researching the same real-world entity does not blindly re-pay a
// real provider to re-discover a fact TSF already established elsewhere.
//
// GOVERNANCE BOUNDARY (deliberate, narrow V0 scope): this module is
// strictly ADVISORY. Indexing a CanonicalFact here never creates a second
// canonicalization authority and never lets one mission's decision bind
// another's -- querying the library returns candidate facts for a human or
// the calling mission to consider, nothing more. Actually ADOPTING a
// library hit into a new mission still requires that mission's own,
// explicit ReconciliationDecision (via decideLibraryReferenceReconciliation
// below, a thin wrapper around research-reconciliation.mjs's existing
// ACCEPT_DERIVED_VALUE path -- no new decisionType, no new CanonicalFact
// construction path is introduced; admitReconciliationDecision remains the
// ONLY function that may ever create a CanonicalFact). A stale or wrong
// library entry can therefore never silently become canonical anywhere --
// every reuse is its own fully-audited decision, with the cross-mission
// origin preserved in derivationLineage rather than hidden.
import { canonicalize, deepClone, isoNow, sha256 } from './canonical.mjs'
import { assertSourcePolicyAllows } from './research-admission.mjs'
import { assertNodeTransition, withResearchNode } from './research-mission.mjs'
import { decideReconciliation } from './research-reconciliation.mjs'

function assertLibraryRevision(library, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== library.revision) {
    const error = new Error(`stale revision: expected ${expectedRevision}, library is at ${library.revision}`)
    error.code = 'TSF_STALE_REVISION'
    throw error
  }
}

export function createResearchLibrary(clock) {
  const at = isoNow(clock)
  // sourceSnapshots: additive field (existing schemaVersion unchanged,
  // per research-schema-versioning.mjs's guard, which only checks the
  // schemaVersion string, not an exact key set) -- see indexSourceSnapshot
  // below for what it holds and why it is a genuinely separate concern
  // from `entries` (reconciled CanonicalFacts).
  return { schemaVersion: 'TSF_RESEARCH_LIBRARY_V1', entries: [], sourceSnapshots: [], revision: 0, createdAt: at, updatedAt: at }
}

// Indexes ONE already-admitted CanonicalFact from `mission`/`nodeId` into
// the library. Idempotent by (missionId, canonicalFactId) -- re-indexing
// after the source mission changes unrelated state is a safe no-op; if the
// SAME CanonicalFact id is somehow indexed with different content (should
// be impossible -- CanonicalFact ids are content-derived and CanonicalFacts
// are never mutated in place), this throws rather than silently keeping
// stale library content.
export function indexCanonicalFact(library, mission, nodeId, canonicalFactId, clock, expectedRevision) {
  assertLibraryRevision(library, expectedRevision)
  const node = mission.nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  const fact = node.canonicalFacts.find((f) => f.id === canonicalFactId)
  if (!fact) throw new Error(`unknown canonical fact: ${canonicalFactId}`)
  const entityId = node.targetEntity?.entityId ?? null
  // Independent-verification finding: CanonicalFact ids are content-derived
  // from a decision's binding, which does NOT include nodeId/entityId --
  // two genuinely different entities/nodes deriving the same fieldName +
  // decidedValue + temporalScope via ACCEPT_DERIVED_VALUE (no
  // selectedClaimId to disambiguate) legitimately produce the SAME
  // canonicalFactId. That's harmless inside admitReconciliationDecision
  // (each node's own canonicalFacts array is independently deduped), but
  // this library aggregates facts across nodes/missions into one flat
  // list, so the entry id must include nodeId too or two real, distinct
  // facts collide into what looks like "the same entry with different
  // content" and wrongly refuse to index the second one.
  const id = sha256({ kind: 'ResearchLibraryEntry', missionId: mission.id, nodeId, canonicalFactId })
  const existing = library.entries.find((e) => e.id === id)
  const candidate = {
    schemaVersion: 'TSF_RESEARCH_LIBRARY_ENTRY_V1',
    id,
    missionId: mission.id,
    nodeId,
    canonicalFactId,
    entityId,
    fieldName: fact.fieldName,
    // deepClone: the underlying CanonicalFact.value/temporalScope must
    // never become a live reference shared with the origin mission's own
    // object graph -- a caller mutating a library entry in memory must
    // never be able to reach back into another mission's durable state,
    // which is exactly the advisory-only, no-cross-mission-binding
    // guarantee this module's header comment promises.
    value: deepClone(fact.value),
    temporalScope: fact.temporalScope,
    reconciliationDecisionId: fact.reconciliationDecisionId,
    canonicalizedAt: fact.canonicalizedAt,
    indexedAt: isoNow(clock)
  }
  if (existing) {
    const contentUnchanged = JSON.stringify(canonicalize({ ...existing, indexedAt: null })) === JSON.stringify(canonicalize({ ...candidate, indexedAt: null }))
    if (contentUnchanged) return library
    // Should be structurally unreachable -- CanonicalFacts are immutable
    // once created -- but never silently overwrite indexed content with
    // something that disagrees with what was indexed before.
    throw new Error(`research library entry ${id} already indexed with different content -- CanonicalFacts must never change after creation`)
  }
  const next = deepClone(library)
  next.entries.push(candidate)
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

// Pure, read-only. temporalScope is optional -- omitting it returns
// candidates across every period this entity/field pair has ever been
// researched under (the caller decides what, if anything, is relevant),
// most-recently-canonicalized first. This never filters by "quality" --
// source-independence/quality metadata lives on the ORIGIN mission's own
// records, not duplicated into the library; a caller wanting that detail
// re-reads the origin mission via missionId/nodeId/canonicalFactId.
//
// Independent-verification finding: this previously returned LIVE
// references into library.entries -- a caller mutating a returned
// candidate (e.g. via evaluateResearchLibraryReuse's `hit`) could
// permanently corrupt the shared, cross-mission library's own stored
// data, since indexCanonicalFact's deepClone(library) on every future
// write would then propagate the corruption forward forever. Deep-cloning
// here closes that gap the same way indexCanonicalFact already protects
// the ORIGIN mission's object graph -- the library's own stored data is
// now equally protected from a reader.
export function queryResearchLibrary(library, { entityId, fieldName, temporalScope = undefined }) {
  return library.entries
    .filter((e) => e.entityId === entityId && e.fieldName === fieldName && (temporalScope === undefined || e.temporalScope === temporalScope))
    .map((e) => deepClone(e))
    .sort((a, b) => (a.canonicalizedAt < b.canonicalizedAt ? 1 : a.canonicalizedAt > b.canonicalizedAt ? -1 : 0))
}

export const RESEARCH_LIBRARY_REUSE_DECISIONS = Object.freeze([
  'CACHE_HIT',
  'CACHE_MISS',
  'CACHE_REJECTED_POLICY',
  'CACHE_REJECTED_TEMPORAL',
  'CACHE_REJECTED_SCHEMA',
  'CACHE_REJECTED_FRESHNESS'
])

// CONTINUATION 2 Priority Block 4: the ACQUISITION-DECISION gate. Wires
// the library into the source-first planning path -- conservatively.
// Never itself decides anything is canonical (that invariant is untouched:
// see decideLibraryReferenceReconciliation below); this only decides
// whether a library hit is even SAFE TO CONSIDER before a caller pays for
// a redundant fetch/provider call. Every rejection reason is real and
// checkable, never a guess:
//   POLICY     -- the CURRENT mission's own specification must explicitly
//                 opt in (sourcePolicy.allowCrossMissionLibraryReuse ===
//                 true). Fail-closed default: a specification that never
//                 mentions this is treated as NOT permitting reuse, not as
//                 silently permitting it -- reuse is an opt-in capability,
//                 licensing/terms included (this is also where a real
//                 licensing-constraint conflict would be judged; this
//                 module invents no licensing-compatibility heuristic of
//                 its own, since nothing else in this codebase has one --
//                 an operator who has already reviewed licensing sets this
//                 flag deliberately).
//   TEMPORAL   -- when the caller supplies a required temporalScope, only
//                 an EXACT match is eligible -- never a fuzzy "close
//                 enough" date.
//   FRESHNESS  -- only 'HISTORICAL_STATIC' (immutable-by-nature data) is
//                 currently trusted to reuse safely regardless of age;
//                 every other freshnessPolicy value is rejected rather
//                 than guessed at -- a real staleness-window design for
//                 non-static data is a separate, later piece of work, not
//                 invented speculatively here.
//   SCHEMA     -- when the caller's requestedField declares a valueType,
//                 the hit's actual value must match it (typeof-level
//                 check -- the smallest real signal available without a
//                 shared cross-mission schema registry, which does not
//                 exist and is not invented here).
// A rejection never deletes/consumes the candidate hits -- the caller
// falls through to real acquisition/research or Needs You, exactly as
// before this function existed.
export function evaluateResearchLibraryReuse(library, { sourcePolicy, entityId, fieldName, requiredTemporalScope = undefined, valueType = undefined }) {
  if (sourcePolicy?.allowCrossMissionLibraryReuse !== true) {
    return { decision: 'CACHE_REJECTED_POLICY', hit: null, reason: 'this mission\'s sourcePolicy does not explicitly permit cross-mission research-library reuse (sourcePolicy.allowCrossMissionLibraryReuse must be true)', candidates: [] }
  }
  const candidates = queryResearchLibrary(library, { entityId, fieldName })
  if (candidates.length === 0) {
    return { decision: 'CACHE_MISS', hit: null, reason: 'no prior canonical fact exists in the library for this entity/field', candidates: [] }
  }
  const temporallyEligible = requiredTemporalScope === undefined ? candidates : candidates.filter((c) => c.temporalScope === requiredTemporalScope)
  if (temporallyEligible.length === 0) {
    return { decision: 'CACHE_REJECTED_TEMPORAL', hit: null, reason: `library has ${candidates.length} candidate(s) for this entity/field, but none match the required temporalScope ${requiredTemporalScope} -- a value for a different period is never reused`, candidates }
  }
  const freshEligible = temporallyEligible.filter((c) => sourcePolicy?.freshnessPolicy === 'HISTORICAL_STATIC')
  if (freshEligible.length === 0) {
    return { decision: 'CACHE_REJECTED_FRESHNESS', hit: null, reason: `sourcePolicy.freshnessPolicy (${sourcePolicy?.freshnessPolicy ?? 'unset'}) is not trusted for cross-mission reuse -- only HISTORICAL_STATIC is today`, candidates: temporallyEligible }
  }
  const schemaEligible = valueType === undefined ? freshEligible : freshEligible.filter((c) => typeof c.value === valueType)
  if (schemaEligible.length === 0) {
    return { decision: 'CACHE_REJECTED_SCHEMA', hit: null, reason: `the library candidate's value type does not match this field's declared valueType (${valueType})`, candidates: freshEligible }
  }
  return { decision: 'CACHE_HIT', hit: schemaEligible[0], reason: null, candidates: schemaEligible }
}

// The ONLY sanctioned way to bring a library hit into a NEW mission: an
// explicit ReconciliationDecision in the calling mission, decisionType
// ACCEPT_DERIVED_VALUE (research-reconciliation.mjs's existing, unmodified
// path -- no new decisionType). The cross-mission origin is preserved in
// derivationLineage.crossMissionOrigin, never hidden. Still requires the
// separate admitReconciliationDecision call to actually produce the new
// mission's own CanonicalFact -- deciding never canonicalizes by itself,
// matching every other reconciliation path in this codebase.
export function decideLibraryReferenceReconciliation(mission, nodeId, { fieldName, libraryEntry, decidedBy, rationale }, clock, expectedRevision) {
  if (!libraryEntry?.id) throw new Error('a library entry is required')
  return decideReconciliation(
    mission,
    nodeId,
    {
      fieldName,
      decisionType: 'ACCEPT_DERIVED_VALUE',
      decidedValue: libraryEntry.value,
      temporalScope: libraryEntry.temporalScope,
      rationale,
      decidedBy,
      derivationLineage: {
        schemaVersion: 'TSF_DERIVATION_LINEAGE_V1',
        derivationRule: 'CROSS_MISSION_LIBRARY_REFERENCE',
        inputFieldNames: [fieldName],
        inputCanonicalFactIds: [],
        crossMissionOrigin: {
          libraryEntryId: libraryEntry.id,
          missionId: libraryEntry.missionId,
          nodeId: libraryEntry.nodeId,
          canonicalFactId: libraryEntry.canonicalFactId,
          canonicalizedAt: libraryEntry.canonicalizedAt
        }
      }
    },
    clock,
    expectedRevision
  )
}

// Real-pilot, independent-verification finding: a node resolved ENTIRELY
// via cross-mission library reuse (decideLibraryReferenceReconciliation +
// admitReconciliationDecision, zero real dispatch) previously stayed
// PENDING/READY forever -- genuine epistemic content (real CanonicalFacts)
// with an execution status that silently under-reported
// presentEntityCoverage/evidenceCoverage/verifiedCoverage for a reuse-only
// mission. This is the ONE sanctioned way to move such a node to ADMITTED
// without ever going through recordResearchNodeDispatch/
// admitBoundedResearchResult -- it asserts defensively that no dispatch
// ever actually happened first, so it can never be used as a generic
// bypass of the real DISPATCHED -> RESULT_RECEIVED -> ADMITTED path (a
// node with any real dispatch/result history must go through that path,
// not this one).
export function markResearchNodeAdmittedViaLibraryReuse(mission, nodeId, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      if (node.status === 'ADMITTED') return { next: node, changed: false }
      if ((node.dispatchRecords ?? []).length > 0 || (node.rawResults ?? []).length > 0) {
        const error = new Error(`node ${nodeId} has real dispatch/result history -- markResearchNodeAdmittedViaLibraryReuse is only for a node resolved ENTIRELY via cross-mission reuse with zero dispatch; use the normal admission path instead`)
        error.code = 'TSF_NODE_HAS_REAL_DISPATCH_HISTORY'
        throw error
      }
      // Independent-verification finding: the dispatch-history check above
      // guards the "no real dispatch" half of the invariant, but not the
      // "genuinely has a real fact" half -- self-defense against any future
      // caller (not just the one sanctioned adoptResearchLibraryReuseDurable
      // sequence, which always creates the fact first).
      if ((node.canonicalFacts ?? []).length === 0) {
        const error = new Error(`node ${nodeId} has zero canonicalFacts -- markResearchNodeAdmittedViaLibraryReuse must never mark a node ADMITTED without a real fact behind it`)
        error.code = 'TSF_NODE_HAS_NO_CANONICAL_FACT'
        throw error
      }
      assertNodeTransition(node.status, 'ADMITTED')
      return { next: { ...node, status: 'ADMITTED' }, changed: true }
    },
    clock,
    expectedRevision
  )
}

// ---------------------------------------------------------------------
// RAW SOURCE LIBRARY V0 (HQ "GENERIC V0 ADOPTION READINESS" Phase 3
// finding): everything above this line reuses already-RECONCILED
// CanonicalFacts. That is a genuinely different concern from reusing raw,
// immutable SOURCE material -- until now, admitSourceSnapshot
// (research-source-admission.mjs) only deduped a fetched source WITHIN one
// mission/node (its own header comment already disclosed this as
// "V0's scope is per-node dedup; a shared cross-mission cache is
// deferred, disclosed future work"). This closes exactly that gap, and
// only that gap -- deliberately the smallest safe addition, not a
// document-management product:
//   - no raw content bytes are ever stored here, only a locator/hash/ref,
//     mirroring the existing per-node SourceSnapshotReference shape;
//   - reusing a cached source NEVER creates an Observation, Claim,
//     Verification, ReconciliationDecision, or CanonicalFact by itself --
//     source reuse != claim verification. The reusing mission still
//     performs its own full epistemic-ladder path over this material,
//     exactly as if it had just fetched it fresh.
// ---------------------------------------------------------------------

// Indexes ONE already-admitted SourceSnapshotReference from
// `mission`/`nodeId` into the library. Idempotent by (missionId, nodeId,
// sourceSnapshotId) for the same reason indexCanonicalFact is: two
// genuinely different missions/nodes can legitimately admit the exact
// same contentHash (the same real source fetched independently twice),
// and this library aggregates across all of them into one flat list.
export function indexSourceSnapshot(library, mission, nodeId, sourceSnapshotId, clock, expectedRevision) {
  assertLibraryRevision(library, expectedRevision)
  const node = mission.nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  const snapshot = (node.sourceSnapshots ?? []).find((s) => s.id === sourceSnapshotId)
  if (!snapshot) throw new Error(`unknown source snapshot: ${sourceSnapshotId}`)
  const sourceRef = (node.sourceReferences ?? []).find((s) => s.sourceRef === snapshot.sourceRef) ?? null
  const id = sha256({ kind: 'ResearchSourceLibraryEntry', missionId: mission.id, nodeId, sourceSnapshotId })
  const existing = (library.sourceSnapshots ?? []).find((e) => e.id === id)
  const candidate = {
    schemaVersion: 'TSF_RESEARCH_SOURCE_LIBRARY_ENTRY_V1',
    id,
    missionId: mission.id,
    nodeId,
    sourceSnapshotId,
    // Canonical locator + content hash: the two fields this V0 actually
    // trusts to decide reuse safety below.
    canonicalLocator: snapshot.sourceRef,
    url: sourceRef?.url ?? null,
    publisher: sourceRef?.publisher ?? null,
    contentHash: snapshot.contentHash,
    rawContentRef: snapshot.rawContentRef ?? null,
    retrievedAt: sourceRef?.retrievedAt ?? null,
    // Honestly unavailable from anything upstream captures today -- never
    // fabricated. A future source adapter that DOES capture these should
    // populate them at admission time; this module only forwards what it
    // is given.
    publishedAt: snapshot.publishedAt ?? null,
    dataAsOf: mission.specification?.temporalRequirements?.asOfDate ?? null,
    sourceVersion: snapshot.sourceVersion ?? null,
    mediaType: snapshot.mediaType ?? null,
    // License/cache/redistribution/temporal-class are mission-level policy
    // today (research-mission.mjs's ResearchSpecification.sourcePolicy),
    // not per-source fields -- carried forward from the ORIGIN mission's
    // own policy at index time, deep-cloned so a later policy edit on that
    // mission (if ever supported) cannot retroactively rewrite history here.
    licenseNotes: deepClone(mission.specification?.sourcePolicy?.licensingConstraints ?? []),
    cachePolicy: mission.specification?.sourcePolicy?.freshnessPolicy ?? null,
    redistributionNotes: null,
    temporalClass: mission.specification?.temporalRequirements?.periodScope ?? null,
    // Source-independence metadata, if the origin mission ever recorded it
    // on this exact sourceRef (recordSourceIndependenceMetadata) -- honest
    // UNKNOWN default, matching research-source-independence.mjs's own
    // fail-closed convention, never fabricated as PRIMARY/INDEPENDENT.
    sourceQualityClass: sourceRef?.sourceQualityClass ?? null,
    independenceState: sourceRef?.independenceState ?? 'UNKNOWN',
    upstreamSourceId: sourceRef?.upstreamSourceId ?? null,
    indexedAt: isoNow(clock)
  }
  if (existing) {
    const contentUnchanged = JSON.stringify(canonicalize({ ...existing, indexedAt: null })) === JSON.stringify(canonicalize({ ...candidate, indexedAt: null }))
    if (contentUnchanged) return library
    throw new Error(`research source library entry ${id} already indexed with different content -- an admitted SourceSnapshotReference must never change after admission`)
  }
  const next = deepClone(library)
  next.sourceSnapshots = [...(next.sourceSnapshots ?? []), candidate]
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

// Pure, read-only, deep-cloned for the same live-reference-corruption
// reason queryResearchLibrary is.
export function queryResearchSourceLibrary(library, { canonicalLocator }) {
  return (library.sourceSnapshots ?? [])
    .filter((e) => e.canonicalLocator === canonicalLocator)
    .map((e) => deepClone(e))
    .sort((a, b) => (a.indexedAt < b.indexedAt ? 1 : a.indexedAt > b.indexedAt ? -1 : 0))
}

export const SOURCE_LIBRARY_REUSE_DECISIONS = Object.freeze([
  'SOURCE_CACHE_HIT',
  'SOURCE_CACHE_MISS',
  'SOURCE_CACHE_REJECTED_POLICY',
  'SOURCE_CACHE_REJECTED_TEMPORAL',
  'SOURCE_CACHE_REJECTED_FRESHNESS',
  'SOURCE_CACHE_REJECTED_SOURCE_POLICY'
])

function isSourcePolicyViolation(sourcePolicy, url) {
  try {
    assertSourcePolicyAllows(sourcePolicy, url)
    return false
  } catch (error) {
    if (error.code === 'TSF_SOURCE_POLICY_VIOLATION') return true
    throw error
  }
}

// Mirrors evaluateResearchLibraryReuse's decision structure/vocabulary
// (POLICY/TEMPORAL/FRESHNESS gates, same fail-closed reasoning) but for
// raw source material instead of a reconciled fact -- deliberately kept
// consistent so a caller already familiar with the fact-reuse gate does
// not need to learn a second mental model.
//
// Independent-verification finding (real, found in THIS module before it
// was ever exercised against a real disallowedSources mismatch): the
// original version gated only on allowCrossMissionLibraryReuse/temporal/
// freshness, never on the REUSING mission's own disallowedSources -- a
// mission with a stricter sourcePolicy than the one that originally
// admitted a locator could still reuse it via reuseSourceSnapshotIntoNode,
// silently bypassing the exact enforcement research-admission.mjs's
// assertSourcePolicyAllows exists to guarantee. Checked here (candidate
// filtering, matching this function's existing pure/non-throwing
// convention) AND defensively re-checked inside reuseSourceSnapshotIntoNode
// itself (matching admitSourceSnapshot's own defense-in-depth pattern) --
// never relying on a caller to have checked evaluateSourceLibraryReuse
// first.
export function evaluateSourceLibraryReuse(library, { sourcePolicy, canonicalLocator, requiredTemporalClass = undefined }) {
  if (sourcePolicy?.allowCrossMissionLibraryReuse !== true) {
    return { decision: 'SOURCE_CACHE_REJECTED_POLICY', hit: null, reason: 'this mission\'s sourcePolicy does not explicitly permit cross-mission research-library reuse (sourcePolicy.allowCrossMissionLibraryReuse must be true)', candidates: [] }
  }
  const candidates = queryResearchSourceLibrary(library, { canonicalLocator })
  if (candidates.length === 0) {
    return { decision: 'SOURCE_CACHE_MISS', hit: null, reason: 'no prior admitted source snapshot exists in the library for this canonical locator', candidates: [] }
  }
  const policyEligible = candidates.filter((c) => !isSourcePolicyViolation(sourcePolicy, c.url ?? c.canonicalLocator))
  if (policyEligible.length === 0) {
    return { decision: 'SOURCE_CACHE_REJECTED_SOURCE_POLICY', hit: null, reason: `every candidate for this locator matches THIS mission's own sourcePolicy.disallowedSources -- a stricter mission never inherits a laxer mission's admitted source`, candidates }
  }
  const temporallyEligible = requiredTemporalClass === undefined ? policyEligible : policyEligible.filter((c) => c.temporalClass === requiredTemporalClass)
  if (temporallyEligible.length === 0) {
    return { decision: 'SOURCE_CACHE_REJECTED_TEMPORAL', hit: null, reason: `library has ${policyEligible.length} candidate(s) for this locator, but none match the required temporal class ${requiredTemporalClass}`, candidates: policyEligible }
  }
  const freshEligible = temporallyEligible.filter((c) => c.cachePolicy === 'HISTORICAL_STATIC')
  if (freshEligible.length === 0) {
    return { decision: 'SOURCE_CACHE_REJECTED_FRESHNESS', hit: null, reason: `no eligible candidate's cachePolicy is HISTORICAL_STATIC -- only immutable-by-nature sources are trusted for cross-mission reuse today`, candidates: temporallyEligible }
  }
  return { decision: 'SOURCE_CACHE_HIT', hit: freshEligible[0], reason: null, candidates: freshEligible }
}

// The ONLY sanctioned way to bring a cached raw source into a NEW
// mission's node: admits the SAME locator/hash/metadata this mission
// would have gotten from a fresh fetch, stamped with `reusedFrom` so
// provenance honestly shows this was not independently refetched. This
// mirrors admitSourceSnapshot's record shape exactly (so downstream code
// reading node.sourceReferences/sourceSnapshots sees no difference), and,
// like admitSourceSnapshot, creates NO Observation/Claim/Verification/
// ReconciliationDecision/CanonicalFact -- the reusing mission performs
// that entire path itself, over this now-locally-available raw material,
// exactly as HQ's "source reuse != claim verification" instruction
// requires.
export function reuseSourceSnapshotIntoNode(mission, nodeId, sourceLibraryEntry, clock, expectedRevision) {
  if (!sourceLibraryEntry?.contentHash) throw new Error('a source library entry is required')
  // Defense in depth, never reliant on the caller having already run
  // evaluateSourceLibraryReuse -- same reasoning as admitSourceSnapshot's
  // own check.
  assertSourcePolicyAllows(mission.specification?.sourcePolicy, sourceLibraryEntry.url ?? sourceLibraryEntry.canonicalLocator)
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const alreadyAdmitted = (node.sourceSnapshots ?? []).some((s) => s.contentHash === sourceLibraryEntry.contentHash)
      if (alreadyAdmitted) return { next: node, changed: false }
      const admittedAt = isoNow(clock)
      const next = deepClone(node)
      const sourceRefId = sha256({ kind: 'SourceReference', sourceRef: sourceLibraryEntry.canonicalLocator })
      if (!(next.sourceReferences ?? []).some((s) => s.id === sourceRefId)) {
        next.sourceReferences.push({
          schemaVersion: 'TSF_SOURCE_REFERENCE_V1',
          id: sourceRefId,
          sourceRef: sourceLibraryEntry.canonicalLocator,
          url: sourceLibraryEntry.url,
          publisher: sourceLibraryEntry.publisher,
          retrievedAt: sourceLibraryEntry.retrievedAt,
          admittedAt
        })
      }
      const snapshotId = sha256({ kind: 'SourceSnapshotReference', contentHash: sourceLibraryEntry.contentHash })
      next.sourceSnapshots.push({
        schemaVersion: 'TSF_SOURCE_SNAPSHOT_REFERENCE_V1',
        id: snapshotId,
        sourceRef: sourceLibraryEntry.canonicalLocator,
        contentHash: sourceLibraryEntry.contentHash,
        rawContentRef: sourceLibraryEntry.rawContentRef ?? null,
        retrievable: Boolean(sourceLibraryEntry.rawContentRef),
        acquisitionMethod: 'CROSS_MISSION_SOURCE_LIBRARY_REUSE',
        reusedFrom: { missionId: sourceLibraryEntry.missionId, nodeId: sourceLibraryEntry.nodeId, sourceLibraryEntryId: sourceLibraryEntry.id },
        admittedAt
      })
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}
