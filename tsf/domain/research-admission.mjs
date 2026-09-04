// Admits a durably-stored raw BoundedResearchResult into the epistemic
// ladder's first rung: SourceReference/SourceSnapshotReference/Observation/
// Claim/TypedMissingness/Evidence/gap proposals. This is the ONLY module
// that constructs Observation/Claim records, and it NEVER constructs a
// CanonicalFact -- see research-reconciliation.mjs for the sole path there.
//
// SECURITY BOUNDARY (§11): a worker's result cannot alter mission scope,
// widen tool permissions, change source policy, or admit child work
// directly -- the BoundedResearchResult contract has no field for any of
// those, and newGapProposals are stored as proposals only
// (admittedAsNode: false always, in this wave); no code path here calls
// addResearchNode. Every field this module writes is either copied
// verbatim from the validated result or computed by TSF itself -- nothing
// here evaluates worker-supplied code or executes worker-supplied commands.
//
// Idempotency is per-item (digest of {resultDigest, kind, item}), not just
// per-result -- a crash mid-admission (some observations/claims/evidence
// written, others not) is safely resumed by re-calling this function for
// the same resultDigest: already-present items are skipped, missing items
// are added, and admittedResultDigests is only appended once everything
// else has landed.
import { deepClone, isoNow, sha256 } from './canonical.mjs'
import { assertNodeTransition, withResearchNode } from './research-mission.mjs'

function hasId(list, id) {
  return list.some((item) => item.id === id)
}

// "GENERIC V0 ADOPTION READINESS" Phase 10/11 finding: sourcePolicy.
// disallowedSources was already forwarded to real providers as a
// polite REQUEST (research-node.mjs's BoundedResearchRequest,
// confirmed reaching Parallel/Exa's real payload as source_policy.
// exclude_domains in provider-adapter-conformance.test.mjs) -- but
// nothing downstream ever VERIFIED a provider actually honored it.
// A non-compliant provider result citing a disallowed domain would have
// been silently admitted anyway. This closes that specific gap: defense
// in depth at the one real admission boundary, not a trust-the-provider
// assumption. Deliberately a simple, real, checkable substring match
// (mirrors how disallowedSources entries are already written throughout
// this codebase, e.g. 'pro-football-reference.com') -- no speculative
// URL-parsing/domain-matching engine invented for a case that has not
// occurred yet.
export function assertSourcePolicyAllows(sourcePolicy, url) {
  const disallowed = sourcePolicy?.disallowedSources ?? []
  if (disallowed.length === 0 || !url) return
  const violated = disallowed.find((host) => url.includes(host))
  if (violated) {
    const error = new Error(`source ${url} matches a disallowedSources entry (${violated}) -- refusing to admit, even though sourcePolicy already asked the provider to exclude it (defense in depth against a non-compliant provider)`)
    error.code = 'TSF_SOURCE_POLICY_VIOLATION'
    throw error
  }
}

