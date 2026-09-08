// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part A4: golden
// proof. Disposable, fixture-shaped verified candidate ONLY -- a real,
// throwaway git repo (git init/real commits, mirrors self-improvement-
// adoption.test.mjs's own fixture pattern) with a real project record and a
// real Keep Going run built through the ACTUAL domain state machine
// (createOvernightRun/planWave/dispatchWave/settleInFlightWave/completeRun)
// reaching COMPLETE -- never C:\TSF_ORCA, never WorldForge/Nytheria.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-command-adoption-execution-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { executeCommandAdoption } = await import('../server/command-adoption-execution.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readProjectCanonicalBase } = await import('../server/project-canonical-base-store.mjs')
const { withProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
const {
  createOvernightRun,
  planWave,
  dispatchWave,
  settleInFlightWave,
  completeRun
} = await import('../domain/keep-going.mjs')

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initFixtureRepo(name) {
  const dir = path.join(ROOT, name)
  git(ROOT, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'existing-file.mjs'), 'export const x = 1\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

// A real, linked git worktree of the fixture repo, on a fresh branch, with
// one real commit -- exactly the shape a Keep Going dispatch's own
// auto-provisioned worktree produces.
function createCandidateWorktree(canonicalRepoPath, worktreeName, branch, commitMessage) {
  const worktreePath = path.join(ROOT, worktreeName)
  git(canonicalRepoPath, ['worktree', 'add', '-b', branch, worktreePath, 'main'])
  writeFileSync(path.join(worktreePath, 'existing-file.mjs'), `export const x = ${Date.now()}\n`)
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', commitMessage])
  return worktreePath
}

function seedOnboardedProject(projectId, repoPath) {
  const opState = loadState()
  saveState({
    ...opState,
    onboardedProjects: {
      ...opState.onboardedProjects,
      [projectId]: { repoPath, lastAnalysis: null, receipts: [], acceptedAt: '2026-09-07T00:00:00.000Z', refreshedAt: '2026-09-07T00:00:00.000Z' }
    }
  })
}

// Builds a real, COMPLETE Keep Going run through the ACTUAL domain state
// machine (never a hand-fabricated object), dispatched into `worktree`, and
// persists it directly to opState.keepGoingRuns (bypassing the real Orca
// CLI/orchestration bridge -- this test proves the ADOPTION engine, not the
// dispatch pipeline, which is already covered by chat-dispatch-bridge.test.mjs).
function seedCompleteKeepGoingRun(projectId, worktree, clock) {
  let run = createOvernightRun({
    id: `run:${projectId}`,
    projectId,
    originalGoal: 'ship the fixture change',
    acceptanceCriteria: ['the fixture change lands']
  }, clock)
  const workItem = { id: `work:${projectId}`, scope: ['existing-file.mjs'], worktree }
  const wavePlan = planWave(run, [workItem], clock)
  const dispatchRecords = [{ workItemId: workItem.id, scope: workItem.scope, taskId: `task:${projectId}`, dispatchId: `dispatch:${projectId}`, worktree }]
  run = dispatchWave(run, wavePlan, dispatchRecords, clock, run.revision)
  const waveResult = {
    schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1',
    outcomes: dispatchRecords.map((r) => ({ ...r, outcome: 'COMPLETED', rawStatus: 'completed' })),
    settledAt: new Date().toISOString()
  }
  run = settleInFlightWave(run, waveResult, clock, run.revision)
  run = completeRun(run, clock)
  const opState = loadState()
  saveState({ ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } })
  return run
}

const clock = () => new Date('2026-09-07T12:00:00.000Z')

test('Proof 1: explicit owner-style command path -- resolve candidate -> revalidate -> adopt -> receipt -> canonical branch genuinely advances', async () => {
  const projectId = 'fixture-proof-1'
  const canonicalRepoPath = initFixtureRepo('proof1-canonical')
  const worktree = createCandidateWorktree(canonicalRepoPath, 'proof1-candidate', 'command/fixture-proof-1', 'a real, verified fix')
  seedOnboardedProject(projectId, canonicalRepoPath)
  seedCompleteKeepGoingRun(projectId, worktree, clock)

  const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()

  const result = await executeCommandAdoption({ project: { id: projectId, root: canonicalRepoPath }, clock })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.alreadyIncluded, false)
  assert.equal(result.priorCanonicalSha, priorHead)
  assert.equal(result.receipt.kind, 'ADOPTION_DECISION')
  assert.equal(result.receipt.decision.type, 'ADOPT')

  // Real git log/rev-parse proof -- the canonical branch genuinely advanced.
  const newHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  assert.equal(newHead, result.resultingCanonicalSha)
  assert.notEqual(newHead, priorHead)
  assert.equal(git(canonicalRepoPath, ['log', '-1', '--format=%s']).trim(), 'a real, verified fix')
  const log = git(canonicalRepoPath, ['log', '--oneline']).trim().split('\n')
  assert.equal(log.length, 2, 'canonical repo now has both the original commit and the adopted candidate commit')

  // Durable receipt really landed on the onboarded project record.
  const onboarded = loadState().onboardedProjects[projectId]
  assert.equal(onboarded.receipts.length, 1)
  assert.equal(onboarded.receipts[0].receiptHash, result.receipt.receiptHash)

  // Durable canonical-base pointer really advanced (Part C store).
  const canonicalBase = readProjectCanonicalBase(projectId)
  assert.equal(canonicalBase.ref, 'main')
  assert.equal(canonicalBase.history.at(-1).action, 'ADVANCED')
  assert.equal(canonicalBase.history.at(-1).resultingSha, newHead)
})

