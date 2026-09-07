// CAPSTONE (Phase 10, own-initiative adversarial scenario): does stacking
// multiple independent hazards on the SAME target confuse the blocker
// pipeline into a false allow, or does refusing for "the first reason
// found" mean a second, unrelated hazard goes unnoticed and could survive
// past a fix to the first? Two real proofs:
//
// 1. A real worktree fixture with TWO genuinely independent, simultaneous
//    hazards (uncommitted dirty tree + a real non-COMPLETE planner mission
//    referencing it) run through the full runGovernedCleanupAction pipeline
//    -- every existing adversarial test only ever stacks ONE hazard at a
//    time onto an otherwise-perfect fixture.
// 2. domain/cleanup-safety-blockers.mjs's evaluateCleanupBlockers has no
//    early return anywhere in its body (read in full) -- every field is
//    independently evaluated and appended to `blockers`, so refusal is
//    never "the first blocking reason found" in the first place; it is
//    "every blocking reason found." Proven directly by forcing every
//    blockable field hazardous at once and asserting all of them surface.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { evaluateCleanupBlockers } from '../domain/cleanup-safety-blockers.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-stacked-blockers-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
const QUARANTINE_DIR = path.join(HERE, '..', 'server', '.local-state', `cleanup-quarantine-test-stacked-blockers-${process.pid}`)
process.env.TSF_CLEANUP_QUARANTINE_DIR = QUARANTINE_DIR

const { runGovernedCleanupAction } = await import('../server/cleanup-executor.mjs')
const { mutateCheckpoint } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint } = await import('../domain/planner-mission-checkpoint.mjs')

function cleanupIsolatedState() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock', '.cleanup-request.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
  rmSync(QUARANTINE_DIR, { recursive: true, force: true })
}
cleanupIsolatedState()
test.after(cleanupIsolatedState)

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-stacked-blockers-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))
const clock = () => new Date('2026-09-06T12:00:00.000Z')
const openGate = () => ({ open: true, reason: 'test-injected open gate (real global gate never touched)' })

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

test('CAPSTONE 1/2: dirty worktree + stale/sleeping mission reference STACKED on the same real target -- refused, worktree untouched, BOTH real hazards visible in the blocker detail (neither masks the other)', async () => {
  const repo = path.join(ROOT, 'repo-stacked')
  git(ROOT, ['init', '-q', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'fixture@example.com'])
  git(repo, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(repo, 'README.md'), 'root\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'initial'])
  const worktreePath = path.join(ROOT, 'repo-stacked-linked')
  git(repo, ['worktree', 'add', '-q', '-b', 'tsf/feature/stacked-hazards', worktreePath])

  // Hazard 1: a real dirty tree (uncommitted, untracked file).
  writeFileSync(path.join(worktreePath, 'uncommitted.txt'), 'not committed')

  // Hazard 2: a real, durable, non-COMPLETE planner mission referencing this
  // exact branch (the "sleeping unfinished mission" mechanism).
  const missionId = 'mission:cleanup-stacked-hazards'
  await mutateCheckpoint(
    missionId,
    () =>
      createPlannerMissionCheckpoint(
        { missionId, missionGoal: 'a lane that is both dirty and unfinished', phase: 'BUILD', repoState: { branch: 'tsf/feature/stacked-hazards', sha: 'e'.repeat(40), worktreePath } },
        clock
      ),
    clock
  )

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_DISPOSABLE_WORKTREE',
    targetIdentity: { realPath: worktreePath, branch: 'tsf/feature/stacked-hazards' },
    rationale: 'stacked-hazard capstone: two real, independent blockers on one target',
    mutationParams: { repoRoot: repo },
    safetyOptions: { checkGit: true },
    gateCheck: openGate,
    clock
  })

  assert.equal(outcome.status, 'AUTHORIZATION_REFUSED', 'refused for a real reason, not a guess')
  assert.equal(existsSync(worktreePath), true, 'nothing real may ever be mutated while ANY blocker is present')
  assert.equal(existsSync(path.join(worktreePath, 'uncommitted.txt')), true)
  const codes = outcome.blockers.map((b) => b.code)
  assert.ok(codes.includes('DIRTY_WORKTREE'), `dirty-worktree hazard must surface even with a second hazard also present: ${codes}`)
  assert.ok(codes.includes('ACTIVE_MISSION_REFERENCE'), `active-mission hazard must surface even with a second hazard also present: ${codes}`)
})

test('CAPSTONE 2/2: evaluateCleanupBlockers has no first-match-wins short-circuit -- every one of 7 simultaneous real-shaped hazards surfaces independently, never suppressed by another', () => {
  const clockFn = () => new Date('2026-09-06T12:00:00.000Z')
  const allHazardous = {
    evidenceObservedAt: clockFn().toISOString(),
    protectedPath: true,
    protectedBranch: true,
    isMainWorktree: true,
    git: { clean: false },
    activeMissionReferenced: true,
    sessionLive: true,
    fileLocked: true
  }
  const result = evaluateCleanupBlockers(allHazardous, clockFn)
  assert.equal(result.blocked, true)
  assert.equal(result.tier, 'PROTECTED')
  const codes = new Set(result.blockers.map((b) => b.code))
  const expectedCodes = ['PROTECTED_PATH', 'PROTECTED_BRANCH', 'CANONICAL_MAIN_WORKTREE', 'DIRTY_WORKTREE', 'ACTIVE_MISSION_REFERENCE', 'ACTIVE_SESSION_LIVE', 'FILE_HANDLE_LOCKED']
  for (const code of expectedCodes) {
    assert.ok(codes.has(code), `${code} must independently surface among 7 simultaneous hazards, not be suppressed by another: ${[...codes]}`)
  }
  assert.equal(result.blockers.length, expectedCodes.length, 'no hazard is silently dropped or double-counted when every field is hazardous at once')

  // Removing the single highest-priority-sounding hazard (protectedPath)
  // must not "clear" the others -- proves this is real accumulation, not a
  // priority ladder that stops once one match is found.
  const withoutProtectedPath = evaluateCleanupBlockers({ ...allHazardous, protectedPath: false }, clockFn)
  assert.equal(withoutProtectedPath.blocked, true)
  assert.equal(withoutProtectedPath.blockers.length, expectedCodes.length - 1)
})