export function admitBoundedResearchResult(mission, nodeId, resultDigest, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const raw = (node.rawResults ?? []).find((r) => r.digest === resultDigest)
      if (!raw) throw new Error(`unknown raw result digest for node ${nodeId}: ${resultDigest}`)
      // Independent-verification finding: this previously also required
      // node.status === 'ADMITTED' to short-circuit -- but "was THIS EXACT
      // resultDigest already fully processed" is a fact about history
      // (content-derived, permanent), not about current status. Requiring
      // status==='ADMITTED' broke the moment ANY legitimate later
      // transition moved the node past ADMITTED (escalateResearchNodeToNeedsYou
      // -> BLOCKED being the concrete case found: a resumed
      // pollAndAdmitResearchNodeDurable call on an already-escalated node
      // re-admitted the same digest and threw BLOCKED -> ADMITTED, an
      // illegal transition). A specific digest already in
      // admittedResultDigests is done, full stop, regardless of what has
      // happened to node.status since.
      if ((node.admittedResultDigests ?? []).includes(resultDigest)) {
        return { next: node, changed: false }
      }
      const result = raw.result
      const admittedAt = isoNow(clock)
      const next = deepClone(node)
      let wrote = false

      const sourceRefIdByRef = new Map(next.sourceReferences.map((s) => [s.sourceRef, s.id]))
      for (const sr of result.sourceReferences) {
        assertSourcePolicyAllows(mission.specification?.sourcePolicy, sr.url ?? sr.sourceRef)
        const id = sha256({ resultDigest, kind: 'SourceReference', sourceRef: sr.sourceRef })
        if (!hasId(next.sourceReferences, id)) {
          next.sourceReferences.push({
            schemaVersion: 'TSF_SOURCE_REFERENCE_V1',
            id,
            sourceRef: sr.sourceRef,
            url: sr.url ?? null,
            publisher: sr.publisher ?? null,
            retrievedAt: sr.retrievedAt,
            admittedAt
          })
          wrote = true
        }
        sourceRefIdByRef.set(sr.sourceRef, id)
      }

      for (const snap of result.sourceSnapshotsOrSnapshotRefs) {
        const id = sha256({ resultDigest, kind: 'SourceSnapshotReference', sourceRef: snap.sourceRef, contentHash: snap.contentHash })
        if (!hasId(next.sourceSnapshots, id)) {
          next.sourceSnapshots.push({
            schemaVersion: 'TSF_SOURCE_SNAPSHOT_REFERENCE_V1',
            id,
            sourceRef: snap.sourceRef,
            contentHash: snap.contentHash,
            rawContentRef: snap.rawContentRef ?? null,
            retrievable: Boolean(snap.rawContentRef || snap.inlineSnapshot),
            admittedAt
          })
          wrote = true
        }
      }

      const observationIds = []
      for (const obs of result.observations) {
        const id = sha256({ resultDigest, kind: 'Observation', obs })
        if (!hasId(next.observations, id)) {
          next.observations.push({
            schemaVersion: 'TSF_OBSERVATION_V1',
            id,
            digest: id,
            provider: result.provider,
            providerRunRef: result.providerRunRef,
            rawContent: obs.rawContent,
            // Unknown provider confidence/reasoning stays null -- never
            // coerced to a fabricated value (e.g. 0), per §12/§14.
            providerConfidence: obs.providerConfidence ?? null,
            providerReasoning: obs.providerReasoning ?? null,
            extractedAt: obs.extractedAt,
            admittedAt
          })
          wrote = true
        }
        observationIds.push(id)
      }

      // A ProposedClaim with proposedValue === null is an honest missingness
      // signal, not a claim -- admitted as TypedMissingness instead. This
      // keeps the wire contract simple (no separate missingness field) while
      // making "missingness honesty" a first-class, testable admission
      // outcome distinct from "no data returned at all".
      const claimIdByField = new Map()
      for (const pc of result.proposedClaims) {
        if (pc.proposedValue === null) {
          const id = sha256({ resultDigest, kind: 'TypedMissingness', pc })
          if (!hasId(next.typedMissingness, id)) {
            next.typedMissingness.push({
              schemaVersion: 'TSF_TYPED_MISSINGNESS_V1',
              id,
              fieldName: pc.fieldName,
              // Trust + Scale Hardening Continuation 2 Priority Block 3:
              // carried through exactly like Claim.temporalScope already
              // is, so "this field is honestly missing FOR THIS PERIOD"
              // can be told apart from missingness with no period context
              // at all -- required for temporal-aware completeness below.
              temporalScope: pc.temporalScope ?? null,
              // "GENERIC V0 ADOPTION READINESS" Phase 8: honest default,
              // never fabricated as CONTEMPORANEOUS -- see
              // research-node.mjs's TEMPORAL_CLASSES.
              temporalClass: pc.temporalClass ?? 'UNKNOWN_TEMPORAL_STATUS',
              missingnessType: 'NOT_PUBLICLY_AVAILABLE',
              reason: pc.providerReasoning ?? 'no value found by provider',
              admittedAt
            })
            wrote = true
          }
          continue
        }
        const id = sha256({ resultDigest, kind: 'Claim', pc })
        if (!hasId(next.claims, id)) {
          next.claims.push({
            schemaVersion: 'TSF_CLAIM_V1',
            id,
            digest: id,
            fieldName: pc.fieldName,
            proposedValue: pc.proposedValue,
            temporalScope: pc.temporalScope ?? null,
            // "GENERIC V0 ADOPTION READINESS" Phase 8: see
            // research-node.mjs's TEMPORAL_CLASSES -- honest default,
            // never fabricated as CONTEMPORANEOUS.
            temporalClass: pc.temporalClass ?? 'UNKNOWN_TEMPORAL_STATUS',
            provider: result.provider,
            providerConfidence: pc.providerConfidence ?? null,
            providerReasoning: pc.providerReasoning ?? null,
            observationIds,
            // status is RESEARCH EPISTEMIC STATE. Admission never sets
            // anything but UNVERIFIED here -- a completed worker result
            // does not imply verified, let alone canonical.
            status: 'UNVERIFIED',
            admittedAt
          })
          wrote = true
        }
        claimIdByField.set(pc.fieldName, id)
      }

      for (const ev of result.evidence) {
        const claimId = claimIdByField.get(ev.claimFieldName)
        const sourceReferenceId = sourceRefIdByRef.get(ev.sourceRef)
        // An evidence entry that cross-references a field/source this
        // result didn't actually claim/cite is dropped, never thrown --
        // a malformed worker cross-reference must not crash admission of
        // everything else it did supply correctly.
        if (!claimId || !sourceReferenceId) continue
        const id = sha256({ resultDigest, kind: 'Evidence', ev })
        if (!hasId(next.evidence, id)) {
          next.evidence.push({
            schemaVersion: 'TSF_EVIDENCE_V1',
            id,
            digest: id,
            claimId,
            sourceReferenceId,
            snippet: ev.snippet,
            supportsClaim: ev.supportsClaim,
            admittedAt
          })
          wrote = true
        }
      }

      // Proposals only -- TSF admission never creates durable additional
      // work from these. A future, separate governed step may promote one
      // into a real addResearchNode call; nothing in this module does.
      for (const gap of result.newGapProposals) {
        const id = sha256({ resultDigest, kind: 'GapProposal', gap })
        if (!hasId(next.gapProposals, id)) {
          next.gapProposals.push({ id, fieldName: gap.fieldName, reason: gap.reason, admittedAt, admittedAsNode: false })
          wrote = true
        }
      }

      const alreadyMarkedAdmitted = (next.admittedResultDigests ?? []).includes(resultDigest)
      if (!alreadyMarkedAdmitted) {
        next.admittedResultDigests = [...(next.admittedResultDigests ?? []), resultDigest]
        wrote = true
      }
      // A FAILED raw result has nothing epistemic to admit -- forcing
      // ADMITTED here would silently disguise a real dispatch failure as a
      // successful admission. Leave the node's FAILED status (set by
      // recordResearchNodeResult) as-is UNLESS this node already carries
      // real claims from an earlier, successful dispatch cycle (the
      // re-dispatch/multi-cycle pattern) -- a later cycle's failure must
      // never erase or hide previously admitted content.
      if (result.status === 'FAILED') {
        if (next.claims.length > 0 && next.status !== 'ADMITTED') {
          assertNodeTransition(next.status, 'ADMITTED')
          next.status = 'ADMITTED'
          wrote = true
        }
      } else if (next.status !== 'ADMITTED') {
        assertNodeTransition(next.status, 'ADMITTED')
        next.status = 'ADMITTED'
        wrote = true
      }

      return { next, changed: wrote }
    },
    clock,
    expectedRevision
  )
}

