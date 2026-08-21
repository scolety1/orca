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
  `operator-state.test-http-flight-recorder-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { createOvernightRun, checkpointRun } = await import('../domain/keep-going.mjs')

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

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

test('an honest empty timeline when no Keep Going run exists yet', async () => {
  await withServer(async (base) => {
    const res = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/flight-recorder`)
    assert.equal(res.status, 200)
    assert.equal(res.body.timeline, null)
    assert.equal(res.body.bottleneck, null)
  })
})

test('REQUIRED PROOF: a real, seeded run produces a real timeline and bottleneck over HTTP', async () => {
  await withServer(async (base) => {
    const clockAt = (iso) => () => new Date(iso)
    let run = createOvernightRun(
      {
        id: 'run-1',
        projectId: FIXTURE_PROJECT_ID,
        originalGoal: 'test goal',
        acceptanceCriteria: ['done'],
        usageMode: 'BALANCED'
      },
      clockAt('2026-01-01T00:00:00.000Z')
    )
    run = checkpointRun(
      run,
      { phase: 'PLANNING' },
      clockAt('2026-01-01T02:00:00.000Z'),
      run.revision
    )
    const state = loadState()
    saveState({ ...state, keepGoingRuns: { ...state.keepGoingRuns, [FIXTURE_PROJECT_ID]: run } })

    const res = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/flight-recorder`)
    assert.equal(res.status, 200)
    assert.equal(res.body.timeline.runId, 'run-1')
    assert.ok(res.body.timeline.events.length >= 2)
    assert.equal(res.body.bottleneck.durationMs, 2 * 60 * 60 * 1000)
  })
})
