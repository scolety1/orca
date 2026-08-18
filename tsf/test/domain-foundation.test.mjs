import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createMission, transitionMission, projectOrcaRuntimeState } from '../domain/mission-state.mjs'
import {
  assertNewDispatchAllowed,
  createPortfolio,
  registerProject,
  setActiveFleet,
  setWorkSet
} from '../domain/portfolio.mjs'
import { createSessionBinding, assertAffinity, replaceSessionBinding } from '../domain/session-affinity.mjs'
import { assertRoutingConfiguration, resolveUsageMode } from '../domain/routing.mjs'
import { assessHealth } from '../domain/health.mjs'
import { validatePlanCapsule, validateResultCapsule } from '../contracts/validate-capsules.mjs'
import { runDogfood } from '../fixtures/run-dogfood.mjs'

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const clock = () => new Date('2026-08-17T18:00:00.000Z')

test('mission state stays above Orca runtime facts and rejects invalid transitions', () => {
  let mission = createMission({ id: 'm1', projectId: 'p1', objective: 'fixture', usageMode: 'BALANCED' }, clock)
  mission = transitionMission(mission, 'PLANNING', { expectedRevision: 0 }, clock)
  assert.equal(mission.state, 'PLANNING')
  assert.equal(projectOrcaRuntimeState({ state: 'running' }), 'ACTIVE')
  assert.equal(projectOrcaRuntimeState({ state: 'completed', exitCode: 0 }), 'REVIEW')
  assert.throws(() => transitionMission(mission, 'ADOPTED', {}, clock), /invalid mission transition/)
  assert.throws(() => transitionMission(mission, 'READY', { expectedRevision: 0 }, clock), /stale revision/)
})

test('Active Fleet preserves known projects and Work Set cannot exceed it', () => {
  let portfolio = createPortfolio(clock)
  portfolio = registerProject(portfolio, { id: 'fixture-a', displayName: 'A', root: 'fixture://a', sourceClass: 'FIXTURE' }, clock)
  portfolio = registerProject(portfolio, { id: 'fixture-b', displayName: 'B', root: 'fixture://b', sourceClass: 'FIXTURE' }, clock)
  portfolio = setActiveFleet(portfolio, ['fixture-a'], clock)
  portfolio = setWorkSet(portfolio, ['fixture-a'], clock)
  assert.deepEqual(Object.keys(portfolio.projects).sort(), ['fixture-a', 'fixture-b'])
  assert.throws(() => setWorkSet(portfolio, ['fixture-b'], clock), /subset of Active Fleet/)
})

test('Work Set removal blocks new dispatch without invalidating existing state', () => {
  let portfolio = createPortfolio(clock)
  portfolio = registerProject(portfolio, {
    id: 'fixture-a',
    displayName: 'A',
    root: 'fixture://a',
    sourceClass: 'FIXTURE'
  }, clock)
  portfolio = setActiveFleet(portfolio, ['fixture-a'], clock)
  portfolio = setWorkSet(portfolio, ['fixture-a'], clock)
  const admitted = assertNewDispatchAllowed(portfolio, 'fixture-a')
  assert.equal(admitted.allowed, true)

  portfolio = setWorkSet(portfolio, [], clock)
  assert.deepEqual(portfolio.activeFleet, ['fixture-a'])
  assert.throws(
    () => assertNewDispatchAllowed(portfolio, 'fixture-a'),
    /new dispatch blocked outside Work Set/
  )
})

test('provider roles and Usage Modes remain configuration-driven', async () => {
  const mappings = await readJson('../routing/provider-role-mappings.v1.json')
  const modes = await readJson('../routing/usage-modes.v1.json')
  const profiles = await readJson('../providers/launch-profiles.v1.json')
  assert.equal(assertRoutingConfiguration(mappings, modes, profiles), true)
  const balanced = resolveUsageMode({ mode: 'BALANCED', mappings, modes, profiles })
  assert.equal(balanced.worker.role, 'WORKER_BALANCED')
  assert.equal(balanced.worker.selectionAssurance, 'RECOMMENDED_ONLY')
  assert.equal(balanced.policy.trustMode, 'MAXIMUM_AUTONOMOUS')
})