// "GENERIC V0 ADOPTION READINESS" Phase 11 finding: identityResolutionState
// previously accepted ANY string for `status` (no enum), and nothing in
// research-reconciliation.mjs ever read it -- an AMBIGUOUS identity
// (multiple candidateEntityRefs, no confident resolvedEntityId) could not
// mechanically block canonicalization from proceeding anyway. Formalized
// the vocabulary here; the actual enforcement lives in
// admitReconciliationDecision (research-reconciliation.mjs) -- see its
// own comment.
export const IDENTITY_RESOLUTION_STATES = Object.freeze(['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED'])

// Node-level identity-resolution record (one entity per node, e.g. "which
// real player does this alias-prone name refer to"). Distinct from and
// unrelated to TSF's own repository-identity concept in health.mjs.
export function recordIdentityResolutionState(
  mission,
  nodeId,
  { candidateEntityRefs, resolvedEntityId = null, status, rationale = null },
  clock,
  expectedRevision
) {
  if (!IDENTITY_RESOLUTION_STATES.includes(status)) {
    throw new Error(`unknown identity resolution status: ${status} (must be one of ${IDENTITY_RESOLUTION_STATES.join(', ')})`)
  }
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const id = sha256({ nodeId, candidateEntityRefs, resolvedEntityId, status })
      if (node.identityResolutionState?.id === id) return { next: node, changed: false }
      const next = deepClone(node)
      next.identityResolutionState = {
        schemaVersion: 'TSF_IDENTITY_RESOLUTION_STATE_V1',
        id,
        candidateEntityRefs,
        resolvedEntityId,
        status,
        rationale,
        admittedAt: isoNow(clock)
      }
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}
