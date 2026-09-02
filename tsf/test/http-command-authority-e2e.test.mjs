// Command Authority + Project Resolution repair -- real end-to-end proofs,
// same conventions as http-command.test.mjs (real HTTP layer, real onboarded
// disposable temp-repo fixture projects, stubbed Orca CLI/planner -- never a
// real registered project, so this can never touch NWR/WorldForge/tsf-orca).
// Proves the two resolution-path behaviors this repair actually changed
// (alias resolution, negation-scoped exclusion) drive a REAL dispatch
// through the unmodified planAndDispatchFromChat path, creating a real,
// durable Keep Going run visible via GET /api/keep-going/:projectId -- the
// same read Work's own UI uses. The infra-mention guard and the
// authorization-loop confirmation-intent fix are already proven against the
// real respondCommand() function in command-authority-regression-matrix.test.mjs;
// this file only adds what that unit-level coverage cannot: proof the alias
// and negation paths survive all the way through the real HTTP route and
// produce a real durable run, not just a resolver-level match.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-http-command-authority-e2e-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'

const { createRequestHandler } = await import('../server/http-server.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `tsf-http-command-authority-${name}-`))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.TSF_PROJECT_ALIASES_JSON
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

async function onboardTestProject(base, name) {
  const dir = createTempRepo(name)
  tempDirs.push(dir)
  const analyzeRes = await post(base, '/api/onboarding/analyze', { repoPath: dir })
  assert.equal(analyzeRes.status, 200)
  assert.equal(analyzeRes.body.migrationClassification.classification, 'SAFE_TO_ONBOARD_NOW')
  const commitRes = await post(base, '/api/onboarding/commit', {
    analysis: analyzeRes.body,
    addTo: { knownProjects: true, activeFleet: false, workSet: false }
  })
  assert.equal(commitRes.status, 200)
  return { projectId: analyzeRes.body.projectId, root: dir }
}

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

// PROOF: an alias for a real disposable fixture project (injected via the
// same TSF_PROJECT_ALIASES_JSON env override an operator would use to add a
// durable alias) drives a real dispatch end to end, exactly like an
// exact id/displayName match already does in http-command.test.mjs.
test('a durable alias resolves through the real HTTP route and dispatches a real, durable Keep Going run', async () => {
  await withServer(async (base) => {
    const { projectId, root } = await onboardTestProject(base, 'alias-target')
    process.env.TSF_PROJECT_ALIASES_JSON = JSON.stringify({ 'project-nickname': projectId })
    process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'repo-alias', path: root, kind: 'git' }])
    process.env.STUB_ORCA_WORKTREE_PATH = root
    try {
      const { status, body } = await chat(base, {
        projectId: null,
        message: 'go ahead and get project-nickname ready'
      })
      assert.equal(status, 200)
      assert.deepEqual(body.resolvedProjectIds, [projectId])
      assert.equal(body.dispatched, true)

      // Durable: a fresh GET confirms a real Keep Going run exists -- the
      // same read Work's own UI uses, proving this created a real operation,
      // not just an in-memory reply.
      const runView = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(runView.started, true)
      assert.equal(runView.state, 'ACTIVE')
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
      delete process.env.TSF_PROJECT_ALIASES_JSON
    }
  })
})

// PROOF: negation excludes one onboarded fixture project by name while the
// other, named alongside it in the same message, still gets a real,
// durable dispatch -- proves exclusion is scoped to exactly the named
// project, not the whole message. The two onboarded projects deliberately
// share most of their auto-derived id/displayName tokens (both come from
// this file's own createTempRepo prefix) -- a real, honest side effect: the
// excluded project still surfaces as an unrelated FUZZY co-match (never
// exact, never dispatched to -- command-responder.mjs's own adversarial-
// review-fixed rule), which is why this goes through the multi-project
// response shape (dispatchResults/live) rather than the single-project
// fast path's `dispatched` field.
test('negation excludes the named project end to end while the other named project still gets a real, durable run', async () => {
  await withServer(async (base) => {
    const keep = await onboardTestProject(base, 'negation-keep')
    const excluded = await onboardTestProject(base, 'negation-exclude')
    process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'repo-keep', path: keep.root, kind: 'git' }])
    process.env.STUB_ORCA_WORKTREE_PATH = keep.root
    try {
      const { status, body } = await chat(base, {
        projectId: null,
        message: `go ahead and fix ${keep.projectId}, not ${excluded.projectId}`
      })
      assert.equal(status, 200)
      // Only the non-excluded project was ever actually dispatched to --
      // the excluded one, even though it appears as unrelated fuzzy noise
      // in the wider resolution, never reaches resolvedProjectIds/dispatchResults
      // (command-responder.mjs only ever reports projects a real dispatch
      // was attempted against).
      assert.deepEqual(body.resolvedProjectIds, [keep.projectId])
      assert.equal(body.live, true)
      assert.deepEqual(body.dispatchResults.map((r) => r.projectId), [keep.projectId])
      assert.equal(body.dispatchResults[0].ok, true)

      const runKeep = await (await fetch(`${base}/api/keep-going/${keep.projectId}`)).json()
      const runExcluded = await (await fetch(`${base}/api/keep-going/${excluded.projectId}`)).json()
      assert.equal(runKeep.started, true, 'the named, non-excluded project got a real run')
      assert.equal(runExcluded.started, false, 'the negated project got no run at all')
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
    }
  })
})
