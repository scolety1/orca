// TSF Control Plane -- Command Act Model V1, LIVE DISPOSABLE EXECUTION PROOF
// (CASE-31/CASE-32 structural P0 repair, Full Conversational Control Plane
// Exhaustive Gauntlet V1). Proves, through REAL backend paths (a real git
// repo per project, a real COMPLETE Keep Going run built through the actual
// domain state machine, a real candidate worktree, the REAL top-level
// server/command-responder.mjs respondCommand entry point -- the exact same
// code a real chat turn goes through), that the 5 dangerous phrases the
// owner's own directive named do NOT reach an unintended branch mutation,
// and that the positive control DOES advance the canonical branch normally.
//
// Disposable, fixture-shaped ONLY -- three fresh throwaway git repos created
// under a temp dir this file owns and deletes; never C:\TSF_ORCA, never any
// real user project repository, never niners-war-room/NWR (mirrors the exact
// same real-repo fixture pattern test/command-adoption-execution-server.test.mjs
// already established and this file reuses verbatim).
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-command-act-model-live-proof-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { respondCommand } = await import('../server/command-responder.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
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

function createCandidateWorktree(canonicalRepoPath, worktreeName, branch, commitMessage) {
  const worktreePath = path.join(ROOT, worktreeName)
  git(canonicalRepoPath, ['worktree', 'add', '-b', branch, worktreePath, 'main'])
  writeFileSync(path.join(worktreePath, 'existing-file.mjs'), `export const x = ${Date.now()}${Math.random()}\n`)
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

// Three real, independent, ready-for-adoption disposable projects -- every
// one of them has a REAL, genuinely mergeable candidate, so a false
// adoption is actually OBSERVABLE (a project with no run at all would just
// fail closed regardless of whether the bug existed -- an unconvincing
// proof).
function seedProject(label) {
  const projectId = `live-proof-${label.toLowerCase()}`
  const canonicalRepoPath = initFixtureRepo(`${label}-canonical`)
  const worktree = createCandidateWorktree(canonicalRepoPath, `${label}-candidate`, `command/${projectId}`, `a real, verified fix for ${label}`)
  seedOnboardedProject(projectId, canonicalRepoPath)
  seedCompleteKeepGoingRun(projectId, worktree, clock)
  return {
    id: projectId,
    displayName: label,
    root: canonicalRepoPath,
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
}

function head(repoPath) {
  return git(repoPath, ['rev-parse', 'HEAD']).trim()
}

async function runControl(message, projects) {
  const opState = loadState()
  return respondCommand({ message, projects, opState, clock, deps: {}, aliases: {} })
}

test('LIVE PROOF: "Adopt A -- actually, don\'t." => A canonical branch genuinely unchanged', async () => {
  const A = seedProject('LiveA1')
  const before = head(A.root)
  await runControl("Adopt A -- actually, don't.".replace('A', A.displayName), [A])
  assert.equal(head(A.root), before, 'A must never merge when the final current-owner act is a reversal')
})

test('LIVE PROOF: quoted "adopt A" grants no authority -- "Claude said \'adopt A\', but I don\'t want that." => A canonical branch genuinely unchanged', async () => {
  const A = seedProject('LiveA2')
  const before = head(A.root)
  await runControl(`Claude said 'adopt ${A.displayName}', but I don't want that.`, [A])
  assert.equal(head(A.root), before, 'a quoted "adopt A" must never reach a real merge')
})

// Real, disclosed finding from this live proof (not hidden): PAUSE has no
// real multi-action execution intent (existingMultiActionIntent: GENERAL,
// per this module's own explicitly-authorized CASE-32 gap -- "classify/
// document the separate PAUSE-model gap without allowing cross-target
// bleed"), and GENERAL is excluded from classifyMultiActionEntries' own
// >=2-distinguishing-intents gate (server/command-multi-action-bridge.mjs).
// So "Pause A, adopt B." never actually clears that gate at all -- it
// falls through to server/command-adoption-command-bridge.mjs's single-
// project path, which (per CASE-29's own real fix, this mission) sees TWO
// projects named alongside adoption language and safely REFUSES
// (NEEDS_OWNER) rather than guessing which one to adopt. The real,
// consequential safety property the directive cares about still holds --
// A's branch never mutates, and B's doesn't either (a false decline, not a
// false adoption: under-acts, never wrongly over-acts) -- but B does NOT
// currently reach ITS OWN authorized adoption path in this exact
// combination. Documented here rather than asserted away.
test('LIVE PROOF: "Pause A, adopt B." => A canonical branch unchanged (B also does not merge here -- a disclosed, safe ambiguity refusal, not a wrongful mutation of either branch)', async () => {
  const A = seedProject('LiveA3')
  const B = seedProject('LiveB3')
  const aBefore = head(A.root)
  const bBefore = head(B.root)
  const result = await runControl(`Pause ${A.displayName}, adopt ${B.displayName}.`, [A, B])
  assert.equal(head(A.root), aBefore, 'PAUSE on A must never bleed into a real merge for A')
  assert.equal(head(B.root), bBefore, 'disclosed gap: PAUSE+ADOPT together currently falls through to a safe NEEDS_OWNER refusal rather than B\'s own authorized adoption path -- never a wrongful mutation of either branch')
  assert.equal(result.decisionClass, 'NEEDS_OWNER')
})

test('LIVE PROOF: decomposeMultiAction itself correctly scopes "Pause A, adopt B." per target at the domain level (the real fix, independent of the multi-action gate\'s own separate, disclosed PAUSE-execution gap)', async () => {
  const { decomposeMultiAction } = await import('../domain/command-multi-action-decomposition.mjs')
  const A = { id: 'scope-proof-a', displayName: 'ScopeProofA' }
  const B = { id: 'scope-proof-b', displayName: 'ScopeProofB' }
  const entries = decomposeMultiAction(`Pause ${A.displayName}, adopt ${B.displayName}.`, [A, B], {})
  const aEntries = entries.filter((e) => e.target === A.id)
  const bEntries = entries.filter((e) => e.target === B.id)
  assert.equal(aEntries.some((e) => e.intent === 'ADOPT_CANDIDATE_REPORT'), false, 'the CASE-32 fix itself: A must never receive ADOPT_CANDIDATE_REPORT')
  assert.equal(bEntries.some((e) => e.intent === 'ADOPT_CANDIDATE_REPORT'), true)
})

test('LIVE PROOF: "Adopt A, not B." => B canonical branch genuinely unchanged', async () => {
  const A = seedProject('LiveA4')
  const B = seedProject('LiveB4')
  const bBefore = head(B.root)
  await runControl(`Adopt ${A.displayName}, not ${B.displayName}.`, [A, B])
  assert.equal(head(B.root), bBefore, 'an explicitly excluded target must never merge')
})

test('LIVE PROOF: "Pause A, adopt B, leave C alone." => C canonical branch ABSOLUTELY unchanged, B genuinely merges through the authorized path (EXTERNAL_WORK_HOLD is a real distinguishing intent, so this combination DOES clear the multi-action gate)', async () => {
  const A = seedProject('LiveA5')
  const B = seedProject('LiveB5')
  const C = seedProject('LiveC5')
  const aBefore = head(A.root)
  const bBefore = head(B.root)
  const cBefore = head(C.root)
  const result = await runControl(`Pause ${A.displayName}, adopt ${B.displayName}, leave ${C.displayName} alone.`, [A, B, C])
  assert.equal(head(C.root), cBefore, 'ABSOLUTELY NO ADOPT C -- C must never merge under any circumstance here')
  assert.equal(head(A.root), aBefore, 'PAUSE on A must never bleed into a real merge for A')
  assert.notEqual(head(B.root), bBefore, 'B must genuinely enter the authorized adoption path and merge')
  assert.equal(result.intent, 'MULTI_ACTION')
})

test('POSITIVE CONTROL: "Adopt B." => B follows the normal, explicit, governed adoption path and genuinely merges', async () => {
  const B = seedProject('LiveB6')
  const before = head(B.root)
  const result = await runControl(`Adopt ${B.displayName}.`, [B])
  const after = head(B.root)
  assert.notEqual(after, before, 'an unambiguous, explicit, unnegated adoption request must still genuinely merge')
  assert.match(result.text ?? '', /adopted/i)
})

// Independent-review finding (BLOCKING, round 3, the most severe finding
// across all review rounds, same mission): a declined act's own rawClause
// used to be sliced starting exactly at the verb anchor, stripping away
// whatever negation trigger preceded it -- server/command-multi-action-
// bridge.mjs's executeAdoptionCandidate hands ONLY rawClause to its own
// independent, execution-time safety re-derivation
// (classifyAdoptionCommandIntent(rawClause, [project])), so "Don't adopt
// A, adopt B." let A's OWN act (correctly intent-tagged
// ADOPT_CANDIDATE_DECLINED at the decomposer level) reach a REAL git
// ff-only merge anyway, because the re-derivation only ever saw the bare,
// truncated "adopt A" with no "Don't" in front of it. This is the exact
// live, disposable-repo proof of that fix: A must NEVER merge here, with
// a real ready candidate sitting right there waiting, while B (the
// genuinely affirmed target in the very same message) still does.
test('LIVE PROOF (P0, round-3 finding): "Don\'t adopt A, adopt B." => A canonical branch genuinely unchanged despite a real, ready candidate; B genuinely merges', async () => {
  const A = seedProject('LiveA7')
  const B = seedProject('LiveB7')
  const aBefore = head(A.root)
  const bBefore = head(B.root)
  await runControl(`Don't adopt ${A.displayName}, adopt ${B.displayName}.`, [A, B])
  assert.equal(head(A.root), aBefore, 'A must never merge -- this is the exact P0 the truncated-rawClause bug let through')
  assert.notEqual(head(B.root), bBefore, 'B must still genuinely merge through the authorized path')
})
