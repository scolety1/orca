// V1 stabilization: the onboarding/reconciliation deadlock (a handoff/live-
// repo conflict forced TIM_REQUIRED, which blocked even Known Projects, with
// no UI control anywhere to ever resolve it) plus the directly related
// WorldForge real-migration findings (structured "Key: `value`" handoff
// claims, repository-identity mismatch, linked-worktree detection). Split
// out of onboarding.test.mjs to stay under the repo's max-lines cap.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  classifyMigration,
  portfolioGatingForClassification,
  reconcileHandoff,
  isLinkedWorktreeGitDir
} from '../domain/onboarding.mjs'
import { createPortfolio } from '../domain/portfolio.mjs'
import {
  analyzeRepository,
  commitOnboarding,
  resolveReconciliation
} from '../server/onboarding.mjs'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo({ dirty = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-reconciliation-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# Test Project\n')
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

// V1 stabilization finding (onboarding reconciliation deadlock): an
// ordinary current-state handoff/repo conflict no longer forces TIM_REQUIRED
// — that gating blocked even Known Projects with no UI control to ever
// resolve it. Genuine identity ambiguity (handoffIdentityAmbiguous) is the
// only case that still fully blocks; see the dedicated test below.
test('classifyMigration: an ordinary handoff/repo conflict is UNRESOLVED_HANDOFF_DISCREPANCY, not TIM_REQUIRED', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: true,
    handoffIdentityAmbiguous: false,
    handoffConflictSummary: 'HEAD mismatch'
  })
  assert.equal(result.classification, 'UNRESOLVED_HANDOFF_DISCREPANCY')
})

test('classifyMigration: a genuinely identity-ambiguous handoff conflict is still TIM_REQUIRED', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: true,
    handoffIdentityAmbiguous: true,
    handoffConflictSummary: 'neither claimed branch nor commit found'
  })
  assert.equal(result.classification, 'TIM_REQUIRED')
})

// V1 stabilization finding (KNOWN-PROJECTS GATING requirement): Known
// Projects is a low-authority operation and must stay available for an
// ordinary unresolved discrepancy — only genuine identity ambiguity
// (TIM_REQUIRED) should block it too.
test('portfolioGatingForClassification: UNRESOLVED_HANDOFF_DISCREPANCY allows Known Projects but blocks Active Fleet and Work Set', () => {
  const gating = portfolioGatingForClassification('UNRESOLVED_HANDOFF_DISCREPANCY')
  assert.equal(gating.knownProjects.allowed, true)
  assert.equal(gating.knownProjects.default, true)
  assert.equal(gating.activeFleet.allowed, false)
  assert.equal(gating.workSet.allowed, false)
})

test('portfolioGatingForClassification: TIM_REQUIRED (genuine identity ambiguity) still blocks Known Projects too', () => {
  const gating = portfolioGatingForClassification('TIM_REQUIRED')
  assert.equal(gating.knownProjects.allowed, false)
})

// --- V1 stabilization finding: onboarding reconciliation deadlock ---
// (Review had a TIM_REQUIRED classification with no UI control anywhere to
// ever resolve it, and no structured competing evidence to render one
// against.)

test('reconcileHandoff: a working-tree conflict produces structured LIVE_REPO-vs-HANDOFF evidence, not just a sentence', () => {
  const result = reconcileHandoff({
    handoffText: 'The repository is clean.',
    repoFacts: { dirty: true, untrackedCount: 2, head: 'abc123def456', branch: 'main' }
  })
  assert.equal(result.discrepancyDetails.length, 1)
  const [detail] = result.discrepancyDetails
  assert.equal(detail.field, 'workingTree')
  assert.equal(detail.liveRepo.value, 'dirty')
  assert.equal(detail.handoff.value, 'clean')
})

test('reconcileHandoff: an ordinary branch mismatch (branch exists locally) is not identity-ambiguous', () => {
  const result = reconcileHandoff({
    handoffText: 'Branch feature/old is clean.',
    repoFacts: {
      dirty: false,
      head: 'abc123',
      branch: 'main',
      localBranches: [{ name: 'main' }, { name: 'feature/old' }]
    }
  })
  assert.equal(result.identityAmbiguous, false)
})

test('reconcileHandoff: a claimed branch that does not exist anywhere is a discrepancy but not, by itself, identity-ambiguous (no commit claim to also fail)', () => {
  const result = reconcileHandoff({
    handoffText: 'Branch feature/ghost is clean.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main', localBranches: [{ name: 'main' }] }
  })
  assert.equal(result.hasConflict, true)
  assert.equal(result.identityAmbiguous, false)
})

