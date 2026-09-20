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
