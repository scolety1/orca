// COMMAND FINAL HANDS-ON HARDENING: bare imperative dispatch recognition.
// Command is meant to be the main conversational control surface, but a
// natural "Run Nytheria" / "Start WorldForge" was not recognized as a
// dispatch request at all -- disclosed during the integration-reconciliation
// task as a real, pre-existing (not merge-caused) vocabulary gap, then fixed
// here in chat-responder.mjs's DISPATCH_REQUEST pattern (a new,
// clause-start-anchored BARE_IMPERATIVE alternative, reusing the same
// directiveOnly/isGenuineDirective negation-and-question judgment every
// other DISPATCH_REQUEST phrasing already goes through).
//
// Governance is explicitly preserved, not bypassed: recognizing intent is
// not the same as granting authority -- classifyDecision's own consequential
// check (isConsequentialDirective) is completely independent of intent
// classification and still refuses a bare imperative that also names a
// consequential action ("Run X to production").
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { classifyIntent, classifyDecision } from '../server/chat-responder.mjs'

// --- PART 1: pure classification matrix (fast, deterministic) -------------

test('BARE IMPERATIVE: "Run Nytheria" classifies as DISPATCH_REQUEST', () => {
  assert.equal(classifyIntent('Run Nytheria'), 'DISPATCH_REQUEST')
  assert.equal(classifyDecision('Run Nytheria', 'DISPATCH_REQUEST'), 'RECOMMEND_AND_PROCEED')
})

test('BARE IMPERATIVE: "Start WorldForge" classifies as DISPATCH_REQUEST', () => {
  assert.equal(classifyIntent('Start WorldForge'), 'DISPATCH_REQUEST')
})

test('BARE IMPERATIVE: "Run Nytheria overnight" classifies as DISPATCH_REQUEST', () => {
  assert.equal(classifyIntent('Run Nytheria overnight'), 'DISPATCH_REQUEST')
})

test('BARE IMPERATIVE: "Run Nytheria and WorldForge" classifies as DISPATCH_REQUEST (multi-project phrasing)', () => {
  assert.equal(classifyIntent('Run Nytheria and WorldForge'), 'DISPATCH_REQUEST')
})

test('BARE IMPERATIVE: "Run Nytheria but not WorldForge" classifies as DISPATCH_REQUEST -- the exclusion itself is project-name-resolver.mjs\'s own job, not intent classification\'s', () => {
  assert.equal(classifyIntent('Run Nytheria but not WorldForge'), 'DISPATCH_REQUEST')
})

test('NEGATION: "Don\'t run Nytheria" never classifies as DISPATCH_REQUEST', () => {
  assert.equal(classifyIntent("Don't run Nytheria"), 'GENERAL')
  assert.equal(classifyIntent('Never run Nytheria'), 'GENERAL')
  assert.equal(classifyIntent('Please do not run Nytheria'), 'GENERAL')
})

test('NEGATION: a later, genuine bare imperative still fires even after an earlier negated one in the same message', () => {
  assert.equal(classifyIntent("Don't run Nytheria. Run WorldForge instead."), 'DISPATCH_REQUEST')
})

test('QUERY/STATUS: sentences containing "run" that are not dispatch requests never classify as DISPATCH_REQUEST', () => {
  assert.equal(classifyIntent("what's running right now?"), 'STATUS')
  assert.equal(classifyIntent('is the test still running?'), 'GENERAL')
  assert.equal(classifyIntent('how do I run the migration?'), 'GENERAL')
  assert.equal(classifyIntent('the CI run failed'), 'GENERAL')
  assert.equal(classifyIntent('Run Nytheria?'), 'GENERAL', 'a genuine question, not a directive')
})

test('IDIOM: "run into" (encounter, not a dispatch verb) never classifies as DISPATCH_REQUEST', () => {
  assert.equal(classifyIntent('Run into an issue with WorldForge'), 'GENERAL')
  assert.equal(classifyIntent('I ran into a problem with Nytheria'), 'GENERAL')
})

test('GOVERNANCE: recognizing bare-imperative intent never bypasses TIM_REQUIRED -- a consequential bare imperative still refuses', () => {
  const message = 'Run WorldForge to production'
  assert.equal(classifyIntent(message), 'DISPATCH_REQUEST', 'intent recognition happens')
  assert.equal(
    classifyDecision(message, 'DISPATCH_REQUEST'),
    'TIM_REQUIRED',
    'but authority still refuses it'
  )
})

test('GOVERNANCE: "please run" is still recognized (politeness does not defeat the anchor)', () => {
  assert.equal(classifyIntent('please run WorldForge'), 'DISPATCH_REQUEST')
})

// --- PART 2: real HTTP round trip -- bare imperative produces real durable
// state, never a fabricated "Started" claim; authorization-once + exclusion
// still compose correctly with the new trigger phrasing. --------------------

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-bare-imperative-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = PLANNER_STUB
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.STUB_MODE = 'success'
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'success'
// Main TSF overnight review of Resource Pressure Governor V0: real dispatch
// now consults real host memory before spawning a heavyweight worker
// (chat-dispatch-bridge.mjs). This file's own dispatch is not what's under
// test here -- forced HEALTHY so a genuinely shared, loaded host never
// makes this file's real dispatch assertions flaky, same env-var seam
// http-resource-pressure-governor.test.mjs already uses deterministically.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

