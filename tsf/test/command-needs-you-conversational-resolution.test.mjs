// Hands-Free Command + Project Manager V1: full path from a chat message
// through the REAL action-executor.mjs's RESOLVE_NEEDS_YOU, using the real,
// isolated on-disk store (TSF_UI_STATE_FILE), matching this session's own
// established real-store test-isolation convention.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-needs-you-conversational-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun, raiseNeedsYou } = await import('../domain/keep-going.mjs')
const { loadState } = await import('../server/data-store.mjs')
const { respondNeedsYouAnswerCommand } =
  await import('../server/command-needs-you-answer-bridge.mjs')

const clock = () => new Date('2026-09-19T00:00:00.000Z')
const PROJECT_A = { id: 'proj-a', displayName: 'Project A' }
const PROJECT_B = { id: 'proj-b', displayName: 'Project B' }

test.after(() => {
  for (const suffix of ['', '.tmp', '.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
})

async function seedRunWithOpenQuestion(projectId, question) {
  await withKeepGoingRun(projectId, () => {
    let run = createOvernightRun(
      {
        id: `run-${projectId}`,
        projectId,
        originalGoal: 'Ship it.',
        acceptanceCriteria: ['X'],
        usageMode: 'BALANCED'
      },
      clock
    )
    run = raiseNeedsYou(run, { question, options: [] }, clock, run.revision)
    return run
  })
}

test('conversational resolution: a named project with its own single open item resolves for real via executeAction', async () => {
  await seedRunWithOpenQuestion(PROJECT_A.id, 'Which provider?')
  const opState = loadState()
  const result = await respondNeedsYouAnswerCommand({
    message: `Answer the ${PROJECT_A.id} question with option two.`,
    projects: [PROJECT_A],
    opState,
    focusProjectId: null,
    clock
  })
  assert.match(result.text, /Got it/)
  const run = readKeepGoingRun(PROJECT_A.id)
  const resolvedEntry = run.needsYou.find((n) => n.question === 'Which provider?')
  assert.ok(resolvedEntry.resolvedAt, 'the real run must show the question genuinely resolved')
  assert.match(resolvedEntry.resolution, /option two/)
})

// DIRECTIVE SEMANTICS CLOSURE V1 (P0): classifyIntent's NEEDS_YOU_ANSWER
// pattern had no directive-vs-musing guard -- a musing statement
// containing the trigger vocabulary ("answer ... question with option
// two") resolved and mutated a real open item exactly like an
// unambiguous answer. Proves the real store is genuinely untouched, not
// just that the classifier returns a refusal shape.
test('conversational resolution (P0, fixed): a musing statement about answering never resolves or mutates a real open item', async () => {
  await seedRunWithOpenQuestion(PROJECT_A.id, 'Which config?')
  const opState = loadState()
  const before = readKeepGoingRun(PROJECT_A.id)
  for (const message of [
    'I wonder if we should just answer the question with option two',
    'Maybe we should answer that with option two'
  ]) {
    const result = await respondNeedsYouAnswerCommand({
      message,
      projects: [PROJECT_A],
      opState,
      focusProjectId: PROJECT_A.id,
      clock
    })
    assert.match(result.text, /still deciding/)
  }
  const after = readKeepGoingRun(PROJECT_A.id)
  assert.deepEqual(
    after,
    before,
    'the real run must be byte-identical -- no mutation from musing text'
  )
})

// DIRECTIVE SEMANTICS CLOSURE V1, round 2 (real Codex adversarial-review
// finding): the round-1 fix above only caught a musing opener at message
// START -- a genuine question, reported speech, negation, a retraction,
// or a mid-sentence hedge all still resolved and mutated a real open
// item. Proves the real store is genuinely untouched for each, and that
// the canonical trigger phrasings still work.
test('conversational resolution (P0, fixed, round 2): questions, reported speech, negation, and retraction never resolve or mutate a real open item', async () => {
  await seedRunWithOpenQuestion(PROJECT_A.id, 'Which config?')
  const opState = loadState()
  const before = readKeepGoingRun(PROJECT_A.id)
  for (const message of [
    'Should we answer the question with option two',
    'We may want to answer the question with option two',
    'Claude suggested we answer the question with option two',
    'Do not answer the question with option two',
    "Don't answer the question with option two",
    'Answer the question with option two no wait never mind'
  ]) {
    const result = await respondNeedsYouAnswerCommand({
      message,
      projects: [PROJECT_A],
      opState,
      focusProjectId: PROJECT_A.id,
      clock
    })
    assert.equal(result.resolvedProjectIds.length, 0, message)
  }
  const after = readKeepGoingRun(PROJECT_A.id)
  assert.deepEqual(after, before, 'the real run must be byte-identical for every case above')

  // The real, intended trigger phrasings must still work.
  const direct = await respondNeedsYouAnswerCommand({
    message: 'Can you answer the question with option two',
    projects: [PROJECT_A],
    opState,
    focusProjectId: PROJECT_A.id,
    clock
  })
  assert.match(direct.text, /Got it/)
})

test('conversational resolution: "Yes, authorize it" with no named project resolves via the currently-focused project', async () => {
  await seedRunWithOpenQuestion(PROJECT_B.id, 'Approve $50 research spend?')
  const opState = loadState()
  const result = await respondNeedsYouAnswerCommand({
    message: 'Yes, authorize it.',
    projects: [PROJECT_A, PROJECT_B],
    opState,
    focusProjectId: PROJECT_B.id,
    clock
  })
  assert.match(result.text, /Got it/)
  const run = readKeepGoingRun(PROJECT_B.id)
  const resolvedEntry = run.needsYou.find((n) => n.question === 'Approve $50 research spend?')
  assert.ok(resolvedEntry.resolvedAt)
})

test('conversational resolution: ambiguity (no named project, no focus, multiple real open items) refuses -- the store is genuinely untouched', async () => {
  const PROJECT_C = { id: 'proj-c', displayName: 'Project C' }
  const PROJECT_D = { id: 'proj-d', displayName: 'Project D' }
  await seedRunWithOpenQuestion(PROJECT_C.id, 'Which branch?')
  await seedRunWithOpenQuestion(PROJECT_D.id, 'Which environment?')
  const opState = loadState()
  const beforeC = JSON.parse(JSON.stringify(readKeepGoingRun(PROJECT_C.id)))
  const beforeD = JSON.parse(JSON.stringify(readKeepGoingRun(PROJECT_D.id)))
  const result = await respondNeedsYouAnswerCommand({
    message: 'Answer the question with option two.',
    projects: [PROJECT_C, PROJECT_D],
    opState,
    focusProjectId: null,
    clock
  })
  assert.match(result.text, /couldn't tell|not sure/)
  assert.deepEqual(
    readKeepGoingRun(PROJECT_C.id).needsYou,
    beforeC.needsYou,
    'ambiguous refusal must never mutate any real state'
  )
  assert.deepEqual(readKeepGoingRun(PROJECT_D.id).needsYou, beforeD.needsYou)
})

// REAL CODEX ADVERSARIAL-REVIEW FINDING (P0, fixed): the answer's own
// free-text content ("with password remediation") was scanned for a
// project reference exactly like the rest of the message -- since a real
// project happened to be named "password-remediation", this resolved and
// answered THAT project's item instead of the actually-focused one.
test("conversational resolution (P0, fixed): the answer's own free-text content is never scanned for a project reference -- resolves via focus, not the answer text", async () => {
  const HOUSEOS = { id: 'houseos', displayName: 'HouseOS' }
  const PASSWORD_REMEDIATION = { id: 'password-remediation', displayName: 'Password-Remediation' }
  await seedRunWithOpenQuestion(HOUSEOS.id, 'Which security approach?')
  await seedRunWithOpenQuestion(PASSWORD_REMEDIATION.id, 'Which release?')
  const opState = loadState()
  const result = await respondNeedsYouAnswerCommand({
    message: 'Answer the question with password remediation',
    projects: [HOUSEOS, PASSWORD_REMEDIATION],
    opState,
    focusProjectId: HOUSEOS.id,
    clock
  })
  assert.match(result.text, /Got it/)
  const houseosRun = readKeepGoingRun(HOUSEOS.id)
  const resolved = houseosRun.needsYou.find((n) => n.question === 'Which security approach?')
  assert.ok(resolved.resolvedAt, "HouseOS's own focused question must be the one resolved")
  assert.match(resolved.resolution, /password remediation/)
  const otherRun = readKeepGoingRun(PASSWORD_REMEDIATION.id)
  assert.ok(
    !otherRun.needsYou.find((n) => n.question === 'Which release?').resolvedAt,
    'the unrelated project whose name only coincidentally appeared in the answer text must stay untouched'
  )
})

test('conversational resolution: a NEEDS_YOU_ANSWER-shaped message never fabricates a resolution -- it only ever acts on a real, already-open item it can unambiguously identify', async () => {
  // "Yes, authorize it" is real NEEDS_YOU_ANSWER phrasing, but a message
  // that is ALSO independently consequential (push/deploy/credentials/money)
  // is classified TIM_REQUIRED by chat-responder.mjs's own classifyDecision
  // BEFORE this bridge is ever reached in the real wiring (command-
  // responder.mjs/chat-http-routes.mjs check decisionClass first) -- this
  // bridge itself has no notion of TIM_REQUIRED at all, structurally
  // incapable of resolving one; it can only ever refuse or resolve a real,
  // already-open Needs-You item. Real open items remain from the prior
  // ambiguity test (proj-c/proj-d, deliberately left unresolved to prove
  // non-mutation there) -- this message names neither and sets no focus,
  // so with more than one genuinely open item, the honest outcome is
  // AMBIGUOUS, never a guessed resolution.
  const opState = loadState()
  const result = await respondNeedsYouAnswerCommand({
    message: 'Yes, authorize it -- push this to production now.',
    projects: [],
    opState,
    focusProjectId: null,
    clock
  })
  assert.match(result.text, /not sure which open question/)
})
