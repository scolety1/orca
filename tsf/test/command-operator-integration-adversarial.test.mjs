// tsf-command-operator-integration-v1: adversarial reconciliation coverage
// for merging the Command Authority repair (4332af4e71) onto Operator
// Stabilization V1 (640cfc64c53ff82ecbf2b07fdc217e86a8224228). The two
// candidates touch zero overlapping files (confirmed at merge time -- see
// the merge commit message), so this file's job is not conflict resolution
// but SEMANTIC proof: the exact literal operator phrasings named for this
// integration, run against the merged tree, plus the authorization-once and
// cross-surface-agreement properties that span both candidates' territory
// (Command's resolution/authorization vs. Operator Stabilization's
// Work/Keep Going/global-status surfaces).
//
// Every scenario below uses either inert id/displayName strings (pure
// resolveProjectsFromText/classifyIntent/classifyDecision calls -- same
// convention as command-authority-regression-matrix.test.mjs; these never
// touch a real registered project or issue a real dispatch) or disposable
// temp-repo fixtures aliased to "nytheria"/"worldforge"/"nwr" via
// TSF_PROJECT_ALIASES_JSON (same convention as http-command-authority-e2e.
// test.mjs) -- never the real NWR/WorldForge/tsf-orca projects.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { classifyIntent, classifyDecision } from '../server/chat-responder.mjs'
import { resolveProjectsFromText } from '../server/project-name-resolver.mjs'

const REAL_PROJECTS = [
  { id: 'tsf-orca', displayName: 'TSF_ORCA' },
  { id: 'niners-war-room', displayName: 'Niners-War-Room' },
  {
    id: 'worldforge-sablewake-live-runtime-repair-v3',
    displayName: 'Worldforge-Sablewake-Live-Runtime-Repair-V3'
  }
]

function ids(matches) {
  return matches.map((m) => m.project.id)
}

// --- PART 1: the exact literal required scenarios, pinned at the resolver/
// intent level (fast, deterministic, no server needed). ---------------------