test('Proof 1b: idempotency -- a candidate already an ancestor of canonical HEAD is honestly ALREADY_INCLUDED, no merge attempted, still a real receipt', async () => {
  const projectId = 'fixture-proof-1b'
  const canonicalRepoPath = initFixtureRepo('proof1b-canonical')
  // The candidate worktree's branch is created from the SAME main tip with
  // no further commit -- candidateSha === canonical HEAD already.
  const worktree = path.join(ROOT, 'proof1b-candidate')
  git(canonicalRepoPath, ['worktree', 'add', '-b', 'command/fixture-proof-1b', worktree, 'main'])
  seedOnboardedProject(projectId, canonicalRepoPath)
  seedCompleteKeepGoingRun(projectId, worktree, clock)

  const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  const result = await executeCommandAdoption({ project: { id: projectId, root: canonicalRepoPath }, clock })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.alreadyIncluded, true)
  assert.equal(result.resultingCanonicalSha, priorHead)
  assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), priorHead, 'no merge attempted -- HEAD unchanged')
  assert.equal(result.receipt.decision.alreadyIncluded, true)
})

test('Proof 3: an unverified candidate (run not COMPLETE) is REFUSED with the real reason', async () => {
  const projectId = 'fixture-proof-3'
  const canonicalRepoPath = initFixtureRepo('proof3-canonical')
  createCandidateWorktree(canonicalRepoPath, 'proof3-candidate', 'command/fixture-proof-3', 'not yet verified')
  seedOnboardedProject(projectId, canonicalRepoPath)
  // Build the run but do NOT complete it -- still ACTIVE.
  const run = createOvernightRun({ id: `run:${projectId}`, projectId, originalGoal: 'ship it', acceptanceCriteria: ['done'] }, clock)
  const opState = loadState()
  saveState({ ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } })

  const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  const result = await executeCommandAdoption({ project: { id: projectId, root: canonicalRepoPath }, clock })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NOT_READY_FOR_ADOPTION')
  assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), priorHead, 'no merge attempted')
  assert.equal(loadState().onboardedProjects[projectId].receipts.length, 0, 'no receipt written on a refused check')
})

