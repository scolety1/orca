// Canonicalization integrity boundary. Closes the plain-object hand-splice
// caveat the independent verifier disclosed against research-reconciliation
// .mjs: every CanonicalFact present at load, at reconciliation output, or
// at artifact export must reference an existing, consistent, persisted
// ReconciliationDecision (and never one of decisionType ACCEPT_TYPED_MISSING,
// which by construction never produces a CanonicalFact -- see
// research-reconciliation.mjs). A fact that fails this check is quarantined
// (excluded from what's treated as canonical, never silently deleted from
// the durable record itself, never thrown away) and surfaced as an
// ADVISORY_ONLY finding -- the same {status, findings[], authority} shape
// tsf/domain/health.mjs already uses, not a new convention. This is a pure,
// stateless projection (mirrors flight-recorder.mjs's discipline: never a
// second persisted source of truth) -- it does not mutate stored state.
import { isoNow } from './canonical.mjs'
// The EXACT SAME Set instance research-reconciliation.mjs's own write-side
// assertion (admitReconciliationDecision) checks against -- not a second,
// independently-filtered copy. One shared source of truth for which
// decision types may produce a CanonicalFact.
import { VALID_CANONICAL_DECISION_TYPES } from './research-reconciliation.mjs'

export function verifyCanonicalFactLineage(node) {
  const decisionsById = new Map((node.reconciliationDecisions ?? []).map((d) => [d.id, d]))
  const valid = []
  const quarantined = []
  for (const fact of node.canonicalFacts ?? []) {
    if (!fact.reconciliationDecisionId) {
      quarantined.push({ fact, reason: 'MISSING_RECONCILIATION_DECISION_ID' })
      continue
    }
    const decision = decisionsById.get(fact.reconciliationDecisionId)
    if (!decision) {
      quarantined.push({ fact, reason: 'RECONCILIATION_DECISION_NOT_FOUND' })
      continue
    }
    if (decision.fieldName !== fact.fieldName) {
      quarantined.push({ fact, reason: 'FIELD_NAME_MISMATCH' })
      continue
    }
    if (!VALID_CANONICAL_DECISION_TYPES.has(decision.decisionType)) {
      quarantined.push({ fact, reason: 'INVALID_DECISION_TYPE_FOR_CANONICAL_FACT' })
      continue
    }
    valid.push(fact)
  }
  return { valid, quarantined }
}

// Projects a mission into an integrity-checked view: canonicalFacts is
// replaced by ONLY the lineage-valid subset in the returned projection;
// quarantinedCanonicalFacts on each node preserves what was excluded (and
// why) for operator/audit visibility -- fail closed, not fail silent. The
// INPUT mission object (and whatever is durably persisted) is never
// mutated by this function.
export function integrityCheckedMission(mission, clock) {
  const findings = []
  const nodes = mission.nodes.map((node) => {
    const { valid, quarantined } = verifyCanonicalFactLineage(node)
    if (quarantined.length > 0) {
      findings.push({
        code: 'CANONICAL_FACT_LINEAGE_INVALID',
        nodeId: node.id,
        quarantinedCount: quarantined.length,
        reasons: [...new Set(quarantined.map((q) => q.reason))],
        remediation: 'Re-derive the field through a real decideReconciliation + admitReconciliationDecision call; the quarantined value is never trusted as canonical.'
      })
    }
    return { ...node, canonicalFacts: valid, quarantinedCanonicalFacts: quarantined }
  })
  return {
    mission: { ...mission, nodes },
    integrityReport: {
      schemaVersion: 'TSF_RESEARCH_INTEGRITY_REPORT_V1',
      status: findings.length > 0 ? 'FINDINGS' : 'CLEAN',
      findings,
      authority: 'ADVISORY_ONLY',
      checkedAt: isoNow(clock)
    }
  }
}
