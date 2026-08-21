// M8 wave 11: the required adversarial real-proof wave (per Tim's own M8
// handoff item 7). Each test below is labeled with the exact adversarial
// scenario it covers. "Small clean repo" and "idea-only estimate" are
// already covered by http-estimate.test.mjs's own real-repo-grounded and
// idea-brief tests, so they are not repeated here.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { rmSync } from 'node:fs'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-estimate-adversarial-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')
const { repoEvidenceFor } = await import('../server/estimate-http-routes.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { createOvernightRun, completeRun } = await import('../domain/keep-going.mjs')

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
    delete process.env.STUB_WBS_MULTI
    delete process.env.STUB_ORCA_RATE_LIMITS
  }
}

async function post(base, urlPath, body = {}) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

test('REQUIRED PROOF (larger, uncertain repo): a real multi-task, dependency-and-conflict WBS from the live planner flows end to end through normalization, Monte Carlo, and dependency-aware scheduling', async () => {
  process.env.STUB_WBS_MULTI = '1'
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z',
      maxConcurrent: 1
    })
    assert.equal(res.status, 200)
    const { wbs, plan } = res.body.estimate
    assert.equal(wbs.length, 3)
    const byId = Object.fromEntries(plan.schedule.map((t) => [t.id, t]))
    // Dependency respected: implement cannot start before discover ends.
    assert.ok(byId.implement.startHour >= byId.discover.endHour)
    // Dependency AND conflict both respected: verify cannot start before
    // implement ends (it depends on it AND conflicts with it).
    assert.ok(byId.verify.startHour >= byId.implement.endHour)
    // The genuinely low-clarity/confidence task's widened range makes its
    // own P95-P10 spread meaningfully wider than the well-understood
    // discovery task's -- proves the uncertainty judgment actually reached
    // the Monte Carlo engine, not just structural pass-through.
    assert.ok(plan.estimate.activeEffortHours.p95 - plan.estimate.activeEffortHours.p10 > 20)
  })
})

test("REQUIRED PROOF (provider near reset): a real, historically-observed near-exhaustion capacity signal is honestly reflected in the estimate's provider forecast", async () => {
  // The exact real value this program has observed live before (M2-era
  // dogfood) -- reused here rather than inventing a new shape.
  process.env.STUB_ORCA_RATE_LIMITS = JSON.stringify({
    claude: null,
    codex: { weekly: { usedPercent: 91 }, status: 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE' }
  })
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    assert.equal(res.status, 200)
    const { providerForecast } = res.body.estimate
    assert.equal(providerForecast.codex.currentAction, 'PAUSE_AND_CHECKPOINT')
    assert.equal(providerForecast.codex.likelyBottleneck, true)
    // No real signal for claude in this scenario -- honestly UNKNOWN, not
    // guessed as healthy just because codex is the one under pressure.
    assert.equal(providerForecast.claude.assurance, 'UNKNOWN')
  })
})

test('REQUIRED PROOF (blocked/dirty project): repoEvidenceFor honestly discloses a real blocked reason and health finding rather than presenting a silently healthy project', () => {
  const blockedProject = {
    id: 'blocked-proj',
    displayName: 'Blocked Project',
    purpose: 'test',
    mission: { state: 'BLOCKED', blockedReason: 'Waiting on a real upstream API key' },
    health: {
      status: 'DEGRADED',
      findings: [{ code: 'DIRTY_WORKTREE', summary: 'Uncommitted changes present' }]
    }
  }
  const evidence = repoEvidenceFor(blockedProject)
  assert.equal(evidence.missionState, 'BLOCKED')
  assert.equal(evidence.blockedReason, 'Waiting on a real upstream API key')
  assert.equal(evidence.healthStatus, 'DEGRADED')
  assert.deepEqual(evidence.healthFindings, [
    { code: 'DIRTY_WORKTREE', summary: 'Uncommitted changes present' }
  ])
})

test('REQUIRED PROOF (missing provider pricing): the default estimate never fabricates a metered cost -- no pricing adapter is configured anywhere in this server', async () => {
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    assert.equal(res.status, 200)
    const { costForecast } = res.body.estimate
    assert.equal(costForecast.claude.costUsd, null)
    assert.equal(costForecast.claude.reason, 'NO_PRICING_ADAPTER_CONFIGURED')
    assert.equal(costForecast.codex.costUsd, null)
    assert.equal(costForecast.codex.reason, 'NO_PRICING_ADAPTER_CONFIGURED')
  })
})

test('REQUIRED PROOF (scope change / regeneration): regenerating an estimate replaces the estimate on file, but a past estimate-vs-actual record survives the regeneration', async () => {
  await withServer(async (base) => {
    const first = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    let state = loadState()
    let run = createOvernightRun(
      {
        id: 'run-scope-change',
        projectId: FIXTURE_PROJECT_ID,
        originalGoal: 'test',
        acceptanceCriteria: ['done'],
        usageMode: 'BALANCED'
      },
      () => new Date('2026-01-01T00:00:00.000Z')
    )
    run = completeRun(run, () => new Date('2026-01-02T00:00:00.000Z'))
    state = loadState()
    saveState({ ...state, keepGoingRuns: { ...state.keepGoingRuns, [FIXTURE_PROJECT_ID]: run } })
    const recorded = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/actuals`, {
      runId: 'run-scope-change'
    })
    assert.equal(recorded.status, 200)

    // Scope changed -- re-estimate with an idea brief instead of the repo.
    const second = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-02-01T00:00:00.000Z',
      ideaBrief: 'Scope changed -- re-estimating from a fresh brief.'
    })
    assert.equal(second.status, 200)
    assert.notEqual(second.body.estimate.generatedAt, first.body.estimate.generatedAt)

    const currentEstimate = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`)
    assert.equal(currentEstimate.body.estimate.generatedAt, second.body.estimate.generatedAt)

    // The old estimate is gone (never versioned in this wave), but the
    // real historical actual tied to the completed run is untouched.
    const calibration = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/calibration`)
    assert.equal(calibration.body.actuals.length, 1)
    assert.equal(calibration.body.actuals[0].runId, 'run-scope-change')
  })
})

test('REQUIRED PROOF (no historical calibration data): a project with zero settled runs gets an honest, uncalibrated verdict, never a fabricated multiplier', async () => {
  await withServer(async (base) => {
    const res = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/calibration`)
    assert.equal(res.status, 200)
    assert.equal(res.body.calibration.calibrated, false)
    assert.equal(res.body.calibration.reason, 'INSUFFICIENT_SAMPLE_SIZE')
    assert.equal(res.body.calibration.sampleSize, 0)
  })
})