test('Proof 4: a cross-project candidate (run belongs to a different project) is REFUSED', async () => {
  const projectId = 'fixture-proof-4'
  const otherProjectId = 'fixture-proof-4-other'
  const canonicalRepoPath = initFixtureRepo('proof4-canonical')
  const worktree = createCandidateWorktree(canonicalRepoPath, 'proof4-candidate', 'command/fixture-proof-4', 'belongs to a different project')
  seedOnboardedProject(projectId, canonicalRepoPath)
  // The run is real and COMPLETE, but its projectId is a DIFFERENT project
  // than the one being resolved against -- the run is stored under
  // `projectId`'s own keepGoingRuns key (readKeepGoingRun looks it up by
  // that key) but the run's own internal projectId field names another
  // project entirely, exactly the cross-project mismatch this check exists
  // to catch.
  let run = createOvernightRun({ id: `run:${projectId}`, projectId: otherProjectId, originalGoal: 'ship it', acceptanceCriteria: ['done'] }, clock)
  const workItem = { id: `work:${projectId}`, scope: ['existing-file.mjs'], worktree }
  const wavePlan = planWave(run, [workItem], clock)
  const dispatchRecords = [{ workItemId: workItem.id, scope: workItem.scope, taskId: `task:${projectId}`, dispatchId: `dispatch:${projectId}`, worktree }]
  run = dispatchWave(run, wavePlan, dispatchRecords, clock, run.revision)
  const waveResult = { schemaVersion: 'TSF_KEEP_GOING_WAVE_RESULT_V1', outcomes: dispatchRecords.map((r) => ({ ...r, outcome: 'COMPLETED', rawStatus: 'completed' })), settledAt: new Date().toISOString() }
  run = settleInFlightWave(run, waveResult, clock, run.revision)
  run = completeRun(run, clock)
  const opState = loadState()
  saveState({ ...opState, keepGoingRuns: { ...opState.keepGoingRuns, [projectId]: run } })

  const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  const result = await executeCommandAdoption({ project: { id: projectId, root: canonicalRepoPath }, clock })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'CROSS_PROJECT_CANDIDATE')
  assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), priorHead, 'no merge attempted')
})

test('Proof 5: a held project (a real, active project-execution-hold) is REFUSED', async () => {
  const projectId = 'fixture-proof-5'
  const canonicalRepoPath = initFixtureRepo('proof5-canonical')
  const worktree = createCandidateWorktree(canonicalRepoPath, 'proof5-candidate', 'command/fixture-proof-5', 'held project should refuse')
  seedOnboardedProject(projectId, canonicalRepoPath)
  seedCompleteKeepGoingRun(projectId, worktree, clock)
  await withProjectExecutionHold(projectId, () =>
    createProjectExecutionHold({ projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT', note: 'another agent is on this repo' }, clock)
  )

  const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  const result = await executeCommandAdoption({ project: { id: projectId, root: canonicalRepoPath }, clock })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'PROJECT_EXECUTION_HOLD_ACTIVE')
  assert.match(result.detail, /another agent is on this repo/)
  assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), priorHead, 'no merge attempted')
})

test('a genuinely diverged candidate is refused, never forced/rebased', async () => {
  const projectId = 'fixture-diverged'
  const canonicalRepoPath = initFixtureRepo('diverged-canonical')
  const worktree = createCandidateWorktree(canonicalRepoPath, 'diverged-candidate', 'command/fixture-diverged', 'candidate-only commit')
  // Advance canonical main independently after branching, so candidate and
  // canonical HEAD have genuinely diverged.
  writeFileSync(path.join(canonicalRepoPath, 'canonical-only.mjs'), 'export const y = 1\n')
  git(canonicalRepoPath, ['add', '.'])
  git(canonicalRepoPath, ['commit', '-q', '-m', 'canonical-only commit, after the candidate branched'])
  seedOnboardedProject(projectId, canonicalRepoPath)
  seedCompleteKeepGoingRun(projectId, worktree, clock)

  const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  const result = await executeCommandAdoption({ project: { id: projectId, root: canonicalRepoPath }, clock })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'CANDIDATE_DIVERGED_FROM_CANONICAL_BASE')
  assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), priorHead, 'never forced/rebased')
})
