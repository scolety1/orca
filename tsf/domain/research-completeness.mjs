// Multidimensional completeness -- deliberately never collapsed into one
// opaque score (§9). Every ratio is null (never coerced to 0) when its
// denominator is genuinely zero/unknown, matching this codebase's
// established "never fabricate a number" discipline (provider-forecast.mjs's
// forecastMeteredCost is the direct precedent). Worker execution-status
// COMPLETED is never read here as if it meant dataset completeness --
// every dimension below is computed from epistemic records
// (canonicalFacts/claims/evidence/conflicts/typedMissingness), not from
// node.status.
import { isoNow } from './canonical.mjs'

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

export function computeCompletenessMetrics(mission, clock) {
  const nodes = mission.nodes
  const { expectedEntities, expectedCount } = mission.expectedUniverse

  let expectedEntityCoverage
  if (expectedEntities.length > 0) {
    const presentIds = new Set(nodes.map((n) => n.targetEntity?.entityId).filter(Boolean))
    const matched = expectedEntities.filter((e) => presentIds.has(e.entityId)).length
    expectedEntityCoverage = ratio(matched, expectedEntities.length)
  } else {
    expectedEntityCoverage = expectedCount > 0 ? Math.min(1, nodes.length / expectedCount) : null
  }

  const presentEntityCoverage = ratio(
    nodes.filter((n) => n.status === 'ADMITTED' || n.status === 'COMPLETED').length,
    expectedCount
  )

  let requestedFieldTotal = 0
  let resolvedFieldTotal = 0
  let requiredFieldTotal = 0
  let requiredResolvedFieldTotal = 0
  let claimTotal = 0
  let claimsWithEvidence = 0
  let verifiableClaimTotal = 0
  let verifiedClaimTotal = 0
  let conflictCount = 0
  let unresolvedConflictCount = 0
  let typedMissingnessCount = 0
  let identityReviewCount = 0
  let derivedFieldTotal = 0
  let derivedFieldReproducible = 0

  for (const node of nodes) {
    for (const rf of node.requestedFields) {
      // Trust + Scale Hardening Continuation 2 Priority Block 3: temporal-
      // aware completeness. requestedFields.requiredTemporalScopes is
      // OPTIONAL and domain-neutral -- absent/empty means "this field has
      // no point-in-time requirement," preserving every existing single-
      // period fixture's behavior byte-for-byte (falls straight into the
      // untouched fieldName-only branch below). When present, each entry
      // is its own required (fieldName, temporalScope) coverage unit --
      // "ADP at T-7" and "ADP at T-14" are two DISTINCT snapshots that
      // must EACH resolve, and neither is satisfied by a fact/missingness
      // for a different date or with no temporalScope at all (a scope-
      // less record never satisfies a specific required scope -- failing
      // honestly rather than guessing it's "close enough").
      // REQUIRED_REQUESTED/REQUIRED_IDENTITY vs OPTIONAL_ENRICHMENT/
      // SYSTEM_PROVENANCE (real free-path research execution finding):
      // fieldCoverage below counts EVERY requested field equally, so a
      // mission can never reach COMPLETE while any optional enrichment
      // field (e.g. a derived "Year-over-Year Change" no one asked for)
      // stays unresolved -- even once every field Tim actually needs is
      // genuinely resolved. requiredFieldCoverage is the new, separate
      // metric COMPLETE-worthiness actually gates on (see
      // research-mission-fleet-driver.mjs); fieldCoverage is kept
      // unchanged for existing informational/reporting callers.
      const countsAsRequired = rf.required !== false
      const requiredScopes = rf.requiredTemporalScopes ?? null
      if (requiredScopes && requiredScopes.length > 0) {
        for (const scope of requiredScopes) {
          requestedFieldTotal += 1
          if (countsAsRequired) requiredFieldTotal += 1
          const scopedFact = node.canonicalFacts.find((f) => f.fieldName === rf.fieldName && f.temporalScope === scope)
          const scopedMissing = node.typedMissingness.some((m) => m.fieldName === rf.fieldName && m.temporalScope === scope)
          const resolved = Boolean(scopedFact || scopedMissing)
          if (resolved) resolvedFieldTotal += 1
          if (resolved && countsAsRequired) requiredResolvedFieldTotal += 1
          if (rf.derivationRule) {
            derivedFieldTotal += 1
            if (scopedFact?.derivationLineage) {
              const inputsStillCanonical = scopedFact.derivationLineage.inputCanonicalFactIds.every((id) => node.canonicalFacts.some((f) => f.id === id))
              if (inputsStillCanonical) derivedFieldReproducible += 1
            }
          }
        }
        continue
      }

      requestedFieldTotal += 1
      // No required temporal scope for this field (the common case: a
      // historical immutable value, or a mission with a single implicit
      // periodScope) -- unchanged from before: any CanonicalFact/
      // TypedMissingness for this fieldName resolves it, regardless of
      // its own temporalScope. A field with multiple CanonicalFacts across
      // periods still picks the first match here, same known, accepted
      // limitation as before for the untyped case -- callers that need
      // point-in-time precision opt in via requiredTemporalScopes instead
      // of this module guessing at one.
      if (countsAsRequired) requiredFieldTotal += 1
      const fact = node.canonicalFacts.find((f) => f.fieldName === rf.fieldName)
      const hasMissing = node.typedMissingness.some((m) => m.fieldName === rf.fieldName)
      const resolvedPlain = Boolean(fact || hasMissing)
      if (resolvedPlain) resolvedFieldTotal += 1
      if (resolvedPlain && countsAsRequired) requiredResolvedFieldTotal += 1
      if (rf.derivationRule) {
        derivedFieldTotal += 1
        if (fact?.derivationLineage) {
          const inputsStillCanonical = fact.derivationLineage.inputCanonicalFactIds.every((id) =>
            node.canonicalFacts.some((f) => f.id === id)
          )
          if (inputsStillCanonical) derivedFieldReproducible += 1
        }
      }
    }
    for (const claim of node.claims) {
      claimTotal += 1
      if (node.evidence.some((e) => e.claimId === claim.id)) claimsWithEvidence += 1
      if (claim.status !== 'REJECTED') {
        verifiableClaimTotal += 1
        if (claim.status === 'VERIFIED' || claim.status === 'RECONCILED') verifiedClaimTotal += 1
      }
    }
    conflictCount += node.conflicts.length
    unresolvedConflictCount += node.conflicts.filter((c) => c.status === 'OPEN').length
    typedMissingnessCount += node.typedMissingness.length
    if (node.identityResolutionState) identityReviewCount += 1
  }

  return {
    schemaVersion: 'TSF_COMPLETENESS_METRICS_V1',
    expectedEntityCoverage,
    presentEntityCoverage,
    fieldCoverage: ratio(resolvedFieldTotal, requestedFieldTotal),
    requiredFieldCoverage: ratio(requiredResolvedFieldTotal, requiredFieldTotal),
    evidenceCoverage: ratio(claimsWithEvidence, claimTotal),
    verifiedCoverage: ratio(verifiedClaimTotal, verifiableClaimTotal),
    conflictCount,
    unresolvedConflictCount,
    typedMissingnessCount,
    identityReviewCount,
    derivedFieldReproducibilityCoverage: ratio(derivedFieldReproducible, derivedFieldTotal),
    computedAt: isoNow(clock)
  }
}
