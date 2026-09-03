// TSF's research authority layer. decideReconciliation records WHY a value
// was chosen (rationale/considered claims/verifications/conflict, staleness
// -guarded by a binding hash mirroring adoption.mjs's candidateBinding
// pattern -- THIN_EXTENSION per CORRECTION WAVE 1). admitReconciliationDecision
// is the ONLY function in this codebase that may construct a CanonicalFact
// record. There is no worker-result -> CanonicalFact or Observation ->
// CanonicalFact or Claim -> CanonicalFact shortcut anywhere else: every
// other research-*.mjs module writes only to observations/claims/evidence/
// verifications/conflicts, never canonicalFacts.
import { deepClone, isoNow, sha256 } from './canonical.mjs'
import { withResearchNode } from './research-mission.mjs'

export const RECONCILIATION_DECISION_TYPES = Object.freeze([
  'ACCEPT_SINGLE_VERIFIED_CLAIM',
  'RESOLVE_CONFLICT',
  'ACCEPT_TYPED_MISSING',
  'ACCEPT_DERIVED_VALUE'
])

// The subset of decision types that DO produce a CanonicalFact --
// everything in RECONCILIATION_DECISION_TYPES except ACCEPT_TYPED_MISSING.
// EXPORTED as the one shared instance research-integrity.mjs's read-side
// check imports directly (not a second independently-filtered copy) --
// an independent-verification finding on the prior copy-via-filter
// approach: the exclusion of ACCEPT_TYPED_MISSING was a literal repeated
// in two files, a real (if narrow) future-drift risk if a future decision
// type also needed excluding. Now there is exactly one Set instance.
export const VALID_CANONICAL_DECISION_TYPES = new Set(
  RECONCILIATION_DECISION_TYPES.filter((t) => t !== 'ACCEPT_TYPED_MISSING')
)

function decisionBinding({ fieldName, decisionType, selectedClaimId, consideredClaimIds, verificationIds, conflictId, decidedValue }) {
  return sha256({ fieldName, decisionType, selectedClaimId, consideredClaimIds, verificationIds, conflictId, decidedValue })
}

