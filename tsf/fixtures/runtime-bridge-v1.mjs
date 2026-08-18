import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCandidate, decideCandidate } from '../domain/adoption.mjs'
import {
  registerVerifierResult,
  registerWorkerResult,
  setMissionPlan,
  startMissionWork
} from '../domain/coordinator.mjs'
import { createMission, transitionMission } from '../domain/mission-state.mjs'
import { createPortfolio, registerProject, setActiveFleet, setWorkSet } from '../domain/portfolio.mjs'
import { createReceipt, verifyReceipt } from '../domain/receipts.mjs'
import { attachAdoptedCandidate, createReleaseState, startUpgrade } from '../domain/release-state.mjs'
import { resolveRole, resolveUsageMode } from '../domain/routing.mjs'
import { assertAffinity, createSessionBinding } from '../domain/session-affinity.mjs'
import { createOrcaDispatch } from '../adapters/orca-runtime.mjs'
import { validatePlanCapsule, validateResultCapsule } from '../contracts/validate-capsules.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const artifactDir = resolve(scriptDir, 'runtime-bridge-v1')
const statePath = resolve(artifactDir, 'bridge-state.json')
const planPath = resolve(artifactDir, 'plan-capsule.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
const clock = () => new Date()

function initialize() {
  const plan = readJson(planPath)
  validatePlanCapsule(plan)
  const mappings = readJson(resolve(scriptDir, '../routing/provider-role-mappings.v1.json'))
  const modes = readJson(resolve(scriptDir, '../routing/usage-modes.v1.json'))
  const profiles = readJson(resolve(scriptDir, '../providers/launch-profiles.v1.json'))

  let portfolio = createPortfolio(clock)
  portfolio = registerProject(portfolio, {
    id: plan.projectId,
    displayName: 'TSF Orca Runtime Bridge Fixture',
    root: plan.repository.root,
    sourceClass: 'FIXTURE',
    provenance: 'DISPOSABLE_SYNTHETIC'
  }, clock)
  portfolio = setActiveFleet(portfolio, [plan.projectId], clock)
  portfolio = setWorkSet(portfolio, [plan.projectId], clock)

  const usageMode = resolveUsageMode({ mode: 'TEST_MINIMAL', mappings, modes, profiles })
  const workerRole = resolveRole({ role: 'WORKER_BALANCED', mappings, profiles })
  let mission = createMission({
    id: 'tsf-orca-native-runtime-bridge-v1',
    projectId: plan.projectId,
    objective: 'Prove a real governed TSF to Orca to Codex fixture execution and adoption boundary.',
    usageMode: 'TEST_MINIMAL',
    plannerIdentity: {
      role: 'PLANNER_BALANCED',
      orcaSessionId: process.env.TSF_COORDINATOR_HANDLE
    }
  }, clock)
  mission = transitionMission(mission, 'PLANNING', { reason: 'LIVE_BRIDGE_MISSION_ACCEPTED' }, clock)
  mission = setMissionPlan(mission, [plan], clock)

  let release = createReleaseState({
    projectId: plan.projectId,
    stable: { head: plan.repository.head, tree: plan.repository.tree, branch: 'main' },
    published: null
  }, clock)
  release = startUpgrade(release, {
    id: 'upgrade-native-runtime-bridge-v1',
    branch: plan.repository.branch,
    worktreeId: process.env.TSF_WORKTREE_ID,
    worktreePath: plan.repository.worktree
  }, clock)

  const receipts = [createReceipt({
    kind: 'MISSION_CREATED',
    projectId: plan.projectId,
    missionId: mission.id,
    decision: 'CREATE',
    identities: {
      orcaRuntimeId: process.env.TSF_RUNTIME_ID,
      orcaRunId: process.env.TSF_RUN_ID,
      orcaTaskId: process.env.TSF_TASK_ID
    }
  }, { clock })]

  const state = {
    schemaVersion: 'TSF_ORCA_NATIVE_RUNTIME_BRIDGE_STATE_V1',
    portfolio,
    usageMode,
    workerRole,
    plan,
    mission,
    release,
    binding: null,
    dispatch: null,
    orcaFacts: {
      runtimeId: process.env.TSF_RUNTIME_ID,
      runId: process.env.TSF_RUN_ID,
      taskId: process.env.TSF_TASK_ID,
      coordinatorHandle: process.env.TSF_COORDINATOR_HANDLE,
      worktreeId: process.env.TSF_WORKTREE_ID,
      worktreePath: plan.repository.worktree
    },
    candidate: null,
    receipts,
    recoveryChecks: [],
    updatedAt: new Date().toISOString()
  }
  writeJson(statePath, state)
  return state
}

function bindWorker(factsPath) {
  const state = readJson(statePath)
  const facts = readJson(resolve(factsPath))
  const binding = createSessionBinding({
    role: 'WORKER_BALANCED',
    providerId: facts.providerId,
    agentId: facts.agentId,
    modelClass: state.workerRole.requested.modelClass,
    modelObserved: facts.modelObserved,
    orcaSessionId: facts.orcaSessionId,
    providerConversationId: facts.providerConversationId,
    worktreeId: facts.worktreeId
  }, clock)
  const dispatch = createOrcaDispatch({
    planCapsule: state.plan,
    roleResolution: {
      ...state.workerRole,
      observed: {
        providerId: facts.providerId,
        agentId: facts.agentId,
        model: facts.modelObserved,
        effort: facts.effortObserved,
        assurance: 'OBSERVED_ORCA_NATIVE_SESSION'
      },
      selectionAssurance: 'OBSERVED'
    },
    sessionBinding: { ...binding, worktreePath: facts.worktreePath },
    usageMode: state.usageMode.mode
  })
  state.workerRole.observed = {
    providerId: facts.providerId,
    agentId: facts.agentId,
    model: facts.modelObserved,
    effort: facts.effortObserved,
    assurance: 'OBSERVED_ORCA_NATIVE_SESSION'
  }
  state.workerRole.selectionAssurance = 'OBSERVED'
  state.binding = binding
  state.dispatch = dispatch
  state.orcaFacts = { ...state.orcaFacts, ...facts }
  state.mission = startMissionWork(state.mission, clock)
  state.updatedAt = new Date().toISOString()
  writeJson(statePath, state)
  return state
}

function admit(resultPath, verifierPath) {
  const state = readJson(statePath)
  const result = readJson(resolve(resultPath))
  const verifier = readJson(resolve(verifierPath))
  validateResultCapsule(result)
  state.mission = registerWorkerResult(state.mission, result, clock)
  state.mission = registerVerifierResult(state.mission, verifier, clock)
  state.candidate = createCandidate({
    id: 'candidate-native-runtime-bridge-v1',
    projectId: state.plan.projectId,
    missionId: state.mission.id,
    resultCapsule: result,
    verifierResult: verifier,
    baseStable: state.release.stable.identity
  }, clock)
  state.receipts.push(createReceipt({
    kind: 'CANDIDATE_FINISHED',
    projectId: state.plan.projectId,
    missionId: state.mission.id,
    orca: {
      sessionId: result.workerIdentity.orcaSessionId,
      worktreeId: result.workerIdentity.worktreeId,
      worktreePath: state.plan.repository.worktree
    },
    execution: result.workerIdentity,
    result: result.outcome,
    tests: result.testsRun,
    identities: { head: result.repository.head, tree: result.repository.tree }
  }, { previousReceiptHash: state.receipts.at(-1).receiptHash, clock }))
  state.receipts.push(createReceipt({
    kind: 'VERIFIER_RESULT',
    projectId: state.plan.projectId,
    missionId: state.mission.id,
    orca: { sessionId: verifier.verifierIdentity.orcaSessionId },
    execution: verifier.verifierIdentity,
    result: verifier.verdict
  }, { previousReceiptHash: state.receipts.at(-1).receiptHash, clock }))
  state.updatedAt = new Date().toISOString()
  writeJson(statePath, state)
  return state
}

function recover(factsPath) {
  const state = readJson(statePath)
  const facts = readJson(resolve(factsPath))
  assertAffinity(state.binding, facts)
  const identityChecks = ['runId', 'taskId', 'dispatchId', 'orcaSessionId', 'worktreeId']
    .map((key) => ({ key, expected: state.orcaFacts[key], observed: facts[key], match: state.orcaFacts[key] === facts[key] }))
  const check = {
    checkedAt: new Date().toISOString(),
    runtimeIdBefore: state.orcaFacts.runtimeId,
    runtimeIdAfter: facts.runtimeId,
    runtimeRecreated: state.orcaFacts.runtimeId !== facts.runtimeId,
    identityChecks,
    noDuplicateIdentity: identityChecks.every((item) => item.match),
    missionState: state.mission.state
  }
  if (!check.noDuplicateIdentity) throw new Error('recovery identity mismatch')
  state.recoveryChecks.push(check)
  state.orcaFacts.runtimeId = facts.runtimeId
  state.updatedAt = new Date().toISOString()
  writeJson(statePath, state)
  return state
}

function adopt() {
  const state = readJson(statePath)
  if (state.mission.state !== 'READY_FOR_ADOPTION') throw new Error('mission is not ready for adoption')
  state.candidate = decideCandidate(state.candidate, {
    decision: 'ADOPT',
    expectedBinding: state.candidate.binding,
    requestId: 'fixture-adopt-native-runtime-bridge-v1',
    reason: 'Explicit fixture-only adoption after GREEN verifier and restart recovery.'
  }, clock)
  state.mission = transitionMission(state.mission, 'ADOPTED', {
    reason: 'EXPLICIT_FIXTURE_ADOPTION_APPROVED',
    evidence: [state.candidate.binding]
  }, clock)
  state.release = attachAdoptedCandidate(state.release, state.candidate, clock)
  state.receipts.push(createReceipt({
    kind: 'ADOPTION_DECISION',
    projectId: state.plan.projectId,
    missionId: state.mission.id,
    decision: 'ADOPT',
    identities: {
      candidateBinding: state.candidate.binding,
      stableIdentity: state.release.stable.identity,
      upgradeHead: state.release.upgrade.candidate.head
    }
  }, { previousReceiptHash: state.receipts.at(-1).receiptHash, clock }))
  if (!state.receipts.every(verifyReceipt)) throw new Error('receipt chain validation failed')
  state.updatedAt = new Date().toISOString()
  writeJson(statePath, state)
  return state
}

const [command, ...args] = process.argv.slice(2)
const result = command === 'init'
  ? initialize()
  : command === 'bind'
    ? bindWorker(args[0])
    : command === 'admit'
      ? admit(args[0], args[1])
      : command === 'recover'
        ? recover(args[0])
        : command === 'adopt'
          ? adopt()
          : (() => { throw new Error(`unknown runtime bridge command: ${command}`) })()

console.log(JSON.stringify({
  command,
  missionState: result.mission.state,
  portfolioProjects: Object.keys(result.portfolio.projects),
  activeFleet: result.portfolio.activeFleet,
  workSet: result.portfolio.workSet,
  usageMode: result.usageMode.mode,
  workerRole: result.workerRole.role,
  runtimeId: result.orcaFacts.runtimeId,
  taskId: result.orcaFacts.taskId,
  sessionId: result.orcaFacts.orcaSessionId ?? null,
  recoveryChecks: result.recoveryChecks.length,
  candidateState: result.candidate?.state ?? null,
  receiptsValid: result.receipts.every(verifyReceipt)
}, null, 2))
