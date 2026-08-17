import { fileURLToPath } from 'node:url'
import { createMission, transitionMission } from '../domain/mission-state.mjs'
import { setMissionPlan, startMissionWork, registerWorkerResult, registerVerifierResult } from '../domain/coordinator.mjs'
import { createPortfolio, registerProject, setActiveFleet, setWorkSet, workSetFingerprint } from '../domain/portfolio.mjs'
import { createCandidate, decideCandidate } from '../domain/adoption.mjs'
import { createReleaseState, startUpgrade, attachAdoptedCandidate } from '../domain/release-state.mjs'
import { createReceipt, verifyReceipt } from '../domain/receipts.mjs'

const HEAD = '1'.repeat(40)
const TREE = '2'.repeat(40)
const CANDIDATE_HEAD = '3'.repeat(40)
const CANDIDATE_TREE = '4'.repeat(40)

function plan(id, scope, worktree) {
  return {
    schemaVersion: 'TSF_PLAN_CAPSULE_V1',
    missionId: id,
    projectId: 'fixture-sunrise',
    objective: `Implement the ${id} half of the fixture goal.`,
    decisions: ['Keep each worker scope disjoint.'],
    repository: { root: 'fixture://sunrise', worktree, branch: `codex/${id}`, head: HEAD, tree: TREE },
    allowedScope: [scope],
    constraints: ['Fixture repository only.'],
    prohibitedActions: ['push', 'merge', 'deploy', 'access real project repositories'],
    relevantComponents: [scope],
    acceptanceCriteria: [`${scope} is implemented and tested.`],
    requiredTests: [`node --test ${scope}`],
    stopConditions: ['Any path outside the fixture is requested.'],
    expectedResultFormat: 'TSF_RESULT_CAPSULE_V1'
  }
}

function result(id, worktree, file) {
  return {
    schemaVersion: 'TSF_RESULT_CAPSULE_V1',
    missionId: id,
    workerIdentity: {
      role: 'WORKER_BALANCED',
      providerId: 'openai',
      agentId: 'codex',
      modelObserved: null,
      orcaSessionId: `orca-session-${id}`,
      providerConversationId: null,
      worktreeId: worktree
    },
    outcome: 'SUCCEEDED',
    repository: { head: CANDIDATE_HEAD, tree: CANDIDATE_TREE },
    filesChanged: [file],
    testsRun: [{ command: `node --test ${file}`, exitCode: 0 }],
    evidence: [{ kind: 'TEST_EXIT', exitCode: 0, file }],
    blockers: [],
    unresolvedQuestions: [],
    implementationSummary: `Implemented isolated fixture file ${file}.`,
    recommendedNextStep: 'Independent verification.'
  }
}

