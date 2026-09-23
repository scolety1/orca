// TSF Owner Dogfood/Critique Loop V1, Chunk 1: real HTTP proof of the
// non-execution safety gate in server/dogfood-session-capture.mjs. Real,
// isolated on-disk state per process (mirrors http-chat-hold-command.test.mjs
// exactly) -- this drives the real /api/chat route end to end, never a
// fixture-only shortcut.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-dogfood-session-capture-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { readAllDogfoodSessions } = await import('../server/dogfood-session-store.mjs')

function seedActiveKeepGoingRun(projectId, clock) {
  const opState = loadState()
  const run = createOvernightRun(
    { id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
  saveState(
    { ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } },
    { writerCollection: 'keepGoingRuns' }
  )
}

function seedOnboardedProjectForHttp(projectId, displayName, repoPath) {
  const opState = loadState()
  saveState({
    ...opState,
    onboardedProjects: {
      ...opState.onboardedProjects,
      [projectId]: {
        acceptedAt: '2026-09-10T00:00:00.000Z',
        receipts: [],
        lastAnalysis: {
          projectId,
          displayName,
          repoPath,
          analyzedAt: '2026-09-10T00:00:00.000Z',
          maturity: 'DEVELOPING',
          identity: { branch: 'main', head: 'seed000', tree: 'seedtree' },
          migrationClassification: { classification: 'SAFE_TO_ONBOARD_NOW', reasons: [] },
          handoffReconciliation: { hasHandoff: false },
          orcaRegistration: { checked: false, registered: false },
          discovery: {
            commandGuidance: {
              hasKnownTestCommand: false,
              testCommands: [],
              lintCommands: [],
              buildCommands: []
            }
          },
          direction: {
            purpose: null,
            recommendedNextMission: null,
            upgradeCandidates: [],
            unfinishedSummary: null,
            completedSummary: null,
            alignment: 'UNKNOWN',
            live: false
          },
          health: { status: 'HEALTHY', findings: [], observedAt: '2026-09-10T00:00:00.000Z' }
        }
      }
    }
  })
}

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.writeHead(404)
      res.end()
    })
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

function relevantState() {
  const s = loadState()
  return {
    keepGoingRuns: s.keepGoingRuns,
    projectExecutionHolds: s.projectExecutionHolds,
    commandFocus: s.commandFocus,
    researchMissions: s.researchMissions
  }
}

test('State-before == state-after: dangerous-sounding messages captured during an ACTIVE dogfood session never mutate real state', async () => {
  await withServer(async (base) => {
    const projectId = 'dogfood-capture-danger'
    seedOnboardedProjectForHttp(projectId, 'Dogfood Capture Danger', 'C:/nonexistent-dogfood-1')
    seedActiveKeepGoingRun(projectId, () => new Date('2026-09-22T12:00:00.000Z'))

    const start = await chat(base, { projectId, message: 'start dogfood mode' })
    assert.equal(start.status, 200)
    assert.match(start.body.text, /Dogfood session started/)

    const dangerous = [
      `pause ${projectId}`,
      `${projectId} is being handled by another agent, leave it alone`,
      `release the hold on ${projectId}`,
      'switch to a different project',
      `start research on ${projectId}`
    ]

    for (const message of dangerous) {
      const before = relevantState()
      const res = await chat(base, { projectId, message })
      assert.equal(res.status, 200)
      assert.equal(res.body.dogfood, true, `expected a dogfood-capture response for: ${message}`)
      const after = relevantState()
      assert.deepEqual(
        after,
        before,
        `real durable state must be byte-for-byte unchanged after a captured message: ${message}`
      )
    }

    const sessions = readAllDogfoodSessions()
    const session = Object.values(sessions).find((s) => s.projectId === projectId)
    assert.ok(session, 'the session must exist')
    assert.equal(
      session.transcript.length,
      dangerous.length,
      'every dangerous message must have been captured as a transcript turn'
    )
  })
})

