import assert from 'node:assert/strict'
import test from 'node:test'
import { mapOrchestrationFacts } from '../adapters/orca-runtime.mjs'

const RESULT_CAPSULE = {
  schemaVersion: 'TSF_RESULT_CAPSULE_V1',
  missionId: 'mission-succeeded',
  workerIdentity: {
    role: 'WORKER_BALANCED',
    providerId: 'openai',
    agentId: 'codex',
    orcaSessionId: 'term_succeeded',
    worktreeId: 'repo-1::C:/worktrees/succeeded'
  },
  outcome: 'SUCCEEDED',
  repository: {
    head: '1'.repeat(40),
    tree: '2'.repeat(40)
  },
  filesChanged: ['src/result.mjs'],
  testsRun: [{ command: 'node --test', exitCode: 0 }],
  evidence: [{ kind: 'ORCA_WORKER_SETTLED', dispatchId: 'ctx_succeeded' }],
  blockers: [],
  unresolvedQuestions: [],
  implementationSummary: 'Implemented and verified the bounded task.',
  recommendedNextStep: 'Admit the result for independent review.'
}

test('mapOrchestrationFacts returns empty projections for empty facts', () => {
  assert.deepEqual(mapOrchestrationFacts(), {
    workerHeartbeats: [],
    resultCapsules: [],
    openGates: []
  })
})

test('mapOrchestrationFacts maps real worker rows without inventing heartbeat timestamps', () => {
  const projection = mapOrchestrationFacts({
    workerList: {
      workers: [
        {
          dispatchId: 'ctx_active',
          taskId: 'task_active',
          runId: 'run_1',
          workerState: 'ready',
          dispatchStatus: 'dispatched',
          terminalState: 'active'
        },
        {
          dispatchId: 'ctx_failed',
          taskId: 'task_failed',
          runId: 'run_1',
          workerState: 'failed',
          dispatchStatus: 'failed',
          terminalState: 'retained'
        },
        {
          dispatchId: 'ctx_succeeded',
          taskId: 'task_succeeded',
          runId: 'run_1',
          workerState: 'succeeded',
          dispatchStatus: 'completed',
          terminalState: 'reclaimable'
        }
      ]
    },
    taskList: {
      runId: 'run_1',
      tasks: [
        {
          id: 'task_failed',
          run_id: 'run_1',
          status: 'failed',
          result: JSON.stringify({ provenance: 'worker_report', outcome: 'failed' })
        },
        {
          id: 'task_succeeded',
          run_id: 'run_1',
          status: 'completed',
          result: JSON.stringify(RESULT_CAPSULE)
        }
      ]
    }
  })

  assert.deepEqual(projection.workerHeartbeats, [
    { dispatchId: 'ctx_active', taskId: 'task_active', lastHeartbeatAt: null },
    { dispatchId: 'ctx_failed', taskId: 'task_failed', lastHeartbeatAt: null },
    { dispatchId: 'ctx_succeeded', taskId: 'task_succeeded', lastHeartbeatAt: null }
  ])
  assert.deepEqual(projection.resultCapsules, [RESULT_CAPSULE])
})

test('mapOrchestrationFacts projects only pending gates from real gate-list fields', () => {
  const projection = mapOrchestrationFacts({
    gateList: {
      runId: 'run_1',
      gates: [
        {
          id: 'gate_pending',
          run_id: 'run_1',
          task_id: 'task_active',
          question: 'Continue with adoption?',
          options: JSON.stringify(['yes', 'no']),
          status: 'pending',
          resolution: null,
          created_at: '2026-08-19 20:00:00',
          resolved_at: null
        },
        {
          id: 'gate_resolved',
          run_id: 'run_1',
          task_id: 'task_succeeded',
          question: 'Use the candidate?',
          options: '[]',
          status: 'resolved',
          resolution: 'yes',
          created_at: '2026-08-19 19:00:00',
          resolved_at: '2026-08-19 19:05:00'
        }
      ]
    }
  })

  assert.deepEqual(projection.openGates, [
    {
      id: 'gate_pending',
      runId: 'run_1',
      taskId: 'task_active',
      question: 'Continue with adoption?',
      options: ['yes', 'no'],
      status: 'pending',
      createdAt: '2026-08-19 20:00:00'
    }
  ])
})
