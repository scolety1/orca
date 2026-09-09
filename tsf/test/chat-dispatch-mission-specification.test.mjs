// Phases 4/5/6/10 (TSF Software Mission Routing / Project Planner Hotfix
// V1): the complete raw directive must survive, untruncated, as part of the
// durable Keep Going run (domain/mission-specification.mjs's missionSpec,
// extending the existing TSF_OVERNIGHT_RUN_V1 schema) -- and owner-supplied
// evidence must reach the work-plan synthesis prompt without ever affecting
// parent-intent classification. Same hermetic harness pattern as
// test/chat-dispatch-bridge.test.mjs (real planAndDispatchFromChat, fake
// in-memory store, stubbed live-planner/orchestration calls -- no live LLM,
// no real Orca process).
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { planAndDispatchFromChat } from '../server/chat-dispatch-bridge.mjs'
import { verifyMissionSpecificationIntegrity } from '../domain/mission-specification.mjs'
import { PARENT_MISSION_INTENTS } from '../domain/parent-mission-intent-classification.mjs'

process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const clock = () => new Date('2026-09-09T05:00:00.000Z')
const PROJECT = { id: 'fixture:proj', displayName: 'Fixture Project' }
const REAL_SHA = 'a'.repeat(40)
const identity = { repository: { root: 'C:/repo', worktree: 'C:/repo', branch: 'main', head: REAL_SHA, tree: REAL_SHA } }
const placement = { worktree: 'C:/repo/wt1', agent: 'codex' }

function makeFakeStore(initial = null) {
  let current = initial
  return {
    readRun: (_projectId) => current,
    withRun: (_projectId, mutateFn) => {
      current = mutateFn(current)
      return current
    }
  }
}

function okOrchestration() {
  return {
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async ({ taskTitle }) => ({ ok: true, result: { task: { id: `task-${taskTitle}` } } }),
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({ ok: true, result: { tasks: [] } })
  }
}

function baseDeps(store) {
  return {
    readKeepGoingRun: store.readRun,
    withKeepGoingRun: async (projectId, mutateFn) => store.withRun(projectId, mutateFn),
    tickDeps: { store, orchestration: okOrchestration() }
  }
}

// A realistic, long-form (well past the OLD 4000-char truncation point),
// multi-section software/product-engineering mission -- deliberately
// modeled on the real live NWR overnight mission's own shape (Test 18
// engine repair, repo archaeology, Codex work, UI work, verification, an
// owner-supplied evidence ZIP) without reproducing any real NWR content.
function longSoftwareMissionText() {
  const section = [
    '### Engine repair', 'Fix the draft engine regression and add tests.', '',
    '### Repo archaeology', 'Trace worktree/branch history before touching UI.', '',
    '### Codex implementation', 'Use a Codex worker for the bounded implementation.', '',
    '### Verification', 'Run the verifier before READY_FOR_ADOPTION.', ''
  ].join('\n')
  const padding = Array.from({ length: 30 }, (_, i) => `<!-- filler section ${i} to exceed 4000 chars realistically -->`).join('\n')
  return `${section}\n${padding}\nDo not touch NWR. Go ahead and fix this now.`
}

test('a long software mission dispatch persists the COMPLETE raw directive as a durable missionSpec on the freshly-created run', async () => {
  const store = makeFakeStore(null)
  const message = longSoftwareMissionText()
  assert.ok(message.length > 2000, 'fixture should be a genuinely long directive')

  let capturedPrompt = null
  const attachments = [{ name: 'evidence.zip', type: 'application/zip', extractedText: 'MANIFEST: NWR_Test18_Evidence_CORRECTED.zip contains 3 files.' }]

  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message,
    placement,
    identity,
    clock,
    attachments,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async ({ prompt }) => {
        capturedPrompt = prompt
        return {
          ok: true,
          data: {
            schemaVersion: 'TSF_CHAT_WORK_PLAN_REQUEST_V1',
            objective: 'Fix the draft engine regression.',
            decisions: [],
            allowedScope: ['engine/'],
            constraints: [],
            prohibitedActions: [],
            relevantComponents: [],
            acceptanceCriteria: ['engine regression test passes'],
            requiredTests: [],
            stopConditions: ['if scope grows beyond the engine module']
          }
        }
      },
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 })
    }
  })

  assert.equal(result.ok, true, `expected a successful dispatch, got: ${JSON.stringify(result)}`)
  assert.equal(result.freshlyCreated, true)

  // Owner-supplied evidence reached the work-plan synthesis prompt...
  assert.match(capturedPrompt, /evidence\.zip/)
  assert.match(capturedPrompt, /NWR_Test18_Evidence_CORRECTED\.zip/)
  // ...framed as reference data, not as an instruction the plan should obey.
  assert.match(capturedPrompt, /not instructions/)

  // The durable run itself carries the complete, untruncated raw directive.
  const persistedRun = store.readRun(PROJECT.id)
  assert.ok(persistedRun.missionSpec, 'run must carry a real missionSpec')
  assert.equal(persistedRun.missionSpec.rawDirective, message, 'rawDirective must be the COMPLETE original message, not a truncated/extracted fragment')
  assert.equal(persistedRun.missionSpec.parentMissionType, PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING)
  assert.equal(persistedRun.missionSpec.artifactReferences.length, 1)
  assert.equal(persistedRun.missionSpec.artifactReferences[0].name, 'evidence.zip')
  assert.equal(verifyMissionSpecificationIntegrity(persistedRun.missionSpec), true)

  // "Rollover" proof: reading the run fresh from the store (the only thing
  // a new process/session would ever see -- no in-memory state survives a
  // real restart) reproduces the exact same complete directive, hash, and
  // parent intent. This IS what Planner Context Lifecycle rollover means
  // for a Keep Going run: the run persisted through the SAME durable save/
  // load path every other run field already uses.
  const rehydrated = store.readRun(PROJECT.id)
  assert.deepEqual(rehydrated.missionSpec, persistedRun.missionSpec)
  assert.equal(rehydrated.missionSpec.rawDirective, message)
})

