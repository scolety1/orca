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
      requestedFieldTotal += 1
      const fact = node.canonicalFacts.find((f) => f.fieldName === rf.fieldName)
      const hasMissing = node.typedMissingness.some((m) => m.fieldName === rf.fieldName)
      if (fact || hasMissing) resolvedFieldTotal += 1
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
