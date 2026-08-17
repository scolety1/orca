import assert from 'node:assert/strict'
import test from 'node:test'
import { createCandidate, decideCandidate } from '../domain/adoption.mjs'
import { createReleaseState, startUpgrade, attachAdoptedCandidate, beginTesting, recordTestDisposition, promoteStable } from '../domain/release-state.mjs'

const clock = () => new Date('2026-08-17T18:00:00.000Z')
const base = { head: '1'.repeat(40), tree: '2'.repeat(40), branch: 'main' }
const resultCapsule = {
  schemaVersion: 'TSF_RESULT_CAPSULE_V1', missionId: 'work-1',
  workerIdentity: { role: 'WORKER_BALANCED', providerId: 'openai', agentId: 'codex', orcaSessionId: 's1', worktreeId: 'w1' },
  outcome: 'SUCCEEDED', repository: { head: '3'.repeat(40), tree: '4'.repeat(40) },
  filesChanged: ['src/a'], testsRun: [{ exitCode: 0 }], evidence: [{ exitCode: 0 }], blockers: [], unresolvedQuestions: [],
  implementationSummary: 'fixture', recommendedNextStep: 'verify'
}
const verifierResult = { verdict: 'GREEN', verifierIdentity: { orcaSessionId: 'verify-1' }, evidence: [{}] }

test('worker completion does not adopt and stale candidate actions fail closed', () => {
  const candidate = createCandidate({ id: 'c1', projectId: 'p1', missionId: 'm1', resultCapsule, verifierResult, baseStable: 'stable-1' }, clock)
  assert.equal(candidate.state, 'READY_FOR_ADOPTION')
  assert.throws(() => decideCandidate(candidate, { decision: 'ADOPT', expectedBinding: 'stale', requestId: 'r1' }, clock), /binding changed/)
  const adopted = decideCandidate(candidate, { decision: 'ADOPT', expectedBinding: candidate.binding, requestId: 'r1' }, clock)
  assert.equal(adopted.state, 'ADOPTED')
})

test('release promotion requires adoption, Testing PASS, and exact Stable/candidate bindings', () => {
  let release = createReleaseState({ projectId: 'p1', stable: base, published: base }, clock)
  const stableIdentity = release.stable.identity
  release = startUpgrade(release, { id: 'u1', branch: 'codex/u1', worktreeId: 'w1', worktreePath: 'fixture://w1' }, clock)
  let candidate = createCandidate({ id: 'c1', projectId: 'p1', missionId: 'm1', resultCapsule, verifierResult, baseStable: stableIdentity }, clock)
  assert.throws(() => attachAdoptedCandidate(release, candidate, clock), /adopted first/)
  candidate = decideCandidate(candidate, { decision: 'ADOPT', expectedBinding: candidate.binding, requestId: 'a1' }, clock)
  release = attachAdoptedCandidate(release, candidate, clock)
  assert.equal(release.stable.identity, stableIdentity)
  release = beginTesting(release, { runtimeAttestation: { candidateTree: resultCapsule.repository.tree } }, clock)
  release = recordTestDisposition(release, { disposition: 'PASS', evidence: [{ exitCode: 0 }] }, clock)
  assert.throws(() => promoteStable(release, { expectedStableIdentity: 'stale', expectedCandidateIdentity: release.testing.candidateIdentity, requestId: 'p1' }, clock), /Stable changed/)
  release = promoteStable(release, { expectedStableIdentity: stableIdentity, expectedCandidateIdentity: release.testing.candidateIdentity, requestId: 'p1' }, clock)
  assert.equal(release.previousStable.identity, stableIdentity)
  assert.notEqual(release.stable.identity, stableIdentity)
  assert.equal(release.published.identity, stableIdentity)
})
