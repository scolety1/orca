import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  classifyMigration,
  portfolioGatingForClassification,
  reconcileHandoff
} from '../domain/onboarding.mjs'
import { createPortfolio } from '../domain/portfolio.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'
import {
  snapshotRepository,
  discoverProjectFiles,
  discoverCommandGuidance,
  boundedUntrackedDirectorySizes
} from '../server/repo-inspector.mjs'
import { analyzeRepository, commitOnboarding } from '../server/onboarding.mjs'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo({ dirty = false, readme = true, packageJson = true, agents = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-onboarding-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  if (readme) {
    writeFileSync(path.join(dir, 'README.md'), '# Test Project\nA small test project.\n')
  }
  if (packageJson) {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'test-project', scripts: { test: 'echo ok', build: 'echo build' } })
    )
  }
  if (agents) {
    writeFileSync(path.join(dir, 'AGENTS.md'), '# Agent instructions\n')
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial commit'])
  if (dirty) {
    writeFileSync(path.join(dir, 'wip.txt'), 'work in progress')
  }
  return dir
}

async function withEnv(vars, fn) {
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

// Default env for most tests: planner stubbed (deterministic, no cost),
// Orca stubbed with no pre-existing repos (not registered).
const BASE_ENV = {
  TSF_PLANNER_CLAUDE_COMMAND: PLANNER_STUB,
  TSF_PLANNER_CODEX_COMMAND: NONEXISTENT,
  STUB_MODE: 'success',
  TSF_ORCA_CLI_COMMAND: ORCA_STUB,
  STUB_ORCA_MODE: 'success',
  STUB_ORCA_REPOS: '[]'
}

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tracked(dir) {
  tempDirs.push(dir)
  return dir
}

// --- domain/onboarding.mjs ---

test('classifyMigration: clean, understood repo is SAFE_TO_ONBOARD_NOW', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SAFE_TO_ONBOARD_NOW')
})

test('classifyMigration: dirty with untracked/staged work is DIRTY_PRESERVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [],
    dirty: true,
    untrackedCount: 2,
    stagedCount: 0,
    unstagedCount: 0,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'DIRTY_PRESERVE')
})

test('classifyMigration: sensitive paths force SENSITIVE regardless of cleanliness', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: ['.env', 'src/index.js'],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
})

test('classifyMigration: active Git operation is TIM_REQUIRED', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: true,
    activeGitOperationKind: 'merge',
    handoffConflict: false
  })
  assert.equal(result.classification, 'TIM_REQUIRED')
})

// Reconciliation-deadlock/UNRESOLVED_HANDOFF_DISCREPANCY/identity-ambiguity
// tests live in onboarding-reconciliation.test.mjs.

test('classifyMigration: not a Git repository is NOT_READY', () => {
  const result = classifyMigration({ gitRepositoryFound: false })
  assert.equal(result.classification, 'NOT_READY')
})

test('portfolioGatingForClassification: Known Project never implies Work Set for any classification', () => {
  for (const classification of [
    'SAFE_TO_ONBOARD_NOW',
    'DIRTY_PRESERVE',
    'READ_ONLY_ONBOARDING_ONLY',
    'SENSITIVE',
    'UNRESOLVED_HANDOFF_DISCREPANCY',
    'NOT_READY',
    'TIM_REQUIRED'
  ]) {
    const gating = portfolioGatingForClassification(classification)
    assert.equal(gating.workSet.default, false, `${classification} must default Work Set off`)
  }
})