test('session affinity is sticky and replacement is boundary-receipted', () => {
  const binding = createSessionBinding({ role: 'WORKER_BALANCED', providerId: 'openai', agentId: 'codex', orcaSessionId: 's1', worktreeId: 'w1' }, clock)
  assert.equal(assertAffinity(binding, { providerId: 'openai', agentId: 'codex', orcaSessionId: 's1', worktreeId: 'w1' }), true)
  assert.throws(() => assertAffinity(binding, { providerId: 'openai', agentId: 'codex', orcaSessionId: 's2', worktreeId: 'w1' }), /affinity changed/)
  const replacement = replaceSessionBinding(binding, { providerId: 'openai', agentId: 'codex', orcaSessionId: 's2', worktreeId: 'w1' }, { boundary: 'PROVIDER_FAILURE', reason: 'fixture', checkpointRef: 'cp1' }, clock)
  assert.equal(replacement.receipt.oldIdentity, binding.identity)
  assert.equal(replacement.binding.orcaSessionId, 's2')
})

test('capsule validators reject prose-only success and unsafe empty plans', () => {
  const plan = {
    schemaVersion: 'TSF_PLAN_CAPSULE_V1', missionId: 'w1', projectId: 'p1', objective: 'fixture', decisions: [],
    repository: { root: 'x', worktree: 'w', branch: 'b', head: '1'.repeat(40), tree: '2'.repeat(40) },
    allowedScope: ['src/a'], constraints: [], prohibitedActions: ['push'], relevantComponents: [],
    acceptanceCriteria: ['test passes'], requiredTests: [], stopConditions: ['scope change'], expectedResultFormat: 'TSF_RESULT_CAPSULE_V1'
  }
  assert.equal(validatePlanCapsule(plan), true)
  assert.throws(() => validatePlanCapsule({ ...plan, prohibitedActions: [] }), /may not be empty/)
  const result = {
    schemaVersion: 'TSF_RESULT_CAPSULE_V1', missionId: 'w1',
    workerIdentity: { role: 'WORKER_BALANCED', providerId: 'openai', agentId: 'codex', orcaSessionId: 's1', worktreeId: 'w1' },
    outcome: 'SUCCEEDED', repository: { head: '3'.repeat(40), tree: '4'.repeat(40) }, filesChanged: [], testsRun: [], evidence: [], blockers: [], unresolvedQuestions: [],
    implementationSummary: 'claimed success', recommendedNextStep: 'review'
  }
  assert.throws(() => validateResultCapsule(result), /requires evidence/)
})

test('Health reports actionable facts without granting remediation authority', () => {
  const health = assessHealth({ repositoryAvailable: true, worktreeHealthy: true, testsPassed: false, providerAvailable: false, overlayCompatible: true }, clock)
  assert.equal(health.status, 'BLOCKED')
  assert.equal(health.authority, 'ADVISORY_ONLY')
  assert.ok(health.findings.some((item) => item.code === 'TESTS_FAILED'))
})

test('fixture dogfood reaches adoption while Stable and Published remain protected', () => {
  const report = runDogfood(clock)
  assert.equal(report.status, 'GREEN_OVERLAY_DOGFOOD')
  assert.equal(report.plannerTaskCount, 2)
  assert.equal(report.workerResultCount, 2)
  assert.equal(report.verifierVerdict, 'GREEN')
  assert.equal(report.candidateState, 'ADOPTED')
  assert.equal(report.stableUnchangedBeforeAdoption, true)
  assert.equal(report.stableUnchangedByLocalAdoption, true)
  assert.equal(report.publishedUnchanged, true)
  assert.equal(report.receiptsValid, true)
})