// Records a durable ReconciliationDecision. Does NOT create a CanonicalFact
// -- that is a separate, later call (admitReconciliationDecision), so a
// crash between the two leaves the decision durably explainable without a
// canonical value having been produced (crash/resume scenario I).
export function decideReconciliation(
  mission,
  nodeId,
  { fieldName, decisionType, selectedClaimId = null, consideredClaimIds = [], verificationIds = [], conflictId = null, decidedValue, rationale, decidedBy, derivationLineage = null },
  clock,
  expectedRevision
) {
  if (!RECONCILIATION_DECISION_TYPES.includes(decisionType)) {
    throw new Error(`invalid reconciliation decision type: ${decisionType}`)
  }
  if (!rationale?.trim()) throw new Error('a reconciliation decision requires a non-empty rationale')
  if (!decidedBy?.trim()) throw new Error('a reconciliation decision requires decidedBy')
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      if (decisionType === 'ACCEPT_SINGLE_VERIFIED_CLAIM') {
        const claim = node.claims.find((c) => c.id === selectedClaimId)
        if (!claim) throw new Error(`unknown claim: ${selectedClaimId}`)
        if (claim.status !== 'VERIFIED') {
          const error = new Error(`ACCEPT_SINGLE_VERIFIED_CLAIM requires a VERIFIED claim, got ${claim.status}`)
          error.code = 'TSF_CLAIM_NOT_VERIFIED'
          throw error
        }
      }
      if (decisionType === 'RESOLVE_CONFLICT') {
        const conflict = node.conflicts.find((c) => c.id === conflictId)
        if (!conflict) throw new Error(`unknown conflict: ${conflictId}`)
        if (!conflict.conflictingClaimIds.includes(selectedClaimId)) {
          throw new Error('selected claim is not part of the conflict it is meant to resolve')
        }
      }
      if (decisionType === 'ACCEPT_TYPED_MISSING') {
        const missing = node.typedMissingness.find((m) => m.fieldName === fieldName)
        if (!missing) throw new Error(`no typed missingness record exists for field ${fieldName}`)
      }
      const binding = decisionBinding({ fieldName, decisionType, selectedClaimId, consideredClaimIds, verificationIds, conflictId, decidedValue })
      const id = binding
      if (node.reconciliationDecisions.some((d) => d.id === id)) return { next: node, changed: false }
      const next = deepClone(node)
      const decidedAt = isoNow(clock)
      next.reconciliationDecisions.push({
        schemaVersion: 'TSF_RECONCILIATION_DECISION_V1',
        id,
        fieldName,
        decidedValue,
        decisionType,
        selectedClaimId,
        consideredClaimIds,
        verificationIds,
        conflictId,
        rationale,
        decidedBy,
        binding,
        derivationLineage,
        decidedAt
      })
      if (selectedClaimId) {
        const idx = next.claims.findIndex((c) => c.id === selectedClaimId)
        if (idx !== -1) next.claims[idx] = { ...next.claims[idx], status: 'RECONCILED' }
      }
      if (conflictId) {
        const cidx = next.conflicts.findIndex((c) => c.id === conflictId)
        if (cidx !== -1) next.conflicts[cidx] = { ...next.conflicts[cidx], status: 'RECONCILED', resolvedAt: decidedAt }
      }
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

// THE ONLY path to a CanonicalFact -- with one deliberate exception: an
// ACCEPT_TYPED_MISSING decision reconciles the field's missingness itself
// (marks the TypedMissingness record as the accepted, decided-upon
// outcome), it does NOT synthesize a value-bearing CanonicalFact. A field
// that is honestly missing has a canonical MISSINGNESS status, not a
// canonical null value -- collapsing the two would let downstream readers
// mistake "definitively absent" for "the value is the JSON literal null".
// Every other decisionType requires an already-persisted
// ReconciliationDecision id -- there is no overload that accepts a raw
// value, a Claim, or an Observation directly.
export function admitReconciliationDecision(mission, nodeId, reconciliationDecisionId, clock, expectedRevision) {
  return withResearchNode(
    mission,
    nodeId,
    (node) => {
      const decision = node.reconciliationDecisions.find((d) => d.id === reconciliationDecisionId)
      if (!decision) {
        const error = new Error(`unknown reconciliation decision: ${reconciliationDecisionId} -- a CanonicalFact cannot be created without a persisted ReconciliationDecision`)
        error.code = 'TSF_RECONCILIATION_DECISION_REQUIRED'
        throw error
      }
      if (decision.decisionType === 'ACCEPT_TYPED_MISSING') {
        const idx = node.typedMissingness.findIndex((m) => m.fieldName === decision.fieldName)
        if (idx === -1) throw new Error(`no typed missingness record exists for field ${decision.fieldName}`)
        if (node.typedMissingness[idx].reconciliationDecisionId === reconciliationDecisionId) {
          return { next: node, changed: false }
        }
        const next = deepClone(node)
        next.typedMissingness[idx] = { ...next.typedMissingness[idx], reconciliationDecisionId, reconciledAt: isoNow(clock) }
        return { next, changed: true }
      }
      if (!VALID_CANONICAL_DECISION_TYPES.has(decision.decisionType)) {
        // Guards against a future bug in THIS function ever constructing a
        // CanonicalFact from a decision type that isn't supposed to
        // produce one -- the same invariant research-integrity.mjs checks
        // at the read/export boundary, asserted here at the one write
        // boundary too so a regression fails loudly at write time rather
        // than silently at read time.
        throw new Error(`unreachable: decisionType ${decision.decisionType} must not produce a CanonicalFact`)
      }
      const id = sha256({ kind: 'CanonicalFact', reconciliationDecisionId })
      if (node.canonicalFacts.some((f) => f.id === id)) return { next: node, changed: false }
      const selectedClaim = decision.selectedClaimId ? node.claims.find((c) => c.id === decision.selectedClaimId) : null
      const next = deepClone(node)
      next.canonicalFacts.push({
        schemaVersion: 'TSF_CANONICAL_FACT_V1',
        id,
        fieldName: decision.fieldName,
        value: decision.decidedValue,
        temporalScope: selectedClaim?.temporalScope ?? null,
        reconciliationDecisionId,
        derivationLineage: decision.derivationLineage ?? null,
        canonicalizedAt: isoNow(clock)
      })
      return { next, changed: true }
    },
    clock,
    expectedRevision
  )
}

// Convenience for a derived field: computes decidedValue from already-
// canonical inputs (never from raw claims -- a derived field is grounded
// only in facts that already survived the full ladder) and records the
// decision with a populated DerivationLineage. Still requires the separate
// admitReconciliationDecision call to actually produce the CanonicalFact.
export function decideDerivedFieldReconciliation(
  mission,
  nodeId,
  { fieldName, derivationRule, inputFieldNames, computeFn, decidedBy = 'TSF_DERIVATION_ENGINE' },
  clock,
  expectedRevision
) {
  const node = mission.nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`unknown research node: ${nodeId}`)
  const inputFacts = inputFieldNames.map((name) => {
    const fact = node.canonicalFacts.find((f) => f.fieldName === name)
    if (!fact) {
      const error = new Error(`derived field ${fieldName} requires input ${name} to already be a CanonicalFact`)
      error.code = 'TSF_DERIVATION_INPUT_NOT_CANONICAL'
      throw error
    }
    return fact
  })
  const decidedValue = computeFn(...inputFacts.map((f) => f.value))
  return decideReconciliation(
    mission,
    nodeId,
    {
      fieldName,
      decisionType: 'ACCEPT_DERIVED_VALUE',
      consideredClaimIds: [],
      verificationIds: [],
      decidedValue,
      rationale: `derived via ${derivationRule} from canonical input(s): ${inputFieldNames.join(', ')}`,
      decidedBy,
      derivationLineage: {
        schemaVersion: 'TSF_DERIVATION_LINEAGE_V1',
        derivationRule,
        inputFieldNames,
        inputCanonicalFactIds: inputFacts.map((f) => f.id)
      }
    },
    clock,
    expectedRevision
  )
}
