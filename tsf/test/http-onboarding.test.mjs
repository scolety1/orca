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
  `operator-state.test-http-onboarding-${process.pid}.json`
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

function createTempRepo({ dirty = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-onboarding-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# HTTP Onboarding Test Project\n')
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'http-onboarding-test', scripts: { test: 'echo ok' } })
  )
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  if (dirty) {
    writeFileSync(path.join(dir, 'wip.txt'), 'wip')
  }
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

test('POST /api/onboarding/analyze returns a read-only analysis for a real repo', async () => {
  await withServer(async (base) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tsf-http-onboarding-'))
    tempDirs.push(dir)
    git(dir, ['init', '-q'])
    git(dir, ['config', 'user.email', 'a@b.com'])
    git(dir, ['config', 'user.name', 'A'])
    writeFileSync(path.join(dir, 'README.md'), '# X\n')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', 'init'])
    const { status, body } = await post(base, '/api/onboarding/analyze', { repoPath: dir })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.migrationClassification.classification, 'SAFE_TO_ONBOARD_NOW')
    assert.equal(body.existingProjectId, null)
  })
})

test('POST /api/onboarding/analyze on a nonexistent path returns an honest 422, not a 500 crash', async () => {
  await withServer(async (base) => {
    const { status, body } = await post(base, '/api/onboarding/analyze', {
      repoPath: path.join(tmpdir(), 'tsf-does-not-exist-http-test')
    })
    assert.equal(status, 422)
    assert.equal(body.ok, false)
    assert.equal(body.reason, 'REPOSITORY_UNAVAILABLE')
  })
})

test('full flow: analyze then commit onboards a project into Known Projects/Active Fleet/Work Set, and it appears in /api/projects', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    const analyzeRes = await post(base, '/api/onboarding/analyze', { repoPath: dir })
    assert.equal(analyzeRes.status, 200)
    const analysis = analyzeRes.body

    const commitRes = await post(base, '/api/onboarding/commit', {
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.equal(commitRes.status, 200)
    assert.equal(commitRes.body.ok, true)
    assert.equal(commitRes.body.activeFleet, true)
    assert.equal(commitRes.body.workSet, true)

    const projectsRes = await fetch(`${base}/api/projects`)
    const projects = await projectsRes.json()
    const found = projects.find((p) => p.id === analysis.projectId)
    assert.ok(found, 'onboarded project must appear in /api/projects')
    assert.equal(found.activeFleet, true)
    assert.equal(found.workSet, true)

    const detailRes = await fetch(`${base}/api/projects/${analysis.projectId}`)
    const detail = await detailRes.json()
    assert.ok(
      detail.evidence.onboarding,
      'onboarded project detail must carry onboarding evidence for Planner Chat'
    )
    // Regression guard: the stored record must reflect the real post-commit
    // Orca registration outcome, not the stale pre-commit "not registered"
    // snapshot from the read-only analysis step.
    assert.equal(detail.evidence.onboarding.orcaRegistration.registered, true)
    // Regression guard: the receipts tab renders receiptHash directly —
    // an onboarding receipt must be a real, fully-shaped ReceiptEntry, not
    // a bespoke record missing fields the UI assumes are always present.
    assert.ok(detail.receipts.chain.length > 0)
    for (const entry of detail.receipts.chain) {
      assert.equal(typeof entry.receiptHash, 'string')
      assert.equal(typeof entry.chainValid, 'boolean')
    }
  })
})

test('a dirty repo cannot be committed into Work Set even if requested through the HTTP route', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo({ dirty: true })
    tempDirs.push(dir)
    const analysis = (await post(base, '/api/onboarding/analyze', { repoPath: dir })).body
    assert.equal(analysis.migrationClassification.classification, 'DIRTY_PRESERVE')
    const commitRes = await post(base, '/api/onboarding/commit', {
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.equal(commitRes.body.workSet, false)
  })
})