test('reconcileHandoff: identityAmbiguous is true only when NEITHER the claimed branch NOR the claimed commit can be located anywhere in this repository', () => {
  const result = reconcileHandoff({
    handoffText: 'Branch feature/ghost is clean at commit 1234567890ab.',
    repoFacts: {
      dirty: false,
      head: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      branch: 'main',
      localBranches: [{ name: 'main' }],
      recentCommits: [
        { sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' },
        { sha: 'fedcbafedcbafedcbafedcbafedcbafedcbafedc' }
      ]
    }
  })
  assert.equal(result.hasConflict, true)
  assert.equal(result.identityAmbiguous, true)
})

test('reconcileHandoff: a claimed commit found in recent history (not just current HEAD) is not a discrepancy', () => {
  const result = reconcileHandoff({
    handoffText: 'Last experimental commit at 1234567890ab.',
    repoFacts: {
      dirty: false,
      head: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      branch: 'main',
      recentCommits: [
        { sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' },
        { sha: '1234567890abcdef1234567890abcdef12345678' }
      ]
    }
  })
  assert.equal(result.hasConflict, false)
})

test('reconcileHandoff: USE_LIVE_REPO_FOR_CURRENT_STATE resolves the conflict but preserves the raw discrepancy as history', () => {
  const result = reconcileHandoff({
    handoffText: 'The repository is clean.',
    repoFacts: { dirty: true, untrackedCount: 2, head: 'abc123', branch: 'main' },
    resolution: { mode: 'USE_LIVE_REPO_FOR_CURRENT_STATE' }
  })
  assert.equal(result.hasConflict, true, 'the raw discrepancy is never erased')
  assert.equal(
    result.effectiveConflict,
    false,
    'but it no longer blocks classification once resolved'
  )
  assert.equal(result.resolution.mode, 'USE_LIVE_REPO_FOR_CURRENT_STATE')
})

test('reconcileHandoff: USE_HANDOFF resolves the conflict for classification purposes without changing any live-repo fact', () => {
  const result = reconcileHandoff({
    handoffText: 'The repository is clean.',
    repoFacts: { dirty: true, untrackedCount: 2, head: 'abc123', branch: 'main' },
    resolution: { mode: 'USE_HANDOFF' }
  })
  assert.equal(result.effectiveConflict, false)
  // Repository truth is never overridden — discrepancyDetails still report the real live state.
  assert.equal(result.discrepancyDetails[0].liveRepo.value, 'dirty')
})

test('reconcileHandoff: KEEP_UNRESOLVED explicitly preserves the block, same as no resolution at all', () => {
  const result = reconcileHandoff({
    handoffText: 'The repository is clean.',
    repoFacts: { dirty: true, untrackedCount: 2, head: 'abc123', branch: 'main' },
    resolution: { mode: 'KEEP_UNRESOLVED' }
  })
  assert.equal(result.effectiveConflict, true)
})

// Real V1 stabilization finding (silent-visual-speech-spike real migration
// replay): "Restricted NASA evaluation media stayed local and uncommitted"
// matched the bare word "uncommitted" and was misread as live, possibly-lost
// SOURCE work — it describes deliberately-excluded evaluation data, governed
// by licensing, not code. This is the exact real sentence from that repo's
// PROJECT_HQ.md handoff.
test('reconcileHandoff: a handoff describing restricted/licensed data or media left "uncommitted" on purpose is not a lost-work discrepancy', () => {
  const result = reconcileHandoff({
    handoffText:
      'Licensing was not product-cleared. Restricted NASA evaluation media stayed local and uncommitted.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, false)
})

test('reconcileHandoff: a genuine uncommitted-source-work claim next to an unrelated restricted-media claim is still flagged (the exclusion does not overreach)', () => {
  const result = reconcileHandoff({
    handoffText:
      'Restricted evaluation media stayed local and uncommitted. Separately, there are uncommitted changes to src/model.py that have not been pushed.',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main' }
  })
  assert.equal(result.hasConflict, true)
  assert.match(result.discrepancies.join(' '), /uncommitted/i)
})

// Real V1 stabilization findings (WorldForge real-migration replay): the
// original prose-only extraction patterns never recognized common
// structured "Key: `value`" documentation headers at all, so real
// branch/commit/repository claims in that style went completely unchecked.

test('reconcileHandoff: a structured "Branch: `X`" header line is recognized without requiring a "clean" claim nearby', () => {
  const result = reconcileHandoff({
    handoffText:
      '- Repository: `C:/elsewhere/other-repo`\n- Branch: `work/some-other-feature-20260101`\n- Implementation checkpoint: `deadbeefcafe0123456789abcdef01234567`',
    repoFacts: {
      dirty: false,
      head: 'abc123',
      branch: 'main',
      root: 'C:/elsewhere/other-repo',
      localBranches: [{ name: 'main' }]
    }
  })
  assert.ok(
    result.claims.some(
      (c) => c.field === 'branch' && c.claimed === 'work/some-other-feature-20260101'
    )
  )
  assert.match(result.discrepancies.join(' '), /work\/some-other-feature-20260101/)
})

test('reconcileHandoff: a colon/backtick-delimited commit claim ("Last experimental commit: `sha`") is now recognized (previously never matched)', () => {
  const result = reconcileHandoff({
    handoffText: 'Last experimental commit: `1234567890abcdef1234567890abcdef12345678`.',
    repoFacts: {
      dirty: false,
      head: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      branch: 'main',
      recentCommits: [{ sha: '1234567890abcdef1234567890abcdef12345678' }]
    }
  })
  assert.ok(result.claims.some((c) => c.field === 'head'))
  assert.equal(
    result.hasConflict,
    false,
    'the claimed commit is genuinely in recent history, so this is not a discrepancy'
  )
})

test('reconcileHandoff: a handoff explicitly naming a DIFFERENT repository path is a real discrepancy and genuine identity ambiguity', () => {
  const result = reconcileHandoff({
    handoffText:
      '- Repository: `C:\\Users\\codex-agent\\Documents\\Worldforge-Sablewake-Player-Surface-V2`\n- Branch: `work/worldforge-sablewake-topdown-living-player-surface-v1-20260813`',
    repoFacts: {
      dirty: false,
      head: '7ba554fccf84797c31455fb4774888d5f185205c',
      branch: 'work/worldforge-npc-interior-movement-bellharbor-plan-v1-20260817',
      root: 'C:\\Users\\codex-agent\\Documents\\Worldforge-NPC-Interior-Movement-Bellharbor-Plan-V1',
      localBranches: [{ name: 'work/worldforge-npc-interior-movement-bellharbor-plan-v1-20260817' }]
    }
  })
  assert.equal(result.hasConflict, true)
  assert.equal(
    result.identityAmbiguous,
    true,
    'a claimed different repository is the strongest possible identity signal'
  )
  assert.match(result.discrepancies.join(' '), /Worldforge-Sablewake-Player-Surface-V2/)
})

test('reconcileHandoff: a matching repository path claim is an agreement, not a discrepancy', () => {
  const result = reconcileHandoff({
    handoffText: '- Repository: `C:/Users/tim/project`',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main', root: 'C:/Users/tim/project' }
  })
  assert.equal(result.hasConflict, false)
  assert.ok(result.agreements.some((a) => /repository path/i.test(a)))
})

test('reconcileHandoff: a repository-mismatch conflict is resolvable the same way as any other, preserving the handoff as history', () => {
  const result = reconcileHandoff({
    handoffText: '- Repository: `C:/elsewhere/other-repo`',
    repoFacts: { dirty: false, head: 'abc123', branch: 'main', root: 'C:/here/this-repo' },
    resolution: { mode: 'USE_LIVE_REPO_FOR_CURRENT_STATE' }
  })
  assert.equal(result.hasConflict, true)
  assert.equal(result.effectiveConflict, false)
})

// Real V1 stabilization finding (WorldForge real-migration case): the
// selected repository can be a linked Git worktree (a bounded workstream),
// not the project's canonical checkout — `.git` is a file there, not a
// directory, and `git rev-parse --absolute-git-dir` reports a path under
// `<main-repo>/.git/worktrees/<name>`.
test('isLinkedWorktreeGitDir: a linked-worktree gitDir path is detected', () => {
  assert.equal(
    isLinkedWorktreeGitDir('C:\\Users\\tim\\Documents\\main-repo\\.git\\worktrees\\feature-branch'),
    true
  )
  assert.equal(isLinkedWorktreeGitDir('/home/tim/main-repo/.git/worktrees/feature-branch'), true)
})

test('isLinkedWorktreeGitDir: a plain main-checkout gitDir path is not a linked worktree', () => {
  assert.equal(isLinkedWorktreeGitDir('C:\\Users\\tim\\Documents\\my-repo\\.git'), false)
  assert.equal(isLinkedWorktreeGitDir('/home/tim/my-repo/.git'), false)
  assert.equal(isLinkedWorktreeGitDir(null), false)
  assert.equal(isLinkedWorktreeGitDir(undefined), false)
})

// --- server/onboarding.mjs: resolution end-to-end (stubbed planner + Orca) ---

test('analyzeRepository: handoff conflicting with repository truth surfaces the discrepancy as UNRESOLVED_HANDOFF_DISCREPANCY, and Known Projects stays allowed', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ dirty: true }))
    const result = await analyzeRepository({
      repoPath: dir,
      handoffText: 'The repository is clean and ready to go.'
    })
    assert.equal(result.handoffReconciliation.hasConflict, true)
    assert.equal(result.migrationClassification.classification, 'UNRESOLVED_HANDOFF_DISCREPANCY')
    assert.equal(result.portfolioGating.knownProjects.allowed, true)
    assert.equal(result.portfolioGating.activeFleet.allowed, false)
  })
})

