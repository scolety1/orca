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
  `operator-state.test-http-fleet-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_ORCA_CLI_COMMAND = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')

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

async function post(base, urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

function seedEstimate(projectId, wbs) {
  const state = loadState()
  saveState({
    ...state,
    projectEstimates: {
      ...state.projectEstimates,
      [projectId]: { schemaVersion: 'TSF_PROJECT_ESTIMATE_RESULT_V1', projectId, wbs }
    }
  })
}

function task(id, expected) {
  return {
    id,
    title: id,
    activeEffortHours: { min: expected, expected, max: expected },
    dependencies: [],
    conflictsWith: []
  }
}

test('POST /api/fleet/schedule rejects a missing/empty projectIds', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/fleet/schedule', { projectIds: [] })
    assert.equal(res.status, 400)
  })
})

test('a project with no estimate on file is an honest 422, never a fabricated WBS', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/fleet/schedule', { projectIds: ['no-such-estimate'] })
    assert.equal(res.status, 422)
    assert.equal(res.body.error, 'NO_ESTIMATE_ON_FILE_FOR_PROJECT')
  })
})

test('REQUIRED PROOF: a real multi-project fleet schedule is produced end to end over HTTP from real, persisted per-project estimates', async () => {
  await withServer(async (base) => {
    seedEstimate('proj-a', [task('a1', 4)])
    seedEstimate('proj-b', [task('b1', 4)])
    const res = await post(base, '/api/fleet/schedule', {
      projectIds: ['proj-a', 'proj-b'],
      priorities: { 'proj-a': 1, 'proj-b': 2 },
      maxConcurrentWorkers: 1
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.schedule.projects.length, 2)
    const a = res.body.schedule.projects.find((p) => p.projectId === 'proj-a')
    const b = res.body.schedule.projects.find((p) => p.projectId === 'proj-b')
    assert.equal(a.schedule[0].startHour, 0)
    assert.equal(b.schedule[0].startHour, 4)
  })
})