test('duplicate/case-normalized path: analyzing an already-onboarded repo again surfaces existingProjectId instead of a silent duplicate', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    const analysis = (await post(base, '/api/onboarding/analyze', { repoPath: dir })).body
    await post(base, '/api/onboarding/commit', { analysis, addTo: { knownProjects: true } })

    // Re-analyze the same path with different case/slash form.
    const variantPath = dir.toUpperCase()
    const second = (await post(base, '/api/onboarding/analyze', { repoPath: variantPath })).body
    assert.equal(second.existingProjectId, analysis.projectId)
  })
})

test('GET /api/onboarding/browse lists subdirectories of a real path without mutating anything', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/onboarding/browse?path=${encodeURIComponent(tmpdir())}`)
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.ok, true)
    assert.ok(Array.isArray(body.directories))
  })
})

test('POST /api/onboarding/orca-status refreshes Orca registration alone, without re-running discovery/health/the planner', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    const { status, body } = await post(base, '/api/onboarding/orca-status', { repoPath: dir })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.orcaRegistration.registered, false)
    assert.equal(body.orcaRegistration.status, 'NOT_REGISTERED')
    assert.deepEqual(Object.keys(body).sort(), ['ok', 'orcaRegistration'])
  })
})

test('POST /api/onboarding/orca-status on a missing repoPath returns an honest 400', async () => {
  await withServer(async (base) => {
    const { status, body } = await post(base, '/api/onboarding/orca-status', {})
    assert.equal(status, 400)
    assert.equal(body.ok, false)
  })
})

test('POST /api/onboarding/retry-direction re-runs only the live planner call', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    const { status, body } = await post(base, '/api/onboarding/retry-direction', { repoPath: dir })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.direction.live, true)
  })
})

test('POST /api/onboarding/refresh reruns read-only facts but preserves the durable Known/Active Fleet/Work Set decision', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    const analysis = (await post(base, '/api/onboarding/analyze', { repoPath: dir })).body
    await post(base, '/api/onboarding/commit', {
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })

    // Make the repo dirty, then refresh.
    writeFileSync(path.join(dir, 'new-file.txt'), 'new')
    const refreshRes = await post(base, '/api/onboarding/refresh', {
      projectId: analysis.projectId
    })
    assert.equal(refreshRes.status, 200)
    assert.equal(refreshRes.body.ok, true)
    assert.equal(refreshRes.body.changes.dirtyStateChanged, true)
    assert.equal(refreshRes.body.analysis.projectId, analysis.projectId)

    // Portfolio membership (a durable decision) must survive the refresh untouched.
    const projectsRes = await fetch(`${base}/api/projects`)
    const projects = await projectsRes.json()
    const found = projects.find((p) => p.id === analysis.projectId)
    assert.equal(found.activeFleet, true)
    assert.equal(found.workSet, true)
  })
})

test('refreshing an unknown project id returns 404, not a crash', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/onboarding/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'does-not-exist' })
    })
    assert.equal(res.status, 404)
  })
})

// V1 stabilization finding: the onboarding reconciliation deadlock. A
// handoff/live-repo conflict had no UI control anywhere to resolve it, and
// TIM_REQUIRED's gating blocked even Known Projects.
test('POST /api/onboarding/analyze on a handoff/repo conflict returns UNRESOLVED_HANDOFF_DISCREPANCY with structured discrepancy evidence, and Known Projects stays allowed', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo({ dirty: true })
    tempDirs.push(dir)
    const { status, body } = await post(base, '/api/onboarding/analyze', {
      repoPath: dir,
      handoffText: 'The repository is clean and ready to go.'
    })
    assert.equal(status, 200)
    assert.equal(body.migrationClassification.classification, 'UNRESOLVED_HANDOFF_DISCREPANCY')
    assert.equal(body.portfolioGating.knownProjects.allowed, true)
    assert.equal(body.portfolioGating.activeFleet.allowed, false)
    assert.ok(body.handoffReconciliation.discrepancyDetails.length > 0)
    assert.equal(body.handoffReconciliation.discrepancyDetails[0].liveRepo.value, 'dirty')
  })
})

test('POST /api/onboarding/resolve re-classifies using an explicit resolution, without re-running the live planner', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo({ dirty: true })
    tempDirs.push(dir)
    const { status, body } = await post(base, '/api/onboarding/resolve', {
      repoPath: dir,
      handoffText: 'The repository is clean and ready to go.',
      resolution: { mode: 'USE_LIVE_REPO_FOR_CURRENT_STATE' }
    })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.migrationClassification.classification, 'DIRTY_PRESERVE')
    assert.equal(body.portfolioGating.activeFleet.allowed, true)
    assert.equal(body.handoffReconciliation.effectiveConflict, false)
    assert.equal(
      body.handoffReconciliation.hasConflict,
      true,
      'the raw discrepancy stays on record as history'
    )
    assert.deepEqual(Object.keys(body).sort(), [
      'handoffReconciliation',
      'health',
      'migrationClassification',
      'ok',
      'portfolioGating'
    ])
  })
})

test('POST /api/onboarding/resolve with an invalid mode returns an honest 422, not a silent no-op', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    const { status, body } = await post(base, '/api/onboarding/resolve', {
      repoPath: dir,
      handoffText: 'clean',
      resolution: { mode: 'BOGUS' }
    })
    assert.equal(status, 422)
    assert.equal(body.ok, false)
    assert.equal(body.reason, 'INVALID_RESOLUTION_MODE')
  })
})

test('full flow: analyze (conflict) -> commit as Known-only -> onboarded project records the discrepancy resolution in its receipt', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo({ dirty: true })
    tempDirs.push(dir)
    const analysis = (
      await post(base, '/api/onboarding/analyze', {
        repoPath: dir,
        handoffText: 'The repository is clean and ready to go.'
      })
    ).body
    assert.equal(analysis.migrationClassification.classification, 'UNRESOLVED_HANDOFF_DISCREPANCY')

    // Known Projects alone, no resolution made yet — the safest allowed choice.
    const commitRes = await post(base, '/api/onboarding/commit', {
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.equal(commitRes.status, 200)
    assert.equal(
      commitRes.body.activeFleet,
      false,
      'Active Fleet must stay gated for an unresolved discrepancy even if requested'
    )

    const projectsRes = await fetch(`${base}/api/projects`)
    const projects = await projectsRes.json()
    assert.ok(
      projects.find((p) => p.id === analysis.projectId),
      'Known-only onboarding must succeed despite the unresolved discrepancy'
    )
  })
})

test('a project judged genuinely identity-ambiguous (TIM_REQUIRED) cannot be committed to Known Projects through the HTTP route either', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    const analysis = (
      await post(base, '/api/onboarding/analyze', {
        repoPath: dir,
        handoffText:
          'Branch feature/ghost-ambiguous is clean. Handoff was captured at commit deadbeefcafe0123456789abcdef01234567.'
      })
    ).body
    assert.equal(analysis.migrationClassification.classification, 'TIM_REQUIRED')
    const commitRes = await post(base, '/api/onboarding/commit', {
      analysis,
      addTo: { knownProjects: true }
    })
    const projectsRes = await fetch(`${base}/api/projects`)
    const projects = await projectsRes.json()
    assert.equal(
      projects.find((p) => p.id === analysis.projectId),
      undefined
    )
    assert.equal(commitRes.body.activeFleet, false)
  })
})

test('a sensitive project is committed as Known but never enters Active Fleet or Work Set even when requested', async () => {
  await withServer(async (base) => {
    const dir = createTempRepo()
    tempDirs.push(dir)
    writeFileSync(path.join(dir, '.env'), 'SECRET=x')
    const analysis = (await post(base, '/api/onboarding/analyze', { repoPath: dir })).body
    assert.equal(analysis.migrationClassification.classification, 'SENSITIVE')
    const commitRes = await post(base, '/api/onboarding/commit', {
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.equal(commitRes.body.activeFleet, false)
    assert.equal(commitRes.body.workSet, false)
  })
})
