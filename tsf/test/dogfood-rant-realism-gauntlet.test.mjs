// Owner-trial-prep mission, Section 9/10 ("dogfood the dogfood loop"):
// covers realistic capture shapes the existing rant tests
// (dogfood-synthesis.test.mjs's own "messy example", dogfood-session-
// capture.test.mjs's dangerous-message set) don't yet exercise --
// route changes mid-rant (the owner navigating while talking), voice-
// like punctuation-free/fragment text, and a real invariant proof: a
// finding created from a session's transcript is ALWAYS attributed to
// that session's own project, never to a different real project the
// owner merely mentioned by name mid-rant (implementation-batch safety,
// Section 10's "wrong-project finding cannot leak in").
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-dogfood-rant-realism-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readAllDogfoodSessions } = await import('../server/dogfood-session-store.mjs')
const { synthesizeDogfoodSession } = await import('../server/dogfood-synthesis.mjs')
const { readFinding } = await import('../server/self-improvement-finding-store.mjs')

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

// Realistic voice-transcript shapes: no punctuation, sentence fragments,
// filler words, self-interruption, run-on clauses -- exactly what Web
// Speech API output (or a fast typed rant) actually looks like, not the
// grammatically clean prose every other dogfood test fixture uses.
const VOICE_LIKE_TURNS = [
  { route: '/hq', content: 'this whole thing is confusing' },
  { route: '/hq', content: 'like i dont even know whats happening here' },
  { route: '/work', content: 'ok this page is fine actually' },
  {
    route: '/work',
    content: 'pause everything actually im talking about the ui dont pause anything'
  },
  { route: '/projects/other-real-project', content: 'this looks broken too on the other project' },
  { route: '/command', content: 'i hate this button delete it actually no just make it smaller' },
  { route: '/command', content: 'this needs you interaction is perfect dont change it' }
]

test('a voice-like, punctuation-free, route-changing rant is captured turn-by-turn intact -- never throws, never executes, never drops a route', async () => {
  await withServer(async (base) => {
    const projectId = 'rant-realism-project'
    const otherRealProjectId = 'rant-realism-other-project'
    seedOnboardedProjectForHttp(projectId, 'Rant Realism Project', 'C:/nonexistent-rant-realism')

    await chat(base, { projectId, route: '/hq', message: 'start dogfood mode' })
    for (const turn of VOICE_LIKE_TURNS) {
      const res = await chat(base, { projectId, route: turn.route, message: turn.content })
      assert.equal(res.status, 200)
      assert.equal(res.body.dogfood, true, `"${turn.content}" must be captured, not executed`)
    }
    const endRes = await chat(base, { projectId, message: 'end dogfood mode' })
    assert.equal(endRes.status, 200)

    const session = Object.values(readAllDogfoodSessions()).find((s) => s.projectId === projectId)
    assert.equal(session.transcript.length, VOICE_LIKE_TURNS.length)
    // Every turn's own route is preserved individually -- a rant that
    // moves across pages must not collapse to a single, stale route.
    assert.deepEqual(
      session.transcript.map((t) => t.route),
      VOICE_LIKE_TURNS.map((t) => t.route)
    )
    assert.deepEqual(
      session.transcript.map((t) => t.content),
      VOICE_LIKE_TURNS.map((t) => t.content)
    )

    // The mid-rant mention of a DIFFERENT real project by route
    // (/projects/other-real-project) must never itself become an action
    // against that project -- it's just captured text, same as everything
    // else. otherRealProjectId is never referenced by chat() above at all
    // -- this assertion documents the invariant, not a real check target.
    void otherRealProjectId
  })
})

test("a finding synthesized from this session is always attributed to the SESSION'S OWN project, never to a different project merely mentioned in the transcript text", async () => {
  process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
  process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
  // The planner's own settledDescription text NAMES a different real
  // project ("other-real-project") -- an adversarial-ish but realistic
  // case (the owner said "this is broken on the other project too" and
  // the planner wrote that into its description). The finding's
  // projectId field must still come from the session, structurally,
  // never parsed or inferred from this text.
  process.env.STUB_DOGFOOD_SYNTHESIS_JSON = JSON.stringify([
    {
      category: 'BUG',
      settledDescription: 'The layout is broken here, and also on other-real-project.',
      disposition: 'SAFE_TO_IMPLEMENT',
      evidenceTurnIndexes: [0],
      severity: 'P2',
      route: '/hq'
    }
  ])

  const { createDogfoodSession, appendDogfoodTurn, endDogfoodSession } =
    await import('../domain/dogfood-session.mjs')
  const clock = () => new Date('2026-09-23T00:00:00.000Z')
  let session = createDogfoodSession(
    { id: 'dogfood:leak-test', projectId: 'leak-test-project' },
    clock
  )
  session = appendDogfoodTurn(
    session,
    { role: 'OWNER', content: 'this looks broken too on the other project' },
    clock
  )
  session = endDogfoodSession(session, clock)

  const result = await synthesizeDogfoodSession(session, { clock })
  assert.equal(result.ok, true)
  assert.equal(result.findingIds.length, 1)
  const finding = readFinding(result.findingIds[0])
  assert.equal(
    finding.projectId,
    'leak-test-project',
    "the finding must be attributed to the session's own project, never a project named only in the settledDescription text"
  )
  assert.notEqual(finding.projectId, 'other-real-project')
})