test('analyzeRepository: resolving the conflict with USE_LIVE_REPO_FOR_CURRENT_STATE lets classification proceed to the underlying repo state', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ dirty: true }))
    const result = await analyzeRepository({
      repoPath: dir,
      handoffText: 'The repository is clean and ready to go.',
      resolution: { mode: 'USE_LIVE_REPO_FOR_CURRENT_STATE' }
    })
    assert.equal(
      result.handoffReconciliation.hasConflict,
      true,
      'the raw discrepancy is preserved as history'
    )
    assert.equal(result.handoffReconciliation.effectiveConflict, false)
    assert.equal(
      result.migrationClassification.classification,
      'DIRTY_PRESERVE',
      'falls through to the real repo state once the conflict no longer blocks'
    )
  })
})

test('resolveReconciliation: a standalone resolve call re-classifies without re-running discovery/health-independent facts twice or requiring a full re-analysis', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ dirty: true }))
    const result = await resolveReconciliation({
      repoPath: dir,
      handoffText: 'The repository is clean and ready to go.',
      resolution: { mode: 'USE_LIVE_REPO_FOR_CURRENT_STATE' }
    })
    assert.equal(result.ok, true)
    assert.equal(result.migrationClassification.classification, 'DIRTY_PRESERVE')
    assert.equal(result.portfolioGating.activeFleet.allowed, true)
    assert.equal(result.handoffReconciliation.resolution.mode, 'USE_LIVE_REPO_FOR_CURRENT_STATE')
  })
})