const { createRequestHandler } = await import('../server/http-server.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `tsf-bare-imperative-${name}-`))
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

// PROOF: "Run <alias>" dispatches a real, durable Keep Going run end to end
// through the real HTTP route -- never a fabricated "Started" text with no
// backing state. Same disposable-fixture-plus-alias-override convention as
// test/command-target-resolution-blocker.test.mjs / http-command-authority-
// e2e.test.mjs.
test('a bare "Run <alias>" imperative dispatches a real, durable Keep Going run -- never a claimed start with no real backing state', async () => {
  await withServer(async (base) => {
    const { projectId, root } = await onboardTestProject(base, 'bare-run-target')
    process.env.TSF_PROJECT_ALIASES_JSON = JSON.stringify({ nytheria: projectId })
    process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'repo-bare-run', path: root, kind: 'git' }])
    process.env.STUB_ORCA_WORKTREE_PATH = root
    try {
      const preRun = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(preRun.started, false, 'no run exists before the bare imperative is sent')

      const { status, body } = await chat(base, { projectId: null, message: 'Run Nytheria' })
      assert.equal(status, 200)
      assert.deepEqual(body.resolvedProjectIds, [projectId])
      assert.equal(body.dispatched, true)

      const runView = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(
        runView.started,
        true,
        'a real run now exists -- the claim corresponds to real durable state'
      )
      assert.equal(runView.state, 'ACTIVE')

      const work = await (await fetch(`${base}/api/work`)).json()
      const allWorkIds = [...(work.active ?? []), ...(work.verifying ?? [])].map((p) => p.id)
      assert.ok(
        allWorkIds.includes(projectId),
        'Work page agrees with the real Keep Going run the bare imperative created'
      )
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
      delete process.env.TSF_PROJECT_ALIASES_JSON
    }
  })
})

// PROOF: "Run X but not Y" -- the new bare-imperative trigger composes
// correctly with pre-existing negation-scoped exclusion: X gets a real
// durable run, Y gets none at all.
test('"Run X but not Y" dispatches only the named, non-excluded project -- the new trigger composes correctly with exclusion', async () => {
  await withServer(async (base) => {
    const keep = await onboardTestProject(base, 'bare-run-keep')
    const excluded = await onboardTestProject(base, 'bare-run-exclude')
    process.env.STUB_ORCA_REPOS = JSON.stringify([
      { id: 'repo-keep', path: keep.root, kind: 'git' }
    ])
    process.env.STUB_ORCA_WORKTREE_PATH = keep.root
    try {
      const { status, body } = await chat(base, {
        projectId: null,
        message: `Run ${keep.projectId} but not ${excluded.projectId}`
      })
      assert.equal(status, 200)
      assert.deepEqual(body.resolvedProjectIds, [keep.projectId])
      assert.equal(body.dispatched, true)

      const runKeep = await (await fetch(`${base}/api/keep-going/${keep.projectId}`)).json()
      const runExcluded = await (await fetch(`${base}/api/keep-going/${excluded.projectId}`)).json()
      assert.equal(runKeep.started, true)
      assert.equal(runExcluded.started, false, 'the excluded project got no run at all')
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
    }
  })
})

// PROOF: "Don't run X" over the real HTTP route never dispatches anything.
test('"Don\'t run X" over the real HTTP route never dispatches -- no run, no claim', async () => {
  await withServer(async (base) => {
    const { projectId } = await onboardTestProject(base, 'bare-run-negated')
    process.env.TSF_PROJECT_ALIASES_JSON = JSON.stringify({ nytheria: projectId })
    try {
      const { status, body } = await chat(base, { projectId: null, message: "Don't run Nytheria" })
      assert.equal(status, 200)
      assert.notEqual(body.dispatched, true)
      const runView = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(runView.started, false)
    } finally {
      delete process.env.TSF_PROJECT_ALIASES_JSON
    }
  })
})

// PROOF (authorization-once, extended to the new trigger): a TIM_REQUIRED
// refusal on a consequential bare imperative, followed by an explicit
// non-consequential bare-imperative authorization, dispatches immediately
// without asking again.
test('AUTHORIZATION-ONCE with the new bare-imperative trigger: a TIM_REQUIRED refusal is followed by one plain "Run <alias>" that dispatches immediately', async () => {
  await withServer(async (base) => {
    const { projectId, root } = await onboardTestProject(base, 'bare-run-auth')
    process.env.TSF_PROJECT_ALIASES_JSON = JSON.stringify({ nytheria: projectId })
    process.env.STUB_ORCA_REPOS = JSON.stringify([
      { id: 'repo-bare-run-auth', path: root, kind: 'git' }
    ])
    process.env.STUB_ORCA_WORKTREE_PATH = root
    try {
      const refusal = await chat(base, { projectId: null, message: 'Run Nytheria to production' })
      assert.equal(refusal.body.decisionClass, 'TIM_REQUIRED')
      assert.notEqual(refusal.body.dispatched, true)

      const authorized = await chat(base, { projectId: null, message: 'Run Nytheria' })
      assert.notEqual(authorized.body.decisionClass, 'TIM_REQUIRED')
      assert.equal(authorized.body.dispatched, true)

      const runView = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(runView.started, true)
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
      delete process.env.TSF_PROJECT_ALIASES_JSON
    }
  })
})
