// Command (M-Command) end-to-end proofs, real HTTP layer, stubbed Orca CLI
// -- same conventions as http-chat-dispatch.test.mjs/http-work-summary.test.mjs.
// Proves: a POST /api/chat with projectId: null (Command's global scope)
// resolves the right project(s) from free text and drives a real dispatch
// through the exact same, unmodified planAndDispatchFromChat every
// project-scoped chat dispatch already uses -- no second execution engine.
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
  `operator-state.test-http-command-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
// Main TSF overnight review of Resource Pressure Governor V0: real dispatch
// now consults real host memory before spawning a heavyweight worker
// (chat-dispatch-bridge.mjs). Forced HEALTHY so a genuinely shared, loaded
// host never makes this file's real dispatch assertions flaky, same
// env-var seam http-resource-pressure-governor.test.mjs already uses.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { createRequestHandler } = await import('../server/http-server.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `tsf-http-command-${name}-`))
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

// PROOF 1: single project, real dispatch via Command's global scope.
test('Command resolves a message naming one project and dispatches a real Keep Going run through the unmodified single-project dispatch path', async () => {
  await withServer(async (base) => {
    const { projectId, root } = await onboardTestProject(base, 'single')
    process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'repo-single', path: root, kind: 'git' }])
    process.env.STUB_ORCA_WORKTREE_PATH = root
    try {
      const { status, body } = await chat(base, {
        projectId: null,
        message: `go ahead and fix the ${projectId} bug`
      })
      assert.equal(status, 200)
      assert.deepEqual(body.resolvedProjectIds, [projectId])
      assert.equal(body.dispatched, true)
      // BUG-06 (bug-ledger.json): text now distinguishes a new mission
      // from adding to an existing one -- real outcome here is new.
      assert.match(body.text, /Started a new mission.*dispatched/s)
      assert.ok(
        body.planCapsule.repository.head.match(/^[0-9a-f]{40}$/),
        'a real HEAD was resolved via the auto-provisioned worktree, not fabricated'
      )

      // Durable: a fresh GET confirms a real Keep Going run exists.
      const runView = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(runView.started, true)
      assert.equal(runView.state, 'ACTIVE')
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
    }
  })
})

// PROOF 2: multi-project -- one project's repo is never registered with
// Orca, so its worktree auto-provisioning fails honestly; the others still
// succeed, and the failure is reported, never silently dropped, never
// blocking the batch.
test('Command dispatches to multiple resolved projects independently -- one unregistered project is skipped and explained, the others still dispatch', async () => {
  await withServer(async (base) => {
    const healthy1 = await onboardTestProject(base, 'multi-healthy-1')
    const healthy2 = await onboardTestProject(base, 'multi-healthy-2')
    const unregistered = await onboardTestProject(base, 'multi-unregistered')
    // Only the two healthy repos are registered with Orca -- the third's
    // root is real but absent from STUB_ORCA_REPOS, so
    // findRegisteredOrcaRepo honestly reports NOT_REGISTERED for it.
    process.env.STUB_ORCA_REPOS = JSON.stringify([
      { id: 'repo-h1', path: healthy1.root, kind: 'git' },
      { id: 'repo-h2', path: healthy2.root, kind: 'git' }
    ])
    // The stub's single STUB_ORCA_WORKTREE_PATH answers every worktree
    // create call the same way regardless of --repo -- fine here since
    // only the two registered repos ever reach that call at all.
    process.env.STUB_ORCA_WORKTREE_PATH = healthy1.root
    try {
      const { status, body } = await chat(base, {
        projectId: null,
        message: `get ${healthy1.projectId}, ${healthy2.projectId}, and ${unregistered.projectId} ready -- go ahead and fix them`
      })
      assert.equal(status, 200)
      assert.equal(body.scope, 'MULTI_PROJECT')
      assert.deepEqual(
        [...body.resolvedProjectIds].sort(),
        [healthy1.projectId, healthy2.projectId, unregistered.projectId].sort()
      )

      const byId = Object.fromEntries(body.dispatchResults.map((r) => [r.projectId, r]))
      assert.equal(byId[healthy1.projectId].ok, true)
      assert.equal(byId[healthy2.projectId].ok, true)
      assert.equal(byId[unregistered.projectId].ok, false)
      assert.equal(byId[unregistered.projectId].reason, 'TSF_REPOSITORY_NOT_REGISTERED')

      // Real, durable runs exist for the two that succeeded; none for the
      // one that was skipped.
      const runHealthy1 = await (await fetch(`${base}/api/keep-going/${healthy1.projectId}`)).json()
      const runHealthy2 = await (await fetch(`${base}/api/keep-going/${healthy2.projectId}`)).json()
      const runUnregistered = await (
        await fetch(`${base}/api/keep-going/${unregistered.projectId}`)
      ).json()
      assert.equal(runHealthy1.started, true)
      assert.equal(runHealthy2.started, true)
      assert.equal(runUnregistered.started, false)
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
    }
  })
})

// PROOF 3: an "overnight fleet"-style message naming every project in a
// small fleet dispatches to all of them, sequentially and independently --
// the same real per-project Keep Going start every other overnight/multi
// path in this codebase already uses, just reached through Command.
test('a fleet-wide Command message dispatches sequentially to every named project', async () => {
  await withServer(async (base) => {
    const a = await onboardTestProject(base, 'fleet-a')
    const b = await onboardTestProject(base, 'fleet-b')
    const c = await onboardTestProject(base, 'fleet-c')
    process.env.STUB_ORCA_REPOS = JSON.stringify([
      { id: 'repo-a', path: a.root, kind: 'git' },
      { id: 'repo-b', path: b.root, kind: 'git' },
      { id: 'repo-c', path: c.root, kind: 'git' }
    ])
    process.env.STUB_ORCA_WORKTREE_PATH = a.root
    try {
      const { status, body } = await chat(base, {
        projectId: null,
        message: `go ahead and run ${a.projectId}, ${b.projectId}, and ${c.projectId} overnight`
      })
      assert.equal(status, 200)
      assert.equal(body.scope, 'MULTI_PROJECT')
      assert.ok(
        body.dispatchResults.every((r) => r.ok),
        'every project in the fleet dispatched'
      )

      for (const { projectId } of [a, b, c]) {
        const runView = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
        assert.equal(runView.started, true)
        assert.equal(runView.state, 'ACTIVE')
      }
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
    }
  })
})

test('Command answers a fleet-wide status question from real state when no project is named', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, { projectId: null, message: "what's going on?" })
    assert.equal(status, 200)
    assert.equal(body.scope, 'FLEET')
    assert.deepEqual(body.resolvedProjectIds, [])
    assert.match(body.text, /running right now/i)
  })
})

// Pins the exact live-found gap: the spec's own example phrasing (Phase 7)
// must answer with the real fleet status, not "couldn't tell which project."
test('Command answers "what\'s running right now?" -- the spec\'s own exact Phase 7 example -- with real fleet status', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, {
      projectId: null,
      message: "what's running right now?"
    })
    assert.equal(status, 200)
    assert.equal(body.intent, 'STATUS')
    assert.equal(body.scope, 'FLEET')
    assert.match(body.text, /running right now/i)
    assert.doesNotMatch(body.text, /couldn't tell which project/i)
  })
})

test('Command refuses a TIM_REQUIRED message across the fleet without acting on anything', async () => {
  await withServer(async (base) => {
    const { status, body } = await chat(base, {
      projectId: null,
      message: 'go ahead and push everything to production'
    })
    assert.equal(status, 200)
    assert.equal(body.decisionClass, 'TIM_REQUIRED')
    assert.match(body.text, /consequential/i)
  })
})
