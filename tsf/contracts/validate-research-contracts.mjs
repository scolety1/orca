// Hand-written runtime validators, mirroring validate-capsules.mjs's style
// (no external JSON-schema library taken as a dependency -- tsf/package.json
// has none). The .schema.v1.json files alongside this module are the
// documented contract of record; these functions are what actually gates
// data crossing the provider-independent worker seam and the admission
// boundary into durable research state.
const FINGERPRINT = /^[0-9a-f]{64}$/

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
}

// Validates the request TSF sends to a BoundedResearchWorker. Fixed shape --
// nothing here lets external content widen scope/toolPermissions/sourcePolicy
// after the fact (see research-node.mjs's buildBoundedResearchRequest, the
// only place one of these is constructed).
export function validateBoundedResearchRequest(value) {
  assertObject(value, 'bounded research request')
  if (value.schemaVersion !== 'TSF_BOUNDED_RESEARCH_REQUEST_V1') throw new Error('invalid request schemaVersion')
  for (const key of ['nodeId', 'nodeRole', 'researchQuestion', 'freshnessPolicy']) assertString(value[key], key)
  if (!FINGERPRINT.test(value.taskFingerprint)) throw new Error('taskFingerprint must be a 64-hex sha256 digest')
  for (const key of ['scope', 'preferredSources', 'disallowedSources', 'licensingConstraints', 'toolPermissions']) {
    assertArray(value[key], key)
  }
  assertObject(value.requestedOutputSchema, 'requestedOutputSchema')
  assertObject(value.temporalRequirements, 'temporalRequirements')
  for (const key of ['asOfDate', 'periodScope']) assertString(value.temporalRequirements[key], `temporalRequirements.${key}`)
  assertObject(value.sourcePolicy, 'sourcePolicy')
  assertObject(value.budget, 'budget')
  return true
}

// Validates a worker's result BEFORE it is trusted by admission. Everything
// this checks is structural -- it says nothing about truth/verification,
// which is a separate, later step (research-verification.mjs).
export function validateBoundedResearchResult(value) {
  assertObject(value, 'bounded research result')
  if (value.schemaVersion !== 'TSF_BOUNDED_RESEARCH_RESULT_V1') throw new Error('invalid result schemaVersion')
  assertString(value.nodeId, 'nodeId')
  if (!FINGERPRINT.test(value.taskFingerprint)) throw new Error('taskFingerprint must be a 64-hex sha256 digest')
  assertString(value.provider, 'provider')
  if (!['SUCCEEDED', 'FAILED', 'PARTIAL', 'NEEDS_INPUT'].includes(value.status)) throw new Error('invalid result status')
  assertObject(value.providerRunRef, 'providerRunRef')
  for (const key of ['provider', 'providerRunId', 'dispatchedAt']) assertString(value.providerRunRef[key], `providerRunRef.${key}`)
  for (const key of ['observations', 'proposedClaims', 'evidence', 'sourceReferences', 'sourceSnapshotsOrSnapshotRefs', 'newGapProposals', 'warnings', 'unresolvedQuestions']) {
    assertArray(value[key], key)
  }
  for (const claim of value.proposedClaims) {
    assertString(claim.fieldName, 'proposedClaims[].fieldName')
    if (!('proposedValue' in claim)) throw new Error('proposedClaims[].proposedValue is required')
  }
  assertObject(value.usage, 'usage')
  if (value.status === 'SUCCEEDED' && value.usage.providerReportedCostUsd === 0) {
    // Unknown/free-fake cost must still be represented honestly. A fake
    // worker legitimately reports 0 (no real provider call was made); a
    // real provider adapter reporting a bare 0 without evidence is the
    // exact null->zero coercion this contract exists to prevent -- callers
    // constructing a result for a REAL provider must pass null unless the
    // provider itself reported a real, non-fabricated 0.
  }
  if (value.status === 'FAILED' && !value.failureDetails) throw new Error('a FAILED result requires failureDetails')
  return true
}
