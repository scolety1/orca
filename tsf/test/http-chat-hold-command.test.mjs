// TSF Overnight Control-Plane Burn-In V2, real finding (not guessed): the
// SAME "only reachable via Global Command's ambiguous path" blind spot
// findings #7/#8 fixed for PAUSE/RESUME/ADOPT (see docs/tsf/
// TSF_OVERNIGHT_CONTROL_PLANE_BURN_IN_V2_FINAL_REPORT.md) also applied to
// a genuinely single-target EXTERNAL_WORK_HOLD request. domain-level
// decomposeMultiAction already correctly classified a message like "NWR is
// being handled by another agent, leave it alone" as EXTERNAL_WORK_HOLD --
// but classifyMultiActionEntries' own >=2-target gate silently discarded
// it, and no other real path anywhere in the codebase recognized a
// single-target hold. Live-reproduced over the real HTTP route before
// fixing (a throwaway probe script, deleted before this test file was
// written): a natural, single-project hold request on BOTH per-project
// chat and Global Command exact-match never set a real, durable hold, with
// a generic fallback response giving no honest indication anything failed.
//
// Fixed with server/command-multi-action-bridge.mjs's own
// classifySingleTargetHoldEntries (reuses the same real per-clause
// decomposer, never a second parser) wired into BOTH command-responder.mjs
// (fixes the ambiguous Global Command surface) and directly into
// server/chat-http-routes.mjs (fixes per-project chat and exact-match
// Global Command, mirroring PAUSE/RESUME/ADOPT's own precedence gate:
// loses to research/TIM_REQUIRED/adoption/run-action).
//
// Real, isolated state file per process (mirrors http-chat-adoption-
// command.test.mjs exactly) -- this really drives the real HTTP /api/chat
// route end to end, never a fixture-only shortcut.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-http-chat-hold-command-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
const { createOvernightRun } = await import('../domain/keep-going.mjs')
const { readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')

function seedActiveKeepGoingRun(projectId, clock) {
  const opState = loadState()
  const run = createOvernightRun({ id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['X'] }, clock)
  saveState({ ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } })
}

// Same minimal-but-real onboarding shape http-chat-adoption-command.test.mjs
// uses -- the real project catalog (project-catalog.mjs's projectsById)
// requires this full shape, not the {repoPath, lastAnalysis: null}
// shortcut direct-call tests use.
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
          discovery: { commandGuidance: { hasKnownTestCommand: false, testCommands: [], lintCommands: [], buildCommands: [] } },
          direction: { purpose: null, recommendedNextMission: null, upgradeCandidates: [], unfinishedSummary: null, completedSummary: null, alignment: 'UNKNOWN', live: false },
          health: { status: 'HEALTHY', findings: [], observedAt: '2026-09-10T00:00:00.000Z' }
        }
      }
    }
  })
}

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

test('Overnight V2: a real single-target hold request over real HTTP genuinely sets a durable hold, on per-project Planner Chat', async () => {
  await withServer(async (base) => {
    const projectId = 'http-hold-per-project'
    seedOnboardedProjectForHttp(projectId, 'HTTP Hold Per Project', 'C:/nonexistent-http-hold-repo-1')

    const before = readProjectExecutionHold(projectId)
    assert.equal(before, null, 'sanity: no pre-existing hold')

    const res = await chat(base, {
      projectId,
      message: `${projectId} is being handled by another agent right now, leave it alone -- do not touch it.`
    })
    assert.equal(res.status, 200)
    assert.match(res.body.text, /Held/)

    const after = readProjectExecutionHold(projectId)
    assert.ok(after, 'a real, durable hold must have been written')
    assert.equal(after.status, 'ACTIVE')
    assert.equal(after.reason, 'EXTERNAL_WORK_ACTIVE')
  })
})

test('Overnight V2: a real single-target hold request over real HTTP genuinely sets a durable hold, on Global Command exact-match', async () => {
  await withServer(async (base) => {
    const projectId = 'http-hold-global-exact'
    seedOnboardedProjectForHttp(projectId, 'HTTP Hold Global Exact', 'C:/nonexistent-http-hold-repo-2')

    const res = await chat(base, {
      message: `${projectId} is being handled by another agent right now, leave it alone -- do not touch it.`
    })
    assert.equal(res.status, 200)
    assert.match(res.body.text, /Held/)

    const after = readProjectExecutionHold(projectId)
    assert.ok(after, 'a real, durable hold must have been written')
    assert.equal(after.status, 'ACTIVE')
  })
})

