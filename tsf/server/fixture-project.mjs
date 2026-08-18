// The ONE clearly-labeled fixture project in the operator UI. It exists only
// so the Adoption surface (Review/Adopt/Request Revision/Reject) can be
// exercised end-to-end through the real tsf/domain functions, without
// touching any real project's history. Never treat this as a real project.
import { createCandidate, decideCandidate, candidateBinding } from '../domain/adoption.mjs'
import { createReceipt } from '../domain/receipts.mjs'
import { assessHealth } from '../domain/health.mjs'

export const FIXTURE_PROJECT_ID = 'tsf-ui-capability-check'

const resultCapsule = {
  schemaVersion: 'TSF_RESULT_CAPSULE_V1',
  missionId: 'capability-check/adoption-surface',
  workerIdentity: {
    role: 'WORKER_BALANCED',
    providerId: 'local',
    agentId: 'fixture',
    modelObserved: 'fixture-worker',
    orcaSessionId: 'fixture-session-worker',
    providerConversationId: null,
    worktreeId: 'fixture::C:/tsf-fixtures/capability-check'
  },
  outcome: 'SUCCEEDED',
  repository: {
    head: 'fixture0000000000000000000000000000000c',
    tree: 'fixturetree00000000000000000000000000c'
  },
  filesChanged: ['tsf/ui/src/pages/AdoptionDemo.tsx', 'tsf/ui/src/components/CandidateCard.tsx'],
  testsRun: [{ command: 'node --test tsf/test/*.test.mjs', exitCode: 0, passed: 27, failed: 0 }],
  evidence: [{ kind: 'FIXTURE', note: 'Synthetic candidate for exercising the Adoption surface only.' }],
  blockers: [],
  unresolvedQuestions: [],
  implementationSummary:
    'Built the Adoption surface (candidate card, decision actions, receipt trail) against a synthetic, clearly-labeled fixture candidate so the real adoption code path can be exercised without touching real project history.',
  recommendedNextStep: 'Review the fixture candidate, then try Adopt / Request Revision / Reject to see the bound decision and receipt.'
}

const verifierResult = {
  verdict: 'GREEN',
  verifierIdentity: { role: 'VERIFIER_INDEPENDENT', orcaSessionId: 'fixture-session-verifier' },
  checks: { tests: '27/27', typecheck: 'PASS', lint: 'PASS', build: 'PASS', browser: 'N/A_FIXTURE' }
}

function baseStable() {
  return { head: 'fixture0000000000000000000000000000000s', tree: 'fixturetree00000000000000000000000000s' }
}

export function createFixtureState(clock) {
  const candidate = createCandidate(
    { id: 'capability-check-candidate-1', projectId: FIXTURE_PROJECT_ID, missionId: 'capability-check/adoption-surface', resultCapsule, verifierResult, baseStable: baseStable() },
    clock
  )
  const health = assessHealth({ repositoryAvailable: true, testsPassed: true }, clock)
  return {
    id: FIXTURE_PROJECT_ID,
    displayName: 'TSF UI Capability Check',
    sourceClass: 'FIXTURE',
    provenance: 'LOCAL_FIXTURE_FOR_ADOPTION_UI_ONLY',
    root: null,
    lifecycle: 'FIXTURE',
    branch: 'fixture/capability-check',
    registeredAt: '2026-08-18T00:00:00.000Z',
    purpose: 'Exercises the real Adopt / Request Revision / Reject code path. Not a real project — no repository, no push, no adoption authority beyond this local UI session.',
    restrictions: ['Fixture only: no repository exists on disk.', 'Decisions here never touch a real project.'],
    activeFleet: true,
    workSet: true,
    mission: { id: candidate.missionId, state: 'READY_FOR_ADOPTION', blockedReason: null },
    release: {
      stable: { branch: 'main', head: baseStable().head, tree: baseStable().tree },
      previousStable: null,
      upgrade: { head: resultCapsule.repository.head, tree: resultCapsule.repository.tree },
      testing: 'GREEN',
      adoption: 'PENDING_YOUR_DECISION',
      published: 'UNCHANGED'
    },
    health,
    baseline: { tests: '27/27', lint: 'PASS', typecheck: 'PASS', build: 'PASS' },
    evidence: {
      planner: { role: 'PLANNER_BALANCED', providerId: 'local', agentId: 'fixture', modelObserved: 'fixture-planner', orcaSessionId: 'fixture-session-planner' },
      verifier: { role: 'VERIFIER_INDEPENDENT', providerId: 'local', agentId: 'fixture', modelObserved: 'fixture-verifier', orcaSessionId: 'fixture-session-verifier' },
      browser: null,
      resultCapsules: [resultCapsule],
      verifierRaw: verifierResult
    },
    receipts: { chain: [], chainValid: true, tip: null },
    candidateObject: candidate
  }
}

// Applies a real decideCandidate() transition and records a real, hash-chained
// receipt. Mutates the given fixture state's candidateObject in place is
// avoided — callers persist the returned { candidate, receipt } pair.
export function decideFixtureCandidate(fixtureState, { decision, requestId, reason }, previousReceiptHash, clock) {
  const candidate = fixtureState.candidateObject
  const expectedBinding = candidateBinding(candidate)
  const next = decideCandidate(candidate, { decision, expectedBinding, requestId, reason }, clock)
  const receipt = createReceipt(
    {
      kind: 'ADOPTION_DECISION',
      projectId: FIXTURE_PROJECT_ID,
      missionId: candidate.missionId,
      orca: { sessionId: null, worktreeId: null, worktreePath: null },
      execution: { role: 'HUMAN_ADOPTION_AUTHORITY', providerId: null, agentId: null, modelObserved: null },
      result: next.state,
      tests: resultCapsule.testsRun,
      decision,
      identities: { candidateId: candidate.id, binding: next.binding, requestId }
    },
    { previousReceiptHash, clock }
  )
  return { candidate: next, receipt }
}
