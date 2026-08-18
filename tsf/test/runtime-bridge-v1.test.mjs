import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validatePlanCapsule, validateResultCapsule } from '../contracts/validate-capsules.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'

const tsfRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactDir = resolve(tsfRoot, 'fixtures/runtime-bridge-v1')
const readJson = (name) => JSON.parse(readFileSync(resolve(artifactDir, name), 'utf8'))

test('real runtime bridge evidence preserves governance, identity, and isolation', () => {
  const plan = readJson('plan-capsule.json')
  const result = readJson('result-capsule.json')
  const verifier = readJson('verifier-result.json')
  const state = readJson('bridge-state.json')
  const recovery = readJson('recovery-resume-proof.json')

  assert.equal(validatePlanCapsule(plan), true)
  assert.equal(validateResultCapsule(result), true)
  assert.deepEqual(Object.keys(state.portfolio.projects), ['fixture:tsf-orca-runtime-bridge'])
  assert.deepEqual(state.portfolio.activeFleet, ['fixture:tsf-orca-runtime-bridge'])
  assert.deepEqual(state.portfolio.workSet, ['fixture:tsf-orca-runtime-bridge'])
  assert.equal(state.usageMode.mode, 'TEST_MINIMAL')
  assert.equal(state.workerRole.role, 'WORKER_BALANCED')
  assert.deepEqual(state.workerRole.observed, {
    providerId: 'openai',
    agentId: 'codex',
    model: 'gpt-5.6-sol',
    effort: 'high',
    assurance: 'OBSERVED_ORCA_NATIVE_SESSION'
  })

  assert.equal(state.mission.state, 'ADOPTED')
  assert.equal(state.candidate.state, 'ADOPTED')
  assert.equal(state.release.upgrade.state, 'ADOPTED_LOCAL')
  assert.equal(state.release.stable.head, plan.repository.head)
  assert.equal(state.release.stable.tree, plan.repository.tree)
  assert.equal(state.release.upgrade.candidate.head, result.repository.head)
  assert.equal(state.release.upgrade.candidate.tree, result.repository.tree)

  assert.equal(verifier.verdict, 'GREEN')
  assert.notEqual(verifier.verifierIdentity.orcaSessionId, result.workerIdentity.orcaSessionId)
  assert.ok(verifier.evidence.every((entry) => entry.pass))
  assert.deepEqual(result.filesChanged.sort(), plan.allowedScope.sort())
  assert.equal(result.testsRun[0].exitCode, 0)

  assert.equal(state.orcaFacts.runId, 'run_79578caf1acb')
  assert.equal(state.orcaFacts.taskId, 'task_86fb11c93eed')
  assert.equal(state.orcaFacts.dispatchId, 'ctx_b1be706d2dec')
  assert.equal(state.binding.orcaSessionId, result.workerIdentity.orcaSessionId)
  assert.equal(state.binding.providerConversationId, result.workerIdentity.providerConversationId)
  assert.equal(state.recoveryChecks.length, 2)
  assert.ok(state.recoveryChecks.every((entry) => entry.noDuplicateIdentity))
  assert.equal(recovery.sameProviderConversationResumed, true)
  assert.equal(recovery.newTaskCreated, false)
  assert.equal(recovery.newDispatchCreated, false)
  assert.equal(recovery.newWorktreeCreated, false)
  assert.ok(state.receipts.every(verifyReceipt))

  const serialized = JSON.stringify({ plan, result, verifier, state, recovery })
  assert.equal(serialized.includes('dcap_'), false)
  assert.equal(serialized.includes('authToken'), false)
  assert.equal(serialized.includes('0xc0000142'), false)
  assert.ok(readdirSync(artifactDir).every((name) => name.length <= 64))
  assert.equal(plan.repository.root, 'C:/TSF_ORCA_RUNTIME_BRIDGE_FIXTURE')
})