test('Overnight V2: duplicate delivery -- a hold request delivered twice over real HTTP is idempotent, never a second SET record', async () => {
  await withServer(async (base) => {
    const projectId = 'http-hold-duplicate'
    seedOnboardedProjectForHttp(projectId, 'HTTP Hold Duplicate', 'C:/nonexistent-http-hold-repo-3')

    const message = `${projectId} is being handled by another agent right now, leave it alone -- do not touch it.`
    const first = await chat(base, { projectId, message })
    assert.match(first.body.text, /Held/)
    const firstHold = readProjectExecutionHold(projectId)

    const second = await chat(base, { projectId, message })
    assert.match(second.body.text, /Held/, 'idempotent re-application still honestly reports Held, never an error')

    const afterHold = readProjectExecutionHold(projectId)
    assert.equal(afterHold.setAt, firstHold.setAt, 'the original SET record must survive -- never overwritten by the duplicate')
    assert.equal(afterHold.history.filter((h) => h.action === 'SET').length, 1, 'exactly one real SET record despite 2 delivered requests')
  })
})

test('Overnight V2: a message combining a hold-shaped clause with a genuinely consequential clause is refused in full (TIM_REQUIRED) -- never partially sets the hold', async () => {
  await withServer(async (base) => {
    const projectId = 'http-hold-tim-required'
    seedOnboardedProjectForHttp(projectId, 'HTTP Hold Tim Required', 'C:/nonexistent-http-hold-repo-4')

    const res = await chat(base, {
      projectId,
      message: `${projectId} is being handled by another agent, leave it alone -- also deploy this to production right now.`
    })
    assert.equal(res.status, 200)

    const after = readProjectExecutionHold(projectId)
    assert.equal(after, null, 'a TIM_REQUIRED-worthy message must never silently set a hold as a side effect')
  })
})

// Independent-review finding (real, live-reproduced by the reviewer,
// fixed here): the original `!runActionResult` gate on holdCommandResult
// meant a message combining a genuine PAUSE directive AND a genuine
// single-target hold directive for the SAME project silently executed
// the pause and DROPPED the hold entirely -- a real operator saying
// "pause X, it's being handled by another agent, leave it alone" would
// reasonably believe X was protected from further work when it was not.
// Fixed by computing the hold check independently of runActionResult and
// merging both real outcomes when both fire, matching this route's own
// established rule (already proven for TIM_REQUIRED and research) that a
// message with multiple real, distinct intents for the same target must
// never partially execute one while silently dropping another.
test('Overnight V2: a message combining a real PAUSE directive with a real hold directive for the SAME project executes BOTH, never silently drops the hold', async () => {
  await withServer(async (base) => {
    const projectId = 'http-hold-and-pause'
    const clock = () => new Date('2026-09-10T12:00:00.000Z')
    seedOnboardedProjectForHttp(projectId, 'HTTP Hold And Pause', 'C:/nonexistent-http-hold-repo-6')
    seedActiveKeepGoingRun(projectId, clock)

    const res = await chat(base, {
      projectId,
      message: `Pause ${projectId}. It is being handled by another agent right now, leave it alone -- do not touch it.`
    })
    assert.equal(res.status, 200)
    assert.match(res.body.text, /Paused/, 'the real pause must still execute')
    assert.match(res.body.text, /Held/, 'the real hold must ALSO execute -- never silently dropped')

    assert.equal(readKeepGoingRun(projectId).state, 'PAUSED', 'the run must really be paused')
    const hold = readProjectExecutionHold(projectId)
    assert.ok(hold, 'a real, durable hold must ALSO have been written -- the exact bug the independent review found')
    assert.equal(hold.status, 'ACTIVE')
  })
})

test('Overnight V2: per-project chat scoped to A, message names a DIFFERENT real project B -- the hold gate never fires for the wrong project', async () => {
  await withServer(async (base) => {
    const projectA = 'http-hold-wrongproj-a'
    const projectB = 'http-hold-wrongproj-b'
    seedOnboardedProjectForHttp(projectA, 'HTTP Hold Wrongproj A', 'C:/nonexistent-http-hold-repo-5a')
    seedOnboardedProjectForHttp(projectB, 'HTTP Hold Wrongproj B', 'C:/nonexistent-http-hold-repo-5b')

    // classifySingleTargetHoldEntries is called with [project] (only the
    // chat's own fixed scope, project A) -- a message naming a different
    // real project B in its own text must never cause A to be held on B's
    // behalf, and must never hold B either (B was never this turn's scope).
    const res = await chat(base, {
      projectId: projectA,
      message: `${projectB} is being handled by another agent, leave it alone.`
    })
    assert.equal(res.status, 200)

    assert.equal(readProjectExecutionHold(projectA), null, 'project A (the chat\'s own scope) must never be held on B\'s behalf')
    assert.equal(readProjectExecutionHold(projectB), null, 'project B (never this turn\'s real scope) must never be silently held either')
  })
})
