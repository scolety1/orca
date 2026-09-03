// Source-independence model, wired directly into verification/
// reconciliation. Smallest domain-extensible representation: a
// SourceReference optionally carries `upstreamSourceId` (another
// SourceReference's id it derives from, if known) and an
// `independenceState`. This mechanically prevents the classic failure
// mode HQ named: two URLs that both derive from the same upstream provider
// must not count as two independent confirmations. No universal cross-
// domain "quality ranking" is created -- `sourceQualityClass` is an
// open, per-source label a caller (a domain adapter, a human reviewer)
// assigns; this module never invents a ranking between classes itself,
// it only refuses to double-count shared-upstream sources as independent.
import { canonicalize, deepClone, isoNow, sha256 } from './canonical.mjs'
import { withResearchNode } from './research-mission.mjs'

// Reference equality (===) is wrong for independenceEvidence once a caller
// passes an object/array -- two structurally-identical-but-distinct
// evidence payloads would each look "changed" and bump the revision.
// Canonical-JSON comparison, matching research-verification.mjs's own
// valuesEqual, treats them as the true idempotent replay they are.
function evidenceEqual(a, b) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

export const SOURCE_QUALITY_CLASSES = Object.freeze([
  'PRIMARY_SOURCE',
  'INDEPENDENT_SECONDARY',
  'AGGREGATOR',
  'DERIVED_SOURCE',
  'MIRROR'
])

export const INDEPENDENCE_STATES = Object.freeze([
  'INDEPENDENT',
  'SUSPECTED_SHARED_UPSTREAM',
  'KNOWN_SHARED_UPSTREAM',
  'UNKNOWN'
])

// TSF-authority update to a SourceReference's independence metadata --
// providers never supply this (they have no concept of it); it is
// established by domain knowledge or explicit research after the fact,
// which is exactly why this is a separate, later admission step rather
// than something research-admission.mjs sets at result-admission time.
export function recordSourceIndependenceMetadata(
  mission,
  nodeId,
  sourceReferenceId,
  { sourceQualityClass = null, upstreamSourceId = null, independenceState = 'UNKNOWN', independenceEvidence = null },
  clock,
  expectedRevision
) {
  if (sourceQualityClass != null && !SOURCE_QUALITY_CLASSES.includes(sourceQualityClass)) {
    throw new Error(`unknown source quality class: ${sourceQualityClass}`)
  }
  if (!INDEPENDENCE_STATES.includes(independenceState)) {
    throw new Error(`unknown independence state: ${independenceState}`)
  }
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const idx = node.sourceReferences.findIndex((s) => s.id === sourceReferenceId)
      if (idx === -1) throw new Error(`unknown source reference: ${sourceReferenceId}`)
      if (upstreamSourceId != null && !node.sourceReferences.some((s) => s.id === upstreamSourceId)) {
        throw new Error(`unknown upstream source reference: ${upstreamSourceId}`)
      }
      const existing = node.sourceReferences[idx]
      const nextRecord = { ...existing, sourceQualityClass, upstreamSourceId, independenceState, independenceEvidence, independenceRecordedAt: isoNow(clock) }
      const unchanged =
        existing.sourceQualityClass === sourceQualityClass &&
        existing.upstreamSourceId === upstreamSourceId &&
        existing.independenceState === independenceState &&
        evidenceEqual(existing.independenceEvidence, independenceEvidence)
      if (unchanged) return { next: node, changed: false }
      const next = deepClone(node)
      next.sourceReferences[idx] = nextRecord
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

// Resolves a source to its ultimate root upstream id (following
// upstreamSourceId chains, bounded against cycles). A source with no
// known upstream resolves to itself.
function resolveRoot(sourceReferences, sourceId, visited = new Set()) {
  if (visited.has(sourceId)) return sourceId // cycle guard -- never loop forever on malformed data
  visited.add(sourceId)
  const source = sourceReferences.find((s) => s.id === sourceId)
  if (!source?.upstreamSourceId) return sourceId
  return resolveRoot(sourceReferences, source.upstreamSourceId, visited)
}

// The core mechanical guard: groups a claim's cited sources by resolved
// root, so "2 sources but 1 independent evidence lineage" is a real,
// computed fact, not a raw count. Sources with an UNKNOWN independence
// state and no known upstream are counted as their own lineage but
// flagged unresolved -- optimistically independent, not confidently so.
export function computeIndependentEvidenceLineage(node, claimId) {
  const evidenceForClaim = node.evidence.filter((e) => e.claimId === claimId && e.supportsClaim)
  const sourceIds = [...new Set(evidenceForClaim.map((e) => e.sourceReferenceId))]
  const lineageGroups = new Map() // rootId -> [sourceId, ...]
  let unresolvedSourceCount = 0
  let knownSharedUpstreamCount = 0
  for (const sourceId of sourceIds) {
    const source = node.sourceReferences.find((s) => s.id === sourceId)
    if (!source) continue
    // Admission never sets independenceState (providers have no concept of
    // it) -- a freshly-admitted source is UNKNOWN in substance even though
    // the field is literally absent, and must be flagged unresolved just
    // the same as an explicit 'UNKNOWN'.
    const state = source.independenceState ?? 'UNKNOWN'
    if (state === 'UNKNOWN' && !source.upstreamSourceId) unresolvedSourceCount += 1
    // A recorded upstreamSourceId is itself a known-shared-upstream fact
    // regardless of whether independenceState was also set to match --
    // the two fields must not be allowed to silently disagree and
    // under-report this diagnostic count (lineage merging already keys
    // off upstreamSourceId alone, so this only fixes the count, not the
    // real independentLineageCount guard).
    if (state === 'KNOWN_SHARED_UPSTREAM' || state === 'SUSPECTED_SHARED_UPSTREAM' || source.upstreamSourceId != null) {
      knownSharedUpstreamCount += 1
    }
    const root = resolveRoot(node.sourceReferences, sourceId)
    if (!lineageGroups.has(root)) lineageGroups.set(root, [])
    lineageGroups.get(root).push(sourceId)
  }
  return {
    schemaVersion: 'TSF_EVIDENCE_LINEAGE_V1',
    claimId,
    sourceCount: sourceIds.length,
    independentLineageCount: lineageGroups.size,
    lineageGroups: [...lineageGroups.values()],
    unresolvedSourceCount,
    knownSharedUpstreamCount,
    hasPrimarySource: sourceIds.some((id) => node.sourceReferences.find((s) => s.id === id)?.sourceQualityClass === 'PRIMARY_SOURCE')
  }
}

// Reconciliation-time guidance for a conflict -- exposes independent-
// lineage-count and primary-source presence PER competing claim, so a
// real decideReconciliation call is never reduced to raw source counting
// (blind majority vote). This function decides nothing; it only refuses
// to hide the information that would let 3 mirrored aggregators look
// stronger than 1 primary source.
export function computeConflictIndependenceGuidance(node, conflictId) {
  const conflict = node.conflicts.find((c) => c.id === conflictId)
  if (!conflict) throw new Error(`unknown conflict: ${conflictId}`)
  return {
    schemaVersion: 'TSF_CONFLICT_INDEPENDENCE_GUIDANCE_V1',
    conflictId,
    fieldName: conflict.fieldName,
    perClaim: conflict.conflictingClaimIds.map((claimId) => {
      const claim = node.claims.find((c) => c.id === claimId)
      return { claimId, proposedValue: claim?.proposedValue, ...computeIndependentEvidenceLineage(node, claimId) }
    })
  }
}
