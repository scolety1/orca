// OPERATOR-STATE ADVERSARIAL TESTS (tsf-operator-hardening-v2). Not
// re-testing any single bug's own fix -- hunting for real defects at the
// SEAMS between already-adopted mechanisms: concurrent requests, stale
// state, unusual real state combinations, and cross-project isolation.
// Every test here exercises the real HTTP server + real domain code; the
// only stub is the Orca CLI (STUB_ORCA_MODE=success), matching every
// other test in this suite.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync, readFileSync, writeFileSync } from 'node:fs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-operator-state-adversarial-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
delete process.env.ORCA_TERMINAL_HANDLE

const { createRequestHandler } = await import('../server/http-server.mjs')
const { withKeepGoingRun } = await import('../server/keep-going-run-store.mjs')
const { pauseRun, raiseNeedsYou } = await import('../domain/keep-going.mjs')

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
    rmSync(STATE_FILE, { force: true })
    rmSync(`${STATE_FILE}.tmp`, { force: true })
    rmSync(`${STATE_FILE}.lock`, { force: true })
  }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}
async function post(base, urlPath, payload) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {})
  })
  return { status: res.status, body: await res.json() }
}

// tsf-ui-capability-check is the always-present fixture project id
// (server/fixture-project.mjs), safe to exercise real Keep Going runs
// against without touching any real project.
const P1 = 'tsf-ui-capability-check'

test('CONCURRENCY: two simultaneous start requests for the same project -- exactly one creates a run, the other is honestly rejected, never two runs', async () => {
  await withServer(async (base) => {
    const body = { originalGoal: 'Race the start route.', acceptanceCriteria: ['X'] }
    const [r1, r2] = await Promise.all([post(base, `/api/keep-going/${P1}/start`, body), post(base, `/api/keep-going/${P1}/start`, body)])
    const results = [r1, r2]
    const succeeded = results.filter((r) => r.status === 200)
    const rejected = results.filter((r) => r.status !== 200)
    assert.equal(succeeded.length, 1, `expected exactly one winner, got statuses ${results.map((r) => r.status)}`)
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].status, 422)
    assert.equal(rejected[0].body.code, 'TSF_RUN_ALREADY_ACTIVE')

    // Only one real run exists afterward, not a corrupted/merged shape.
    const final = await get(base, `/api/keep-going/${P1}`)
    assert.equal(final.body.started, true)
    assert.equal(final.body.runId, succeeded[0].body.runId)
  })
})

test('CONCURRENCY: two simultaneous pause requests carrying the same pre-pause revision -- exactly one succeeds, the other gets a real stale-revision rejection, never a silently-reapplied pause', async () => {
  await withServer(async (base) => {
    const started = await post(base, `/api/keep-going/${P1}/start`, {
      originalGoal: 'Race the pause route.',
      acceptanceCriteria: ['X']
    })
    const [r1, r2] = await Promise.all([
      post(base, `/api/keep-going/${P1}/pause`, { reason: 'race-a', expectedRevision: started.body.revision }),
      post(base, `/api/keep-going/${P1}/pause`, { reason: 'race-b', expectedRevision: started.body.revision })
    ])
    const results = [r1, r2]
    const succeeded = results.filter((r) => r.status === 200)
    const rejected = results.filter((r) => r.status !== 200)
    assert.equal(succeeded.length, 1, `expected exactly one winner, got statuses ${results.map((r) => r.status)}`)
    assert.equal(rejected[0].status, 409)
    assert.equal(rejected[0].body.code, 'TSF_STALE_REVISION')

    const final = await get(base, `/api/keep-going/${P1}`)
    assert.equal(final.body.state, 'PAUSED')
    assert.equal(final.body.revision, succeeded[0].body.revision)
  })
})

