import { assertExpectedRevision, deepClone, isoNow, sha256 } from './canonical.mjs'

export const ADOPTION_DECISIONS = Object.freeze(['ADOPT', 'REJECT', 'REQUEST_REVISION'])

export function createCandidate({ id, projectId, missionId, resultCapsule, verifierResult, baseStable }, clock) {
  if (resultCapsule.outcome !== 'SUCCEEDED') throw new Error('only a successful result can become a candidate')
  if (verifierResult?.verdict !== 'GREEN') throw new Error('candidate requires an independent GREEN verifier result')
  const createdAt = isoNow(clock)
  const candidate = {
    schemaVersion: 'TSF_ADOPTION_CANDIDATE_V1',
    id,
    projectId,
    missionId,
    state: 'READY_FOR_ADOPTION',
    revision: 0,
    resultCapsule,
    verifierResult,
    baseStable,
    decisions: [],
    createdAt,
    updatedAt: createdAt
  }
  return { ...candidate, binding: candidateBinding(candidate) }
}

export function candidateBinding(candidate) {
  return sha256({
    schemaVersion: candidate.schemaVersion,
    id: candidate.id,
    projectId: candidate.projectId,
    missionId: candidate.missionId,
    resultDigest: sha256(candidate.resultCapsule),
    verifierDigest: sha256(candidate.verifierResult),
    baseStable: candidate.baseStable,
    revision: candidate.revision
  })
}

export function decideCandidate(
  candidate,
  { decision, expectedBinding, requestId, reason = null },
  clock
) {
  if (!ADOPTION_DECISIONS.includes(decision)) throw new Error(`invalid adoption decision: ${decision}`)
  if (candidate.state !== 'READY_FOR_ADOPTION') {
    const prior = candidate.decisions.find((entry) => entry.requestId === requestId)
    if (prior) return deepClone(candidate)
    throw new Error(`candidate is not ready for adoption: ${candidate.state}`)
  }
  if (!requestId) throw new Error('adoption requestId is required')
  if (expectedBinding !== candidate.binding) {
    const error = new Error('candidate binding changed before adoption decision')
    error.code = 'TSF_STALE_CANDIDATE_ACTION'
    throw error
  }
  const next = deepClone(candidate)
  next.decisions.push({ decision, requestId, reason, binding: expectedBinding, at: isoNow(clock) })
  next.state =
    decision === 'ADOPT' ? 'ADOPTED' : decision === 'REJECT' ? 'REJECTED' : 'REVISION_REQUESTED'
  next.revision += 1
  next.updatedAt = isoNow(clock)
  next.binding = candidateBinding(next)
  return next
}

export function requestCandidateRevision(candidate, expectedRevision) {
  assertExpectedRevision(candidate, expectedRevision)
  if (candidate.state !== 'REVISION_REQUESTED') throw new Error('candidate has no revision request')
  return {
    missionId: candidate.missionId,
    supersedesCandidateId: candidate.id,
    feedback: candidate.decisions.at(-1)?.reason ?? null
  }
}
