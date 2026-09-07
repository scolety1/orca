// Real running HTTP server -- proves the route wiring AND, critically, that
// the HTTP surface cannot be used to smuggle in an open owner-authorization
// gate: no request body field can substitute for the real gate.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-http-${process.pid}.json`)
const QUARANTINE_DIR = path.join(HERE, '..', 'server', '.local-state', `cleanup-quarantine-test-http-${process.pid}`)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_CLEANUP_QUARANTINE_DIR = QUARANTINE_DIR
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.TSF_ORCA_CLI_COMMAND = NONEXISTENT

const { createRequestHandler } = await import('../server/http-server.mjs')

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  rmSync(QUARANTINE_DIR, { recursive: true, force: true })
})

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
    for (const suffix of ['', '.tmp', '.planner-mission.lock', '.cleanup-request.lock']) {
      rmSync(`${STATE_FILE}${suffix}`, { force: true })
    }
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

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

function makeRealFixtureFile(content) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-http-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, 'artifact.txt')
  writeFileSync(filePath, content)
  return filePath
}

test('GET /api/cleanup/action-classes returns the full taxonomy', async () => {
  await withServer(async (base) => {
    const result = await get(base, '/api/cleanup/action-classes')
    assert.equal(result.status, 200)
    assert.ok(result.body.actionClasses.RETIRE_SESSION)
    assert.equal(result.body.actionClasses.ARBITRARY_FILESYSTEM_DELETION.tier, 'ELEVATED')
  })
})

test('GET /api/cleanup/gate-state reports the REAL gate as closed in this test environment', async () => {
  await withServer(async (base) => {
    const result = await get(base, '/api/cleanup/gate-state')
    assert.equal(result.status, 200)
    assert.equal(result.body.gateState.open, false)
  })
})

test('POST /api/cleanup/preview computes the deterministic requestId without running the pipeline at all', async () => {
  await withServer(async (base) => {
    const targetIdentity = { realPath: 'C:/fixtures/preview-target' }
    const first = await post(base, '/api/cleanup/preview', { actionClass: 'QUARANTINE_ARTIFACT', targetIdentity })
    const second = await post(base, '/api/cleanup/preview', { actionClass: 'QUARANTINE_ARTIFACT', targetIdentity })
    assert.equal(first.status, 200)
    assert.equal(first.body.requestId, second.body.requestId)
    const requestRecord = await get(base, `/api/cleanup/request?requestId=${first.body.requestId}`)
    assert.equal(requestRecord.body.record, null, 'a preview must never create a durable request record')
  })
})

test('POST /api/cleanup/run over HTTP is refused by the REAL owner-authorization gate -- no request body field can open it', async () => {
  await withServer(async (base) => {
    const artifact = makeRealFixtureFile('http route safety proof')
    const result = await post(base, '/api/cleanup/run', {
      actionClass: 'QUARANTINE_ARTIFACT',
      targetIdentity: { realPath: artifact },
      rationale: 'attempted HTTP-driven execution with no real gate',
      // Every one of these is an attempt to smuggle authority through the
      // request body -- none of them may work.
      gateCheck: 'OPEN',
      gateState: { open: true },
      ownerGateOpen: true,
      TSF_CLEANUP_V1_OWNER_AUTHORIZATION: 'OWNER_AUTHORIZED_DESTRUCTIVE_EXECUTION_V1'
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.outcome.status, 'AUTHORIZATION_REFUSED')
    assert.equal(existsSync(artifact), true, 'nothing real may ever be mutated via this route while the real gate is unset')
  })
})

test('POST /api/cleanup/run with a missing required field is a clean 422, not a crash', async () => {
  await withServer(async (base) => {
    const result = await post(base, '/api/cleanup/run', { actionClass: 'QUARANTINE_ARTIFACT' })
    assert.equal(result.status, 422)
  })
})

test('GET /api/cleanup/request and /api/cleanup/requests reflect a real (refused) run', async () => {
  await withServer(async (base) => {
    const artifact = makeRealFixtureFile('list/read proof')
    const runResult = await post(base, '/api/cleanup/run', {
      actionClass: 'QUARANTINE_ARTIFACT',
      targetIdentity: { realPath: artifact },
      rationale: 'list/read proof'
    })
    const requestId = runResult.body.outcome.requestId
    const single = await get(base, `/api/cleanup/request?requestId=${requestId}`)
    assert.equal(single.body.record.recommendation.requestId, requestId)

    const all = await get(base, '/api/cleanup/requests')
    assert.ok(all.body.records[requestId])
  })
})

test('POST /api/cleanup/recover on a request with no execution yet reports NO_EXECUTION, not an error', async () => {
  await withServer(async (base) => {
    const recovery = await post(base, '/api/cleanup/recover', { requestId: 'never-existed-request-id' })
    assert.equal(recovery.status, 200)
    assert.equal(recovery.body.recovery.status, 'NO_EXECUTION')
  })
})