test('resolveReconciliation: an invalid resolution mode is rejected honestly, not silently ignored', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    const result = await resolveReconciliation({
      repoPath: dir,
      handoffText: 'clean',
      resolution: { mode: 'NOT_A_REAL_MODE' }
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'INVALID_RESOLUTION_MODE')
  })
})

// V1 stabilization finding: Known Projects gating was only enforced by the
// Review screen's checkbox `disabled` attribute, never by the server itself
// — unlike Active Fleet/Work Set, which were already checked here.
test('commitOnboarding: server enforces Known Projects gating too — a genuinely identity-ambiguous project cannot become Known even if requested', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo())
    const analysis = await analyzeRepository({
      repoPath: dir,
      handoffText:
        'Branch feature/ghost-ambiguous is clean. Handoff was captured at commit deadbeefcafe0123456789abcdef01234567.'
    })
    assert.equal(analysis.migrationClassification.classification, 'TIM_REQUIRED')
    assert.equal(analysis.portfolioGating.knownProjects.allowed, false)
    const { portfolio, receipt } = await commitOnboarding({
      portfolio: createPortfolio(),
      analysis,
      addTo: { knownProjects: true, activeFleet: true, workSet: true }
    })
    assert.equal(
      !!portfolio.projects[analysis.projectId],
      false,
      'server must not record a project it judged identity-ambiguous, even if the client asked to'
    )
    assert.deepEqual(JSON.parse(receipt.decision).addedTo, {
      knownProjects: false,
      activeFleet: false,
      workSet: false
    })
  })
})

test('commitOnboarding: UNRESOLVED_HANDOFF_DISCREPANCY can still join Known Projects, and the receipt records the resolution choice', async () => {
  await withEnv(BASE_ENV, async () => {
    const dir = tracked(createTempRepo({ dirty: true }))
    const analysis = await analyzeRepository({
      repoPath: dir,
      handoffText: 'The repository is clean and ready to go.',
      resolution: { mode: 'KEEP_UNRESOLVED' }
    })
    assert.equal(analysis.migrationClassification.classification, 'UNRESOLVED_HANDOFF_DISCREPANCY')
    const { portfolio, receipt } = await commitOnboarding({
      portfolio: createPortfolio(),
      analysis,
      addTo: { knownProjects: true }
    })
    assert.ok(portfolio.projects[analysis.projectId])
    assert.equal(JSON.parse(receipt.decision).reconciliationResolution.mode, 'KEEP_UNRESOLVED')
  })
})
