import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync, readFileSync, existsSync } from 'node:fs'
import {
  createOvernightRun,
  raiseNeedsYou,
  resolveNeedsYou,
  recordNeedsYouRelayOutcome
} from '../domain/keep-going.mjs'
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

  // Real Codex adversarial review finding: a relay failure (or a crash
  // between resolve and relay) previously left no durable trace -- only a
  // console.error. A successful relay must now be durably recorded too.
  assert.equal(
    readKeepGoingRun(PROJECT_ID).needsYou[0].escalation.relayedAt,
    clock().toISOString(),
    'a successful relay is durably recorded on the needsYou entry, not just console.error-able'
  )
  // Real Codex adversarial review finding (2nd round): resolveProjectNeedsYou
  // used to always return the run from the FIRST (resolve) write, one
  // revision behind the SECOND (relay-outcome) write it made moments
  // later -- a caller acting on that stale revision risked an avoidable
  // TSF_STALE_REVISION on its own next CAS-protected call. The RETURNED
  // value itself must carry the relay outcome, not just a fresh re-read.
  assert.equal(
    resolved.needsYou[0].escalation.relayedAt,
    clock().toISOString(),
    'the returned run itself (not just a later re-read) reflects the relay outcome -- never stale'
  )
  assert.equal(
    readKeepGoingRun(PROJECT_ID).revision,
    resolved.revision,
    'the returned run is the SAME (freshest) revision as what is durably persisted, not one behind it'
  )
  assert.equal(readKeepGoingRun(PROJECT_ID).needsYou[0].escalation.relayFailure, null)
})

// Real Codex adversarial review finding: newWorkerQuestions previously
// deduped only against ALREADY-ESCALATED ids from a prior tick -- a single
// mailbox response that itself contained the same message id twice slipped
// through and raised two Needs You entries for one real question.
test('zero-relay: the same message id appearing twice in ONE mailbox response still raises exactly one Needs You', async () => {
  const store = makeFakeStore(baseRun())
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })

  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      checkOrchestrationMessages: async () => ({
        ok: true,
        result: { messages: [QUESTION_MESSAGE, { ...QUESTION_MESSAGE }] }
      })
    }),
    store
  })

  assert.equal(result.action, 'WORKER_ESCALATED_TO_NEEDS_YOU')
  assert.equal(
    store.readRun().needsYou.length,
    1,
    'a duplicate id within the SAME mailbox batch must never raise two entries for one question'
  )
})

// Real Codex adversarial review finding: a failed mailbox read previously
// fell through silently as "no pending questions", reaching the stall
// check below it -- a real worker question hidden behind a transient CLI
// failure could eventually get the run wrongly marked STALLED instead of
// NEEDS_YOU.
test('zero-relay: a failed mailbox read honestly bails instead of silently proceeding to the stall check', async () => {
  const store = makeFakeStore(baseRun())
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration(), store })

  const result = await tickKeepGoingRun(PROJECT_ID, oneItem, clock, {
    orchestration: okOrchestration({
      checkOrchestrationMessages: async () => ({
        ok: false,
        reason: 'CLI_ERROR',
        detail: 'deliberate transient failure'
      })
    }),
    store
  })

  assert.equal(result.action, 'SETTLE_MESSAGE_CHECK_FAILED')
  const run = store.readRun()
  assert.equal(run.state, 'ACTIVE', 'never silently marked NEEDS_YOU or STALLED on a mailbox-read failure')
  assert.equal(run.needsYou.length, 0, 'no question fabricated from a failed read')
  assert.equal(run.tickLock, null, 'lock released, not left held')
})

// Real Codex adversarial review finding: a relay failure was previously
// only a console.error -- invisible in canonical state, so a genuinely
// failed `orchestration reply` (the worker's dispatch already ended, the
// CLI is transiently unavailable, etc.) left the worker silently blocked
// forever with no durable trace an operator or a future retry mechanism
// could act on. The durable resolution itself must still stand (the
// owner's answer is the source of truth, never rolled back for a
// notification failure).
test('zero-relay: a real relay failure is durably recorded on the needsYou entry, never silently lost, and never un-resolves the answer', async () => {
  const STATE_FILE = path.join(
    import.meta.dirname,
    '..',
    'server',
    '.local-state',
    `operator-state.test-keep-going-worker-escalation-relay-fail-${process.pid}.json`
  )
  process.env.TSF_UI_STATE_FILE = STATE_FILE
  for (const suffix of ['', '.tmp', '.keep-going.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }

  const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
  await withKeepGoingRun(PROJECT_ID, () => baseRun())

  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration: okOrchestration() })
  const orchestration = okOrchestration({
    checkOrchestrationMessages: async () => ({ ok: true, result: { messages: [QUESTION_MESSAGE] } })
  })
  await tickKeepGoingRun(PROJECT_ID, oneItem, clock, { orchestration })
  const needsYouId = readKeepGoingRun(PROJECT_ID).needsYou[0].id

  process.env.STUB_ORCA_MODE = 'error'
  try {
    const resolved = await resolveProjectNeedsYou(PROJECT_ID, needsYouId, 'Approve', clock)
    assert.equal(
      resolved.state,
      'ACTIVE',
      'the durable resolution itself must still succeed even though the relay failed'
    )
    assert.equal(resolved.needsYou[0].resolution, 'Approve', 'never rolled back for a relay failure')
  } finally {
    process.env.STUB_ORCA_MODE = 'success'
  }

  const escalation = readKeepGoingRun(PROJECT_ID).needsYou[0].escalation
  assert.equal(escalation.relayedAt, null, 'never falsely claims a successful relay')
  assert.ok(escalation.relayFailure, 'the failure is durably recorded, not lost after only a console.error')
  assert.equal(escalation.relayFailure.reason, 'CLI_ERROR')
})

