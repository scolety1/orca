// Wave D Phase 10, chaos scenario 9: canonical tsf/main genuinely advances
// (a real, unrelated commit lands) BETWEEN real mission origination and
// real worker dispatch -- proves the worker still forks from the CURRENT
// canonical HEAD, not a stale snapshot recorded at origination time, and
// the mechanism does not corrupt or misapply against the drift.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-chaos-stale-main-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { applyAutofixEligibility } = await import('../domain/self-improvement-autofix-eligibility.mjs')
const { originateRepairMission } = await import('../server/self-improvement-mission-origination.mjs')
const { runRepairAttempt } = await import('../server/self-improvement-repair-cycle.mjs')
const { readFinding } = await import('../server/self-improvement-finding-store.mjs')
const { readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

test('a real commit landing on canonical between origination and dispatch -- the worker forks from CURRENT HEAD, mechanism stays correct', async () => {
  const canonicalRepoPath = path.join(ROOT, 'repo-stale-main')
  git(ROOT, ['init', '-q', '-b', 'main', canonicalRepoPath])
  git(canonicalRepoPath, ['config', 'user.email', 'fixture@example.com'])
  git(canonicalRepoPath, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(canonicalRepoPath, 'fixture.mjs'), 'export const x = 1\n')
  git(canonicalRepoPath, ['add', '.'])
  git(canonicalRepoPath, ['commit', '-q', '-m', 'initial'])
  const originationSha = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()

  let finding = createFinding(
    {
      sourceDetector: 'RUNTIME_ASSERTION',
      severity: 'P1',
      evidence: { x: 1 },
      reproduction: { command: 'node -e "process.exit(1)"' },
      affectedSurface: 'tsf/domain/chaos-stale-main-fixture.mjs',
      confidence: 0.95,
      verificationMethod: 'RECHECK',
      candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'fix', filesHint: ['fixture.mjs'] }
    },
    () => new Date()
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, () => new Date())
  finding = applyAutofixEligibility(finding, () => new Date())

  const origination = await originateRepairMission(finding, {
    canonicalRepoPath,
    clock: () => new Date(),
    deps: { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } }
  })
  const recordedRepoState = readPlannerMissionRecord(origination.missionId).checkpoint.repoState
  assert.equal(recordedRepoState.sha, originationSha, 'origination durably records the repo state AT origination time')

  // A REAL, unrelated commit lands on canonical -- simulates independent
  // real progress on tsf/main while this repair mission sits idle.
  writeFileSync(path.join(canonicalRepoPath, 'unrelated-progress.mjs'), 'export const unrelated = true\n')
  git(canonicalRepoPath, ['add', '.'])
  git(canonicalRepoPath, ['commit', '-q', '-m', 'unrelated real progress landing on canonical'])
  const advancedSha = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  assert.notEqual(advancedSha, originationSha, 'canonical genuinely advanced')

  // Real dispatch (no dispatchWorker override) -- the worker's own
  // dispatchRepairWorker calls createIsolatedRepairWorktree, which forks
  // from canonicalRepoPath's CURRENT HEAD via `git worktree add ... HEAD`.
  const fakeSpawn = async () => ({ exitCode: 0, timedOut: false, stdout: '', stderr: '' }) // real worktree, fake LLM-CLI process only
  const result = await runRepairAttempt({
    finding,
    missionId: origination.missionId,
    canonicalRepoPath,
    clock: () => new Date(),
    deps: { lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory }, workerDeps: { collectHostMemoryEvidence: fakeHealthyMemory, spawnProviderProcess: fakeSpawn } }
  })

  assert.equal(result.verification.detail.baseSha, advancedSha, 'the isolated repair worktree forked from the CURRENT (advanced) canonical HEAD, not the stale origination-time sha')
  assert.equal(existsSync(path.join(result.verification.detail.worktreePath, 'unrelated-progress.mjs')), true, 'the worktree genuinely contains the real commit that landed after origination')
  // Mechanism stays correct under the drift -- verification ran and
  // produced a real, honest verdict rather than corrupting/crashing.
  assert.ok(['VERIFIED_FAIL_WILL_RETRY_OR_ESCALATE_NEXT_TICK', 'READY_FOR_ADOPTION'].includes(result.outcome))
  assert.equal(readFinding(finding.findingId).findingId, finding.findingId, 'the finding record itself is intact, not corrupted by the drift')
})