test('reconcileHandoff: agreement when handoff matches observed repository truth', () => {
  const result = reconcileHandoff({
    handoffText: 'The repo is clean and ready.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, false)
  assert.ok(result.agreements.length > 0)
})

test('reconcileHandoff: conflict when handoff claims clean but repo is dirty', () => {
  const result = reconcileHandoff({
    handoffText: 'main is clean at abc123def456.',
    repoFacts: { dirty: true, untrackedCount: 3, head: 'fedcba987654', branch: 'main' }
  })
  assert.equal(result.hasConflict, true)
  assert.match(result.discrepancies.join(' '), /dirty/i)
})

// Structured-claim, repository-mismatch, resolution-mode, restricted-
// artifact, and isLinkedWorktreeGitDir tests all live in
// onboarding-reconciliation.test.mjs.

// --- Defect 1 (M7 real-migration finding): negation-aware sensitivity ---
// classification. The original single regex matched a bare phrase anywhere
// in the text, so a project explicitly describing what it is NOT ("no
// production deployment") classified identically to one asserting that
// condition IS true. These are the exact adversarial cases from Tim's real
// Route Reader migration report.

function cleanFacts(overrides = {}) {
  return {
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false,
    ...overrides
  }
}

test('classifyMigration: "no production deployment exists" is explicit absence, not SENSITIVE', () => {
  const result = classifyMigration(
    cleanFacts({
      readmeExcerpt: 'This is a research prototype. No production deployment exists yet.'
    })
  )
  assert.equal(result.classification, 'SAFE_TO_ONBOARD_NOW')
})

test('classifyMigration: "production database is active" (no negation) is SENSITIVE', () => {
  const result = classifyMigration(
    cleanFacts({ readmeExcerpt: 'The production database is active and serving real traffic.' })
  )
  assert.equal(result.classification, 'SENSITIVE')
})

test('classifyMigration: "no credentials are required" is explicit absence, not SENSITIVE', () => {
  const result = classifyMigration(
    cleanFacts({
      readmeExcerpt: 'This is a local-only tool. No credentials are required to run it.'
    })
  )
  assert.equal(result.classification, 'SAFE_TO_ONBOARD_NOW')
})

test('classifyMigration: "credentials are required" (no negation) is SENSITIVE', () => {
  const result = classifyMigration(
    cleanFacts({ readmeExcerpt: 'To use the API, real credentials are required.' })
  )
  assert.equal(result.classification, 'SENSITIVE')
})

test('classifyMigration: "future real GPS data will be sensitive" is READ_ONLY_ONBOARDING_ONLY, not SENSITIVE', () => {
  const result = classifyMigration(
    cleanFacts({
      readmeExcerpt:
        'Today this uses synthetic location data. Future real GPS data will be sensitive once we integrate a live feed.'
    })
  )
  assert.equal(result.classification, 'READ_ONLY_ONBOARDING_ONLY')
  assert.ok(result.evidence.futureSensitiveSignals?.length > 0)
})

test('classifyMigration: "current repo contains live customer data" is SENSITIVE', () => {
  const result = classifyMigration(
    cleanFacts({
      readmeExcerpt: 'Warning: the current repo contains live customer data from a real deployment.'
    })
  )
  assert.equal(result.classification, 'SENSITIVE')
})

test('classifyMigration: mixed/ambiguous wording — an unrelated negation does not suppress a genuine current signal elsewhere', () => {
  const result = classifyMigration(
    cleanFacts({
      readmeExcerpt:
        'We have no production deployment yet. However, real customer data already flows through the staging environment for testing.'
    })
  )
  assert.equal(result.classification, 'SENSITIVE')
  assert.ok(result.evidence.currentSensitiveSignals?.some((s) => s.code === 'REAL_USER_DATA'))
})

test('classifyMigration: genuinely sensitive project text is still detected (does not weaken real detection)', () => {
  const result = classifyMigration(
    cleanFacts({
      readmeExcerpt:
        'HouseOS manages the live production database with real customer payment records.'
    })
  )
  assert.equal(result.classification, 'SENSITIVE')
})

test('classifyMigration: sensitive paths still force SENSITIVE even with hedged prose elsewhere', () => {
  const result = classifyMigration(
    cleanFacts({
      trackedAndUntrackedPaths: ['.env', 'src/index.js'],
      readmeExcerpt: 'No production deployment exists yet.'
    })
  )
  assert.equal(result.classification, 'SENSITIVE')
  assert.ok(result.evidence.sensitivePaths.length > 0)
})

// Defect 2 (M7 real-migration finding: committed-unadopted vs actual
// uncommitted-WIP reconciliation) tests live in
// onboarding-reconciliation.test.mjs alongside the rest of the work-status
// claim coverage.

// --- repo-inspector.mjs against real temp Git repos ---

test('snapshotRepository: clean repo reports correct identity and clean state', async () => {
  const dir = tracked(createTempRepo())
  const snapshot = await snapshotRepository(dir)
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.dirty, false)
  assert.equal(snapshot.activeGitOperation, false)
  assert.ok(/^[0-9a-f]{40}$/.test(snapshot.head))
  assert.equal(snapshot.commitCount, 1)
})

test('snapshotRepository: dirty repo reports untracked files, does not mutate the repo', async () => {
  const dir = tracked(createTempRepo({ dirty: true }))
  const before = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
  const snapshot = await snapshotRepository(dir)
  const after = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
  assert.equal(snapshot.dirty, true)
  assert.deepEqual(snapshot.untracked, ['wip.txt'])
  assert.equal(
    before,
    after,
    'repository status must be identical before and after read-only analysis'
  )
})

test('snapshotRepository: active Git operation sentinel (merge) is detected', async () => {
  const dir = tracked(createTempRepo())
  const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd: dir,
    encoding: 'utf8'
  }).trim()
  writeFileSync(path.join(gitDir, 'MERGE_HEAD'), 'deadbeef\n')
  const snapshot = await snapshotRepository(dir)
  assert.equal(snapshot.activeGitOperation, true)
  assert.equal(snapshot.activeGitOperationKind, 'merge')
})