// Real adversarial-review finding: resolveProjectNeedsYou's own reply-back
// call is subject to the exact same unbound-coordinator race
// keep-going-dispatch-loop.mjs's settleStep already defends against (a
// real `orca` call from this same terminal identity can rebind the
// ambient "currently bound Run" elsewhere first). Proves the fix: a
// failed rebind is surfaced honestly as relayFailure, and the real
// `orchestration reply` call is never even attempted once the rebind
// itself has already failed.
test('zero-relay: a failed coordinator rebind before the reply-back is surfaced honestly, and the real reply is never attempted', async () => {
  const STATE_FILE = path.join(
    import.meta.dirname,
    '..',
    'server',
    '.local-state',
    `operator-state.test-keep-going-worker-escalation-rebind-fail-${process.pid}.json`
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
    `stub-orca-reply-rebind-fail-${process.pid}.json`
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

  process.env.STUB_ORCA_RUN_USE_MODE = 'error'
  try {
    const resolved = await resolveProjectNeedsYou(PROJECT_ID, needsYouId, 'Approve', clock)
    assert.equal(resolved.state, 'ACTIVE', 'the durable resolution itself must still succeed even though the rebind failed')
  } finally {
    delete process.env.STUB_ORCA_RUN_USE_MODE
  }

  assert.ok(!existsSync(REPLY_DEBUG_FILE), 'a real reply must never be attempted once the coordinator rebind itself has already failed')
  const escalation = readKeepGoingRun(PROJECT_ID).needsYou[0].escalation
  assert.equal(escalation.relayedAt, null)
  assert.ok(escalation.relayFailure, 'the failed rebind is durably recorded as a relay failure, not silently lost')
})

// Real Codex adversarial review finding (2nd round): resolveProjectNeedsYou
// permits concurrent resolutions of the SAME question when a caller omits
// expectedRevision ("a later answer freely replaces an earlier one" -- see
// resolveProjectNeedsYou's own header comment). Their relay attempts can
// then land out of order -- an OLDER, losing resolution's relay outcome
// must never silently overwrite the NEWER, winning resolution's own
// outcome. Domain-level (not server-level) since this tests
// recordNeedsYouRelayOutcome's own correlation guard directly and
// deterministically, rather than racing real async calls.
test('recordNeedsYouRelayOutcome: a stale/losing concurrent resolution attempt never overwrites the winning resolution\'s own relay outcome', () => {
  let run = raiseNeedsYou(
    baseRun(),
    {
      question: QUESTION_MESSAGE.body,
      escalation: { kind: 'WORKER_ASK', messageId: 'msg-race', dispatchId: 'ctx-race', orchestrationRunId: 'orch-race' }
    },
    clock,
    baseRun().revision
  )
  const needsYouId = run.needsYou[0].id

  // Two concurrent resolutions, both reading the same starting revision --
  // distinct resolvedAt timestamps stand in for "which attempt actually
  // won the durable write", since a real concurrent pair would otherwise
  // be indistinguishable under a fixed test clock.
  const olderResolvedAt = new Date('2026-08-20T05:00:01.000Z').toISOString()
  const newerResolvedAt = new Date('2026-08-20T05:00:02.000Z').toISOString()
  const runIfOlderResolvedFirst = resolveNeedsYou(run, needsYouId, 'A (older)', () => new Date(olderResolvedAt))
  // The run actually, durably ends up on the NEWER resolution (B "wins"
  // the real compare-and-swap write) -- resolved from the SAME starting
  // `run`, exactly like resolveKeepGoingNeedsYou's real CAS semantics.
  let committed = resolveNeedsYou(run, needsYouId, 'B (newer, wins)', () => new Date(newerResolvedAt))
  assert.equal(committed.needsYou[0].resolvedAt, newerResolvedAt, 'sanity: B is the durably committed resolution')

  // The OLDER (A) relay attempt's outcome arrives AFTER B has already won
  // -- must be silently dropped (no-op), never applied to B's entry.
  committed = recordNeedsYouRelayOutcome(
    committed,
    needsYouId,
    { relayedAt: 'A-relayed-at', relayFailure: null },
    runIfOlderResolvedFirst.needsYou[0].resolvedAt,
    clock
  )
  assert.notEqual(
    committed.needsYou[0].escalation.relayedAt,
    'A-relayed-at',
    "a stale resolution's relay outcome must never be stamped onto the winning resolution's entry"
  )
  assert.equal(
    committed.needsYou[0].escalation.messageId,
    'msg-race',
    'the guard is a clean no-op -- the entry is otherwise completely untouched'
  )

  // The NEWER (B, the real winner)'s own relay outcome must still apply normally.
  committed = recordNeedsYouRelayOutcome(
    committed,
    needsYouId,
    { relayedAt: 'B-relayed-at', relayFailure: null },
    newerResolvedAt,
    clock
  )
  assert.equal(
    committed.needsYou[0].escalation.relayedAt,
    'B-relayed-at',
    "the winning resolution's own relay outcome is recorded correctly"
  )
})
