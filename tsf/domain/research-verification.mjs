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

function buildVerificationCase(claimId) {
  return {
    id: `verify:${claimId}`,
    assertions: [
      { type: 'GTE', path: 'supportingEvidenceCount', value: 1 },
      { type: 'EQUALS', path: 'hasContradictingEvidence', value: false },
      { type: 'EQUALS', path: 'temporalMatches', value: true }
    ]
  }
}

export function verifyResearchClaim(mission, nodeId, claimId, clock, expectedRevision) {
  const periodScope = mission.specification.temporalRequirements.periodScope
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const claim = node.claims.find((c) => c.id === claimId)
      if (!claim) throw new Error(`unknown claim: ${claimId}`)
      const linkedEvidence = node.evidence.filter((e) => e.claimId === claimId)
      const actualOutput = {
        supportingEvidenceCount: linkedEvidence.filter((e) => e.supportsClaim).length,
        hasContradictingEvidence: linkedEvidence.some((e) => !e.supportsClaim),
        temporalMatches: claim.temporalScope == null || claim.temporalScope === periodScope
      }
      const id = sha256({ kind: 'Verification', claimId, actualOutput })
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
// fieldName disagree. Idempotent by (fieldName, sorted claim ids).
export function detectResearchConflicts(mission, nodeId, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const byField = new Map()
      for (const c of node.claims) {
        if (c.status === 'REJECTED') continue
        if (!byField.has(c.fieldName)) byField.set(c.fieldName, [])
        byField.get(c.fieldName).push(c)
      }
      const next = deepClone(node)
      let wrote = false
      for (const [fieldName, claims] of byField) {
        if (claims.length < 2) continue
        const distinctValues = []
        for (const c of claims) {
          if (!distinctValues.some((v) => valuesEqual(v, c.proposedValue))) distinctValues.push(c.proposedValue)
        }
        if (distinctValues.length < 2) continue
        const conflictingClaimIds = [...claims.map((c) => c.id)].sort()
        const id = sha256({ fieldName, conflictingClaimIds })
        if (next.conflicts.some((cf) => cf.id === id)) continue
        next.conflicts.push({
          schemaVersion: 'TSF_CONFLICT_V1',
          id,
          fieldName,
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
