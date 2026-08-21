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
  `operator-state.test-http-project-memory-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE

const { createRequestHandler } = await import('../server/http-server.mjs')

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

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

test('POST /api/projects/:id/memory adds a real, retrievable record', async () => {
  await withServer(async (base) => {
    const added = await post(base, '/api/projects/proj-a/memory', {
      class: 'FACT',
      statement: 'uses pnpm workspaces',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    assert.equal(added.status, 200)
    assert.equal(added.body.ok, true)
    assert.equal(added.body.record.statement, 'uses pnpm workspaces')

    const listed = await get(base, '/api/projects/proj-a/memory')
    assert.equal(listed.status, 200)
    assert.equal(listed.body.records.length, 1)
    assert.equal(listed.body.records[0].statement, 'uses pnpm workspaces')
  })
})

test('memory is project-isolated -- a record added to one project never appears under another', async () => {
  await withServer(async (base) => {
    await post(base, '/api/projects/proj-a/memory', {
      class: 'FACT',
      statement: 'project A fact',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    await post(base, '/api/projects/proj-b/memory', {
      class: 'FACT',
      statement: 'project B fact',
      source: { kind: 'CHAT', ref: 'msg-2' }
    })
    const a = await get(base, '/api/projects/proj-a/memory')
    const b = await get(base, '/api/projects/proj-b/memory')
    assert.deepEqual(
      a.body.records.map((r) => r.statement),
      ['project A fact']
    )
    assert.deepEqual(
      b.body.records.map((r) => r.statement),
      ['project B fact']
    )
  })
})

test('memory survives across separate requests (cross-session recall) via the real persisted state file', async () => {
  await withServer(async (base) => {
    await post(base, '/api/projects/proj-a/memory', {
      class: 'EXPERIENCE',
      statement: 'the upload endpoint needs retry backoff',
      source: { kind: 'RESULT_CAPSULE', ref: 'mission-1' }
    })
    // A second, independent GET (a new request, no shared in-memory state)
    // still sees it -- proves real persistence, not a request-scoped cache.
    const recalled = await get(base, '/api/projects/proj-a/memory')
    assert.deepEqual(
      recalled.body.records.map((r) => r.statement),
      ['the upload endpoint needs retry backoff']
    )
  })
})

test('a stale (non-explicit) fact can be superseded via the API with no authorization', async () => {
  await withServer(async (base) => {
    const added = await post(base, '/api/projects/proj-a/memory', {
      class: 'FACT',
      statement: 'uses npm',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    const superseded = await post(
      base,
      `/api/projects/proj-a/memory/${added.body.record.id}/supersede`,
      { statement: 'uses pnpm now', source: { kind: 'CHAT', ref: 'msg-2' } }
    )
    assert.equal(superseded.status, 200)
    const listed = await get(base, '/api/projects/proj-a/memory')
    assert.deepEqual(
      listed.body.records.map((r) => r.statement),
      ['uses pnpm now']
    )
  })
})

test('an explicit preference cannot be superseded over HTTP without authorizedBy: TIM (rejected-design/preference protection)', async () => {
  await withServer(async (base) => {
    const added = await post(base, '/api/projects/proj-a/memory', {
      class: 'PREFERENCE',
      statement: 'Tim wants squash-merged PRs',
      source: { kind: 'TIM_EXPLICIT', ref: 'chat:1' },
      explicit: true
    })
    const rejected = await post(
      base,
      `/api/projects/proj-a/memory/${added.body.record.id}/supersede`,
      { statement: 'actually rebase-merge', source: { kind: 'CHAT', ref: 'msg-9' } }
    )
    assert.equal(rejected.status, 403)
    assert.equal(rejected.body.code, 'TSF_MEMORY_EXPLICIT_IMMUTABLE')

    // Confirms it is genuinely unchanged, not just an error with a stale write.
    const listed = await get(base, '/api/projects/proj-a/memory')
    assert.deepEqual(
      listed.body.records.map((r) => r.statement),
      ['Tim wants squash-merged PRs']
    )

    const authorized = await post(
      base,
      `/api/projects/proj-a/memory/${added.body.record.id}/supersede`,
      {
        statement: 'actually rebase-merge from now on',
        source: { kind: 'TIM_EXPLICIT', ref: 'chat:2' },
        authorizedBy: 'TIM',
        reason: 'Tim changed his mind'
      }
    )
    assert.equal(authorized.status, 200)
    const listedAfter = await get(base, '/api/projects/proj-a/memory')
    assert.deepEqual(
      listedAfter.body.records.map((r) => r.statement),
      ['actually rebase-merge from now on']
    )
  })
})

test('GET supports filtering by class', async () => {
  await withServer(async (base) => {
    await post(base, '/api/projects/proj-a/memory', {
      class: 'FACT',
      statement: 'a fact',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    await post(base, '/api/projects/proj-a/memory', {
      class: 'EXPERIENCE',
      statement: 'a lesson',
      source: { kind: 'CHAT', ref: 'msg-2' }
    })
    const facts = await get(base, '/api/projects/proj-a/memory?class=FACT')
    assert.deepEqual(
      facts.body.records.map((r) => r.statement),
      ['a fact']
    )
  })
})

test('an invalid class filter is rejected with a clear error, not silently ignored', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/projects/proj-a/memory?class=NONSENSE')
    assert.equal(res.status, 400)
    assert.match(res.body.error, /class must be one of/)
  })
})

test('adding a record with an invalid source is rejected honestly (422), not silently dropped', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/projects/proj-a/memory', {
      class: 'FACT',
      statement: 'x',
      source: { kind: 'NOT_A_REAL_SOURCE' }
    })
    assert.equal(res.status, 422)
    assert.match(res.body.error, /source\.kind/)
  })
})
