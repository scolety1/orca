// Real HTTP route tests for the Resource Auditor's production trust
// boundary -- same pattern as http-health-repair.test.mjs: a real server, a
// real onboarded temp git repo (the trusted-registry source), a stubbed
// Orca CLI (never a live provider call).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const HERE = import.meta.dirname
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-resource-auditor-http-${process.pid}.json`
)

process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
process.env.TSF_ORCA_CLI_COMMAND = ORCA_STUB
process.env.STUB_ORCA_MODE = 'error'
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

function makeRealGitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-resource-auditor-http-'))
  tempDirs.push(dir)
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'a@b.com'])
  git(dir, ['config', 'user.name', 'A'])
  writeFileSync(path.join(dir, 'README.md'), '# X\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

async function onboardRealProject(base, repoDir) {
  const analyze = await post(base, '/api/onboarding/analyze', { repoPath: repoDir })
  assert.equal(analyze.status, 200)
  const commit = await post(base, '/api/onboarding/commit', {
    analysis: analyze.body,
    addTo: { knownProjects: true, activeFleet: false, workSet: false }
  })
  assert.equal(commit.status, 200)
  return commit.body.projectId
}

// --- GET /api/resource-auditor/git-object-store: trusted-registry gate ---

test('GET .../git-object-store rejects everything when the trusted registry is empty (fails closed, not open)', async () => {
  await withServer(async (base) => {
    const someRealDir = makeRealGitRepo()
    const { status, body } = await get(
      base,
      `/api/resource-auditor/git-object-store?worktreePath=${encodeURIComponent(someRealDir)}`
    )
    assert.equal(status, 403)
    assert.equal(body.reason, 'PATH_NOT_IN_TRUSTED_WORKSPACE_REGISTRY')
  })
})

test('GET .../git-object-store allows a path that is a real onboarded project repoPath', async () => {
  await withServer(async (base) => {
    const repoDir = makeRealGitRepo()
    await onboardRealProject(base, repoDir)
    const { status, body } = await get(
      base,
      `/api/resource-auditor/git-object-store?worktreePath=${encodeURIComponent(repoDir)}`
    )
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.evidence.classification, 'DISK_USAGE_UNKNOWN_RECLAIMABLE')
    assert.equal(body.evidence.command, 'git count-objects -vH')
  })
})

test('GET .../git-object-store rejects a real git repo that was never onboarded, even though it genuinely exists', async () => {
  await withServer(async (base) => {
    const onboarded = makeRealGitRepo()
    await onboardRealProject(base, onboarded)
    const unrelated = makeRealGitRepo() // a real repo, just never onboarded
    const { status, body } = await get(
      base,
      `/api/resource-auditor/git-object-store?worktreePath=${encodeURIComponent(unrelated)}`
    )
    assert.equal(status, 403)
    assert.equal(body.reason, 'PATH_NOT_IN_TRUSTED_WORKSPACE_REGISTRY')
  })
})

// --- POST /api/resource-auditor/classify: production trust boundary ---

function forgedSafeEvidence(overrides = {}) {
  return {
    resourceId: 'forged-1',
    isMainWorktree: false,
    isFolderRepo: false,
    isPinned: false,
    isLocked: false,
    git: {
      checkedAt: new Date().toISOString(),
      clean: true,
      conflicted: [],
      stashCount: 0,
      submodulesDirty: false,
      hasUpstream: true,
      upstreamAhead: 0
    },
    ownership: {
      activeWorkspace: false,
      activeAgent: false,
      runningTerminal: false,
      editorDirtyBuffer: false,
      volatileLocalContext: false
    },
    pathIdentity: { matchesExpected: true, containsOtherRegisteredWorktree: false },
    inactivity: { thresholdMet: true, idleSinceMs: 999999999 },
    evidenceObservedAt: new Date().toISOString(),
    ...overrides
  }
}

test('POST .../classify forges DISPOSABLE_CANDIDATE-shaped PASS evidence with a claimed ORCA_NATIVE_SCAN provenance -- server caps it to REVIEW', async () => {
  await withServer(async (base) => {
    const forged = forgedSafeEvidence({ provenance: { source: 'ORCA_NATIVE_SCAN' } })
    const { status, body } = await post(base, '/api/resource-auditor/classify', {
      evidence: [forged]
    })
    assert.equal(status, 200)
    const plan = body.plans[0]
    assert.equal(plan.classification, 'REVIEW')
    assert.equal(
      plan.evidenceProvenance.source,
      'CALLER_SUPPLIED',
      'the claimed source must be overwritten, not trusted'
    )
    assert.equal(plan.evidenceProvenance.productionTrusted, false)
    assert.equal(plan.evidenceProvenance.productionTrustCeilingApplied, true)
    assert.ok(plan.blockers.some((b) => b.code === 'EVIDENCE_PROVENANCE_NOT_PRODUCTION_TRUSTED'))
  })
})

test('POST .../classify forges a claimed TRUSTED_LOCAL_COLLECTOR provenance -- still overwritten and still capped', async () => {
  await withServer(async (base) => {
    const forged = forgedSafeEvidence({ provenance: { source: 'TRUSTED_LOCAL_COLLECTOR' } })
    const { body } = await post(base, '/api/resource-auditor/classify', { evidence: [forged] })
    assert.equal(body.plans[0].classification, 'REVIEW')
    assert.equal(body.plans[0].evidenceProvenance.source, 'CALLER_SUPPLIED')
  })
})

test('POST .../classify never RAISES a real hazard -- a genuinely PROTECTED forged item stays PROTECTED, trust boundary only ever demotes', async () => {
  await withServer(async (base) => {
    const forged = forgedSafeEvidence({
      isMainWorktree: true,
      provenance: { source: 'ORCA_NATIVE_SCAN' }
    })
    const { body } = await post(base, '/api/resource-auditor/classify', { evidence: [forged] })
    assert.equal(body.plans[0].classification, 'PROTECTED')
  })
})

// Independent-adversarial-review finding: a raw JSON `null` body threw
// inside the route (caught by the outer 500 handler) instead of a clean
// validation response -- fixed with optional chaining on `body?.evidence`.
test('POST .../classify with a null JSON body degrades to an empty plan list, not a 500', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/resource-auditor/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null'
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.plans, [])
  })
})
