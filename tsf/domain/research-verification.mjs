// Verification: reuses evaluation-pack.mjs's assertion-scoring mechanism
// directly (THIN_EXTENSION per CORRECTION WAVE 1's reuse map) rather than a
// bespoke research-specific scoring engine. A Verification record is
// produced FOR a Claim; its verdict is PASS/FAIL/INCONCLUSIVE -- never
// CANONICAL. Conflict detection compares claims for the same fieldName and
// is unrelated to competing-commitments.mjs's project-resource-conflict
// concept (a genuinely different meaning of "conflict" already present
// elsewhere in TSF).
import { canonicalize, deepClone, isoNow, sha256 } from './canonical.mjs'
import { scoreCase } from './evaluation-pack.mjs'
import { withResearchNode } from './research-mission.mjs'
import { computeIndependentEvidenceLineage } from './research-source-independence.mjs'

function buildVerificationCase(claimId) {
  return {
    id: `verify:${claimId}`,
    assertions: [
      { type: 'GTE', path: 'supportingEvidenceCount', value: 1 },
      { type: 'GTE', path: 'independentLineageCount', value: 1 },
      { type: 'EQUALS', path: 'hasContradictingEvidence', value: false },
      { type: 'EQUALS', path: 'temporalMatches', value: true }
    ]
  }
}

// Trust + Scale Hardening finding: verification previously only counted
// raw supporting-evidence entries -- two citations that both mirror the
// same upstream provider looked identical to two genuinely independent
// confirmations. actualOutput now includes independentLineageCount (from
// research-source-independence.mjs's upstream-resolution grouping), and
// the FULL lineage snapshot is preserved on the record itself ("why a
// claim was considered verified" per HQ). Because the digest this
// function is keyed on now depends on that lineage snapshot, updating a
// source's independence metadata (recordSourceIndependenceMetadata) and
// re-running this function naturally produces a NEW verification record
// with a new id -- the old one is never mutated, just superseded -- which
// is exactly the "recalculation after independence metadata changes"
// property HQ asked for, using the existing append-only convention rather
// than a new invalidation mechanism.
export function verifyResearchClaim(mission, nodeId, claimId, clock, expectedRevision) {
  const periodScope = mission.specification.temporalRequirements.periodScope
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const claim = node.claims.find((c) => c.id === claimId)
      if (!claim) throw new Error(`unknown claim: ${claimId}`)
      const linkedEvidence = node.evidence.filter((e) => e.claimId === claimId)
      const lineage = computeIndependentEvidenceLineage(node, claimId)
      const actualOutput = {
        supportingEvidenceCount: linkedEvidence.filter((e) => e.supportsClaim).length,
        independentLineageCount: lineage.independentLineageCount,
        hasContradictingEvidence: linkedEvidence.some((e) => !e.supportsClaim),
        temporalMatches: claim.temporalScope == null || claim.temporalScope === periodScope
      }
      const id = sha256({ kind: 'Verification', claimId, actualOutput, lineage })
      if (node.verifications.some((v) => v.id === id)) return { next: node, changed: false }
      const scored = scoreCase(actualOutput, buildVerificationCase(claimId))
      const verdict = linkedEvidence.length === 0 ? 'INCONCLUSIVE' : scored.passed ? 'PASS' : 'FAIL'
      const next = deepClone(node)
      next.verifications.push({
        schemaVersion: 'TSF_VERIFICATION_V1',
        id,
        claimId,
        verdict,
        assertionResults: scored.assertionResults,
        evidenceLineage: lineage,
        verifiedBy: 'TSF_EVALUATION_PACK_ENGINE',
        verifiedAt: isoNow(clock)
      })
      const idx = next.claims.findIndex((c) => c.id === claimId)
      if (verdict === 'PASS') {
        next.claims[idx] = { ...next.claims[idx], status: 'VERIFIED' }
      } else if (verdict === 'FAIL') {
        next.claims[idx] = { ...next.claims[idx], status: 'REJECTED' }
      }
      // INCONCLUSIVE leaves the claim UNVERIFIED -- an absent verdict is
      // never silently treated as passing.
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

function valuesEqual(a, b) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

// Raises a Conflict whenever >=2 non-rejected claims for the same
// fieldName AND the same temporalScope disagree. Idempotent by (fieldName,
// temporalScope, sorted claim ids).
//
// Trust + Scale Hardening finding: this previously grouped by fieldName
// alone, so two claims about the same field but genuinely DIFFERENT time
// periods (e.g. "yards, 2001 regular season" = 100 vs "yards, 2001
// preseason" = 12) were wrongly flagged as a real conflict -- an apparent
// disagreement fully explained by temporal difference, not a genuine
// source disagreement. Two claims that both leave temporalScope unset are
// still compared against each other (both fall in the same null bucket,
// matching the specification's implicit periodScope), so an ordinary
// single-period mission is unaffected.
export function detectResearchConflicts(mission, nodeId, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const byFieldAndScope = new Map()
      for (const c of node.claims) {
        if (c.status === 'REJECTED') continue
        const key = sha256({ fieldName: c.fieldName, temporalScope: c.temporalScope ?? null })
        if (!byFieldAndScope.has(key)) byFieldAndScope.set(key, { fieldName: c.fieldName, temporalScope: c.temporalScope ?? null, claims: [] })
        byFieldAndScope.get(key).claims.push(c)
      }
      const next = deepClone(node)
      let wrote = false
      for (const { fieldName, temporalScope, claims } of byFieldAndScope.values()) {
        if (claims.length < 2) continue
        const distinctValues = []
        for (const c of claims) {
          if (!distinctValues.some((v) => valuesEqual(v, c.proposedValue))) distinctValues.push(c.proposedValue)
        }
        if (distinctValues.length < 2) continue
        const conflictingClaimIds = [...claims.map((c) => c.id)].sort()
        const id = sha256({ fieldName, temporalScope, conflictingClaimIds })
        if (next.conflicts.some((cf) => cf.id === id)) continue
        next.conflicts.push({
          schemaVersion: 'TSF_CONFLICT_V1',
          id,
          fieldName,
          temporalScope,
          conflictingClaimIds,
          status: 'OPEN',
          raisedAt: isoNow(clock),
          resolvedAt: null
        })
        wrote = true
        for (const cid of conflictingClaimIds) {
          const idx = next.claims.findIndex((c) => c.id === cid)
          if (next.claims[idx].status !== 'REJECTED') {
            next.claims[idx] = { ...next.claims[idx], status: 'CONFLICTED' }
          }
        }
      }
      return { next, changed: wrote }
    },
    clock,
    expectedRevision
  )
}
