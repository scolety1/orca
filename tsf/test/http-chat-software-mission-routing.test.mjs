// Family 6 (exact regression fixtures) + live end-to-end proof for TSF
// Software Mission Routing / Project Planner Hotfix V1 -- hits the REAL
// /api/chat HTTP route (http-server.mjs -> chat-http-routes.mjs), exactly
// as the real Global Command dock and per-project Planner Chat UI do.
// Same harness as test/http-chat-project-research.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-http-chat-software-mission-routing-${process.pid}.json`)
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'

const { createRequestHandler } = await import('../server/http-server.mjs')

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    for (const suffix of ['', '.tmp', '.lock', '.research.lock']) rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}

const PROJECT_ID = 'tsf-ui-capability-check'

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

// Fixture A/B/C/D/E: a realistic long-form software/product-engineering
// mission, modeled on the real live NWR overnight mission's shape without
// reproducing any real NWR content, that literally contains the exact
// fragments "to Codex;" and standalone "mission" -- the precise substrings
// that were mis-extracted as Dataset Research subjects in the live bug.
function longSoftwareMissionFixture() {
  return [
    'TSF SOFTWARE MISSION ROUTING REGRESSION FIXTURE',
    '',
    'Do not start NWR engineering work in this mission.',
    '',
    'CURRENT LIVE FAILURE',
    'Test 18 engine repair: repo archaeology, hand the heavy implementation work',
    'to Codex; replay tooling, UI work, in-season product development, league',
    'shell work, testing, verification, and an owner-supplied evidence ZIP.',
    '',
    'Research historical outcomes to validate a challenger, using dataset',
    'evidence from public sources. Do not start a research mission for this.',
    '',
    'This is the mission. Fix this and go ahead.'
  ].join('\n')
}

const RESEARCH_REFUSAL_MARKERS = [
  /before i start a research mission/i,
  /dataset ResearchSpecification/i,
  /entity type\/universe\/fields/i,
  /grounded in real ResearchMission state/i
]

function assertNotResearchRouted(body) {
  assert.notEqual(body.scope, 'RESEARCH', `expected non-research scope, got ${body.scope} -- text: ${body.text}`)
  assert.equal(body.researchMissionId ?? null, null, `expected no researchMissionId, got ${body.researchMissionId} -- text: ${body.text}`)
  for (const marker of RESEARCH_REFUSAL_MARKERS) {
    assert.doesNotMatch(body.text ?? '', marker, `response text matched a research-refusal marker: "${body.text}"`)
  }
}

test('Fixture A/B/C/D: Global Command (projectId: null) never routes the long software mission -- or its "to Codex;"/"mission" fragments -- to Dataset Research', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, { projectId: null, message: longSoftwareMissionFixture() })
    assert.equal(status, 200)
    assertNotResearchRouted(body)
  })
})

test('Fixture E: project-scoped Planner Chat never responds with the ResearchMission-only refusal to the same software mission', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, { projectId: PROJECT_ID, message: longSoftwareMissionFixture() })
    assert.equal(status, 200)
    assertNotResearchRouted(body)
    // The exact Failure B symptom: Planner Chat claiming it can ONLY
    // produce a bounded dataset ResearchSpecification and has no
    // filesystem/git/worktree/dispatch tools -- must never appear.
    assert.doesNotMatch(body.text ?? '', /no tools for filesystem inspection/i)
    assert.doesNotMatch(body.text ?? '', /can only produce a bounded dataset/i)
  })
})

test('exact isolated fragment "to Codex;" alone is never treated as a research subject in a software-shaped message', async () => {
  await withServer(async (base) => {
    const message = 'Fix the sync service and hand the implementation to Codex; add tests, run the verifier, and go ahead.'
    const { body } = await chat(base, { projectId: null, message })
    assertNotResearchRouted(body)
  })
})

test('exact isolated fragment "mission" alone is never treated as a research subject in a software-shaped message', async () => {
  await withServer(async (base) => {
    const message = 'Fix the sync service, add tests, run the verifier, and adopt. This is the mission. Go ahead.'
    const { body } = await chat(base, { projectId: null, message })
    assertNotResearchRouted(body)
  })
})

test('control: a genuine standalone dataset-research request through the same Global Command route still creates a real ResearchMission', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, { projectId: null, message: 'Research every 2008 NFL player and collect exact routes run, source, team and position.' })
    assert.equal(body.scope, 'RESEARCH')
    assert.ok(body.researchMissionId)
  })
})

test('control: negation never positively triggers a ResearchMission through the real route', async () => {
  await withServer(async (base) => {
    const { body } = await chat(base, { projectId: null, message: 'Do not research anything; fix the login bug and add tests.' })
    assertNotResearchRouted(body)
  })
})