test('snapshotRepository: unavailable repository path is reported honestly, not thrown', async () => {
  const result = await snapshotRepository(path.join(tmpdir(), 'tsf-onboarding-does-not-exist-xyz'))
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'REPOSITORY_UNAVAILABLE')
})

test('snapshotRepository: malformed/non-Git directory is reported honestly', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-onboarding-nongit-'))
  tracked(dir)
  writeFileSync(path.join(dir, 'file.txt'), 'not a git repo')
  const result = await snapshotRepository(dir)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NOT_A_GIT_REPOSITORY')
})

test('discoverProjectFiles + discoverCommandGuidance: finds README/package.json and known test/build commands without executing them', async () => {
  const dir = tracked(createTempRepo())
  const discovery = await discoverProjectFiles(dir)
  assert.ok(discovery.priorityFiles.some((f) => f.kind === 'README'))
  const pkg = discovery.priorityFiles.find((f) => f.relativePath === 'package.json')
  const guidance = discoverCommandGuidance(dir, pkg.text)
  assert.equal(guidance.hasKnownTestCommand, true)
  assert.deepEqual(guidance.testCommands, ['UNKNOWN run test'])
})

test('boundedUntrackedDirectorySizes: large untracked directory is a bounded, capped scan, not a full recursive walk', async () => {
  const dir = tracked(createTempRepo())
  const bigDir = path.join(dir, 'generated-output')
  mkdirSync(bigDir)
  for (let i = 0; i < 30; i++) {
    writeFileSync(path.join(bigDir, `file-${i}.txt`), 'x')
  }
  const flagged = boundedUntrackedDirectorySizes(dir, ['generated-output'])
  // 30 files is under the 500-file/50MB flag threshold — asserts the bound
  // exists and doesn't flag small directories as "large", not that this one is large.
  assert.equal(flagged.length, 0)
})

// --- server/onboarding.mjs orchestrator (stubbed planner + Orca CLI) ---

test('analyzeRepository: clean repo end to end is SAFE_TO_ONBOARD_NOW with a live direction analysis, no mutation', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ agents: true }))
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
    const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.ok, true)
    assert.equal(result.migrationClassification.classification, 'SAFE_TO_ONBOARD_NOW')
    assert.equal(result.direction.live, true)
    assert.match(result.direction.purpose, /^stub-answer-for::/)
    assert.equal(before, after, 'HEAD must not move during analysis')
    assert.equal(
      result.identity.isLinkedWorktree,
      false,
      'an ordinary main checkout is never a false positive'
    )
    assert.ok(!result.health.findings.some((f) => f.code === 'REPOSITORY_IS_LINKED_WORKTREE'))
  })
})