export function runDogfood(clock = () => new Date('2026-08-17T18:00:00.000Z')) {
  let portfolio = createPortfolio(clock)
  portfolio = registerProject(portfolio, {
    id: 'fixture-sunrise',
    displayName: 'Sunrise Fixture',
    root: 'fixture://sunrise',
    sourceClass: 'FIXTURE',
    provenance: 'DISPOSABLE_SYNTHETIC'
  }, clock)
  portfolio = setActiveFleet(portfolio, ['fixture-sunrise'], clock)
  portfolio = setWorkSet(portfolio, ['fixture-sunrise'], clock)

  let release = createReleaseState({
    projectId: 'fixture-sunrise',
    stable: { head: HEAD, tree: TREE, branch: 'main' },
    published: { head: HEAD, tree: TREE, branch: 'main' }
  }, clock)
  const initialStable = release.stable.identity
  release = startUpgrade(release, {
    id: 'upgrade-001',
    branch: 'codex/fixture-upgrade',
    worktreeId: 'orca-upgrade-wt',
    worktreePath: 'fixture://sunrise/upgrade'
  }, clock)

  let mission = createMission({
    id: 'mission-sunrise-001',
    projectId: 'fixture-sunrise',
    objective: 'Add two independently testable fixture features, verify them, and prepare adoption.',
    usageMode: 'BALANCED',
    plannerIdentity: { role: 'PLANNER_DEEP', orcaSessionId: 'orca-planner-001' }
  }, clock)
  mission = transitionMission(mission, 'PLANNING', { reason: 'AMBIGUOUS_GOAL_ACCEPTED' }, clock)
  mission = setMissionPlan(mission, [
    plan('work-alpha', 'src/alpha.mjs', 'orca-wt-alpha'),
    plan('work-beta', 'src/beta.mjs', 'orca-wt-beta')
  ], clock)
  mission = startMissionWork(mission, clock)
  mission = registerWorkerResult(mission, result('work-alpha', 'orca-wt-alpha', 'src/alpha.mjs'), clock)
  mission = registerWorkerResult(mission, result('work-beta', 'orca-wt-beta', 'src/beta.mjs'), clock)
  mission = registerVerifierResult(mission, {
    verdict: 'GREEN',
    verifierIdentity: {
      role: 'VERIFIER_INDEPENDENT',
      providerId: 'anthropic',
      agentId: 'claude-code',
      modelObserved: null,
      orcaSessionId: 'orca-verifier-001'
    },
    evidence: [{ kind: 'INDEPENDENT_REVIEW', resultDigests: mission.results.map((entry) => entry.digest) }]
  }, clock)

  const combinedResult = {
    ...mission.results[0].capsule,
    missionId: mission.id,
    filesChanged: mission.results.flatMap((entry) => entry.capsule.filesChanged),
    testsRun: mission.results.flatMap((entry) => entry.capsule.testsRun),
    evidence: mission.results.flatMap((entry) => entry.capsule.evidence),
    implementationSummary: 'Planner synthesized both isolated worker results.'
  }
  let candidate = createCandidate({
    id: 'candidate-sunrise-001',
    projectId: portfolio.projects['fixture-sunrise'].id,
    missionId: mission.id,
    resultCapsule: combinedResult,
    verifierResult: mission.verifierResults.at(-1),
    baseStable: release.stable.identity
  }, clock)
  const preAdoptionStable = release.stable.identity
  candidate = decideCandidate(candidate, {
    decision: 'ADOPT',
    expectedBinding: candidate.binding,
    requestId: 'fixture-adopt-001',
    reason: 'Fixture-only dogfood approval.'
  }, clock)
  mission = transitionMission(mission, 'ADOPTED', { reason: 'FIXTURE_ADOPTION_APPROVED' }, clock)
  release = attachAdoptedCandidate(release, candidate, clock)

  const receipts = [
    createReceipt({ kind: 'MISSION_CREATED', projectId: mission.projectId, missionId: mission.id, decision: 'CREATE' }, { clock }),
    createReceipt({ kind: 'CANDIDATE_FINISHED', projectId: mission.projectId, missionId: mission.id, result: 'SUCCEEDED', tests: combinedResult.testsRun }, { clock }),
    createReceipt({ kind: 'VERIFIER_RESULT', projectId: mission.projectId, missionId: mission.id, result: 'GREEN', execution: mission.verifierResults.at(-1).verifierIdentity }, { clock }),
    createReceipt({ kind: 'ADOPTION_DECISION', projectId: mission.projectId, missionId: mission.id, decision: 'ADOPT', identities: { candidateBinding: candidate.binding } }, { clock })
  ]

  return {
    schemaVersion: 'TSF_DOGFOOD_REPORT_V1',
    status: 'GREEN_OVERLAY_DOGFOOD',
    executionTruth: 'DOMAIN_AND_ORCA_ADAPTER_FIXTURE; NATIVE_ORCA_WORKTREE_TERMINAL_PROOF_NOT_COMPLETED',
    project: portfolio.projects['fixture-sunrise'],
    activeFleet: portfolio.activeFleet,
    workSet: portfolio.workSet,
    workSetFingerprint: workSetFingerprint(portfolio),
    usageMode: mission.usageMode,
    plannerTaskCount: mission.workItems.length,
    workerResultCount: mission.results.length,
    verifierVerdict: mission.verifierResults.at(-1).verdict,
    missionState: mission.state,
    candidateState: candidate.state,
    stableUnchangedBeforeAdoption: initialStable === preAdoptionStable,
    stableUnchangedByLocalAdoption: initialStable === release.stable.identity,
    publishedUnchanged: release.published.identity === initialStable,
    receiptCount: receipts.length,
    receiptsValid: receipts.every(verifyReceipt),
    realProjectAccess: false,
    remoteActions: false
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runDogfood(), null, 2))
}
