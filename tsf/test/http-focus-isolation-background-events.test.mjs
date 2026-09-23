// TSF Owner Trial Prep: real, live proof of focus isolation -- the
// overnight mission argued this was "architecturally sound by
// construction" via grep/code-reading alone; the daytime mission
// explicitly deferred proving it live. This proves it for real, over
// real HTTP, against the real durable stores -- not just a claim from
// reading the code.
//
// Complements (does not duplicate) test/http-command-focus-persistence.test.mjs,
// which already proves a single AUTO_DECIDE status question about a
// DIFFERENT project doesn't move focus, and that explicit switch/go-back
// work. This file's unique contribution: real BACKGROUND state-store
// events (a run completing, a run recovering from a stall/worker loss, a
// run raising Needs You, a run unblocking from a resource wait) for
// OTHER projects, interleaved with Command chat turns focused on one
// project, proving (a) focus never drifts because of them, and (b)
// canonical state genuinely did update (the events are real, not
// silently dropped).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-focus-isolation-${process.pid}.json`
)
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { createOvernightRun, markStalled, transitionRun, raiseNeedsYou, blockRun } =
  await import('../domain/keep-going.mjs')

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
    for (const suffix of ['', '.tmp', '.lock', '.research.lock']) {
      rmSync(`${STATE_FILE}${suffix}`, { force: true })
    }
  }
}

// Real, always-present-by-default project ids (server/data-store.mjs's
// own DEFAULTS.workSet) -- no onboarding/seeding required to reference
// them, matching http-command-focus-persistence.test.mjs's own approach.
const PROJECT_A = 'tsf-ui-capability-check' // stays focused throughout
const PROJECT_B = 'colety-labs-sales-engine' // completes
const PROJECT_C = 'weird-talent-marketplace' // recovers from worker loss
const PROJECT_D = 'shopify-catalog-qa' // raises Needs You

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function seedRun(projectId, clock) {
  await withKeepGoingRun(projectId, (current) => {
    assert.equal(current, null, `${projectId} must start with no run for a clean seed`)
    return createOvernightRun(
      { id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
      clock
    )
  })
}

test('LIVE focus isolation: real background events for other projects never move focus off the one the owner is talking to, and canonical state genuinely updates', async () => {
  await withServer(async (base) => {
    const clock = () => new Date('2026-09-23T00:00:00.000Z')

    // Focus the conversation on Project A.
    const focused = await chat(base, { projectId: null, message: `Let's work on ${PROJECT_A}.` })
    assert.equal(focused.body.focusProjectId, PROJECT_A)

    // Seed real, in-flight runs for B/C/D (the ones background events will
    // land on) -- A deliberately has no run; focus isolation must hold
    // regardless of whether the focused project itself has any run at all.
    await seedRun(PROJECT_B, clock)
    await seedRun(PROJECT_C, clock)
    await seedRun(PROJECT_D, clock)

    // --- Real background event 1: Project B's run completes. ---
    await withKeepGoingRun(PROJECT_B, (run) =>
      transitionRun(run, 'COMPLETE', { reason: 'ORIGINAL_GOAL_SATISFIED' }, clock)
    )

    // --- Real background event 2: Project C stalls (worker loss), then recovers. ---
    await withKeepGoingRun(PROJECT_C, (run) =>
      markStalled(run, [{ dispatchId: 'lost-worker-1' }], clock)
    )
    await withKeepGoingRun(PROJECT_C, (run) =>
      transitionRun(run, 'ACTIVE', { reason: 'WORKER_RECOVERED' }, clock)
    )

    // --- Real background event 3: Project D raises a real Needs You. ---
    await withKeepGoingRun(PROJECT_D, (run) =>
      raiseNeedsYou(run, { question: 'Which auth provider should the QA sandbox use?' }, clock)
    )

    // --- Real background event 4: a resource-blocked run for a 5th,
    // newly-onboarded project becomes runnable again. Uses blockRun/
    // transitionRun directly since there is no default 5th workSet id. ---
    const PROJECT_E = 'onboarded-resource-wait-project'
    saveState({
      ...loadState(),
      onboardedProjects: {
        [PROJECT_E]: {
          acceptedAt: '2026-09-10T00:00:00.000Z',
          receipts: [],
          lastAnalysis: {
            projectId: PROJECT_E,
            displayName: 'Onboarded Resource Wait Project',
            repoPath: 'C:/nonexistent-onboarded-resource-wait',
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
    await seedRun(PROJECT_E, clock)
    await withKeepGoingRun(PROJECT_E, (run) =>
      blockRun(run, 'RESOURCE_PRESSURE_HIGH', ['host memory below floor'], clock)
    )
    await withKeepGoingRun(PROJECT_E, (run) =>
      transitionRun(run, 'ACTIVE', { reason: 'RESOURCES_FREED' }, clock)
    )

    // --- Assertion: focus is STILL Project A, completely unmoved by 4 real background events across 4 other projects. ---
    const focusAfterEvents = loadState().commandFocus
    assert.equal(
      focusAfterEvents.focusProjectId,
      PROJECT_A,
      'conversational focus must be untouched by background events on other projects'
    )
    assert.deepEqual(
      focusAfterEvents.recentProjectStack,
      [],
      'the recent-project stack must also be untouched -- these were never a real focus-changing turn'
    )

    // --- Assertion: canonical state genuinely DID update for every one of B/C/D/E (not silently dropped). ---
    const finalState = loadState()
    assert.equal(finalState.keepGoingRuns[PROJECT_B].state, 'COMPLETE')
    assert.equal(finalState.keepGoingRuns[PROJECT_C].state, 'ACTIVE')
    assert.equal(
      finalState.keepGoingRuns[PROJECT_C].transitions.some((t) => t.to === 'STALLED'),
      true,
      'the real stall must be in the transition history even though it later recovered'
    )
    assert.equal(finalState.keepGoingRuns[PROJECT_D].state, 'NEEDS_YOU')
    assert.equal(finalState.keepGoingRuns[PROJECT_D].needsYou.length, 1)
    assert.equal(finalState.keepGoingRuns[PROJECT_E].state, 'ACTIVE')
    assert.equal(
      finalState.keepGoingRuns[PROJECT_E].transitions.some((t) => t.to === 'BLOCKED'),
      true
    )

    // --- A genuine status question about Project B (read-only, no
    // consequential verb) while focus is on A must not switch focus to B
    // either, even with B's own state having just changed underneath it. ---
    const statusAboutB = await chat(base, {
      projectId: null,
      message: `How is ${PROJECT_B} doing?`
    })
    assert.equal(statusAboutB.status, 200)
    assert.equal(
      statusAboutB.body.focusProjectId,
      PROJECT_A,
      'a status question about a project with a just-changed background state must still not steal focus'
    )
    assert.equal(loadState().commandFocus.focusProjectId, PROJECT_A)
  })
})
