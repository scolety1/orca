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
  `operator-state.test-http-estimate-calibration-${process.pid}.json`
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
const { loadState, saveState } = await import('../server/data-store.mjs')
const { createOvernightRun, completeRun } = await import('../domain/keep-going.mjs')

function seedSettledRun({ id = 'run-1', createdAt, completedAt }) {
  const clockAt = (iso) => () => new Date(iso)
  let run = createOvernightRun(
    {
      id,
      projectId: FIXTURE_PROJECT_ID,
      originalGoal: 'test goal',
      acceptanceCriteria: ['done'],
      usageMode: 'BALANCED'
    },
    clockAt(createdAt)
  )
  run = completeRun(run, clockAt(completedAt))
  const state = loadState()
  saveState({ ...state, keepGoingRuns: { ...state.keepGoingRuns, [FIXTURE_PROJECT_ID]: run } })
  return run
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
    rmSync(STATE_FILE, { force: true })
    rmSync(`${STATE_FILE}.tmp`, { force: true })
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

test('POST .../estimate/actuals without an estimate on file is an honest 422', async () => {
  await withServer(async (base) => {
    seedSettledRun({
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-02T00:00:00.000Z'
    })
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/actuals`)
    assert.equal(res.status, 422)
    assert.equal(res.body.error, 'NO_ESTIMATE_ON_FILE_FOR_PROJECT')
  })
})

test('POST .../estimate/actuals with no Keep Going run at all is an honest 422', async () => {
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/actuals`)
    assert.equal(res.status, 422)
    assert.equal(res.body.error, 'NO_KEEP_GOING_RUN_FOR_PROJECT')
  })
})

test('REQUIRED PROOF: a real settled run is paired against a real estimate end to end, persisted, and later reflected in the calibration summary', async () => {
  await withServer(async (base) => {
    await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    seedSettledRun({
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-04T00:00:00.000Z'
    })

    const recorded = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/actuals`, {
      runId: 'run-1'
    })
    assert.equal(recorded.status, 200)
    assert.equal(recorded.body.alreadyRecorded, false)
    assert.equal(recorded.body.actual.schemaVersion, 'TSF_ESTIMATE_ACTUAL_V1')
    assert.equal(recorded.body.actual.actual.wallClockHoursActual, 72)

    // Re-posting the same settled run is idempotent, not a duplicate.
    const again = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/actuals`, {
      runId: 'run-1'
    })
    assert.equal(again.status, 200)
    assert.equal(again.body.alreadyRecorded, true)

    const calibration = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/calibration`)
    assert.equal(calibration.status, 200)
    assert.equal(calibration.body.actuals.length, 1)
    assert.equal(calibration.body.calibration.calibrated, false)
    assert.equal(calibration.body.calibration.reason, 'INSUFFICIENT_SAMPLE_SIZE')
    assert.equal(calibration.body.calibration.sampleSize, 1)
  })
})

test('POST .../estimate/actuals rejects a runId that does not match the current run', async () => {
  await withServer(async (base) => {
    await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    seedSettledRun({
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-02T00:00:00.000Z'
    })
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/actuals`, {
      runId: 'some-other-run'
    })
    assert.equal(res.status, 422)
    assert.equal(res.body.error, 'RUN_ID_DOES_NOT_MATCH_CURRENT_RUN')
  })
})

test('GET .../estimate/calibration on a project with no history at all returns an honest empty, uncalibrated verdict', async () => {
  await withServer(async (base) => {
    const res = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/calibration`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.actuals, [])
    assert.equal(res.body.calibration.calibrated, false)
    assert.equal(res.body.calibration.sampleSize, 0)
  })
})

test('REQUIRED PROOF (final-review finding): once 5+ real samples exist, a NEWLY GENERATED estimate is actually calibrated -- not just computed and left unused', async () => {
  await withServer(async (base) => {
    const first = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    assert.equal(first.body.estimate.calibration.calibrated, false)
    const baselineP50 = first.body.estimate.plan.estimate.wallClockHours.p50

    // 5 real settled runs, each taking exactly 100 real hours -- a
    // consistent, known actual/predicted ratio.
    for (let i = 0; i < 5; i++) {
      seedSettledRun({
        id: `calib-run-${i}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-05T04:00:00.000Z' // exactly 100 hours later
      })
      const recorded = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/actuals`, {
        runId: `calib-run-${i}`
      })
      assert.equal(recorded.status, 200)
    }

    const calibration = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate/calibration`)
    assert.equal(calibration.body.calibration.calibrated, true)
    assert.equal(calibration.body.calibration.sampleSize, 5)

    // Regenerate (same project/seed -- same raw Monte Carlo output) --
    // the fresh estimate must now be visibly calibrated, not identical to
    // the first, uncalibrated one.
    const second = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/estimate`, {
      startDate: '2026-01-05T00:00:00.000Z'
    })
    assert.equal(second.body.estimate.calibration.calibrated, true)
    const calibratedP50 = second.body.estimate.plan.estimate.wallClockHours.p50
    assert.notEqual(calibratedP50, baselineP50)
    // All 5 actuals took exactly 100 hours against the same predicted P50
    // -- the median ratio is exact, so the calibrated P50 lands on 100
    // (baselineP50 * (100 / baselineP50)), modulo floating-point error.
    assert.ok(Math.abs(calibratedP50 - 100) < 1e-9)
    // activeEffortHours is untouched by a wall-clock-only calibration.
    assert.equal(
      second.body.estimate.plan.estimate.activeEffortHours.p50,
      first.body.estimate.plan.estimate.activeEffortHours.p50
    )
  })
})