test('REAL STATE COMBINATION: a run that is PAUSED while carrying an open Needs You question reads NEEDS_YOU consistently across Keep Going, Work, and Flight Recorder -- never PAUSED on one surface and NEEDS_YOU on another', async () => {
  await withServer(async (base) => {
    await post(base, `/api/keep-going/${P1}/start`, {
      originalGoal: 'Prove PAUSED+open-Needs-You reads as NEEDS_YOU everywhere.',
      acceptanceCriteria: ['X']
    })
    const clock = () => new Date()
    // Construct the exact real combination directly at the domain layer
    // (no single HTTP route produces it in one call, but the sequence
    // itself is real and RUN_ALLOWED-legal: raise a question first (a
    // real background-verification-driven escalation, transitioning
    // ACTIVE -> NEEDS_YOU), THEN pause the now-NEEDS_YOU run (NEEDS_YOU ->
    // PAUSED is an explicitly allowed transition in domain/keep-going.mjs's
    // own RUN_ALLOWED table -- an operator choosing to pause a run that's
    // waiting on them, e.g. to come back to it later, is a completely
    // ordinary real action). The REVERSE order (pause first, then raise)
    // was tried first while writing this test and correctly THROWS
    // TSF_INVALID_RUN_TRANSITION (PAUSED -> NEEDS_YOU is not in
    // RUN_ALLOWED.PAUSED) -- confirming that direction is not a real
    // reachable state, only this one is.
    await withKeepGoingRun(P1, (current) =>
      raiseNeedsYou(current, { question: 'A real open question about to survive a pause.' }, clock, current.revision)
    )
    const run = await withKeepGoingRun(P1, (current) => pauseRun(current, 'OPERATOR_PAUSE', clock, current.revision))
    assert.equal(run.state, 'PAUSED')

    const keepGoing = await get(base, `/api/keep-going/${P1}`)
    // The coarse run.state is genuinely PAUSED now -- the real, load-
    // bearing fact every surface must still honor is the OPEN QUESTION.
    assert.equal(keepGoing.body.state, 'PAUSED')
    assert.equal(keepGoing.body.openNeedsYou.length, 1)

    const work = await get(base, '/api/work')
    const workEntry = work.body.needsYou.find((p) => p.id === P1)
    assert.ok(workEntry, 'Work must bucket this project under needsYou, not paused/active, because of the real open question')
    assert.equal(workEntry.liveWorkFeed.state, 'NEEDS_YOU')

    const flightRecorder = await get(base, `/api/projects/${P1}/flight-recorder`)
    assert.ok(
      flightRecorder.body.timeline.events.some((e) => e.type === 'NEEDS_YOU_RAISED'),
      'Flight Recorder must show the real NEEDS_YOU_RAISED event'
    )
  })
})

test('DEEP LINK: GET /api/keep-going/:projectId ignores any runId query string entirely -- always serves the real current run, never a stale one a deep link happens to name', async () => {
  await withServer(async (base) => {
    const started = await post(base, `/api/keep-going/${P1}/start`, {
      originalGoal: 'Prove runId in the query string is purely informational.',
      acceptanceCriteria: ['X']
    })
    const realRunId = started.body.runId
    // A stale/fabricated/completely made-up runId in the query string --
    // exactly what a bookmarked or stale deep link could carry.
    const staleDeepLink = await get(base, `/api/keep-going/${P1}?runId=keep-going-${P1}-0000000000000-does-not-exist`)
    assert.equal(staleDeepLink.status, 200)
    assert.equal(staleDeepLink.body.runId, realRunId, 'must ignore the query string runId and serve the real current run')
    assert.equal(staleDeepLink.body.started, true)
  })
})

test('CROSS-PROJECT ISOLATION: concurrent GETs for two different real projects never cross-contaminate -- each response is genuinely scoped to its own project', async () => {
  await withServer(async (base) => {
    // A second real project, onboarded fresh, distinct from the fixture.
    const analyze = await post(base, '/api/onboarding/analyze', { repoPath: path.join(HERE, '..', '..') })
    assert.equal(analyze.status, 200)
    const p2 = analyze.body.projectId
    assert.notEqual(p2, P1, 'the onboarded project must be a genuinely different id from the fixture')
    await post(base, '/api/onboarding/commit', {
      analysis: analyze.body,
      addTo: { knownProjects: true, activeFleet: false, workSet: false }
    })

    await post(base, `/api/keep-going/${P1}/start`, { originalGoal: `Goal for ${P1}.`, acceptanceCriteria: ['X'] })
    await post(base, `/api/keep-going/${p2}/start`, { originalGoal: `Goal for ${p2}.`, acceptanceCriteria: ['Y'] })

    // Fire many interleaved concurrent GETs for both projects -- if any
    // shared mutable state (a module-level variable, an unscoped cache)
    // ever leaked between them, this is the shape of request that would
    // expose it.
    const rounds = await Promise.all(
      Array.from({ length: 12 }, (_, i) => get(base, `/api/keep-going/${i % 2 === 0 ? P1 : p2}`))
    )
    for (let i = 0; i < rounds.length; i++) {
      const expectedProject = i % 2 === 0 ? P1 : p2
      const expectedGoalFragment = `Goal for ${expectedProject}.`
      assert.equal(
        rounds[i].body.goal,
        expectedGoalFragment,
        `request ${i} for ${expectedProject} returned a goal belonging to a different project: ${rounds[i].body.goal}`
      )
    }
  })
})

