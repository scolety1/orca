// Generic chain-of-custody status computation -- promoted from
// mission:nwr-historical-redraft-calibration-v0's evaluation corpus real
// finding (now filed generically as REQ-003 in
// DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md): a stable local file
// is NOT the same evidence as a well-evidenced publisher-to-local
// provenance chain. The corpus's own 2020-2025 scenario is the concrete
// case this encodes -- files that were stable and hash-verified across
// repeated inventory passes, yet still correctly rated a WEAKER
// chain-of-custody than files that were both stable AND organized/logged
// by the source's own intake process.
//
// This module deliberately keeps the two inputs as SEPARATE, independent
// axes and requires both to be supplied -- there is no code path that
// lets filesystem stability alone produce a strong provenance verdict.

export const FILESYSTEM_STABILITY = Object.freeze({ STABLE: 'STABLE', UNSTABLE: 'UNSTABLE', UNCHECKED: 'UNCHECKED' })
export const PROVENANCE_STRENGTH = Object.freeze({
  NONE: 'NONE', // no origin claim at all
  ASSERTED_UNLOGGED: 'ASSERTED_UNLOGGED', // an origin is claimed, but not yet recorded by the source's own intake/logging process
  ASSERTED_LOGGED: 'ASSERTED_LOGGED', // claimed AND recorded by the source's own intake process
  INDEPENDENTLY_VERIFIED: 'INDEPENDENTLY_VERIFIED' // cross-checked against a source genuinely independent of the original claim
})

/**
 * Determine filesystem stability from a sequence of real, repeated hash
 * checks of the same nominal artifact (e.g. multiple inventory passes
 * separated by real time).
 * @param {string[]} hashSequence - hash recorded at each check, in order
 * @returns {typeof FILESYSTEM_STABILITY[keyof typeof FILESYSTEM_STABILITY]}
 */
export function computeFilesystemStability(hashSequence) {
  // REGRESSION (found by independent adversarial verification, 2026-09-04):
  // this function's own doc says stability is determined from REPEATED
  // checks (plural) -- a single hash observation was never actually
  // confirmed stable across a repeated check, yet previously returned
  // STABLE anyway, feeding straight into a real GREEN verdict downstream.
  // A single-element sequence is now honestly reported as UNCHECKED
  // (insufficient real evidence to claim stability), not silently
  // upgraded to STABLE on one observation.
  if (hashSequence.length < 2) return FILESYSTEM_STABILITY.UNCHECKED
  const allMatch = hashSequence.every((h) => h === hashSequence[0])
  return allMatch ? FILESYSTEM_STABILITY.STABLE : FILESYSTEM_STABILITY.UNSTABLE
}

/**
 * Combine the two independent axes into one reported status, WITHOUT
 * ever collapsing them into a single opaque label -- both inputs are
 * echoed back verbatim in the result alongside the derived overall tier,
 * so a caller can never lose the distinction even by only reading the
 * combined field.
 * @param {typeof FILESYSTEM_STABILITY[keyof typeof FILESYSTEM_STABILITY]} filesystemStability
 * @param {typeof PROVENANCE_STRENGTH[keyof typeof PROVENANCE_STRENGTH]} provenanceStrength
 * @returns {{ filesystemStability: string, provenanceStrength: string, overallChainOfCustody: 'GREEN'|'YELLOW'|'RED' }}
 */
export function computeChainOfCustodyStatus(filesystemStability, provenanceStrength) {
  let overallChainOfCustody
  if (filesystemStability !== FILESYSTEM_STABILITY.STABLE) {
    // An unstable or unchecked filesystem read caps the result at RED
    // regardless of how strong the provenance claim is -- a claim about
    // bytes that might not even be the same bytes anymore is not usable.
    overallChainOfCustody = 'RED'
  } else if (provenanceStrength === PROVENANCE_STRENGTH.INDEPENDENTLY_VERIFIED) {
    overallChainOfCustody = 'GREEN'
  } else if (provenanceStrength === PROVENANCE_STRENGTH.ASSERTED_LOGGED) {
    overallChainOfCustody = 'YELLOW'
  } else {
    // STABLE but NONE or ASSERTED_UNLOGGED provenance -- this is the
    // exact real 2020-2025 case: real, hash-verified stability, but the
    // origin has not been recorded by the source's own intake process.
    overallChainOfCustody = 'RED'
  }
  return { filesystemStability, provenanceStrength, overallChainOfCustody }
}
