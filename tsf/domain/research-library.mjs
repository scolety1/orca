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
  return { schemaVersion: 'TSF_RESEARCH_LIBRARY_V1', entries: [], revision: 0, createdAt: at, updatedAt: at }
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
export function queryResearchLibrary(library, { entityId, fieldName, temporalScope = undefined }) {
  return library.entries
    .filter((e) => e.entityId === entityId && e.fieldName === fieldName && (temporalScope === undefined || e.temporalScope === temporalScope))
    .slice()
    .sort((a, b) => (a.canonicalizedAt < b.canonicalizedAt ? 1 : a.canonicalizedAt > b.canonicalizedAt ? -1 : 0))
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
