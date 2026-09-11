// Manual Self-Improvement Finding Disposition V1: real, end-to-end proofs
// for startFix/applyVerifiedFix/dismissFinding. Mirrors self-improvement-
// adoption.test.mjs's own real-fixture-repo-pair convention (never
// C:\TSF_ORCA) and its GATE OPEN/CLOSED fabricated-env discipline.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-selfimprove-disposition-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { startFix, applyVerifiedFix, dismissFinding } = await import('../server/self-improvement-finding-disposition.mjs')
const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { withFinding, readFinding } = await import('../server/self-improvement-finding-store.mjs')
const { createIsolatedRepairWorktree } = await import('../server/self-improvement-worktree.mjs')
const { deriveRepairAttemptBranch } = await import('../server/self-improvement-worker-dispatch.mjs')
const { ADOPTION_AUTHORIZATION_MARKER } = await import('../server/self-improvement-adoption-authorization-gate.mjs')
const { computeRepairMissionId } = await import('../server/self-improvement-mission-origination.mjs')
const { withPlannerMissionRecord, readPlannerMissionRecord } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint, recordVerifierResult } = await import('../domain/planner-mission-checkpoint.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
const { withProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
const { buildFleetAttentionItems } = await import('../domain/fleet-attention-status.mjs')

const clock = () => new Date('2026-09-11T12:00:00.000Z')
const GB = 1024 ** 3
const fakeHealthyMemory = () => ({ totalBytes: 16 * GB, freeBytes: 8 * GB, availableBytes: 8 * GB, usedPercent: 50 })

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initFixtureRepo(name) {
  const dir = path.join(ROOT, name)
  git(ROOT, ['init', '-q', '-b', 'main', dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'existing-file.mjs'), "export const fixed = false\n")
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

function fakeGate(suffix) {
  const fakeFlagPath = path.join(ROOT, `FAKE_ADOPTION_${suffix}.flag`)
  writeFileSync(fakeFlagPath, ADOPTION_AUTHORIZATION_MARKER, 'utf8')
  return { env: { TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION: ADOPTION_AUTHORIZATION_MARKER }, flagFilePath: fakeFlagPath }
}

let seq = 0
function baseRaw(overrides = {}) {
  seq += 1
  return {
    sourceDetector: 'RUNTIME_ASSERTION',
    severity: 'P1',
    evidence: { assertion: 'expected fixed=true' },
    reproduction: { command: `node -e "process.exit(require('fs').readFileSync('existing-file.mjs','utf8').includes('fixed = true') ? 0 : 1)"` },
    affectedSurface: `tsf/domain/fixture-${seq}.mjs`,
    confidence: 0.9,
    verificationMethod: 'RECHECK_ASSERTION',
    candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', summary: 'fixture', filesHint: [] },
    ...overrides
  }
}

async function seedNeedsOwnerFinding(overrides = {}) {
  let finding = createFinding(baseRaw(overrides), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  return withFinding(finding.findingId, () => finding)
}

async function seedEligibleFinding(overrides = {}) {
  let finding = createFinding(baseRaw(overrides), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  finding = transitionFinding(finding, 'ELIGIBLE_FOR_AUTOFIX', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  return withFinding(finding.findingId, () => finding)
}

// Builds a durable READY_FOR_ADOPTION finding + a real planner mission
// checkpoint carrying a real VERIFIED_PASS verifier result pointing at a
// real, isolated candidate worktree -- exactly the shape advanceOneFinding
// (self-improvement-fleet-driver.mjs) reads for real, never a mock.
async function seedReadyForAdoptionFinding({ canonicalRepoPath, fixedContent = "export const fixed = true\n", overrides = {} } = {}) {
  let finding = createFinding(baseRaw(overrides), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  finding = transitionFinding(finding, 'ELIGIBLE_FOR_AUTOFIX', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  finding = transitionFinding(finding, 'FIX_MISSION_CREATED', { reason: 'REPAIR_MISSION_ORIGINATED' }, clock)
  finding = transitionFinding(finding, 'FIX_IN_PROGRESS', { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED' }, clock)
  finding = transitionFinding(finding, 'READY_FOR_ADOPTION', { reason: 'VERIFIER_PASSED' }, clock)
  finding = await withFinding(finding.findingId, () => finding)

  const missionId = computeRepairMissionId(finding.findingId)
  const branch = deriveRepairAttemptBranch({ missionId, attemptNumber: 1 })
  const worktreePath = path.join(ROOT, `candidate-${finding.findingId.replace(/[^a-z0-9]/gi, '-')}`)
  const candidate = await createIsolatedRepairWorktree({ canonicalRepoPath, worktreePath, branch })
  writeFileSync(path.join(worktreePath, 'existing-file.mjs'), fixedContent)
  git(worktreePath, ['add', '.'])
  git(worktreePath, ['commit', '-q', '-m', 'a real, verified fix'])

  await withPlannerMissionRecord(missionId, () => {
    const checkpoint = createPlannerMissionCheckpoint(
      { missionId, missionGoal: `fixture repair mission for ${finding.findingId}`, phase: 'REPAIR_DISPATCH', repoState: { branch: 'main', sha: git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim() } },
      clock
    )
    const withResult = recordVerifierResult(
      checkpoint,
      { verifier: 'FIXTURE_VERIFIER', verdict: 'VERIFIED_PASS', detail: { worktreePath, branch: candidate.branch } },
      clock
    )
    return { lease: null, checkpoint: withResult }
  })

  return { finding, missionId, worktreePath, branch: candidate.branch }
}

test.after(() => rmSync(ROOT, { recursive: true, force: true }))

// ---- startFix ----

test('startFix: unknown finding is honestly reported, never a crash', async () => {
  const result = await startFix('finding:does-not-exist')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'FINDING_NOT_FOUND')
})

test('startFix: a RESOLVED finding is NOT_STARTABLE', async () => {
  const finding = await seedEligibleFinding()
  const resolved = transitionFinding(
    transitionFinding(finding, 'FIX_MISSION_CREATED', { reason: 'REPAIR_MISSION_ORIGINATED' }, clock),
    'NEEDS_OWNER',
    { reason: 'REPAIR_RETRY_BUDGET_EXCEEDED' },
    clock
  )
  await withFinding(resolved.findingId, () => resolved)
  // NEEDS_OWNER genuinely IS startable (that's the whole point of this
  // feature) -- use a real terminal status to prove the refusal path.
  const dismissed = transitionFinding(resolved, 'DISMISSED_BY_OWNER', { reason: 'OWNER_DISMISSED' }, clock)
  await withFinding(dismissed.findingId, () => dismissed)
  const result = await startFix(dismissed.findingId)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NOT_STARTABLE')
  assert.equal(result.findingStatus, 'DISMISSED_BY_OWNER')
})

test('startFix: ELIGIBLE_FOR_AUTOFIX finding -> real FIX_MISSION_CREATED, a real missionId', async () => {
  const finding = await seedEligibleFinding()
  const canonicalRepoPath = initFixtureRepo('startfix-eligible-repo')
  const result = await startFix(finding.findingId, {
    canonicalRepoPath,
    clock,
    deps: { originationDeps: { observeRepoState: () => ({ branch: 'main', sha: 'a'.repeat(40), worktreePath: canonicalRepoPath }), lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } } }
  })
  assert.equal(result.ok, true)
  assert.equal(result.findingStatus, 'FIX_MISSION_CREATED')
  assert.ok(result.missionId)
  assert.equal(readFinding(finding.findingId).status, 'FIX_MISSION_CREATED')
})

// Test #2 (owner's own list): no verified candidate yet -> Start Fix is
// the real, available action for a NEEDS_OWNER finding.
test('startFix: NEEDS_OWNER finding -> real Start Fix via owner authorization, no candidate needed', async () => {
  const finding = await seedNeedsOwnerFinding()
  const canonicalRepoPath = initFixtureRepo('startfix-needsowner-repo')
  const result = await startFix(finding.findingId, {
    canonicalRepoPath,
    clock,
    deps: { originationDeps: { observeRepoState: () => ({ branch: 'main', sha: 'a'.repeat(40), worktreePath: canonicalRepoPath }), lifecycleDeps: { collectHostMemoryEvidence: fakeHealthyMemory } } }
  })
  assert.equal(result.ok, true)
  assert.equal(result.findingStatus, 'FIX_MISSION_CREATED')
  const record = readPlannerMissionRecord(result.missionId)
  assert.equal(record.checkpoint.decisions[0].by, 'OWNER')
})

// Test #11: a failed Start Fix is a truthful failure, and the finding
// remains exactly as actionable as before.
test('startFix: real failure (unobservable repo state) is reported truthfully, finding status untouched', async () => {
  const finding = await seedNeedsOwnerFinding()
  const result = await startFix(finding.findingId, {
    canonicalRepoPath: 'C:/this-path-does-not-exist-for-the-fixture',
    clock,
    deps: { originationDeps: { observeRepoState: () => null } }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'TSF_SELF_IMPROVEMENT_REPO_STATE_UNOBSERVABLE')
  assert.equal(readFinding(finding.findingId).status, 'NEEDS_OWNER', 'the finding must remain exactly as actionable as before the failed attempt')
})

// ---- applyVerifiedFix ----

test('applyVerifiedFix: unknown finding is honestly reported', async () => {
  const result = await applyVerifiedFix('finding:does-not-exist-2')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'FINDING_NOT_FOUND')
})

// Test #2: no verified candidate -> Apply verified fix is honestly
// unavailable for a NEEDS_OWNER finding.
test('applyVerifiedFix: a NEEDS_OWNER finding is NOT_READY_FOR_ADOPTION -- Apply is genuinely unavailable', async () => {
  const finding = await seedNeedsOwnerFinding()
  const result = await applyVerifiedFix(finding.findingId)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NOT_READY_FOR_ADOPTION')
  assert.equal(result.findingStatus, 'NEEDS_OWNER')
})

// Test #13: the real, unmodified gate -- closed by default in every real
// production run -- blocks a manual Apply exactly like it blocks the
// autonomous driver. Proves manual disposition never bypasses it.
test('applyVerifiedFix: GATE CLOSED (real process.env, real default flag path) blocks adoption honestly, no git I/O attempted', async () => {
  assert.equal(process.env.TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION, undefined)
  const canonicalRepoPath = initFixtureRepo('applyfix-gateclosed-repo')
  const seeded = await seedReadyForAdoptionFinding({ canonicalRepoPath })
  const result = await applyVerifiedFix(seeded.finding.findingId, { canonicalRepoPath, clock })
  assert.equal(result.ok, true, 'the call itself succeeds -- it is the ADOPTION that is honestly refused')
  assert.equal(result.adopted, false)
  assert.equal(result.adoptionReason, 'GATE_CLOSED')
  assert.equal(readFinding(seeded.finding.findingId).status, 'READY_FOR_ADOPTION', 'stays actionable, never silently advanced')
})

// The full real flow: gate open (fabricated), real ff-only merge, real
// post-adoption redogfood re-verification (re-runs the ORIGINAL
// reproduction command against the now-updated canonical repo) genuinely
// confirms the fix -- finding reaches RESOLVED, not just "adopted:true".
test('applyVerifiedFix: GATE OPEN, real merge + real redogfood -> finding genuinely reaches RESOLVED', async () => {
  const canonicalRepoPath = initFixtureRepo('applyfix-success-repo')
  const seeded = await seedReadyForAdoptionFinding({ canonicalRepoPath })
  const gate = fakeGate('success')

  const result = await applyVerifiedFix(seeded.finding.findingId, {
    canonicalRepoPath,
    clock,
    deps: { adoptionDeps: gate }
  })

  assert.equal(result.ok, true)
  assert.equal(result.adopted, true)
  assert.equal(result.action, 'ADOPTION_ATTEMPTED')
  assert.equal(git(canonicalRepoPath, ['log', '-1', '--format=%s']).trim(), 'a real, verified fix')

  assert.equal(result.redogfoodOutcome, 'RESOLVED')
  const after = readFinding(seeded.finding.findingId)
  assert.equal(after.status, 'RESOLVED', 'the real post-adoption redogfood re-check is what actually confirms this, not the merge alone')
})

// Test #3: a candidate that goes stale BETWEEN render and click (the
// worktree is now dirty, diverged from what a fresh readiness check would
// require) is refused honestly -- the SAME real, already-tested
// attemptRepairAdoptionLocked re-derivation this reuses, proven here at
// this module's own boundary.
test('applyVerifiedFix: a candidate worktree gone dirty between render and click is refused honestly, no merge', async () => {
  const canonicalRepoPath = initFixtureRepo('applyfix-stale-repo')
  const seeded = await seedReadyForAdoptionFinding({ canonicalRepoPath })
  // Simulates staleness: an uncommitted change lands in the candidate
  // worktree after the UI rendered "ready for adoption" but before the
  // owner's click reaches the server.
  writeFileSync(path.join(seeded.worktreePath, 'uncommitted.txt'), 'stale\n')

  const result = await applyVerifiedFix(seeded.finding.findingId, {
    canonicalRepoPath,
    clock,
    deps: { adoptionDeps: fakeGate('stale') }
  })
  assert.equal(result.adopted, false)
  assert.equal(result.adoptionReason, 'NOT_READY')
  assert.equal(git(canonicalRepoPath, ['log', '-1', '--format=%s']).trim(), 'initial', 'no merge must have happened')
})

// Test #4: a real, active project execution hold appearing before the
// click refuses adoption -- reused unchanged from attemptRepairAdoption's
// own hold check.
test('applyVerifiedFix: a real active project execution hold refuses adoption', async () => {
  const canonicalRepoPath = initFixtureRepo('applyfix-hold-repo')
  const projectId = 'selfimprove-disposition-hold-fixture'
  const seeded = await seedReadyForAdoptionFinding({ canonicalRepoPath, overrides: { projectId } })
  await withProjectExecutionHold(projectId, () => createProjectExecutionHold({ projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'OPERATOR_CHAT' }, clock))

  const result = await applyVerifiedFix(seeded.finding.findingId, {
    canonicalRepoPath,
    clock,
    deps: { adoptionDeps: fakeGate('hold') }
  })
  assert.equal(result.adopted, false)
  assert.equal(result.adoptionReason, 'NOT_READY')
  assert.equal(git(canonicalRepoPath, ['log', '-1', '--format=%s']).trim(), 'initial')
})

// Test #5: once genuinely adopted (RESOLVED), a second Apply is refused --
// no duplicate adoption.
test('applyVerifiedFix: an already-adopted (RESOLVED) finding refuses a duplicate apply', async () => {
  const canonicalRepoPath = initFixtureRepo('applyfix-duplicate-repo')
  const seeded = await seedReadyForAdoptionFinding({ canonicalRepoPath })
  const gate = fakeGate('duplicate')
  const first = await applyVerifiedFix(seeded.finding.findingId, { canonicalRepoPath, clock, deps: { adoptionDeps: gate } })
  assert.equal(first.adopted, true)
  assert.equal(readFinding(seeded.finding.findingId).status, 'RESOLVED')

  const headAfterFirst = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
  const second = await applyVerifiedFix(seeded.finding.findingId, { canonicalRepoPath, clock, deps: { adoptionDeps: gate } })
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'NOT_READY_FOR_ADOPTION')
  assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), headAfterFirst, 'no second merge must have happened')
})

// Test #6: two genuinely concurrent Apply attempts for the SAME finding
// never interleave -- real mutual exclusion, inherited unchanged from
// withAdoptionLock (command-adoption-execution.mjs), reused by
// attemptRepairAdoption. Both may honestly report adopted:true (the
// loser's own ff-only merge to an already-current HEAD is a real,
// harmless no-op success, not a fabricated one) -- what must be true is
// exactly ONE real action actually happened: one real redogfood
// transition (RESOLVED), the other an honest ALREADY_RECORDED_CONCURRENTLY,
// never a crash and never two competing transitions.
test('applyVerifiedFix: two simultaneous apply attempts resolve to exactly one real transition, never a crash or a duplicate', async () => {
  const canonicalRepoPath = initFixtureRepo('applyfix-concurrent-repo')
  const seeded = await seedReadyForAdoptionFinding({ canonicalRepoPath })
  const gate = fakeGate('concurrent')
  const opts = { canonicalRepoPath, clock, deps: { adoptionDeps: gate } }

  const [a, b] = await Promise.all([applyVerifiedFix(seeded.finding.findingId, opts), applyVerifiedFix(seeded.finding.findingId, opts)])
  assert.ok(a.ok && b.ok, 'neither concurrent request may ever crash')
  assert.ok(a.adopted && b.adopted, 'both a real merge (winner) and a real no-op fast-forward to the same already-current HEAD (loser) are honest adopted:true outcomes')
  const outcomes = [a.redogfoodOutcome, b.redogfoodOutcome].sort()
  assert.deepEqual(outcomes, ['ALREADY_RECORDED_CONCURRENTLY', 'RESOLVED'], 'exactly one real redogfood transition must have won; the other must honestly report the race, never silently duplicate it')
  assert.equal(readFinding(seeded.finding.findingId).status, 'RESOLVED')
})

// ---- dismissFinding ----

test('dismissFinding: unknown finding is honestly reported', async () => {
  const result = await dismissFinding('finding:does-not-exist-3')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'FINDING_NOT_FOUND')
})

test('dismissFinding: an in-progress finding (FIX_IN_PROGRESS) is NOT_DISMISSIBLE', async () => {
  const finding = await seedEligibleFinding()
  const inProgress = transitionFinding(
    transitionFinding(finding, 'FIX_MISSION_CREATED', { reason: 'REPAIR_MISSION_ORIGINATED' }, clock),
    'FIX_IN_PROGRESS',
    { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED' },
    clock
  )
  await withFinding(inProgress.findingId, () => inProgress)
  const result = await dismissFinding(inProgress.findingId)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NOT_DISMISSIBLE')
  assert.equal(result.findingStatus, 'FIX_IN_PROGRESS')
})

// Test #7: a durable disposition, with every original field preserved.
test('dismissFinding: NEEDS_OWNER -> DISMISSED_BY_OWNER, a durable disposition with evidence preserved', async () => {
  const finding = await seedNeedsOwnerFinding({ evidence: { assertion: 'the real, original evidence' } })
  const result = await dismissFinding(finding.findingId, { reason: 'not worth fixing right now', clock })
  assert.equal(result.ok, true)
  assert.equal(result.finding.status, 'DISMISSED_BY_OWNER')
  assert.deepEqual(result.finding.evidence, { assertion: 'the real, original evidence' }, 'original evidence must be untouched')
  assert.equal(result.finding.severity, finding.severity)
  assert.equal(result.finding.sourceDetector, finding.sourceDetector)
  assert.equal(result.finding.findingId, finding.findingId)
  const lastTransition = result.finding.transitions.at(-1)
  assert.equal(lastTransition.to, 'DISMISSED_BY_OWNER')
  assert.equal(lastTransition.reason, 'OWNER_DISMISSED')
  assert.deepEqual(lastTransition.evidence, [{ ownerNote: 'not worth fixing right now' }])
  assert.ok(lastTransition.at, 'a real dismissal timestamp must be recorded')
  // History is APPENDED, never replaced.
  assert.ok(result.finding.transitions.length >= 3)
})

test('dismissFinding: READY_FOR_ADOPTION -> DISMISSED_BY_OWNER also works (owner declines a verified fix)', async () => {
  const canonicalRepoPath = initFixtureRepo('dismiss-ready-repo')
  const seeded = await seedReadyForAdoptionFinding({ canonicalRepoPath })
  const result = await dismissFinding(seeded.finding.findingId)
  assert.equal(result.ok, true)
  assert.equal(result.finding.status, 'DISMISSED_BY_OWNER')
})

// Test #8: reload/restart -- read fresh, from the real durable store, not
// from any cached response.
test('dismissFinding: the dismissal genuinely persists across a fresh read (reload/restart)', async () => {
  const finding = await seedNeedsOwnerFinding()
  await dismissFinding(finding.findingId, { reason: 'persists test', clock })
  const reloaded = readFinding(finding.findingId)
  assert.equal(reloaded.status, 'DISMISSED_BY_OWNER')
  assert.equal(reloaded.transitions.at(-1).reason, 'OWNER_DISMISSED')
})

// Test #9: a dismissed finding no longer appears as unresolved Needs You
// -- proven against the REAL fleet-attention projection, not assumed.
test('dismissFinding: a dismissed finding no longer appears in the real fleet attention Needs-You projection', async () => {
  const finding = await seedNeedsOwnerFinding()
  const before = buildFleetAttentionItems({ projects: [], selfImprovementFindings: { [finding.findingId]: readFinding(finding.findingId) } })
  assert.ok(before.some((i) => i.source.id === finding.findingId), 'sanity: it must have appeared before dismissal')

  await dismissFinding(finding.findingId, { reason: 'no longer needed', clock })
  const after = buildFleetAttentionItems({ projects: [], selfImprovementFindings: { [finding.findingId]: readFinding(finding.findingId) } })
  assert.ok(!after.some((i) => i.source.id === finding.findingId), 'a dismissed finding must never appear in the real Needs-You feed again')
})
