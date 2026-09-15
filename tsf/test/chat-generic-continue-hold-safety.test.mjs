// TSF_DOGFOOD_FINDING_1_EXECUTION_HOLD_SAFETY_V1: reproduces the actual
// failure family the finding was raised from -- a generic "continue/take
// over/finish" message sent to a project under a real execution hold.
//
// Real, live-confirmed via mutation testing against this exact suite: 3 of
// the 5 phrases below ("Take over this project and continue the work.",
// "Continue the overnight product advance.", "Resume work.") are NOT
// merely text-only -- chat-http-routes.mjs's own classifyRunActionVerb
// recognizes them as RESUME, routes through the canonical action-executor
// (executeAction({type:'RESUME'})) into command-run-action-bridge.mjs's
// real resumeProjectRun, exactly the function this finding's fix gated.
// Before the fix, THIS suite (run against the real /api/chat route) proved
// those 3 phrases genuinely resumed a held project's paused run end to
// end -- a real, directly reachable gap via ordinary phrasing, not a
// theoretical one. The other 2 phrases ("Release whatever is blocking
// this and keep going.", "Finish the project.") don't match
// classifyRunActionVerb and fall through this route's own precedence
// chain to the live-planner fallback (server/live-planner.mjs), invoked
// with `--tools ""` -- zero ability to edit/run/adopt/merge/push/deploy,
// pure text generation -- so they were never reachable to begin with,
// regardless of this fix.
//
// The dedicated EXECUTION BACKSTOP tests below isolate resumeProjectRun
// directly (no HTTP/classifier layer) for a faster, more precise proof of
// the same mechanism.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-chat-generic-continue-hold-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
// No live planner call actually succeeds in this file -- these phrases
// never need one to prove the safety property (no run/hold mutation),
// and a real live call would be slow/costly/non-deterministic for no
// added proof value. Mirrors http-chat-hold-command.test.mjs's own
// convention for tests that don't care about live-call content.
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { readProjectExecutionHold, withProjectExecutionHold } =
  await import('../server/project-execution-hold-store.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { resumeProjectRun } = await import('../server/command-run-action-bridge.mjs')

const clock = () => new Date('2026-09-15T18:00:00.000Z')

function seedOnboardedProject(projectId, displayName, repoPath) {
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

function seedPausedKeepGoingRun(projectId) {
  const opState = loadState()
  let run = createOvernightRun(
    { id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
  run = { ...run, state: 'PAUSED' }
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

const HISTORICAL_REPRODUCTION_PHRASES = [
  'Take over this project and continue the work.',
  'Continue the overnight product advance.',
  'Release whatever is blocking this and keep going.',
  'Finish the project.',
  'Resume work.'
]

for (const message of HISTORICAL_REPRODUCTION_PHRASES) {
  test(`HISTORICAL REPRODUCTION: "${message}" against a held project never mutates the run or the hold`, async () => {
    await withServer(async (base) => {
      const projectId = `hold-repro-${message.length}-${Date.now()}`
      seedOnboardedProject(projectId, 'Hold Repro Project', `C:/nonexistent-${projectId}`)
      seedPausedKeepGoingRun(projectId)
      const hold = await withProjectExecutionHold(projectId, () =>
        createProjectExecutionHold(
          {
            projectId,
            reason: 'EXTERNAL_WORK_ACTIVE',
            setBy: 'OPERATOR_CHAT',
            note: 'another AI is actively working this repo'
          },
          clock
        )
      )

      const res = await chat(base, { projectId, message })
      assert.equal(
        res.status,
        200,
        'a generic message must never 5xx even with no live planner configured'
      )
      assert.notEqual(res.body.dispatched, true, 'never claims a dispatch happened')

      assert.equal(
        readKeepGoingRun(projectId).state,
        'PAUSED',
        'the run stays exactly PAUSED -- never silently resumed'
      )
      assert.deepEqual(
        readProjectExecutionHold(projectId),
        hold,
        'the hold is byte-identical -- no hidden release, no mutation'
      )
    })
  })
}

test('EXECUTION BACKSTOP: Command\'s own "continue it" follow-up path (resumeProjectRun) refuses a held project\'s paused run', async () => {
  const projectId = 'command-continue-held'
  seedPausedKeepGoingRun(projectId)
  const hold = await withProjectExecutionHold(projectId, () =>
    createProjectExecutionHold(
      { projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT' },
      clock
    )
  )

  await assert.rejects(
    () => resumeProjectRun(projectId, clock),
    (error) => {
      assert.equal(error.code, 'TSF_PROJECT_EXECUTION_HOLD_ACTIVE')
      return true
    }
  )
  assert.equal(readKeepGoingRun(projectId).state, 'PAUSED')
  assert.deepEqual(readProjectExecutionHold(projectId), hold)
})

test('EXECUTION BACKSTOP: Command\'s own "continue it" follow-up path (resumeProjectRun) still works normally for an unheld project', async () => {
  const projectId = 'command-continue-free'
  seedPausedKeepGoingRun(projectId)
  const run = await resumeProjectRun(projectId, clock)
  assert.equal(run.state, 'ACTIVE')
})
