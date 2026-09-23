// TSF Owner Dogfood/Critique Loop V1: regression coverage for the real
// P0/P1 findings from the round-1 Codex safety review (post-Chunk-4).
// Real HTTP, real isolated state, same convention as
// http-chat-hold-command.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-dogfood-safety-round1-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const { readAllDogfoodSessions } = await import('../server/dogfood-session-store.mjs')
const { recordFindingDetection, readAllFindings } =
  await import('../server/self-improvement-finding-store.mjs')

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

function seedActiveKeepGoingRun(projectId, clock) {
  const opState = loadState()
  const run = createOvernightRun(
    { id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
  saveState({ ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } })
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

test('P0 fix: a fleet-wide "pause everything" command is refused while ANY dogfood session is open, never reaching a project under review', async () => {
  await withServer(async (base) => {
    const projectA = 'safety-p0-scope-a'
    const projectB = 'safety-p0-scope-b'
    seedOnboardedProjectForHttp(projectA, 'Safety P0 Scope A', 'C:/nonexistent-safety-p0-a')
    seedOnboardedProjectForHttp(projectB, 'Safety P0 Scope B', 'C:/nonexistent-safety-p0-b')
    const clock = () => new Date('2026-09-22T12:00:00.000Z')
    seedActiveKeepGoingRun(projectA, clock)
    seedActiveKeepGoingRun(projectB, clock)

    await chat(base, { projectId: projectA, message: 'start dogfood mode' })

    const res = await chat(base, { message: 'pause everything' })
    assert.equal(res.status, 200)
    assert.equal(
      res.body.dogfood,
      true,
      'the fleet-wide command must be captured by the safety gate, not executed'
    )
    assert.notEqual(res.body.live, true)

    assert.equal(
      readKeepGoingRun(projectA).state,
      'ACTIVE',
      'the project under dogfood review must NOT have been paused'
    )
    assert.equal(
      readKeepGoingRun(projectB).state,
      'ACTIVE',
      'the unrelated project must ALSO not have been paused -- the whole fleet-wide action is refused, not partially applied'
    )

    // The dogfood session's own transcript must NOT have captured this
    // fleet-wide command as a critique turn -- it was refused outright,
    // not silently absorbed as feedback about project A.
    const sessions = readAllDogfoodSessions()
    const sessionA = Object.values(sessions).find((s) => s.projectId === projectA)
    assert.equal(sessionA.transcript.length, 0)
  })
})

test('P0 fix: a concurrent stale whole-state save from an unrelated handler never erases an active dogfood session', async () => {
  await withServer(async (base) => {
    const projectId = 'safety-p0-lost-update'
    seedOnboardedProjectForHttp(projectId, 'Safety P0 Lost Update', 'C:/nonexistent-safety-p0-lu')
    seedActiveKeepGoingRun(projectId, () => new Date('2026-09-22T12:00:00.000Z'))

    // Simulate the real repro: an unrelated handler reads a stale full
    // snapshot BEFORE the dogfood session starts...
    const staleSnapshot = loadState()

    await chat(base, { projectId, message: 'start dogfood mode' })
    const beforeCount = Object.keys(readAllDogfoodSessions()).length

    // ...then saves that stale snapshot LATE, the same shape POST
    // /api/usage-mode uses ({ ...staleOpState, someField: newValue }).
    saveState({ ...staleSnapshot, usageMode: 'ECONOMY' })

    const sessionsAfter = readAllDogfoodSessions()
    assert.equal(
      Object.keys(sessionsAfter).length,
      beforeCount,
      'the dogfood session must survive an unrelated stale whole-state write -- none should be lost or duplicated'
    )
    const session = Object.values(sessionsAfter).find((s) => s.projectId === projectId)
    assert.ok(session, "this test's own session must still be present")
    assert.equal(session.state, 'ACTIVE')

    // The unrelated field DID get written -- this fix protects
    // dogfoodSessions specifically, not a claim that every field is now
    // race-free.
    assert.equal(loadState().usageMode, 'ECONOMY')

    // The safety invariant still holds after the near-miss: a dangerous
    // message is still captured, not executed.
    const before = readKeepGoingRun(projectId).state
    const res = await chat(base, { projectId, message: `pause ${projectId}` })
    assert.equal(res.body.dogfood, true)
    assert.equal(readKeepGoingRun(projectId).state, before)
  })
})

test('Cross-contamination fix: pausing a project-scoped session never lets its later messages fall through to an unrelated global session', async () => {
  await withServer(async (base) => {
    const projectId = 'safety-cross-contam'
    seedOnboardedProjectForHttp(projectId, 'Safety Cross Contam', 'C:/nonexistent-safety-cc')

    await chat(base, { message: 'start dogfood mode' }) // global session
    await chat(base, { projectId, message: 'start dogfood mode' }) // project session
    await chat(base, { projectId, message: 'pause dogfood' }) // pauses ONLY the project session

    // A subsequent project-scoped message must NOT be silently captured
    // by the unrelated global session -- it must fall through to normal
    // processing (or be honestly uncaptured), never mis-attributed.
    const res = await chat(base, { projectId, message: 'is anything stuck?' })
    assert.notEqual(
      res.body.dogfood,
      true,
      'a message for a PAUSED project session must not be captured by the global session'
    )

    const sessions = readAllDogfoodSessions()
    const globalSession = Object.values(sessions).find((s) => s.projectId === null)
    assert.equal(
      globalSession.transcript.length,
      0,
      'the global session must never receive a project-scoped message'
    )
  })
})

test('Finding-ID collision fix: two different projects reporting the same description on a shared route create two distinct findings', async () => {
  const clock = () => new Date('2026-09-22T12:00:00.000Z')
  const shared = {
    severity: 'P2',
    reproduction: 'The Save button is unresponsive.',
    route: '/settings'
  }
  const findingA = await recordFindingDetection(
    {
      sourceDetector: 'COMMAND_DOGFOOD',
      severity: shared.severity,
      projectId: 'collision-project-a',
      affectedSurface: `collision-project-a:${shared.route}`,
      evidence: {},
      reproduction: shared.reproduction,
      confidence: 0.5,
      verificationMethod: 'OWNER_DOGFOOD_TRANSCRIPT_REVIEW',
      candidateFixScope: null
    },
    clock
  )
  const findingB = await recordFindingDetection(
    {
      sourceDetector: 'COMMAND_DOGFOOD',
      severity: shared.severity,
      projectId: 'collision-project-b',
      affectedSurface: `collision-project-b:${shared.route}`,
      evidence: {},
      reproduction: shared.reproduction,
      confidence: 0.5,
      verificationMethod: 'OWNER_DOGFOOD_TRANSCRIPT_REVIEW',
      candidateFixScope: null
    },
    clock
  )
  assert.notEqual(
    findingA.findingId,
    findingB.findingId,
    'must be two distinct findings, not a collision'
  )
  const all = readAllFindings()
  assert.equal(all[findingA.findingId].projectId, 'collision-project-a')
  assert.equal(all[findingB.findingId].projectId, 'collision-project-b')
})

test('Concurrent synthesis race fix: two concurrent detections of the same NEW finding never throw an invalid transition', async () => {
  const { synthesizeDogfoodSession } = await import('../server/dogfood-synthesis.mjs')
  const { createDogfoodSession, appendDogfoodTurn, endDogfoodSession } =
    await import('../domain/dogfood-session.mjs')
  const clock = () => new Date('2026-09-22T12:00:00.000Z')

  function buildSession(id, projectId) {
    let s = createDogfoodSession({ id, projectId }, clock)
    s = appendDogfoodTurn(s, { role: 'OWNER', content: 'the save button is broken' }, clock)
    return endDogfoodSession(s, clock)
  }

  const observation = [
    {
      category: 'BUG',
      settledDescription: 'Concurrent-race test: the same underlying bug reported twice at once.',
      disposition: 'SAFE_TO_IMPLEMENT',
      evidenceTurnIndexes: [0],
      severity: 'P2',
      route: '/race-test'
    }
  ]

  process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
  process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
  process.env.STUB_DOGFOOD_SYNTHESIS_JSON = JSON.stringify(observation)
  process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
  process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

  const [resultA, resultB] = await Promise.all([
    synthesizeDogfoodSession(buildSession('dogfood:race-a', 'race-project'), { clock }),
    synthesizeDogfoodSession(buildSession('dogfood:race-b', 'race-project'), { clock })
  ])

  delete process.env.STUB_DOGFOOD_SYNTHESIS_JSON

  assert.equal(resultA.ok, true)
  assert.equal(resultB.ok, true)
  assert.equal(
    resultA.findingIds[0],
    resultB.findingIds[0],
    'both must resolve to the SAME content-addressed finding'
  )

  const { readFinding } = await import('../server/self-improvement-finding-store.mjs')
  const finding = readFinding(resultA.findingIds[0])
  assert.equal(finding.status, 'NEEDS_OWNER')
  assert.equal(
    finding.occurrences,
    2,
    'the recurrence must still be counted even though only one transition wins the race'
  )
})
