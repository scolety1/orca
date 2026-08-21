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
