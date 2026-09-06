// Generic same-name/same-key identity-collision resolver: computes which
// candidateEntityRefs entry (if any) a claim's disambiguating evidence
// safely resolves to, for a caller to pass directly into
// recordIdentityResolutionState (research-admission.mjs). That function is
// the existing RECORD/ENFORCE layer (persists the decision, enum-validates
// status, gates canonicalization on it) -- it has no decision algorithm of
// its own. This module is that missing algorithm, not a second, competing
// identity authority: it returns a plain {status, resolvedEntityId,
// rationale} shaped to feed straight into recordIdentityResolutionState,
// and never persists anything itself.
//
// Promoted and adapted from dataset-research-engine-v0's real, recurring
// finding (fixtures/identity-collision-resolver.mjs): multiple distinct
// real entities can share an identifying name/key -- the name/key alone
// is never sufficient identity evidence. Resolves a collision only when
// caller-supplied evidence uniquely narrows the real candidate set to
// exactly one; otherwise reports AMBIGUOUS (real candidates remain) or
// UNRESOLVED (no candidates, evidence contradicts the sole candidate, or
// evidence matches none) -- mapped directly onto
// research-admission.mjs's own IDENTITY_RESOLUTION_STATES, never a
// fourth, incompatible vocabulary.
//
// Adapted from the original NFL-fixture version: `disambiguatingFields`
// is now caller-supplied (was hardcoded to `['position','team',
// 'providerId']`) so this stays generic across every mission's own
// identity vocabulary, and candidates use the real `{entityId, ...}`
// shape (`candidateEntityRefs`) instead of the fixture's `{id, name,
// position, team, providerId}`.

/**
 * @param {Array<{entityId: string, [key: string]: unknown}>} candidateEntityRefs - every known real entity sharing the queried name/key
 * @param {Record<string, unknown>} [evidence] - disambiguating evidence attached to the claim being resolved; may be omitted entirely when none is available
 * @param {string[]} disambiguatingFields - which evidence fields are allowed to disambiguate, declared by the caller (e.g. ['position','team'] for one mission's identity vocabulary, something else entirely for another) -- never hardcoded to one domain
 * @returns {{status: 'RESOLVED'|'AMBIGUOUS'|'UNRESOLVED', resolvedEntityId: string|null, matchingCandidateCount: number, rationale: string}}
 */
export function resolveIdentityCollision(candidateEntityRefs, evidence, disambiguatingFields) {
  if (!Array.isArray(disambiguatingFields) || disambiguatingFields.length === 0) {
    throw new Error("resolveIdentityCollision requires a non-empty disambiguatingFields list -- never hardcoded to one domain's vocabulary")
  }
  if (candidateEntityRefs.length === 0) {
    return { status: 'UNRESOLVED', resolvedEntityId: null, matchingCandidateCount: 0, rationale: 'no candidates share this identity at all' }
  }
  // Evidence is optional at the call site (a genuine collision can arrive
  // with zero disambiguating evidence available) -- treat missing evidence
  // as "none supplied" rather than crashing, which is strictly worse than
  // the AMBIGUOUS/UNRESOLVED this module promises instead of a guess.
  const safeEvidence = evidence ?? {}
  if (candidateEntityRefs.length === 1) {
    // With only one name/key-sharer there is no COLLISION to resolve, but
    // the sole candidate must never be RESOLVED when supplied evidence
    // flatly CONTRADICTS it (e.g. evidence says one team but the one real
    // candidate on file is another) -- silently ignoring real,
    // contradicting evidence is exactly the kind of guess this module
    // exists to prevent. Contradicting evidence on the sole candidate
    // routes to UNRESOLVED (the evidence may be wrong, or this may be a
    // genuinely new, unlisted entity) -- evidence that is absent or that
    // agrees still resolves immediately. Scoped to the SAME
    // disambiguatingFields list the multi-candidate branch below uses, so
    // an unrelated caller-supplied field (e.g. a jersey number nobody
    // asked this module to consider) can never falsely block an
    // otherwise-uncontested sole candidate.
    const sole = candidateEntityRefs[0]
    const contradicts = disambiguatingFields.some((key) => safeEvidence[key] !== undefined && sole[key] !== safeEvidence[key])
    if (contradicts) {
      return { status: 'UNRESOLVED', resolvedEntityId: null, matchingCandidateCount: 0, rationale: 'the sole known candidate contradicts the supplied evidence -- never silently resolved to a candidate the evidence itself rules out' }
    }
    return { status: 'RESOLVED', resolvedEntityId: sole.entityId, matchingCandidateCount: 1, rationale: 'no collision -- exactly one real candidate shares this identity, and no supplied evidence contradicts it' }
  }

  const narrowed = candidateEntityRefs.filter((c) => disambiguatingFields.every((key) => safeEvidence[key] === undefined || c[key] === safeEvidence[key]))

  if (narrowed.length === 1) {
    return { status: 'RESOLVED', resolvedEntityId: narrowed[0].entityId, matchingCandidateCount: 1, rationale: 'disambiguating evidence narrowed a real identity collision to exactly one candidate' }
  }
  if (narrowed.length === 0) {
    // THE INVARIANT: evidence that matches NONE of the known candidates is
    // never treated as "so just pick the closest one" -- it is a real
    // unresolved case (the evidence itself may be wrong, or this is a
    // genuinely new, unlisted entity).
    return { status: 'UNRESOLVED', resolvedEntityId: null, matchingCandidateCount: 0, rationale: 'the provided evidence matches NONE of the known colliding candidates -- never silently forced to the "closest" one' }
  }
  // THE OTHER INVARIANT: evidence that still leaves MORE THAN ONE real
  // candidate is never silently resolved by picking the first one.
  return { status: 'AMBIGUOUS', resolvedEntityId: null, matchingCandidateCount: narrowed.length, rationale: `evidence narrowed the collision but ${narrowed.length} real candidates still match -- never silently forced to a single guess` }
}
