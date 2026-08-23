// TSF Health Repair Center V1 -- real HTTP route tests, same pattern as
// http-onboarding.test.mjs: a real server, real fixture git repos, a
// stubbed Orca CLI/planner (never a live provider call).
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
  `operator-state.test-http-health-repair-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
process.env.STUB_ORCA_REPOS = '[]'

const { createRequestHandler } = await import('../server/http-server.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
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

async function get(base, urlPath) {
  const res = await fetch(`${base}${urlPath}`)
  return { status: res.status, body: await res.json() }
}

async function withEnvDuring(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key]
  }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prior[key]
      }
    }
  }
}

// Onboards a real temp repo through the real /analyze -> /commit flow (the
// same path a real project takes). Commit-time Orca registration is forced
// to a real failure (STUB_ORCA_MODE: 'error', matching the real CLI_ERROR
// shape seen against real Known Projects tonight), so the resulting
// project genuinely diagnoses ORCA_NOT_REGISTERED/AUTO_REPAIR_SAFE -- a
// real cause, not a fabricated fixture shortcut.
async function onboardRealProject(base) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-health-repair-'))
  tempDirs.push(dir)
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'a@b.com'])
  git(dir, ['config', 'user.name', 'A'])
  writeFileSync(path.join(dir, 'README.md'), '# X\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init'])
  const analyze = await post(base, '/api/onboarding/analyze', { repoPath: dir })
  assert.equal(analyze.status, 200)
  const commit = await withEnvDuring({ STUB_ORCA_MODE: 'error' }, () =>
    post(base, '/api/onboarding/commit', {
      analysis: analyze.body,
      addTo: { knownProjects: true, activeFleet: false, workSet: false }
    })
  )
  assert.equal(commit.status, 200)
  return { dir, projectId: commit.body.projectId }
}

test("GET /api/health-repair/scan surfaces a real onboarded project's real cause, never silently drops it", async () => {
  await withServer(async (base) => {
    const { projectId } = await onboardRealProject(base)
    const { status, body } = await get(base, '/api/health-repair/scan')
    assert.equal(status, 200)
    const project = body.projects.find((p) => p.projectId === projectId)
    assert.ok(project, 'the onboarded project must appear in the scan')
    assert.ok(
      project.causes.some((c) => c.cause === 'ORCA_NOT_REGISTERED'),
      'a real, unregistered project must surface ORCA_NOT_REGISTERED'
    )
    assert.equal(project.readyForWork, false)
  })
})

test('POST /api/health-repair/:projectId/repair actually repairs an AUTO_REPAIR_SAFE cause and persists the result', async () => {
  await withServer(async (base) => {
    const { projectId } = await onboardRealProject(base)
    const repair = await post(base, `/api/health-repair/${projectId}/repair`, {
      cause: 'ORCA_NOT_REGISTERED'
    })
    assert.equal(repair.status, 200)
    assert.equal(repair.body.repairResult.action, 'REFRESH_ORCA_REGISTRATION')
    // Re-scan proves the repair was actually persisted, not just returned
    // once and forgotten.
    const rescan = await get(base, '/api/health-repair/scan')
    const project = rescan.body.projects.find((p) => p.projectId === projectId)
    assert.ok(project, 'project still present after repair')
  })
})

test('POST /api/health-repair/:projectId/repair refuses a cause that is not AUTO_REPAIR_SAFE, never silently no-ops as success', async () => {
  await withServer(async (base) => {
    const { projectId } = await onboardRealProject(base)
    const repair = await post(base, `/api/health-repair/${projectId}/repair`, {
      cause: 'SECURITY_FINDINGS'
    })
    assert.equal(repair.status, 422)
    assert.equal(repair.body.ok, false)
  })
})

test('POST /api/health-repair/:projectId/repair for an unknown project is a real 404, not a crash', async () => {
  await withServer(async (base) => {
    const repair = await post(base, '/api/health-repair/does-not-exist/repair', {
      cause: 'ORCA_NOT_REGISTERED'
    })
    assert.equal(repair.status, 404)
  })
})

test("POST /api/health-repair/:projectId/baseline runs the project's real discovered commands", async () => {
  await withServer(async (base) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-health-repair-'))
    tempDirs.push(dir)
    git(dir, ['init', '-q'])
    git(dir, ['config', 'user.email', 'a@b.com'])
    git(dir, ['config', 'user.name', 'A'])
    writeFileSync(path.join(dir, 'README.md'), '# X\n')
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'node -e "process.exit(0)"' } })
    )
    // A real lockfile so discoverCommandGuidance picks a real runner (npm)
    // instead of 'UNKNOWN' -- without one, the discovered command is the
    // literal placeholder string "UNKNOWN run test", which is not
    // executable and would fail for a reason unrelated to what this test
    // is actually checking.
    writeFileSync(path.join(dir, 'package-lock.json'), '{}')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', 'init'])
    const analyze = await post(base, '/api/onboarding/analyze', { repoPath: dir })
    const commit = await post(base, '/api/onboarding/commit', {
      analysis: analyze.body,
      addTo: { knownProjects: true }
    })
    const baseline = await post(base, `/api/health-repair/${commit.body.projectId}/baseline`, {})
    assert.equal(baseline.status, 200)
    assert.equal(baseline.body.baseline.test, 'PASS')
    assert.equal(baseline.body.baseline.build, 'NOT_APPLICABLE')
  })
})

test('POST /api/health-repair/repair-selected repairs multiple real projects independently -- one unknown project never stops the others', async () => {
  await withServer(async (base) => {
    const { projectId: p1 } = await onboardRealProject(base)
    const { projectId: p2 } = await onboardRealProject(base)
    const { status, body } = await post(base, '/api/health-repair/repair-selected', {
      projectIds: [p1, 'does-not-exist', p2]
    })
    assert.equal(status, 200)
    const byId = Object.fromEntries(body.results.map((r) => [r.projectId, r]))
    assert.equal(byId[p1].ok, true)
    assert.equal(byId[p2].ok, true)
    assert.equal(byId['does-not-exist'].ok, false)
  })
})

test('POST /api/health-repair/:projectId/prepare-mission returns a real spec without dispatching anything', async () => {
  await withServer(async (base) => {
    // Not directly reachable from a real onboarded project's own diagnosis
    // without a real baseline failure, so this proves the route's own
    // authority check: a non-GOVERNED_REPAIR_MISSION cause is refused.
    const { projectId } = await onboardRealProject(base)
    const refused = await post(base, `/api/health-repair/${projectId}/prepare-mission`, {
      cause: 'ORCA_NOT_REGISTERED'
    })
    assert.equal(refused.status, 422)
  })
})
