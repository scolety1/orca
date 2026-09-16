import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync, readFileSync } from 'node:fs'
import { createOvernightRun } from '../domain/keep-going.mjs'
import { tickKeepGoingRun } from '../server/keep-going-dispatch-loop.mjs'
import { resolveProjectNeedsYou } from '../server/command-run-action-bridge.mjs'

// TSF Overnight Product Completion V1, Phase 1 (zero-relay): recreates the
// exact failure family the real from-scratch pilot found -- a real Orca
// worker's own `orchestration ask` question sat invisible to TSF's
// canonical Needs You system, so the owner had to notice and answer it via
// raw Orca CLI (see codex-session-ids.txt / the pilot's own report for the
// real, live-observed session this reproduces). Proves the fix end to end
// using the same fake in-memory store pattern keep-going-dispatch-loop.
// test.mjs already establishes for the first two (isolation-only) cases.
// The third test needs resolveProjectNeedsYou -- a real server module that
// reads/writes only through the REAL keep-going-run-store.mjs, not an
// injectable store -- so it follows command-run-action-bridge.test.mjs's
// own established pattern (TSF_UI_STATE_FILE isolation into a real,
// disposable state file) instead of monkeypatching the real modules:
// module namespace objects are non-configurable, so Object.defineProperty
// on a real ESM export throws "Cannot redefine property" and can never
// work at all, real ESM or not.
process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
delete process.env.ORCA_TERMINAL_HANDLE

const clock = () => new Date('2026-08-20T05:00:00.000Z')
const PROJECT_ID = 'fixture:proj'
const oneItem = [{ id: 't1', scope: ['src/a.mjs'], worktree: 'C:/repo/wt1' }]

function makeFakeStore(run) {
  let current = run
  return {
    readRun: () => current,
    withRun: (_projectId, mutateFn) => {
      current = mutateFn(current)
      return current
    }
  }
}

function baseRun() {
  return createOvernightRun(
    {
      id: 'run-1',
      projectId: PROJECT_ID,
      originalGoal: 'Ship the fixture feature end to end.',
      acceptanceCriteria: ['CRITERION_A'],
      usageMode: 'BALANCED'
    },
    clock
  )
}

function okOrchestration(overrides = {}) {
  return {
    createDispatcherTerminal: async () => ({
      ok: true,
      result: { terminal: { handle: 'fake-dispatcher-terminal' } }
    }),
    bindOrchestrationRun: async ({ id }) => ({ ok: true, result: { run: { id } } }),
    createOrchestrationRun: async () => ({ ok: true, result: { run: { id: 'orch-run-1' } } }),
    createOrchestrationTask: async ({ taskTitle }) => ({
      ok: true,
      result: { task: { id: `task-${taskTitle}` } }
    }),
    startOrchestrationWorker: async ({ task }) => ({
      ok: true,
      result: { taskId: task, dispatchId: `ctx-${task}`, state: 'ready', stage: 'input_accepted' }
    }),
    listOrchestrationTasks: async () => ({
      ok: true,
      result: { tasks: [{ id: 'task-t1', status: 'in_progress' }] }
    }),
    checkOrchestrationMessages: async () => ({ ok: true, result: { messages: [] } }),
    ...overrides
  }
}

const QUESTION_MESSAGE = {
  id: 'msg_real_ask_1',
  from_handle: 'dispatch:ctx-task-t1',
  type: 'question',
  body: 'Approve this bounded design before I edit any files?',
  payload: JSON.stringify({
    taskId: 'task-t1',
    dispatchId: 'ctx-task-t1',
    options: ['Approve', 'Revise']
  })
}

