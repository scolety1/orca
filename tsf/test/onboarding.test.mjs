import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
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
import {
  analyzeRepository,
  commitOnboarding,
  refreshOrcaRegistrationStatus,
  retryDirectionAnalysis
} from '../server/onboarding.mjs'
import { findRegisteredOrcaRepo } from '../adapters/orca-cli-bridge.mjs'

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

// --- Defect 2 (M7 real-migration finding): committed-unadopted vs actual ---
// uncommitted-WIP reconciliation. The original detector treated any mention
// of "committed"/"uncommitted"/"WIP" identically, so "committed YELLOW
// research" against a clean repo was flagged as if real work might be lost.

test('reconcileHandoff: clean repo + handoff says committed candidate is an agreement, not a discrepancy', () => {
  const result = reconcileHandoff({
    handoffText:
      'The research was committed as a YELLOW candidate but has not been adopted into main.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, false)
  assert.ok(result.agreements.some((a) => /committed-but-unadopted/i.test(a)))
})

test('reconcileHandoff: clean repo + handoff says uncommitted files is still a real discrepancy', () => {
  const result = reconcileHandoff({
    handoffText: 'There are several uncommitted files with in-progress edits.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, true)
  assert.match(result.discrepancies.join(' '), /uncommitted/i)
})

test('reconcileHandoff: dirty repo + handoff says clean is still a real discrepancy', () => {
  const result = reconcileHandoff({
    handoffText: 'The repository is clean.',
    repoFacts: { dirty: true, untrackedCount: 2, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, true)
  assert.match(result.discrepancies.join(' '), /dirty/i)
})

test('reconcileHandoff: branch containing unadopted commits is recognized when it exists locally, even if not checked out', () => {
  const result = reconcileHandoff({
    handoffText: 'Branch feature/unadopted-research is clean.',
    repoFacts: {
      dirty: false,
      head: 'abc123',
      branch: 'main',
      localBranches: [{ name: 'main' }, { name: 'feature/unadopted-research' }]
    }
  })
  assert.equal(result.hasConflict, false)
  assert.ok(result.agreements.some((a) => /feature\/unadopted-research/.test(a)))
})

test('reconcileHandoff: a claimed branch that genuinely does not exist anywhere is still a real discrepancy', () => {
  const result = reconcileHandoff({
    handoffText: 'Branch feature/ghost is clean.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main', localBranches: [{ name: 'main' }] }
  })
  assert.equal(result.hasConflict, true)
  assert.match(result.discrepancies.join(' '), /feature\/ghost/)
})

test('reconcileHandoff: planned work only is neither a discrepancy nor forced agreement against a clean repo', () => {
  const result = reconcileHandoff({
    handoffText: 'A GPS integration is planned as future work; nothing has been implemented yet.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, false)
})

test('reconcileHandoff: historical WIP terminology that does not describe current Git state is not a false discrepancy', () => {
  const result = reconcileHandoff({
    handoffText:
      'The WIP research phase concluded and was committed as YELLOW research for later review.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, false)
})

// Independent-review finding (post-adoption hardening): a handoff mentioning
// a committed-unadopted claim in one sentence must not silently swallow a
// genuine uncommitted-work claim made in a different sentence -- each claim
// is judged per-clause, not from a single whole-text classification that
// only keeps the first match it happens to find.
test('reconcileHandoff: a genuine uncommitted-work claim is still flagged even when an unrelated committed-candidate claim also appears in the handoff', () => {
  const result = reconcileHandoff({
    handoffText:
      'The research was committed as a candidate but has not been adopted. Separately, there are uncommitted debugging changes on disk that have not been committed yet.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, true)
  assert.match(result.discrepancies.join(' '), /uncommitted/i)
  assert.ok(result.agreements.some((a) => /committed-but-unadopted/i.test(a)))
})

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

test('findRegisteredOrcaRepo: case-normalized path variants resolve to the same real repo, not a duplicate', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success' }, async () => {
    const dir = tracked(mkdtempSync(path.join(tmpdir(), 'tsf-dedupe-')))
    await withEnv(
      {
        STUB_ORCA_REPOS: JSON.stringify([
          { id: 'x', path: dir.toUpperCase(), displayName: 'x', kind: 'git' }
        ])
      },
      async () => {
        const result = await findRegisteredOrcaRepo(dir)
        assert.equal(result.ok, true)
        assert.equal(
          result.registered,
          true,
          'an uppercase/lowercase path variant of the same real directory must match, not register a duplicate'
        )
      }
    )
  })
})

test('findRegisteredOrcaRepo: Windows 8.3 short-name path variants resolve to the same real repo (regression for realpathSync.native)', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success' }, async () => {
    const dir = tracked(mkdtempSync(path.join(tmpdir(), 'tsf-dedupe83-')))
    const longForm = realpathSync.native(dir)
    if (longForm === dir) {
      return // this machine's tmpdir() isn't 8.3-short-form here; the case-normalization test above still covers the mechanism
    }
    await withEnv(
      {
        STUB_ORCA_REPOS: JSON.stringify([
          { id: 'x', path: longForm, displayName: 'x', kind: 'git' }
        ])
      },
      async () => {
        const result = await findRegisteredOrcaRepo(dir) // query with the short form
        assert.equal(result.ok, true)
        assert.equal(
          result.registered,
          true,
          '8.3 short-name and long-name forms of the same real directory must match, not register a duplicate'
        )
      }
    )
  })
})

// --- Defect 3 (M7 real-migration finding): Orca status resilience ---
// Real Route Reader onboarding report: "Orca: unknown (Orca unreachable)"
// even though TSF itself is hosted inside a genuinely-running Orca. A single
// transient `orca repo list` failure must not collapse into the same
// "unavailable" shown when Orca genuinely isn't installed at all.

test('findRegisteredOrcaRepo: a transient timeout recovers via one bounded retry, reported as REGISTERED', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-orca-flaky-'))
  const counterFile = path.join(dir, 'flaky-counter')
  const repoDir = createTempRepo()
  tracked(repoDir)
  try {
    await withEnv(
      {
        TSF_ORCA_CLI_COMMAND: ORCA_STUB,
        STUB_ORCA_MODE: 'flaky-then-success',
        STUB_ORCA_FLAKY_COUNTER_FILE: counterFile,
        STUB_ORCA_REPOS: JSON.stringify([{ id: 'r1', path: repoDir, displayName: 'r1' }]),
        TSF_ORCA_CLI_TIMEOUT_MS: '300'
      },
      async () => {
        const result = await findRegisteredOrcaRepo(repoDir)
        assert.equal(result.ok, true)
        assert.equal(result.registered, true)
        assert.equal(result.status, 'REGISTERED')
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findRegisteredOrcaRepo: a persistent failure is reported as ORCA_TEMPORARILY_UNAVAILABLE, not silently retried forever', async () => {
  await withEnv(
    { TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'error', TSF_ORCA_CLI_TIMEOUT_MS: '300' },
    async () => {
      const result = await findRegisteredOrcaRepo('/tmp/whatever')
      assert.equal(result.ok, false)
      assert.equal(result.status, 'ORCA_TEMPORARILY_UNAVAILABLE')
    }
  )
})

// Note: reaching CLI_UNAVAILABLE (-> status ORCA_UNKNOWN) specifically
// requires resolveEntry() to find no candidate at all; candidateEntries()'s
// final fallback candidate ({ command: 'orca' }) is unconditionally accepted
// by resolveEntry()'s own `candidate.command === 'orca'` check regardless of
// whether it actually exists on PATH, so a bad/missing binary is always
// reported via a real spawn attempt (SPAWN_ERROR -> ORCA_TEMPORARILY_UNAVAILABLE)
// rather than CLI_UNAVAILABLE in practice — pre-existing resolveEntry
// behavior, out of scope for this fix. The mapping itself is still correct
// and exercised by the SPAWN_ERROR case below.
test('findRegisteredOrcaRepo: a missing/unresolvable CLI binary never fabricates a registered result', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: NONEXISTENT }, async () => {
    const result = await findRegisteredOrcaRepo('/tmp/whatever')
    assert.equal(result.ok, false)
    assert.equal(result.registered, undefined)
    assert.ok(['ORCA_TEMPORARILY_UNAVAILABLE', 'ORCA_UNKNOWN'].includes(result.status))
  })
})

test('findRegisteredOrcaRepo: a genuinely not-registered repo is reported as NOT_REGISTERED, distinct from any unavailable status', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv(
    { TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success', STUB_ORCA_REPOS: '[]' },
    async () => {
      const result = await findRegisteredOrcaRepo(repoDir)
      assert.equal(result.ok, true)
      assert.equal(result.registered, false)
      assert.equal(result.status, 'NOT_REGISTERED')
    }
  )
})

test('refreshOrcaRegistrationStatus: re-checks Orca registration alone, without re-running discovery/health/migration/the planner', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv(
    {
      TSF_ORCA_CLI_COMMAND: ORCA_STUB,
      STUB_ORCA_MODE: 'success',
      STUB_ORCA_REPOS: JSON.stringify([{ id: 'r1', path: repoDir, displayName: 'r1' }])
    },
    async () => {
      const result = await refreshOrcaRegistrationStatus(repoDir)
      assert.equal(result.ok, true)
      assert.equal(result.orcaRegistration.registered, true)
      assert.equal(result.orcaRegistration.status, 'REGISTERED')
      // Only the orca registration shape — no repository/health/migration/direction facts.
      assert.deepEqual(Object.keys(result).sort(), ['ok', 'orcaRegistration'])
    }
  )
})

test('analyzeRepository: a transient Orca hiccup never changes Health or migration classification', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  const healthyRun = await withEnv(
    {
      ...BASE_ENV,
      TSF_ORCA_CLI_COMMAND: ORCA_STUB,
      STUB_ORCA_MODE: 'success',
      STUB_ORCA_REPOS: '[]'
    },
    () => analyzeRepository({ repoPath: repoDir })
  )
  const orcaDownRun = await withEnv(
    {
      ...BASE_ENV,
      TSF_ORCA_CLI_COMMAND: ORCA_STUB,
      STUB_ORCA_MODE: 'error',
      TSF_ORCA_CLI_TIMEOUT_MS: '300'
    },
    () => analyzeRepository({ repoPath: repoDir })
  )
  assert.equal(orcaDownRun.ok, true)
  // Health and migration classification come from Git/filesystem facts
  // alone, computed before the Orca check is ever awaited — a transient
  // Orca outage must produce identical results for both (aside from the
  // observedAt timestamp, which naturally differs between the two calls).
  assert.deepEqual(
    { ...orcaDownRun.health, observedAt: null },
    { ...healthyRun.health, observedAt: null }
  )
  assert.deepEqual(orcaDownRun.migrationClassification, healthyRun.migrationClassification)
  assert.equal(orcaDownRun.orcaRegistration.checked, false)
  assert.equal(orcaDownRun.orcaRegistration.status, 'ORCA_TEMPORARILY_UNAVAILABLE')
  assert.notEqual(orcaDownRun.orcaRegistration.status, healthyRun.orcaRegistration.status)
})

// --- Defect 4 (M7 real-migration finding): retryDirectionAnalysis re-runs ---
// only the live planner call, never re-persisting or re-checking Orca.

test('retryDirectionAnalysis: re-runs only the planner call against freshly-read repo facts', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv(BASE_ENV, async () => {
    const result = await retryDirectionAnalysis({ repoPath: repoDir })
    assert.equal(result.ok, true)
    assert.equal(result.direction.live, true)
    assert.deepEqual(Object.keys(result).sort(), ['direction', 'ok'])
  })
})

test('retryDirectionAnalysis: a persistent planner failure is an honest fallback, never a fabricated mission', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv({ ...BASE_ENV, STUB_MODE: 'provider-error' }, async () => {
    const result = await retryDirectionAnalysis({ repoPath: repoDir })
    assert.equal(result.ok, true)
    assert.equal(result.direction.live, false)
    assert.equal(result.direction.recommendedNextMission, null)
  })
})