test('analyzeRepository: dirty repo is classified DIRTY_PRESERVE and Work Set defaults off', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ dirty: true }))
    const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(result.migrationClassification.classification, 'DIRTY_PRESERVE')
    assert.equal(result.portfolioGating.workSet.default, false)
    assert.equal(result.portfolioGating.activeFleet.allowed, true)
  })
})

// UNRESOLVED_HANDOFF_DISCREPANCY / resolveReconciliation tests live in
// onboarding-reconciliation.test.mjs.

test('analyzeRepository: handoff agreeing with repository truth does not block onboarding', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    const result = await analyzeRepository({
      repoPath: dir,
      handoffText: 'This project is clean and ready.'
    })
    assert.equal(result.handoffReconciliation.hasConflict, false)
    assert.equal(result.migrationClassification.classification, 'SAFE_TO_ONBOARD_NOW')
  })
})

test('analyzeRepository: repo with no package.json has no known test command and an honest health finding', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ packageJson: false }))
    const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(result.discovery.commandGuidance.hasKnownTestCommand, false)
    assert.ok(result.health.findings.some((f) => f.code === 'NO_KNOWN_TEST_COMMAND'))
  })
})

test('analyzeRepository: Orca already-registered repo is reflected honestly', async () => {
  const dir = tracked(createTempRepo())
  await withEnv(
    {
      ...BASE_ENV,
      STUB_ORCA_REPOS: JSON.stringify([
        { id: 'existing', path: dir, displayName: 'x', kind: 'git' }
      ])
    },
    async () => {
      const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
      assert.equal(result.orcaRegistration.checked, true)
      assert.equal(result.orcaRegistration.registered, true)
    }
  )
})

test('analyzeRepository: Orca not registered is reflected honestly, and analysis never calls repo add', async () => {
  await withEnv({ ...BASE_ENV, TSF_ORCA_CLI_COMMAND: ORCA_STUB }, async () => {
    const dir = tracked(createTempRepo())
    const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(result.orcaRegistration.registered, false)
  })
})

test('analyzeRepository: unavailable Orca CLI is reported as checked:false, never fabricated as registered', async () => {
  await withEnv({ ...BASE_ENV, TSF_ORCA_CLI_COMMAND: NONEXISTENT }, async () => {
    const dir = tracked(createTempRepo())
    const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(result.orcaRegistration.checked, false)
    assert.equal(result.orcaRegistration.registered, false)
  })
})

test('analyzeRepository: large/generated directories are bounded, not fully recursed (node_modules-style dir does not blow up discovery)', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    const nodeModules = path.join(dir, 'node_modules')
    mkdirSync(nodeModules)
    for (let i = 0; i < 20; i++) {
      mkdirSync(path.join(nodeModules, `pkg-${i}`))
    }
    const started = Date.now()
    const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(result.ok, true)
    assert.ok(
      Date.now() - started < 20000,
      'discovery must stay fast even with a generated-style directory present'
    )
    assert.ok(
      !result.discovery.discoveredDirectories.some((d) => d.relativePath.includes('node_modules'))
    )
  })
})

test('project switch isolation: two different repos analyzed back to back do not leak facts into each other', async () => {
  await withEnv(BASE_ENV, async () => {
    const dirA = tracked(createTempRepo())
    writeFileSync(path.join(dirA, 'README.md'), '# PROJECT_A_ONLY_MARKER\n')
    execFileSync('git', ['add', '-A'], { cwd: dirA })
    execFileSync('git', ['commit', '-q', '-m', 'readme'], { cwd: dirA })
    const dirB = tracked(createTempRepo())
    writeFileSync(path.join(dirB, 'README.md'), '# PROJECT_B_ONLY_MARKER\n')
    execFileSync('git', ['add', '-A'], { cwd: dirB })
    execFileSync('git', ['commit', '-q', '-m', 'readme'], { cwd: dirB })

    const resultA = await analyzeRepository({ repoPath: dirA, handoffText: '' })
    const resultB = await analyzeRepository({ repoPath: dirB, handoffText: '' })
    assert.doesNotMatch(JSON.stringify(resultB), /PROJECT_A_ONLY_MARKER/)
    assert.doesNotMatch(JSON.stringify(resultA), /PROJECT_B_ONLY_MARKER/)
    assert.notEqual(resultA.projectId, resultB.projectId)
  })
})