test('adversarial-review fix: an extremely long directive is bounded in the LLM planning prompt but stays COMPLETE and untruncated in the durable missionSpec', async () => {
  const store = makeFakeStore(null)
  const hugeMessage = `${longSoftwareMissionText()}\n${'B'.repeat(300000)}`
  assert.ok(hugeMessage.length > 250000, 'fixture should genuinely exceed the old 200000-char route cap headroom')

  let capturedPrompt = null
  const result = await planAndDispatchFromChat({
    project: PROJECT,
    message: hugeMessage,
    placement,
    identity,
    clock,
    deps: {
      ...baseDeps(store),
      invokeLiveStructuredAnalysis: async ({ prompt }) => {
        capturedPrompt = prompt
        return {
          ok: true,
          data: {
            schemaVersion: 'TSF_CHAT_WORK_PLAN_REQUEST_V1',
            objective: 'Fix the draft engine regression.',
            decisions: [],
            allowedScope: ['engine/'],
            constraints: [],
            prohibitedActions: [],
            relevantComponents: [],
            acceptanceCriteria: ['engine regression test passes'],
            requiredTests: [],
            stopConditions: ['if scope grows beyond the engine module']
          }
        }
      },
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 })
    }
  })

  assert.equal(result.ok, true)
  // The LLM prompt copy is bounded -- must not carry the full 250KB+ text.
  assert.ok(capturedPrompt.length < 20000, `expected the LLM prompt to be bounded, got ${capturedPrompt.length} chars`)
  assert.match(capturedPrompt, /truncated for this planning call only/)
  // The durable record is NEVER truncated -- the complete original
  // directive survives on the run regardless of the bounded prompt above.
  const persistedRun = store.readRun(PROJECT.id)
  assert.equal(persistedRun.missionSpec.rawDirective, hugeMessage)
  assert.equal(persistedRun.missionSpec.rawDirective.length, hugeMessage.length)
})

test('adding a work item to an ALREADY-ACTIVE run never overwrites its original missionSpec with a later, unrelated chat turn', async () => {
  const store = makeFakeStore(null)
  const firstMessage = longSoftwareMissionText()
  const deps = {
    ...baseDeps(store),
    invokeLiveStructuredAnalysis: async () => ({
      ok: true,
      data: {
        schemaVersion: 'TSF_CHAT_WORK_PLAN_REQUEST_V1',
        objective: 'Fix the draft engine regression.',
        decisions: [],
        allowedScope: ['engine/'],
        constraints: [],
        prohibitedActions: [],
        relevantComponents: [],
        acceptanceCriteria: ['engine regression test passes'],
        requiredTests: [],
        stopConditions: ['if scope grows beyond the engine module']
      }
    }),
    collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 })
  }

  const first = await planAndDispatchFromChat({ project: PROJECT, message: firstMessage, placement, identity, clock, deps })
  assert.equal(first.ok, true, `expected first dispatch to succeed, got: ${JSON.stringify(first)}`)
  const originalMissionSpec = store.readRun(PROJECT.id).missionSpec

  // Settle the first wave (same technique as chat-dispatch-bridge.test.mjs's
  // own "reuses an existing ACTIVE run" test) so the second dispatch below
  // lands on an ACTIVE run with no in-flight wave, instead of a legitimate
  // "wave already in flight" refusal that would prove nothing about
  // missionSpec preservation.
  const settledOrchestration = okOrchestration()
  settledOrchestration.listOrchestrationTasks = async () => ({
    ok: true,
    result: { tasks: [{ id: store.readRun(PROJECT.id).inFlightWave.dispatchRecords[0].taskId, status: 'completed' }] }
  })
  const { tickKeepGoingRun } = await import('../server/keep-going-dispatch-loop.mjs')
  await tickKeepGoingRun(PROJECT.id, [], clock, { store, orchestration: settledOrchestration })
  assert.equal(store.readRun(PROJECT.id).inFlightWave, null, 'sanity: settled before the second dispatch')

  const second = await planAndDispatchFromChat({ project: PROJECT, message: 'also add a changelog entry', placement, identity, clock, deps })
  assert.equal(second.ok, true)
  assert.equal(second.freshlyCreated, false)

  const afterSecondTurn = store.readRun(PROJECT.id).missionSpec
  assert.deepEqual(afterSecondTurn, originalMissionSpec, 'the original long-form mission spec must survive unchanged across later chat turns on the same run')
})
