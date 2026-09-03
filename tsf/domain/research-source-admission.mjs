// Source-first bulk acquisition admission -- the "SCOPE -> SOURCE
// DISCOVERY -> SOURCE ADMISSION -> BULK ACQUISITION" path, distinct from
// targeted BoundedResearchWorker dispatch (research-admission.mjs). A
// fetched SourceSnapshot becomes durable SourceReference/
// SourceSnapshotReference records directly -- no Observation/Claim is
// created here, since bulk source content is raw material, not yet an
// extracted, field-attributed assertion (that's a separate, source-
// specific parsing step layered on top, e.g. by a future domain-specific
// extractor). Idempotent by contentHash -- the smallest useful "research
// library" semantic: refetching identical content already admitted for
// this node is a genuine no-op, never a duplicate record (V0's scope is
// per-node dedup; a shared cross-mission cache is deferred, disclosed
// future work).
import { deepClone, isoNow, sha256 } from './canonical.mjs'
import { withResearchNode } from './research-mission.mjs'

export function admitSourceSnapshot(mission, nodeId, snapshot, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const alreadyAdmitted = node.sourceSnapshots.some((s) => s.contentHash === snapshot.contentHash)
      if (alreadyAdmitted) return { next: node, changed: false }
      const admittedAt = isoNow(clock)
      const next = deepClone(node)
      const sourceRefId = sha256({ kind: 'SourceReference', sourceRef: snapshot.sourceRef })
      if (!next.sourceReferences.some((s) => s.id === sourceRefId)) {
        next.sourceReferences.push({
          schemaVersion: 'TSF_SOURCE_REFERENCE_V1',
          id: sourceRefId,
          sourceRef: snapshot.sourceRef,
          url: snapshot.url,
          publisher: snapshot.publisher ?? null,
          retrievedAt: snapshot.retrievedAt,
          admittedAt
        })
      }
      const snapshotId = sha256({ kind: 'SourceSnapshotReference', contentHash: snapshot.contentHash })
      next.sourceSnapshots.push({
        schemaVersion: 'TSF_SOURCE_SNAPSHOT_REFERENCE_V1',
        id: snapshotId,
        sourceRef: snapshot.sourceRef,
        contentHash: snapshot.contentHash,
        rawContentRef: null,
        retrievable: true,
        acquisitionMethod: 'BULK_SOURCE_FIRST_HTTP',
        admittedAt
      })
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}
