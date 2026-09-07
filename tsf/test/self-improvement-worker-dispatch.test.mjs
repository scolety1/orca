// Real bounded-dispatch mechanism, FAKE spawn/worktree (no real Codex/
// Claude process, no real git worktree add -- proven separately in
// self-improvement-worktree.test.mjs and by Phase 9's later wave).
// Proves: resource admission gates dispatch (F1's own pattern), the
// worker role/provider is resolved via the real routing config, the
// prompt is built entirely from the finding's own fields, and the
// provider CLI flag/args are derived correctly from the launch profile.
import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchRepairWorker } from '../server/self-improvement-worker-dispatch.mjs'

const GB = 1024 ** 3
const finding = {
  sourceDetector: 'RUNTIME_ASSERTION',
  severity: 'P1',
  evidence: { x: 1 },
  reproduction: { command: 'node -e "process.exit(0)"' },
  affectedSurface: 'tsf/domain/fixture.mjs',
  confidence: 0.9,
  candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', filesHint: ['tsf/domain/fixture.mjs'] }
}
const envelope = { allowedScope: ['tsf/domain/fixture.mjs'], forbiddenPathPrefixes: [], structurallyForbiddenSurfaces: [] }

test('a CRITICAL resource-pressure reading blocks dispatch before any worktree/spawn is attempted', async () => {
  let worktreeCreated = false
  let spawned = false
  await assert.rejects(
    dispatchRepairWorker({
      finding,
      envelope,
      missionId: 'mission:selfimprove:fixture',
      attemptNumber: 1,
      canonicalRepoPath: 'C:/fixture/canonical',
      deps: {
        collectHostMemoryEvidence: () => ({ availableBytes: 0.1 * GB }),
        createIsolatedRepairWorktree: async () => {
          worktreeCreated = true
          return { worktreePath: 'x', branch: 'x', baseSha: 'x' }
        },
        spawnProviderProcess: async () => {
          spawned = true
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
        }
      }
    }),
    (error) => error.code === 'TSF_SELF_IMPROVEMENT_DISPATCH_BLOCKED_BY_RESOURCE_PRESSURE'
  )
  assert.equal(worktreeCreated, false)
  assert.equal(spawned, false)
})

test('a healthy resource reading dispatches: resolves WORKER_BALANCED, builds the worktree, feeds a prompt built from the finding, returns the real shape dispatchWorkerForTask expects', async () => {
  let capturedWorktreeArgs = null
  let capturedSpawnArgs = null
  const result = await dispatchRepairWorker({
    finding,
    envelope,
    missionId: 'mission:selfimprove:fixture',
    attemptNumber: 1,
    canonicalRepoPath: 'C:/fixture/canonical',
    clock: () => new Date('2026-09-07T12:00:00.000Z'),
    deps: {
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * GB }),
      createIsolatedRepairWorktree: async (args) => {
        capturedWorktreeArgs = args
        return { worktreePath: 'C:/fixture/attempt-1', branch: args.branch, baseSha: 'b'.repeat(40) }
      },
      spawnProviderProcess: async (args) => {
        capturedSpawnArgs = args
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false }
      }
    }
  })

  assert.ok(result.workerId.startsWith('worker:mission:selfimprove:fixture:attempt-1'))
  assert.equal(result.providerId, 'openai') // WORKER_BALANCED's real preferred provider
  assert.equal(result.agentId, 'codex')
  assert.equal(result.worktreePath, 'C:/fixture/attempt-1')
  assert.equal(result.exitCode, 0)
  assert.equal(result.timedOut, false)

  assert.equal(capturedWorktreeArgs.canonicalRepoPath, 'C:/fixture/canonical')
  assert.match(capturedWorktreeArgs.branch, /^tsf\/self-improve\/mission-selfimprove-fixture\/attempt-1$/)

  assert.equal(capturedSpawnArgs.provider, 'codex')
  assert.equal(capturedSpawnArgs.workspace, 'C:/fixture/attempt-1')
  assert.deepEqual(capturedSpawnArgs.providerArguments.slice(0, 1), ['exec'])
  const prompt = capturedSpawnArgs.providerArguments[1]
  assert.match(prompt, /RUNTIME_ASSERTION/)
  assert.match(prompt, /tsf\/domain\/fixture\.mjs/)
  assert.match(prompt, /NEVER attempt to push, merge, or write to the canonical repository/)
})
