// TSF Owner Dogfood/Critique Loop V1, Chunk 4: GET /api/dogfood-session,
// the minimal owner-facing status read backing the UI indicator. Real
// HTTP, real isolated state, same convention as http-chat-hold-command.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-http-dogfood-status-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')

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

async function getSessions(base) {
  const res = await fetch(`${base}/api/dogfood-session`)
  return { status: res.status, body: await res.json() }
}

test('GET /api/dogfood-session: empty when nothing is active, reflects a real started session, reflects a stuck synthesis after it ends (no working planner in this test env)', async () => {
  await withServer(async (base) => {
    const before = await getSessions(base)
    assert.equal(before.status, 200)
    assert.deepEqual(before.body.sessions, [])

    await chat(base, { message: 'start dogfood mode' })
    const during = await getSessions(base)
    assert.equal(during.body.sessions.length, 1)
    assert.equal(during.body.sessions[0].state, 'ACTIVE')
    assert.equal(during.body.sessions[0].projectId, null)

    await chat(base, { message: 'this is a real finding' })
    const afterNote = await getSessions(base)
    assert.equal(afterNote.body.sessions[0].transcript.length, 1)

    const endRes = await chat(base, { message: 'end dogfood mode' })
    const after = await getSessions(base)
    // This file has no working planner configured, so synthesis fails and
    // the session's own crash-recovery status (RUNNING/FAILED) correctly
    // keeps it visible here -- a DONE session is the one case GET hides
    // (see test/dogfood-synthesis-crash-recovery.test.mjs for that case).
    const own = after.body.sessions.find((s) => s.id === endRes.body.sessionId)
    assert.ok(own, 'an ENDED session with a stuck synthesis must still appear')
    assert.equal(own.state, 'ENDED')
    assert.equal(own.synthesisStatus, 'FAILED')
  })
})

test('GET /api/dogfood-session: a PAUSED session still appears (paused, not gone)', async () => {
  await withServer(async (base) => {
    const projectId = 'dogfood-status-paused'
    seedOnboardedProjectForHttp(projectId, 'Dogfood Status Paused', 'C:/nonexistent-dogfood-status')
    await chat(base, { projectId, message: 'start dogfood mode' })
    await chat(base, { projectId, message: 'pause dogfood' })
    const result = await getSessions(base)
    const own = result.body.sessions.find((s) => s.projectId === projectId)
    assert.ok(own, "this test's own paused session must appear")
    assert.equal(own.state, 'PAUSED')
  })
})