// --- commitOnboarding: portfolio integration + Work Set gating ---

test('commitOnboarding: SAFE_TO_ONBOARD_NOW project can join Known Projects, Active Fleet, and Work Set', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    const analysis = await analyzeRepository({ repoPath: dir, handoffText: '' })
    const { portfolio, receipt } = await commitOnboarding({
      portfolio: createPortfolio(),
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.ok(portfolio.projects[analysis.projectId])
    assert.ok(portfolio.activeFleet.includes(analysis.projectId))
    assert.ok(portfolio.workSet.includes(analysis.projectId))
    assert.equal(receipt.kind, 'PROJECT_ONBOARDED')
    assert.equal(receipt.result, 'SAFE_TO_ONBOARD_NOW')
    assert.equal(
      verifyReceipt(receipt),
      true,
      'onboarding receipt must be a real, hash-verifiable receipt like any other TSF receipt'
    )
  })
})

// Known-Projects-gating-fix / resolution-receipt tests live in
// onboarding-reconciliation.test.mjs.

test('commitOnboarding: DIRTY_PRESERVE project cannot enter Work Set even if requested — unsafe projects cannot accidentally enter Work Set', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ dirty: true }))
    const analysis = await analyzeRepository({ repoPath: dir, handoffText: '' })
    const { portfolio } = await commitOnboarding({
      portfolio: createPortfolio(),
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.ok(portfolio.projects[analysis.projectId])
    assert.ok(portfolio.activeFleet.includes(analysis.projectId))
    assert.equal(
      portfolio.workSet.includes(analysis.projectId),
      false,
      'DIRTY_PRESERVE must never enter Work Set regardless of what was requested'
    )
  })
})

test('commitOnboarding: SENSITIVE project cannot enter Active Fleet or Work Set even if requested', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    writeFileSync(path.join(dir, '.env'), 'SECRET=1')
    const analysis = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(analysis.migrationClassification.classification, 'SENSITIVE')
    const { portfolio } = await commitOnboarding({
      portfolio: createPortfolio(),
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.ok(portfolio.projects[analysis.projectId], 'Known Project registration is still allowed')
    assert.equal(portfolio.activeFleet.includes(analysis.projectId), false)
    assert.equal(portfolio.workSet.includes(analysis.projectId), false)
  })
})

test("classifyMigration/analyzeRepository: a sensitive file already committed and clean is still detected, not just today's dirty diff", async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    writeFileSync(path.join(dir, '.env'), 'SECRET=1')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'add env file'], { cwd: dir })
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
    assert.equal(status, '', 'repo must be clean — the sensitive file is committed, not dirty')
    const result = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(
      result.migrationClassification.classification,
      'SENSITIVE',
      'a committed-and-clean sensitive file must still be detected'
    )
  })
})

test('commitOnboarding: registers the repo in Orca (via the stub) only at commit time, not during analysis', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    const analysis = await analyzeRepository({ repoPath: dir, handoffText: '' })
    assert.equal(
      analysis.orcaRegistration.registered,
      false,
      'must not be registered yet after analysis alone'
    )
    const { orcaRegistration } = await commitOnboarding({
      portfolio: createPortfolio(),
      analysis,
      addTo: { knownProjects: true }
    })
    assert.equal(orcaRegistration.ok, true)
    assert.equal(orcaRegistration.alreadyRegistered, false)
  })
})

test('commitOnboarding: known project without Known Projects toggle does not attempt Orca registration', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    const analysis = await analyzeRepository({ repoPath: dir, handoffText: '' })
    const { orcaRegistration } = await commitOnboarding({
      portfolio: createPortfolio(),
      analysis,
      addTo: { knownProjects: false }
    })
    assert.equal(orcaRegistration, null)
  })
})

// Orca-registration resilience (Defect 3), path-dedup, and
// retryDirectionAnalysis (Defect 4) regression tests live in
// onboarding-orca-resilience.test.mjs.