test('SCENARIO: "What\'s going on with Nytheria?" -- STATUS intent, resolves via alias, never dispatch-worthy', () => {
  const message = "What's going on with Nytheria?"
  assert.equal(classifyIntent(message), 'STATUS')
  assert.equal(classifyDecision(message, classifyIntent(message)), 'AUTO_DECIDE')
  const { matches } = resolveProjectsFromText(message, REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
  assert.equal(matches[0].matchedOn, 'alias')
})

test('SCENARIO: "What\'s going on with NWR?" -- STATUS intent, resolves via alias', () => {
  const message = "What's going on with NWR?"
  assert.equal(classifyIntent(message), 'STATUS')
  const { matches } = resolveProjectsFromText(message, REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['niners-war-room'])
  assert.equal(matches[0].matchedOn, 'alias')
})

// "Run Nytheria using TSF/Orca." combines three things this integration
// must get right at once: alias resolution (Nytheria), a bare-imperative
// directive ("Run X" -- Command final hands-on hardening fixed this to
// classify DISPATCH_REQUEST, see chat-responder.mjs's BARE_IMPERATIVE
// alternative), and a literal infra-tooling mention of "TSF/Orca" in the
// SAME message that must never corrupt resolution.
test('SCENARIO: "Run Nytheria using TSF/Orca." -- bare imperative recognized as DISPATCH_REQUEST, alias resolves correctly, infra mention never produces a false tsf-orca match', () => {
  const message = 'Run Nytheria using TSF/Orca.'
  assert.equal(classifyIntent(message), 'DISPATCH_REQUEST')
  assert.equal(classifyDecision(message, 'DISPATCH_REQUEST'), 'RECOMMEND_AND_PROCEED')
  const { matches } = resolveProjectsFromText(message, REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
  assert.equal(matches[0].matchedOn, 'alias')
  assert.equal(
    ids(matches).includes('tsf-orca'),
    false,
    'the infra mention must never resolve tsf-orca as a target'
  )
})

// "Run WorldForge. Do not touch TSF." -- WorldForge resolves via alias;
// "TSF" alone (not "tsf-orca", not "TSF_ORCA") is a bare infrastructure
// word that never matches tsf-orca's own id/displayName pattern and falls
// well below the fuzzy-confidence floor (1 of 2 name tokens = 0.5 < 0.6) --
// so it correctly never resolves as a project at all, whether excluded or
// not. Negation/exclusion has nothing to retract here because there was
// never a false match to retract; the two properties (infra-mention safety,
// exclusion respected) are both satisfied by the same "TSF never resolves"
// outcome.
test('SCENARIO: "Run WorldForge. Do not touch TSF." -- WorldForge resolves via alias, bare "TSF" never resolves as (or falsely excludes) any project', () => {
  const message = 'Run WorldForge. Do not touch TSF.'
  const { matches } = resolveProjectsFromText(message, REAL_PROJECTS)
  assert.deepEqual(ids(matches), ['worldforge-sablewake-live-runtime-repair-v3'])
  assert.equal(ids(matches).includes('tsf-orca'), false)
})

// "Should I deploy WorldForge?" -- a genuine question containing a
// TIM_REQUIRED-consequential keyword ("deploy"). Authority-leakage proof:
// the question form must not force TIM_REQUIRED (chat-responder.mjs's own
// isGenuineDirective rejects any clause containing "?"), and must not
// dispatch anything (GENERAL is not in DISPATCH_WORTHY_INTENTS) -- an
// operator asking ABOUT a consequential action must never be treated as
// having requested it.
test('SCENARIO: "Should I deploy WorldForge?" -- a question never forces TIM_REQUIRED and never dispatches, even with a consequential keyword and a resolvable alias present', () => {
  const message = 'Should I deploy WorldForge?'
  const intent = classifyIntent(message)
  assert.equal(intent, 'GENERAL')
  assert.equal(
    classifyDecision(message, intent),
    'AUTO_DECIDE',
    'a question about a consequential action is never itself TIM_REQUIRED'
  )
  const { matches } = resolveProjectsFromText(message, REAL_PROJECTS)
  assert.deepEqual(
    ids(matches),
    ['worldforge-sablewake-live-runtime-repair-v3'],
    'the alias still resolves informationally'
  )
})

// --- PART 2: real HTTP round trip -- authorization-once, real durable
// state, and Planner/Work/Command cross-surface agreement. -----------------

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-command-operator-integration-${process.pid}.json`
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
  const dir = mkdtempSync(path.join(tmpdir(), `tsf-command-operator-integration-${name}-`))
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

// PROOF: a consequential message is refused once (TIM_REQUIRED, no
// dispatch); the operator's very next message supplies exact authorization
// naming the project via its own durable alias ("nytheria") -- this must
// proceed immediately, exactly once, without asking again, and must produce
// real durable state, not just a chat reply. This is the literal round trip
// named for this integration: "authorization requested once -> exact
// authorization supplied -> action proceeds without immediately requesting
// the same approval again, where the current Command action actually has
// executable authority" -- Command's only real executable authority is a
// Keep Going dispatch (chat has no push/merge/deploy tool at all, by this
// codebase's own design -- respondGeneral says so explicitly), so the
// authorized follow-up asks for that, not for the originally-refused
// literal deploy.
test('AUTHORIZATION-ONCE + DURABLE STATE: a TIM_REQUIRED refusal is followed by one explicit, aliased authorization that dispatches immediately and produces real, durable, cross-surface-consistent state', async () => {
  await withServer(async (base) => {
    const { projectId, root } = await onboardTestProject(base, 'nytheria-target')
    process.env.TSF_PROJECT_ALIASES_JSON = JSON.stringify({ nytheria: projectId })
    process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'repo-nytheria', path: root, kind: 'git' }])
    process.env.STUB_ORCA_WORKTREE_PATH = root
    try {
      // Step 1: a consequential ask -- refused, nothing dispatched.
      const refusal = await chat(base, {
        projectId: null,
        message: 'push nytheria to production'
      })
      assert.equal(refusal.status, 200)
      assert.equal(refusal.body.decisionClass, 'TIM_REQUIRED')
      assert.notEqual(refusal.body.dispatched, true, 'a TIM_REQUIRED refusal must never dispatch')
      const preAuthRun = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(preAuthRun.started, false, 'no run exists before real authorization is supplied')

      // Step 2: the operator supplies exact, explicit authorization naming
      // the project by its durable alias -- must dispatch immediately, once.
      const authorized = await chat(base, {
        projectId: null,
        message: 'yes, go ahead and get nytheria ready'
      })
      assert.equal(authorized.status, 200)
      assert.notEqual(
        authorized.body.decisionClass,
        'TIM_REQUIRED',
        'the authorized follow-up must not be refused again'
      )
      assert.deepEqual(authorized.body.resolvedProjectIds, [projectId])
      assert.equal(authorized.body.dispatched, true)

      // Durable: GET /api/keep-going/:id (what Work's own detail view reads).
      const runView = await (await fetch(`${base}/api/keep-going/${projectId}`)).json()
      assert.equal(runView.started, true)
      assert.equal(runView.state, 'ACTIVE')

      // Cross-surface: GET /api/work (what the Work page reads) must show
      // the same project in an active bucket, not just the keep-going API.
      const work = await (await fetch(`${base}/api/work`)).json()
      const allWorkIds = [...(work.active ?? []), ...(work.verifying ?? [])].map((p) => p.id)
      assert.ok(
        allWorkIds.includes(projectId),
        'Work page state must agree with the Keep Going run just created'
      )

      // Cross-surface: a Command STATUS question via the durable alias must
      // report the same real state, not a stale or invented answer.
      const status = await chat(base, {
        projectId: null,
        message: "what's going on with nytheria?"
      })
      assert.equal(status.status, 200)
      assert.match(
        status.body.text,
        /ACTIVE|WORKING|PLANNING/,
        "Command's own status answer agrees with the real run state"
      )
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
      delete process.env.TSF_PROJECT_ALIASES_JSON
    }
  })
})

// PROOF: multi-project request with one explicit exclusion, using durable
// aliases for BOTH named projects (not just literal ids as the existing
// negation e2e test already covers) -- confirms alias resolution and
// negation-scoped exclusion compose correctly together, end to end, with
// real durable state for the kept project and confirmed absence of any run
// for the excluded one.
test('MULTI-PROJECT + EXCLUSION (aliased): "fix nytheria, not worldforge-two" dispatches only the named, non-excluded aliased project', async () => {
  await withServer(async (base) => {
    const keep = await onboardTestProject(base, 'nytheria-keep')
    const excluded = await onboardTestProject(base, 'nytheria-exclude')
    process.env.TSF_PROJECT_ALIASES_JSON = JSON.stringify({
      nytheria: keep.projectId,
      'worldforge-two': excluded.projectId
    })
    process.env.STUB_ORCA_REPOS = JSON.stringify([
      { id: 'repo-keep', path: keep.root, kind: 'git' }
    ])
    process.env.STUB_ORCA_WORKTREE_PATH = keep.root
    try {
      const { status, body } = await chat(base, {
        projectId: null,
        message: 'go ahead and fix nytheria, not worldforge-two'
      })
      assert.equal(status, 200)
      assert.deepEqual(body.resolvedProjectIds, [keep.projectId])
      assert.equal(body.dispatched, true)

      const runKeep = await (await fetch(`${base}/api/keep-going/${keep.projectId}`)).json()
      const runExcluded = await (await fetch(`${base}/api/keep-going/${excluded.projectId}`)).json()
      assert.equal(runKeep.started, true)
      assert.equal(runExcluded.started, false, 'the aliased, excluded project got no run at all')
    } finally {
      delete process.env.STUB_ORCA_REPOS
      delete process.env.STUB_ORCA_WORKTREE_PATH
      delete process.env.TSF_PROJECT_ALIASES_JSON
    }
  })
})
