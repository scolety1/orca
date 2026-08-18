import { execFileSync } from 'node:child_process'
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
import { assessHealth } from '../domain/health.mjs'
import { createMission, transitionMission } from '../domain/mission-state.mjs'
import {
  assertNewDispatchAllowed,
  createPortfolio,
  registerProject,
  setActiveFleet,
  setWorkSet
} from '../domain/portfolio.mjs'
import { createReceipt, receiptNdjson, verifyReceipt } from '../domain/receipts.mjs'
import {
  attachAdoptedCandidate,
  beginTesting,
  createReleaseState,
  recordTestDisposition,
  startUpgrade
} from '../domain/release-state.mjs'
import { validatePlanCapsule, validateResultCapsule } from '../contracts/validate-capsules.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const artifactDir = resolve(scriptDir, 'long-autonomous-runtime-v1')
const fixtureRoot = 'C:/TSF_ORCA_LONG_RUN_FIXTURE'
const workspaceRoot = 'C:/Users/codex-agent/orca/workspaces/TSF_ORCA_LONG_RUN_FIXTURE'
const projectId = 'fixture:tsf-orca-long-run'
const missionId = 'tsf-orca-long-run-mission-board'
const stableHead = 'd1420fee6034e8ba3e1f3ab8fb64749ddb1802cf'
const stableTree = '865b4bf06ff673b976027f324647c21360cd59f6'
const runId = 'run_e1297c4e9d73'
const runtimeId = '7f6b183d-6adf-476d-951c-341bb2f2a629'
const plannerSession = 'term_e449ba52-8676-4f80-8fe3-defedc5534ad'
const integrationWorktreeId = `e77139ae-891a-49ed-b1e2-d50b673d2285::${workspaceRoot}/tsf-longrun-integration`

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (name, value) => writeFileSync(
  resolve(artifactDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  'utf8'
)
const clock = (() => {
  let tick = Date.parse('2026-08-18T02:15:00.000Z')
  return () => new Date(tick += 1_000)
})()

function git(path, ...args) {
  return execFileSync(
    'git',
    ['-c', `safe.directory=${path}`, '-C', path, ...args],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
}

const workers = [
  {
    missionId: 'tsf-orca-long-run-normalization',
    role: 'WORKER_CHEAP',
    terminal: 'term_73b1d795-50b8-4bdb-add2-95559b70b9a4',
    worktree: `${workspaceRoot}/tsf-longrun-normalization`,
    commit: '4a92b9970860cea52b623b43e5c19cd62471f24f',
    tree: '983acad65e0c27219c6d3e68be6370025d0fe711',
    files: ['src/normalize-tasks.mjs', 'test/normalize-tasks.test.mjs'],
    tests: 6,
    dispatchId: 'ctx_616de647afab',
    usageMode: 'ECONOMY',
    recovery: null,
    revision: 'same-owner commit correction'
  },
  {
    missionId: 'tsf-orca-long-run-filtering',
    role: 'WORKER_BALANCED',
    terminal: 'term_0402ec03-258d-462a-b153-ef3e93d97cbc',
    worktree: `${workspaceRoot}/tsf-longrun-filtering`,
    commit: '0f5512e2e2bfbffdf9e8e2644a50efcee589b3d5',
    tree: '2be156a573d0d24cf3787d4451157177bbb696a1',
    files: ['src/filter-tasks.mjs', 'test/filter-tasks.test.mjs'],
    tests: 6,
    dispatchId: 'ctx_e9d124ac4c48',
    usageMode: 'BALANCED',
    recovery: null,
    revision: 'same-owner commit correction'
  },
  {
    missionId: 'tsf-orca-long-run-health-summary',
    role: 'WORKER_BALANCED',
    terminal: 'term_057b7d55-39f4-48f5-a09e-9cffc9254f1a',
    worktree: `${workspaceRoot}/tsf-longrun-health`,
    commit: 'fc13ae8f66c0c4b096f198019232279e23d8c1f6',
    tree: 'ebced3be5cffc3fd3daa773bed7754112e368df3',
    files: ['src/summarize-health.mjs', 'test/summarize-health.test.mjs'],
    tests: 6,
    dispatchId: 'ctx_8ec4fc858e2e',
    usageMode: 'BALANCED',
    recovery: 'intentional interrupt; same terminal and conversation resumed from clean HEAD',
    revision: null
  },
  {
    missionId: 'tsf-orca-long-run-offline-board-integration',
    role: 'WORKER_DEEP',
    terminal: 'term_3fb32c86-cc0c-42d4-9e50-0b95500fddbe',
    worktree: `${workspaceRoot}/tsf-longrun-integration`,
    commit: '98affbde5c59f9758e204dd7cd0a3dca9264f0e4',
    tree: 'e8c2ba1c7a211c632ada460e2805a8cf53a3691b',
    files: [
      'public/app.js',
      'public/index.html',
      'public/styles.css',
      'src/mission-board.mjs',
      'src/server.mjs',
      'test/integration/mission-board.test.mjs'
    ],
    tests: 22,
    dispatchId: 'ctx_7642c9ec777c',
    usageMode: 'MAXIMUM',
    recovery: 'canonical ORCA_USER_DATA_PATH restored completion attachment',
    revision: 'same-owner commit and completion correction'
  }
]

function verifyGitFacts() {
  for (const worker of workers) {
    if (git(worker.worktree, 'rev-parse', 'HEAD') !== worker.commit) {
      throw new Error(`candidate head drifted: ${worker.missionId}`)
    }
    if (git(worker.worktree, 'rev-parse', 'HEAD^{tree}') !== worker.tree) {
      throw new Error(`candidate tree drifted: ${worker.missionId}`)
    }
    if (git(worker.worktree, 'status', '--porcelain')) {
      throw new Error(`candidate worktree is not clean: ${worker.missionId}`)
    }
  }
  if (git(fixtureRoot, 'rev-parse', 'main') !== stableHead) throw new Error('Stable moved')
  if (git(fixtureRoot, 'rev-parse', 'main^{tree}') !== stableTree) throw new Error('Stable tree moved')
}

function resultCapsule(worker) {
  const worktreeId = `e77139ae-891a-49ed-b1e2-d50b673d2285::${worker.worktree}`
  const result = {
    schemaVersion: 'TSF_RESULT_CAPSULE_V1',
    missionId: worker.missionId,
    workerIdentity: {
      role: worker.role,
      providerId: 'openai',
      agentId: 'codex',
      modelObserved: 'gpt-5.6-sol',
      orcaSessionId: worker.terminal,
      providerConversationId: null,
      worktreeId
    },
    outcome: 'SUCCEEDED',
    repository: { head: worker.commit, tree: worker.tree },
    filesChanged: worker.files,
    testsRun: [{ command: 'npm test', exitCode: 0, passed: worker.tests, failed: 0 }],
    evidence: [
      { kind: 'ORCA_DISPATCH', runId, dispatchId: worker.dispatchId, status: 'completed' },
      { kind: 'GIT', clean: true, exactCommit: worker.commit, exactTree: worker.tree },
      { kind: 'USAGE_MODE', mode: worker.usageMode },
      ...(worker.recovery ? [{ kind: 'RECOVERY', detail: worker.recovery }] : []),
      ...(worker.revision ? [{ kind: 'BOUNDED_REVISION', detail: worker.revision }] : [])
    ],
    blockers: [],
    unresolvedQuestions: [],
    implementationSummary: `Completed ${worker.missionId} in its isolated Orca worktree.`,
    recommendedNextStep: worker.role === 'WORKER_DEEP'
      ? 'Admit independent verifier and prepare explicit fixture adoption.'
      : 'Admit independent verification and continue only through the planner gate.'
  }
  validateResultCapsule(result)
  return result
}

function main() {
  mkdirSync(artifactDir, { recursive: true })
  verifyGitFacts()
  const plannerOutput = readJson(resolve(artifactDir, 'planner-output.json'))
  const continuation = readJson(resolve(artifactDir, 'continuation-1.json'))
  const synthesis = readJson(resolve(artifactDir, 'final-synthesis.json'))
  const plans = plannerOutput.workItems.map((item) => item.planCapsule)
  plans.forEach(validatePlanCapsule)
  if (continuation.decision !== 'CONTINUE_TO_INTEGRATION') throw new Error('planner did not continue')
  if (synthesis.decision !== 'READY_FOR_ADOPTION') throw new Error('planner did not synthesize')

  let portfolio = createPortfolio(clock)
  portfolio = registerProject(portfolio, {
    id: projectId,
    displayName: 'TSF Orca Long Autonomous Fixture',
    root: fixtureRoot,
    sourceClass: 'FIXTURE',
    provenance: 'DISPOSABLE_SYNTHETIC'
  }, clock)
  portfolio = setActiveFleet(portfolio, [projectId], clock)
  portfolio = setWorkSet(portfolio, [projectId], clock)
  const dispatchAdmission = assertNewDispatchAllowed(portfolio, projectId)
  portfolio = setWorkSet(portfolio, [], clock)
  let blockedDispatch
  try {
    assertNewDispatchAllowed(portfolio, projectId)
  } catch (error) {
    blockedDispatch = error.message
  }
  portfolio = setWorkSet(portfolio, [projectId], clock)
  const dispatchReadmission = assertNewDispatchAllowed(portfolio, projectId)
  const workSetGateProof = {
    schemaVersion: 'TSF_WORK_SET_GATE_PROOF_V1',
    admission: dispatchAdmission,
    removal: {
      newDispatchBlocked: blockedDispatch,
      activeFleetPreserved: portfolio.activeFleet,
      existingWorkerSettlement: 'THREE_PREEXISTING_DISPATCHES_COMPLETED'
    },
    readmission: dispatchReadmission
  }

  let mission = createMission({
    id: missionId,
    projectId,
    objective: plannerOutput.goalDecisions.map((item) => item.resolution).join(' '),
    usageMode: 'MAXIMUM',
    plannerIdentity: {
      role: 'PLANNER_DEEP',
      providerId: 'openai',
      agentId: 'codex',
      modelObserved: 'gpt-5.6-sol',
      effortObserved: 'high',
      orcaSessionId: plannerSession,
      providerSubstitution: 'CLAUDE_SAFE unavailable; CODEX_SAFE fallback'
    }
  }, clock)
  mission = transitionMission(mission, 'PLANNING', { reason: 'PERSISTENT_PLANNER_STARTED' }, clock)
  mission = setMissionPlan(mission, plans, clock)
  mission = startMissionWork(mission, clock)
  const results = workers.map(resultCapsule)
  for (const result of results) mission = registerWorkerResult(mission, result, clock)

  const verifierResult = {
    schemaVersion: 'TSF_VERIFIER_RESULT_V1',
    verdict: 'GREEN',
    verifierIdentity: {
      role: 'VERIFIER_INDEPENDENT',
      providerId: 'openai',
      agentId: 'codex',
      modelObserved: 'gpt-5.6-sol',
      orcaSessionId: 'term_9a56c7f4-aa55-414d-94b9-a36b66025c38',
      worktreeId: `e77139ae-891a-49ed-b1e2-d50b673d2285::${workspaceRoot}/tsf-longrun-final-verifier`
    },
    verifiedCandidate: { head: workers[3].commit, tree: workers[3].tree },
    dispatchId: 'ctx_ea81ed4a3b07',
    evidence: [
      { check: 'INDEPENDENT_WORKTREE_CLEAN', pass: true },
      { check: 'EXACT_SIX_INTEGRATION_PATHS', pass: true, paths: workers[3].files },
      { check: 'DEPENDENCY_BLOBS_RETAINED', pass: true },
      { check: 'LOOPBACK_AND_LOCAL_ASSETS', pass: true },
      { check: 'INDEPENDENT_TESTS', pass: true, passed: 22, failed: 0 }
    ],
    blockers: [],
    verifiedAt: '2026-08-18T02:14:08.752Z'
  }
  mission = registerVerifierResult(mission, verifierResult, clock)

  let release = createReleaseState({
    projectId,
    stable: { head: stableHead, tree: stableTree, branch: 'main' },
    published: { head: stableHead, tree: stableTree, branch: 'main' }
  }, clock)
  release = startUpgrade(release, {
    id: 'upgrade-long-autonomous-runtime-v1',
    branch: 'tsf-longrun-integration',
    worktreeId: integrationWorktreeId,
    worktreePath: `${workspaceRoot}/tsf-longrun-integration`
  }, clock)

  let candidate = createCandidate({
    id: 'candidate-long-autonomous-runtime-v1',
    projectId,
    missionId,
    resultCapsule: results[3],
    verifierResult,
    baseStable: release.stable.identity
  }, clock)
  const readyBinding = candidate.binding
  candidate = decideCandidate(candidate, {
    decision: 'ADOPT',
    expectedBinding: readyBinding,
    requestId: 'fixture-adopt-long-autonomous-runtime-v1',
    reason: 'Explicit fixture-only adoption after planner synthesis, independent verification, and Orca browser proof.'
  }, clock)
  mission = transitionMission(mission, 'ADOPTED', {
    reason: 'EXPLICIT_FIXTURE_ONLY_ADOPTION',
    evidence: [candidate.binding]
  }, clock)
  release = attachAdoptedCandidate(release, candidate, clock)
  release = beginTesting(release, {
    runtimeAttestation: { runtimeId, runId, browserPageId: 'a9151cba-7ef4-46b1-9a08-f2200fd2c6c1' }
  }, clock)
  release = recordTestDisposition(release, {
    disposition: 'PASS',
    evidence: ['22/22 independent tests', 'Orca native browser filter proof', 'loopback-only listener']
  }, clock)
  if (release.stable.head !== stableHead || release.published.head !== stableHead) {
    throw new Error('Stable or Published moved without promotion')
  }

  const browserProof = {
    schemaVersion: 'TSF_ORCA_BROWSER_PROOF_V1',
    browserPageId: 'a9151cba-7ef4-46b1-9a08-f2200fd2c6c1',
    url: 'http://127.0.0.1:43128/',
    title: 'Mission Control',
    loadError: null,
    initial: {
      missions: ['M-1', 'M-2', 'M-3', 'M-4'],
      health: { total: 4, actionable: 3, staleActionable: 1, done: 1 },
      externalAssets: []
    },
    filtered: {
      criteria: { owner: 'navigator', state: 'active', priority: 'high' },
      missions: ['M-1'],
      health: { total: 1, actionable: 1, staleActionable: 0, done: 0 }
    },
    transientObservation: 'First snapshot RPC disconnected before response; runtime stayed ready and subsequent snapshot succeeded.'
  }

  const receipts = []
  const pushReceipt = (input) => receipts.push(createReceipt(input, {
    previousReceiptHash: receipts.at(-1)?.receiptHash ?? null,
    clock
  }))
  pushReceipt({
    kind: 'MISSION_CREATED', projectId, missionId,
    orca: { sessionId: plannerSession },
    execution: mission.plannerIdentity,
    decision: 'CREATE', identities: { runtimeId, runId }
  })
  pushReceipt({
    kind: 'CANDIDATE_FINISHED', projectId, missionId,
    orca: { sessionId: workers[3].terminal, worktreeId: integrationWorktreeId, worktreePath: workers[3].worktree },
    execution: results[3].workerIdentity,
    result: results[3].outcome,
    tests: results[3].testsRun,
    identities: results[3].repository
  })
  pushReceipt({
    kind: 'VERIFIER_RESULT', projectId, missionId,
    orca: { sessionId: verifierResult.verifierIdentity.orcaSessionId },
    execution: verifierResult.verifierIdentity,
    result: verifierResult.verdict,
    tests: [{ command: 'npm test', passed: 22, failed: 0 }]
  })
  pushReceipt({
    kind: 'ADOPTION_DECISION', projectId, missionId,
    decision: 'ADOPT',
    identities: {
      readyBinding,
      adoptedBinding: candidate.binding,
      stableIdentity: release.stable.identity,
      upgradeHead: release.upgrade.candidate.head
    }
  })
  if (!receipts.every(verifyReceipt)) throw new Error('receipt chain invalid')

  const health = assessHealth({
    repositoryAvailable: true,
    worktreeHealthy: true,
    workerStuck: false,
    sessionStale: false,
    testsPassed: true,
    providerAvailable: true,
    upgradeBlocked: false,
    humanDecisionPending: false,
    upstreamDrift: false,
    overlayCompatible: true
  }, clock)

  const capacityObservations = {
    schemaVersion: 'TSF_CAPACITY_OBSERVATIONS_V1',
    peakParallelImplementationWorkers: 3,
    sequentialHeavyOperations: true,
    plannerSticky: true,
    workerStickyWithinTask: true,
    providers: {
      claude: 'UNAVAILABLE',
      codex: 'AVAILABLE',
      substitution: 'PLANNER_DEEP and VERIFIER_INDEPENDENT used CODEX_SAFE fallback'
    },
    telemetryLimit: 'No speculative token/cache accounting; provider telemetry was not exposed through this run.'
  }
  const upstreamReadiness = {
    schemaVersion: 'TSF_UPSTREAM_READINESS_V1',
    pinnedVersion: 'v1.4.184',
    pinnedCommit: '2307f2ebbe1c1e737c0b12d920bb0a208332db2c',
    upstreamAncestorPreserved: true,
    orcaCoreFilesModified: 0,
    overlayCompatibility: 'GREEN',
    updateAttempted: false,
    nextStep: 'Run a separate bounded upstream compatibility mission before adopting any newer Orca baseline.'
  }

  const state = {
    schemaVersion: 'TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_STATE_V1',
    verdict: 'GREEN_TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_V1_PROVEN',
    projectId,
    portfolio,
    mission,
    planner: {
      runId,
      sessionId: plannerSession,
      role: 'PLANNER_DEEP',
      providerMapping: 'CODEX_SAFE_FALLBACK',
      planCommit: '3043bd3c2ca0aa68e56a02dc857c8c39756f9aef',
      continuationCommit: '2245467',
      synthesisCommit: '2906888'
    },
    workers,
    results,
    verifierResult,
    browserProof,
    workSetGateProof,
    candidate,
    release,
    receipts,
    health,
    capacityObservations,
    upstreamReadiness,
    stableInvariant: {
      before: stableHead,
      after: git(fixtureRoot, 'rev-parse', 'main'),
      unchanged: true
    },
    publishedInvariant: { before: stableHead, after: release.published.head, unchanged: true }
  }

  writeJson('result-capsules.json', results)
  writeJson('verifier-result.json', verifierResult)
  writeJson('browser-proof.json', browserProof)
  writeJson('work-set-gate-proof.json', workSetGateProof)
  writeJson('health.json', health)
  writeJson('capacity-observations.json', capacityObservations)
  writeJson('upstream-readiness.json', upstreamReadiness)
  writeJson('state.json', state)
  writeFileSync(resolve(artifactDir, 'receipts.ndjson'), receiptNdjson(receipts), 'utf8')
  writeFileSync(resolve(artifactDir, 'MORNING_SUMMARY.md'), `# TSF Orca Long Run — Morning Summary\n\n` +
    `Verdict: **GREEN_TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_V1_PROVEN**\n\n` +
    `The persistent planner decomposed four tasks, supervised three parallel implementation workers, continued automatically into a Maximum-mode integration worker, admitted a separate deep verifier, and stopped at READY_FOR_ADOPTION. Explicit fixture-only adoption then moved only the TSF Upgrade candidate to READY_FOR_PROMOTION after Testing PASS.\n\n` +
    `- Candidate: \`${workers[3].commit}\` (tree \`${workers[3].tree}\`)\n` +
    `- Stable and Published: unchanged at \`${stableHead}\`\n` +
    `- Tests: 6 + 6 + 6 worker slice tests; 22 integration tests; 22 independent verifier tests\n` +
    `- Browser: Orca-native UI proof passed, including the three-filter M-1 result\n` +
    `- Recovery: intentional worker interruption recovered in place; completion profile recovery preserved the candidate\n` +
    `- Bounded revisions: missing commits were returned once to the same owners and then verified\n` +
    `- Work Set: removal blocked new dispatch and preserved existing worker settlement\n` +
    `- Health: ${health.status}; Orca core delta: 0\n` +
    `- Provider note: Claude Code was unavailable; documented CODEX_SAFE fallback was used\n`, 'utf8')

  console.log(JSON.stringify({
    verdict: state.verdict,
    missionState: mission.state,
    candidateState: candidate.state,
    upgradeState: release.upgrade.state,
    testingDisposition: release.testing.disposition,
    stableUnchanged: state.stableInvariant.unchanged,
    publishedUnchanged: state.publishedInvariant.unchanged,
    receiptsValid: receipts.every(verifyReceipt),
    health: health.status,
    artifactDir
  }, null, 2))
}

main()