test('Start/pause/resume/end lifecycle: trigger phrases transition state and are never captured as transcript content', async () => {
  await withServer(async (base) => {
    const projectId = 'dogfood-lifecycle'
    seedOnboardedProjectForHttp(projectId, 'Dogfood Lifecycle', 'C:/nonexistent-dogfood-2')

    const start = await chat(base, { projectId, message: 'start dogfood mode' })
    assert.match(start.body.text, /Dogfood session started/)

    const note = await chat(base, { projectId, message: 'this button is confusing' })
    assert.equal(note.body.dogfood, true)

    const pause = await chat(base, { projectId, message: 'pause dogfood' })
    assert.match(pause.body.text, /paused/i)

    // While paused, a normal message is NOT captured -- it falls through
    // to ordinary processing (a question, in this case).
    const duringPause = await chat(base, { projectId, message: 'is anything stuck?' })
    assert.notEqual(
      duringPause.body.dogfood,
      true,
      'a message while PAUSED must not be captured -- normal processing resumes'
    )

    const resume = await chat(base, { projectId, message: 'resume dogfood' })
    assert.match(resume.body.text, /resumed/i)

    const note2 = await chat(base, { projectId, message: 'this is good, do not touch it' })
    assert.equal(note2.body.dogfood, true)

    const end = await chat(base, { projectId, message: 'end dogfood mode' })
    assert.match(end.body.text, /Dogfood session ended/)
    assert.match(end.body.text, /2 thing\(s\) captured/)

    const sessions = readAllDogfoodSessions()
    const session = Object.values(sessions).find((s) => s.projectId === projectId)
    assert.equal(session.state, 'ENDED')
    assert.ok(session.endedAt)
    assert.equal(
      session.transcript.length,
      2,
      'only the 2 real feedback turns, never the trigger phrases'
    )
    assert.deepEqual(
      session.transcript.map((t) => t.content),
      ['this button is confusing', 'this is good, do not touch it']
    )
  })
})

test('Refuse double-start: starting a session when one is already open for the same scope refuses cleanly, never overwrites the transcript', async () => {
  await withServer(async (base) => {
    const projectId = 'dogfood-double-start'
    seedOnboardedProjectForHttp(projectId, 'Dogfood Double Start', 'C:/nonexistent-dogfood-3')

    await chat(base, { projectId, message: 'start dogfood mode' })
    await chat(base, { projectId, message: 'first real finding' })

    const secondStart = await chat(base, { projectId, message: 'start dogfood mode' })
    assert.match(secondStart.body.text, /already open/i)

    const sessions = readAllDogfoodSessions()
    const openSessions = Object.values(sessions).filter(
      (s) => s.projectId === projectId && s.state !== 'ENDED'
    )
    assert.equal(openSessions.length, 1, 'must still be exactly one open session for this scope')
    assert.equal(openSessions[0].transcript.length, 1, 'the original transcript must be intact')
  })
})

test('Global vs project-scoped sessions do not cross-contaminate', async () => {
  await withServer(async (base) => {
    const projectA = 'dogfood-scope-a'
    const projectB = 'dogfood-scope-b'
    seedOnboardedProjectForHttp(projectA, 'Dogfood Scope A', 'C:/nonexistent-dogfood-4a')
    seedOnboardedProjectForHttp(projectB, 'Dogfood Scope B', 'C:/nonexistent-dogfood-4b')

    await chat(base, { projectId: projectA, message: 'start dogfood mode' })
    await chat(base, { projectId: projectA, message: 'finding about A' })

    // Project B has no session of its own and no global session active --
    // an ordinary message about B must NOT be captured.
    const bMessage = await chat(base, { projectId: projectB, message: 'is anything stuck?' })
    assert.notEqual(
      bMessage.body.dogfood,
      true,
      "project B must be unaffected by project A's session"
    )

    const sessions = readAllDogfoodSessions()
    const sessionA = Object.values(sessions).find((s) => s.projectId === projectA)
    assert.equal(sessionA.transcript.length, 1, "only A's own finding was captured")
    assert.ok(
      !Object.values(sessions).some((s) => s.projectId === projectB),
      'no session was ever created for project B'
    )
  })
})

test('Normal chat with no dogfood session active is completely unaffected', async () => {
  await withServer(async (base) => {
    const projectId = 'dogfood-unaffected'
    seedOnboardedProjectForHttp(projectId, 'Dogfood Unaffected', 'C:/nonexistent-dogfood-5')
    seedActiveKeepGoingRun(projectId, () => new Date('2026-09-22T12:00:00.000Z'))

    const before = relevantState()
    const res = await chat(base, { projectId, message: `pause ${projectId}` })
    assert.equal(res.status, 200)
    assert.notEqual(res.body.dogfood, true, 'must not be treated as a dogfood capture')
    assert.match(res.body.text, /Paused/)
    const after = readKeepGoingRun(projectId)
    assert.equal(
      after.state,
      'PAUSED',
      'the real pause must genuinely execute with no session active'
    )
    assert.notDeepEqual(
      relevantState(),
      before,
      'real state must actually change for ordinary chat'
    )
  })
})