test('zero-relay: a real worker ask becomes exactly one canonical Needs You, honestly blocking the run', async () => {
  const store = makeFakeStore(baseRun())
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  assert.equal(store.readRun().state, 'ACTIVE', 'wave dispatched, no question yet')

  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      checkOrchestrationMessages: async () => ({ ok: true, result: { messages: [QUESTION_MESSAGE] } })
    }),
    store
  })

  assert.equal(result.action, 'WORKER_ESCALATED_TO_NEEDS_YOU')
  const run = store.readRun()
  assert.equal(run.state, 'NEEDS_YOU', 'the run honestly blocks, never silently continues')
  assert.equal(run.needsYou.length, 1, 'exactly one canonical Needs You, not a second store/inbox')
  assert.equal(run.needsYou[0].question, QUESTION_MESSAGE.body)
  assert.deepEqual(run.needsYou[0].options, ['Approve', 'Revise'])
  assert.equal(run.needsYou[0].escalation.kind, 'WORKER_ASK')
  assert.equal(run.needsYou[0].escalation.messageId, QUESTION_MESSAGE.id)
  assert.equal(run.needsYou[0].escalation.dispatchId, 'ctx-task-t1')
  assert.equal(run.tickLock, null, 'lock released, not left held')
})

test('zero-relay: the same still-unanswered worker message never raises a second, duplicate Needs You', async () => {
  const store = makeFakeStore(baseRun())
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })
  const orchestration = okOrchestration({
    checkOrchestrationMessages: async () => ({ ok: true, result: { messages: [QUESTION_MESSAGE] } })
  })
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  // A second, later tick re-reads the SAME still-pending message (exactly
  // what a real, not-yet-answered orchestration mailbox looks like across
  // repeated fleet-driver polls) -- must not raise a second entry.
  const secondResult = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration, store })
  assert.equal(secondResult.action, 'NOOP', 'run is NEEDS_YOU, not ACTIVE -- tickKeepGoingRun no-ops')
  assert.equal(store.readRun().needsYou.length, 1, 'still exactly one, no duplicate')
})

test('zero-relay: the owner answer is durable, routes back to the real worker, and the run resumes', async () => {
  // resolveProjectNeedsYou (command-run-action-bridge.mjs) reads/writes
  // only through the REAL keep-going-run-store.mjs -- no injectable store
  // param exists for it (unlike tickKeepGoingRun above). So this test runs
  // BOTH ticks and the resolution against that same real store, isolated
  // into its own disposable state file exactly as command-run-action-
  // bridge.test.mjs's own real-store tests already do.
  const STATE_FILE = path.join(
    import.meta.dirname,
    '..',
    'server',
    '.local-state',
    `operator-state.test-keep-going-worker-escalation-${process.pid}.json`
  )
  process.env.TSF_UI_STATE_FILE = STATE_FILE
  for (const suffix of ['', '.tmp', '.keep-going.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
  const REPLY_DEBUG_FILE = path.join(
    import.meta.dirname,
    '..',
    'server',
    '.local-state',
    `stub-orca-reply-${process.pid}.json`
  )
  rmSync(REPLY_DEBUG_FILE, { force: true })
  process.env.STUB_ORCA_REPLY_DEBUG_FILE = REPLY_DEBUG_FILE

  const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  await withKeepGoingRun(PROJECT_ID, () => baseRun())

  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration() })
  const orchestration = okOrchestration({
    checkOrchestrationMessages: async () => ({ ok: true, result: { messages: [QUESTION_MESSAGE] } })
  })
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  const needsYouId = readKeepGoingRun(PROJECT_ID).needsYou[0].id

  const resolved = await resolveProjectNeedsYou(PROJECT_ID, needsYouId, 'Approve', clock)
  assert.equal(resolved.state, 'ACTIVE', 'run resumes once its only open question is answered')
  assert.equal(resolved.needsYou[0].resolvedAt, clock().toISOString())
  assert.equal(resolved.needsYou[0].resolution, 'Approve', 'the owner answer is durable')
  assert.equal(
    readKeepGoingRun(PROJECT_ID).needsYou[0].resolution,
    'Approve',
    'restart-durable: a fresh, independent read sees the same real resolution'
  )

  // The stub CLI (tsf/test/fixtures/stub-orca-cli.mjs) records exactly
  // what a real `orchestration reply` call received -- proves the answer
  // really reached the (simulated) worker via the real CLI bridge, not a
  // mocked-out stand-in for it.
  const received = JSON.parse(readFileSync(REPLY_DEBUG_FILE, 'utf8'))
  assert.equal(received.id, QUESTION_MESSAGE.id, 'the reply targets the exact worker message that asked')
  assert.equal(received.body, 'Approve', 'the owner answer is relayed back verbatim')
})