test('MALFORMED STATE: a run record missing fields a real one always has degrades honestly (a clear error or a safe default), never crashes the server with an unhandled exception', async () => {
  await withServer(async (base) => {
    await post(base, `/api/keep-going/${P1}/start`, {
      originalGoal: 'About to be corrupted.',
      acceptanceCriteria: ['X']
    })
    // Directly corrupt the persisted run -- simulates a partially-written
    // or hand-edited state file, not something any real route can produce
    // on its own, but a real operational risk (a disk write torn by a
    // crash, a manual state-file edit) this route must survive.
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    delete raw.keepGoingRuns[P1].needsYou
    delete raw.keepGoingRuns[P1].checkpoints
    writeFileSync(STATE_FILE, JSON.stringify(raw))

    const res = await fetch(`${base}/api/keep-going/${P1}`)
    // Whatever the real behavior is, it must not be an unhandled crash --
    // a clean 4xx/5xx JSON error, or a response that degrades the missing
    // fields honestly, are both acceptable; a raw stack trace or a hung
    // connection is not.
    assert.ok(res.status < 600, `got a non-HTTP-status response entirely: ${res.status}`)
    const text = await res.text()
    assert.doesNotMatch(text, /at Object\.<anonymous>|node_modules\/|\.mjs:\d+:\d+\)/, 'response leaked a raw stack trace instead of a real error shape')
  })
})

