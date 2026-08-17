import { deepClone, isoNow, sha256 } from './canonical.mjs'

export function createReleaseState({ projectId, stable, published = null }, clock) {
  if (!projectId || !stable?.head || !stable?.tree) throw new Error('release state requires project and Stable head/tree')
  return {
    schemaVersion: 'TSF_RELEASE_STATE_V1',
    projectId,
    revision: 0,
    stable: { ...stable, identity: releaseIdentity(stable) },
    previousStable: null,
    upgrade: null,
    testing: null,
    published: published ? { ...published, identity: releaseIdentity(published) } : null,
    promotions: [],
    updatedAt: isoNow(clock)
  }
}

export function releaseIdentity(value) {
  return sha256({ head: value.head, tree: value.tree, branch: value.branch ?? null })
}

export function startUpgrade(release, { id, branch, worktreeId, worktreePath }, clock) {
  if (release.upgrade && !['REJECTED', 'PROMOTED'].includes(release.upgrade.state)) {
    throw new Error('an Upgrade candidate is already active')
  }
  const next = deepClone(release)
  next.upgrade = {
    id,
    state: 'DEVELOPMENT',
    branch,
    worktreeId,
    worktreePath,
    baseStableIdentity: release.stable.identity,
    candidate: null,
    createdAt: isoNow(clock)
  }
  next.testing = null
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function attachAdoptedCandidate(release, candidate, clock) {
  if (!release.upgrade || release.upgrade.baseStableIdentity !== release.stable.identity) {
    throw new Error('Upgrade base is missing or stale')
  }
  if (candidate.state !== 'ADOPTED') throw new Error('release candidate must be adopted first')
  const next = deepClone(release)
  next.upgrade.state = 'ADOPTED_LOCAL'
  next.upgrade.candidate = {
    candidateId: candidate.id,
    head: candidate.resultCapsule.repository?.head ?? candidate.resultCapsule.head,
    tree: candidate.resultCapsule.repository?.tree ?? candidate.resultCapsule.tree,
    binding: candidate.binding
  }
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function beginTesting(release, { runtimeAttestation = null }, clock) {
  const candidate = release.upgrade?.candidate
  if (!candidate?.head || !candidate?.tree) throw new Error('Testing requires an adopted exact candidate')
  const next = deepClone(release)
  next.upgrade.state = 'TESTING'
  next.testing = {
    candidate: deepClone(candidate),
    candidateIdentity: releaseIdentity(candidate),
    runtimeAttestation,
    disposition: 'PENDING',
    evidence: [],
    startedAt: isoNow(clock)
  }
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function recordTestDisposition(release, { disposition, evidence = [] }, clock) {
  if (!['PASS', 'ISSUES_FOUND', 'NOT_ENOUGH_TESTING'].includes(disposition)) {
    throw new Error(`invalid test disposition: ${disposition}`)
  }
  if (!release.testing) throw new Error('no Testing candidate exists')
  const next = deepClone(release)
  next.testing.disposition = disposition
  next.testing.evidence = deepClone(evidence)
  next.testing.completedAt = isoNow(clock)
  next.upgrade.state = disposition === 'PASS' ? 'READY_FOR_PROMOTION' : 'DEVELOPMENT'
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}

export function promoteStable(release, { expectedStableIdentity, expectedCandidateIdentity, requestId }, clock) {
  if (release.testing?.disposition !== 'PASS' || release.upgrade?.state !== 'READY_FOR_PROMOTION') {
    throw new Error('only a passing Testing candidate may be promoted')
  }
  if (release.stable.identity !== expectedStableIdentity) throw new Error('Stable changed before promotion')
  if (release.testing.candidateIdentity !== expectedCandidateIdentity) throw new Error('Testing candidate changed before promotion')
  const existing = release.promotions.find((item) => item.requestId === requestId)
  if (existing) return deepClone(release)
  const next = deepClone(release)
  next.previousStable = next.stable
  next.stable = {
    head: next.testing.candidate.head,
    tree: next.testing.candidate.tree,
    branch: next.upgrade.branch,
    identity: next.testing.candidateIdentity
  }
  next.upgrade.state = 'PROMOTED'
  next.promotions.push({ requestId, from: expectedStableIdentity, to: expectedCandidateIdentity, at: isoNow(clock) })
  next.revision += 1
  next.updatedAt = isoNow(clock)
  return next
}
