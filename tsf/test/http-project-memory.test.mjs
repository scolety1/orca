import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-project-memory-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
// Without these, analyzeRepository's invokeLiveStructuredAnalysis call
// (onboarding's "direction" step) hits a real provider CLI/timeout budget
// (observed: ~45s for one test), and commitOnboarding's orca-registration
// step spawns the real orca CLI against each temp repo (the real cause of
// an EPERM cleanup flake -- a real external process holding a handle open
// on the directory, not a generic Windows timing issue). Matches
// http-onboarding.test.mjs's own established stub setup exactly.
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')
const { FIXTURE_PROJECT_ID } = await import('../server/fixture-project.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-project-memory-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# HTTP Project Memory Test Project\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    // maxRetries/retryDelay: Windows can transiently hold a just-closed git
    // process's file handle on a temp repo dir a moment after execFileSync
    // returns, making a bare rmSync fail with EPERM/EBUSY -- not a real
    // correctness issue, just a known Windows cleanup flake class.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  }
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

// Onboards a genuine second real project (a real temp git repo, through
// the actual analyze -> commit flow, matching http-onboarding.test.mjs's
// own pattern) -- needed because project-memory-http-routes.mjs now
// validates the project id against the real known-projects map, so a
// made-up id like the pre-review version of this test used would 404.
async function onboardSecondProject(base) {
  const dir = createTempRepo()
  tempDirs.push(dir)
  const analyzeRes = await post(base, '/api/onboarding/analyze', { repoPath: dir })
  assert.equal(analyzeRes.status, 200)
  const commitRes = await post(base, '/api/onboarding/commit', {
    analysis: analyzeRes.body,
    addTo: { knownProjects: true, activeFleet: false, workSet: false }
  })
  assert.equal(commitRes.status, 200)
  return analyzeRes.body.projectId
}

test('POST /api/projects/:id/memory adds a real, retrievable record', async () => {
  await withServer(async (base) => {
    const added = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'FACT',
      statement: 'uses pnpm workspaces',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    assert.equal(added.status, 200)
    assert.equal(added.body.ok, true)
    assert.equal(added.body.record.statement, 'uses pnpm workspaces')

    const listed = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`)
    assert.equal(listed.status, 200)
    assert.equal(listed.body.records.length, 1)
    assert.equal(listed.body.records[0].statement, 'uses pnpm workspaces')
  })
})

test('an unknown project id 404s honestly rather than silently creating a memory bucket', async () => {
  await withServer(async (base) => {
    const res = await get(base, '/api/projects/does-not-exist-at-all/memory')
    assert.equal(res.status, 404)
    const added = await post(base, '/api/projects/does-not-exist-at-all/memory', {
      class: 'FACT',
      statement: 'x',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    assert.equal(added.status, 404)
  })
})

test('memory is project-isolated -- a record added to one real project never appears under another', async () => {
  await withServer(async (base) => {
    const secondProjectId = await onboardSecondProject(base)
    await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'FACT',
      statement: 'fixture project fact',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    await post(base, `/api/projects/${secondProjectId}/memory`, {
      class: 'FACT',
      statement: 'second project fact',
      source: { kind: 'CHAT', ref: 'msg-2' }
    })
    const a = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`)
    const b = await get(base, `/api/projects/${secondProjectId}/memory`)
    assert.deepEqual(
      a.body.records.map((r) => r.statement),
      ['fixture project fact']
    )
    assert.deepEqual(
      b.body.records.map((r) => r.statement),
      ['second project fact']
    )
  })
})

test('memory survives across separate requests (cross-session recall) via the real persisted state file', async () => {
  await withServer(async (base) => {
    await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'EXPERIENCE',
      statement: 'the upload endpoint needs retry backoff',
      source: { kind: 'RESULT_CAPSULE', ref: 'mission-1' }
    })
    // A second, independent GET (a new request, no shared in-memory state)
    // still sees it -- proves real persistence, not a request-scoped cache.
    const recalled = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`)
    assert.deepEqual(
      recalled.body.records.map((r) => r.statement),
      ['the upload endpoint needs retry backoff']
    )
  })
})

test('a stale (non-explicit) fact can be superseded via the API with no authorization', async () => {
  await withServer(async (base) => {
    const added = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'FACT',
      statement: 'uses npm',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    const superseded = await post(
      base,
      `/api/projects/${FIXTURE_PROJECT_ID}/memory/${added.body.record.id}/supersede`,
      { statement: 'uses pnpm now', source: { kind: 'CHAT', ref: 'msg-2' } }
    )
    assert.equal(superseded.status, 200)
    const listed = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`)
    assert.deepEqual(
      listed.body.records.map((r) => r.statement),
      ['uses pnpm now']
    )
  })
})

test('an explicit preference cannot be superseded over HTTP without authorizedBy: TIM (rejected-design/preference protection)', async () => {
  await withServer(async (base) => {
    const added = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'PREFERENCE',
      statement: 'Tim wants squash-merged PRs',
      source: { kind: 'TIM_EXPLICIT', ref: 'chat:1' },
      explicit: true
    })
    const rejected = await post(
      base,
      `/api/projects/${FIXTURE_PROJECT_ID}/memory/${added.body.record.id}/supersede`,
      { statement: 'actually rebase-merge', source: { kind: 'CHAT', ref: 'msg-9' } }
    )
    assert.equal(rejected.status, 403)
    assert.equal(rejected.body.code, 'TSF_MEMORY_EXPLICIT_IMMUTABLE')

    // Confirms it is genuinely unchanged, not just an error with a stale write.
    const listed = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`)
    assert.deepEqual(
      listed.body.records.map((r) => r.statement),
      ['Tim wants squash-merged PRs']
    )

    const authorized = await post(
      base,
      `/api/projects/${FIXTURE_PROJECT_ID}/memory/${added.body.record.id}/supersede`,
      {
        statement: 'actually rebase-merge from now on',
        source: { kind: 'TIM_EXPLICIT', ref: 'chat:2' },
        authorizedBy: 'TIM',
        reason: 'Tim changed his mind'
      }
    )
    assert.equal(authorized.status, 200)
    const listedAfter = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`)
    assert.deepEqual(
      listedAfter.body.records.map((r) => r.statement),
      ['actually rebase-merge from now on']
    )
  })
})

test('GET supports filtering by class', async () => {
  await withServer(async (base) => {
    await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'FACT',
      statement: 'a fact',
      source: { kind: 'CHAT', ref: 'msg-1' }
    })
    await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'EXPERIENCE',
      statement: 'a lesson',
      source: { kind: 'CHAT', ref: 'msg-2' }
    })
    const facts = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory?class=FACT`)
    assert.deepEqual(
      facts.body.records.map((r) => r.statement),
      ['a fact']
    )
  })
})

test('an invalid class filter is rejected with a clear error, not silently ignored', async () => {
  await withServer(async (base) => {
    const res = await get(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory?class=NONSENSE`)
    assert.equal(res.status, 400)
    assert.match(res.body.error, /class must be one of/)
  })
})

test('adding a record with an invalid source is rejected honestly (422), not silently dropped', async () => {
  await withServer(async (base) => {
    const res = await post(base, `/api/projects/${FIXTURE_PROJECT_ID}/memory`, {
      class: 'FACT',
      statement: 'x',
      source: { kind: 'NOT_A_REAL_SOURCE' }
    })
    assert.equal(res.status, 422)
    assert.match(res.body.error, /source\.kind/)
  })
})