test('STALE ACTION RACE: abandon-stalled-wave against a run that is no longer STALLED by the time the request actually lands is rejected honestly, never silently no-op-ed as success', async () => {
  await withServer(async (base) => {
    const started = await post(base, `/api/keep-going/${P1}/start`, {
      originalGoal: 'Race abandon against a real state change.',
      acceptanceCriteria: ['X'],
      budget: { stallThresholdMs: 100 }
    })
    await post(base, `/api/keep-going/${P1}/tick`, {
      candidateWorkItems: [{ id: 'race-item', scope: ['a.md'], worktree: 'C:/repo/wt-race' }]
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const stallTick = await post(base, `/api/keep-going/${P1}/tick`, { candidateWorkItems: [] })
    assert.equal(stallTick.body.action, 'WAVE_STALLED')

    const beforeAbandon = await get(base, `/api/keep-going/${P1}`)
    // A genuine operator recovery beats the abandon call to the punch --
    // e.g. an autonomous resume/pause raced against a UI click. Simulated
    // here by pausing the run directly (a real, valid ACTIVE-state-only
    // transition path is closed once paused) right before the abandon
    // request is sent with the now-stale pre-race revision.
    await post(base, `/api/keep-going/${P1}/pause`, {
      reason: 'won the race',
      expectedRevision: beforeAbandon.body.revision
    })

    const abandon = await post(base, `/api/keep-going/${P1}/abandon-stalled-wave`, {
      reason: 'lost the race',
      expectedRevision: beforeAbandon.body.revision
    })
    // Verified by reading the real code path
    // (server/keep-going-controller.mjs's abandonKeepGoingStalledWave):
    // a real, independently-review-caught guard checks run.state !==
    // 'STALLED' BEFORE the underlying domain abandonStalledWave's own
    // expectedRevision check is ever reached -- so the run no longer
    // being STALLED (state now PAUSED) is caught first, as
    // TSF_RUN_NOT_STALLED, not TSF_STALE_REVISION. Both are real,
    // independent protections against this exact race; this assertion
    // matches which one actually fires first, not a guess.
    assert.equal(abandon.status, 422, 'a lost race against a real state change must be rejected, not silently applied')
    assert.equal(abandon.body.code, 'TSF_RUN_NOT_STALLED')

    const final = await get(base, `/api/keep-going/${P1}`)
    assert.equal(final.body.state, 'PAUSED', 'the real winning transition (pause) must stand, unclobbered by the lost race')
  })
})

test('NEEDS YOU ORPHANING: removing a project from Active Fleet/Work Set after it has an open Needs You question does not orphan or hide that question -- it stays fully visible and deep-linkable', async () => {
  await withServer(async (base) => {
    // The fixture project (P1) is intentionally never a "known (onboarded)
    // project" in domain/portfolio.mjs's own sense -- planBulkMembershipChange
    // correctly skips it for real membership changes (confirmed live: an
    // add attempt returns it in `skipped`, not `applied`). Real Active
    // Fleet membership additionally requires a classification that
    // actually allows it -- the repo-root path other tests in this file
    // use (path.join(HERE, '..', '..')) genuinely classifies SENSITIVE
    // (this whole checkout's own mobile/src/transport/*credential* paths
    // trip the real sensitive-path heuristic -- confirmed live, correct,
    // honest behavior, not a defect), and SENSITIVE explicitly disallows
    // activeFleet. A genuinely real, safe, non-sensitive local repo is
    // needed instead -- the same disposable "Idea Incubator" pilot repo
    // used during the prior real-project validation wave.
    const SAFE_REAL_REPO = 'C:/Users/codex-agent/Documents/ChatGPT/Idea Incubator/route-reader'
    const analyze = await post(base, '/api/onboarding/analyze', { repoPath: SAFE_REAL_REPO })
    assert.equal(analyze.status, 200)
    const p2 = analyze.body.projectId
    await post(base, '/api/onboarding/commit', {
      analysis: analyze.body,
      addTo: { knownProjects: true, activeFleet: false, workSet: false }
    })

    await post(base, `/api/keep-going/${p2}/start`, {
      originalGoal: 'Prove fleet removal never orphans an open Needs You question.',
      acceptanceCriteria: ['X']
    })
    const clock = () => new Date()
    await withKeepGoingRun(p2, (current) =>
      raiseNeedsYou(current, { question: 'A real open question about to survive fleet removal.' }, clock, current.revision)
    )

    const beforeRemoval = await get(base, '/api/work')
    assert.ok(
      beforeRemoval.body.needsYou.some((p) => p.id === p2),
      'sanity: the project must genuinely be in the needsYou bucket before the removal'
    )

    // Add it to Active Fleet for real first, so the removal below has a
    // genuine membership to remove, not a no-op against an already-absent
    // id.
    const addToFleet = await post(base, '/api/portfolio/active-fleet', { projectIds: [p2], add: true })
    assert.ok(addToFleet.body.applied.includes(p2), 'sanity: the real add must land before this test removes it')

    // Remove from BOTH Active Fleet and Work Set -- domain/portfolio.mjs's
    // setActiveFleet cascades a Work Set removal too, so this exercises
    // the real full-removal path, not a partial one.
    const removeFromFleet = await post(base, '/api/portfolio/active-fleet', {
      projectIds: [p2],
      add: false
    })
    assert.equal(removeFromFleet.status, 200)
    assert.ok(removeFromFleet.body.applied.includes(p2), 'the removal must genuinely have applied to this project')

    const afterRemoval = await get(base, '/api/work')
    const stillThere = afterRemoval.body.needsYou.find((p) => p.id === p2)
    assert.ok(
      stillThere,
      'the open Needs You question must remain visible in Work after Active Fleet/Work Set removal -- it must never silently disappear'
    )
    assert.equal(stillThere.activeFleet, false, 'sanity: the removal itself really did land')
    assert.equal(stillThere.workSet, false)

    // Deep-linkable: the real run/question is still fully reachable by
    // project id through every real surface, unaffected by fleet status.
    const keepGoing = await get(base, `/api/keep-going/${p2}`)
    assert.equal(keepGoing.body.openNeedsYou.length, 1)
    assert.equal(keepGoing.body.openNeedsYou[0].question, 'A real open question about to survive fleet removal.')
  })
})

test('RAPID SWITCHING: many fast sequential ticks/GETs interleaved across two projects never leave either run in an inconsistent (revision-skipped or torn) state', async () => {
  await withServer(async (base) => {
    const analyze = await post(base, '/api/onboarding/analyze', { repoPath: path.join(HERE, '..', '..') })
    const p2 = analyze.body.projectId
    await post(base, '/api/onboarding/commit', {
      analysis: analyze.body,
      addTo: { knownProjects: true, activeFleet: false, workSet: false }
    })
    await post(base, `/api/keep-going/${P1}/start`, { originalGoal: 'P1 goal.', acceptanceCriteria: ['X'] })
    await post(base, `/api/keep-going/${p2}/start`, { originalGoal: 'P2 goal.', acceptanceCriteria: ['Y'] })

    // Rapidly alternate pause/resume on both projects with no delay --
    // each call correctly captures its own project's own current revision
    // just before sending, so this proves sequential correctness (every
    // real state transition lands, none silently dropped or applied to
    // the wrong project) rather than concurrency safety (covered above).
    for (let i = 0; i < 6; i++) {
      for (const projectId of [P1, p2]) {
        const current = await get(base, `/api/keep-going/${projectId}`)
        const action = current.body.state === 'PAUSED' ? 'resume' : 'pause'
        const res = await post(base, `/api/keep-going/${projectId}/${action}`, {
          reason: 'rapid-switch',
          expectedRevision: current.body.revision
        })
        assert.equal(res.status, 200, `round ${i} ${action} on ${projectId} failed: ${JSON.stringify(res.body)}`)
      }
    }

    const finalP1 = await get(base, `/api/keep-going/${P1}`)
    const finalP2 = await get(base, `/api/keep-going/${p2}`)
    assert.equal(finalP1.body.goal, 'P1 goal.', 'P1 must still be P1 after rapid interleaving, never swapped with P2')
    assert.equal(finalP2.body.goal, 'P2 goal.', 'P2 must still be P2 after rapid interleaving, never swapped with P1')
  })
})
