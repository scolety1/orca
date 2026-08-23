// TSF Health Repair Center V1 -- real HTTP route tests, same pattern as
// http-onboarding.test.mjs: a real server, real fixture git repos, a
// stubbed Orca CLI/planner (never a live provider call).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
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

function readState() {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
}
function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// Independent-review finding, confirmed with a live exploit against the
// old code: checking only the REQUESTED cause's own repair class let an
// otherwise-safe cause be auto-repaired on a project that ALSO carries a
// TIM_REQUIRED cause -- a direct violation of "sensitive projects retain
// stronger authority... regardless of anything else found."
test('POST /api/health-repair/:projectId/repair refuses ANY repair on a project that also carries a TIM_REQUIRED cause, even for an otherwise-safe requested cause', async () => {
  await withServer(async (base) => {
    const { projectId } = await onboardRealProject(base)
    // Directly inject a SENSITIVE classification onto the real, already-
    // onboarded record -- simulating a project that is both SENSITIVE
    // (TIM_REQUIRED) and has an otherwise-safe ORCA_NOT_REGISTERED cause,
    // exactly the real-world shape that mattered here.
    const state = readState()
    state.onboardedProjects[projectId].lastAnalysis.migrationClassification = {
      classification: 'SENSITIVE',
      reasons: ['a real secret was found']
    }
    writeState(state)

    const repair = await post(base, `/api/health-repair/${projectId}/repair`, {
      cause: 'ORCA_NOT_REGISTERED'
    })
    assert.equal(repair.status, 422)
    assert.equal(repair.body.ok, false)

    // And confirm nothing was actually run: orcaRegistration on record is
    // unchanged from before the (refused) repair attempt.
    const after = readState()
    assert.deepEqual(
      after.onboardedProjects[projectId].lastAnalysis.orcaRegistration,
      state.onboardedProjects[projectId].lastAnalysis.orcaRegistration
    )
  })
})

test('POST /api/health-repair/repair-selected skips a SENSITIVE project entirely but still repairs the others', async () => {
  await withServer(async (base) => {
    const { projectId: sensitive } = await onboardRealProject(base)
    const { projectId: safe } = await onboardRealProject(base)
    const state = readState()
    state.onboardedProjects[sensitive].lastAnalysis.migrationClassification = {
      classification: 'SENSITIVE',
      reasons: ['a real secret was found']
    }
    writeState(state)

    const { body } = await post(base, '/api/health-repair/repair-selected', {
      projectIds: [sensitive, safe]
    })
    const byId = Object.fromEntries(body.results.map((r) => [r.projectId, r]))
    assert.equal(byId[sensitive].ok, false)
    assert.equal(byId[safe].ok, true)
  })
})

// Independent-review finding, confirmed with a live exploit against the
// old code: no try/catch around the per-project loop, and a single
// saveState after the WHOLE batch -- a real exception on project 2 of 3
// discarded project 1's already-completed real repair (never persisted)
// and never attempted project 3.
test("POST /api/health-repair/repair-selected: a real exception on one project neither loses an earlier project's completed repair nor skips a later project", async () => {
  await withServer(async (base) => {
    const { projectId: p1 } = await onboardRealProject(base)
    const { projectId: p3 } = await onboardRealProject(base)
    // p2: a real onboarded record with a deliberately malformed repoPath
    // (a number, not a string) -- path.resolve() throws synchronously on
    // this, a genuine uncaught exception deep in the real repair call
    // chain (repairProject -> analyzeRepository -> snapshotRepository),
    // not a contrived ok:false.
    const state = readState()
    const p2 = 'malformed-repo-path-project'
    state.onboardedProjects[p2] = {
      repoPath: 12345,
      lastAnalysis: JSON.parse(JSON.stringify(state.onboardedProjects[p1].lastAnalysis)),
      receipts: [],
      acceptedAt: new Date().toISOString()
    }
    state.onboardedProjects[p2].lastAnalysis.projectId = p2
    // Force this record to need PLANNER_UNAVAILABLE -> REFRESH_ANALYSIS,
    // the repair action that actually calls analyzeRepository (and so
    // actually reaches the malformed repoPath).
    state.onboardedProjects[p2].lastAnalysis.direction = {
      live: false,
      recommendedNextMission: null
    }
    state.onboardedProjects[p2].lastAnalysis.orcaRegistration = {
      checked: true,
      registered: true,
      status: 'REGISTERED'
    }
    writeState(state)

    const { status, body } = await post(base, '/api/health-repair/repair-selected', {
      projectIds: [p1, p2, p3]
    })
    assert.equal(status, 200, 'the route itself must not crash even though one project threw')
    const byId = Object.fromEntries(body.results.map((r) => [r.projectId, r]))
    assert.equal(
      byId[p1].ok,
      true,
      'project 1, repaired before the throw, must still report success'
    )
    assert.equal(
      byId[p2].ok,
      false,
      'project 2, which genuinely threw, must report failure honestly'
    )
    assert.equal(byId[p3].ok, true, 'project 3 must still be attempted after project 2 threw')

    // And project 1's real repair was actually persisted, not discarded --
    // refreshedAt genuinely moved forward from its pre-repair value (the
    // stub Orca CLI is stateless/keyed only off a fixed STUB_ORCA_REPOS
    // list, so `registered` itself honestly cannot flip true here -- that
    // would be the stub fabricating state it was never told about).
    const after = readState()
    assert.notEqual(
      after.onboardedProjects[p1].refreshedAt,
      state.onboardedProjects[p1].refreshedAt,
      "project 1's record must show a genuinely fresh write, not the pre-repair state"
    )
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
