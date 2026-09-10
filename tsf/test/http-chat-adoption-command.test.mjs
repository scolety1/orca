// TSF Overnight Control-Plane Burn-In V2, Lane L continuation: real,
// live-confirmed finding (not guessed), same architectural blind spot as
// PAUSE/RESUME (SHA b443f4212c): real adoption EXECUTION
// (command-adoption-command-bridge.mjs's respondAdoptionCommand) was
// likewise reachable ONLY from Global Command's AMBIGUOUS/fuzzy resolution
// path -- an exact project-name adoption request ("adopt <exact project
// id>") on EITHER Global Command's exact-match short-circuit OR per-project
// Planner Chat fell through to chat-responder.mjs's report-only
// respondAdoption, which never calls executeCommandAdoption at all.
// Paradoxically, ONLY a genuinely ambiguous "adopt it" reached real
// execution authority via Global Command, while the clearest, most
// explicit phrasing did not.
//
// Disposable, real-git-repo fixtures ONLY (mirrors command-adoption-
// execution-server.test.mjs's own pattern) -- never C:\TSF_ORCA, never
// WorldForge/Nytheria/EasyLife/Landing Page. Unlike that file (which calls
// executeCommandAdoption/respondCommand directly), THIS file drives the
// real HTTP /api/chat route end to end, so the real project catalog
// (server/project-catalog.mjs's projectsById, which reads
// opState.onboardedProjects) must be seeded with a REAL, complete
// onboarding record -- not the {repoPath, lastAnalysis: null} shortcut
// those direct-call tests use.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-http-chat-adoption-command-'))
const STATE_FILE = path.join(ROOT, 'operator-state.json')
process.env.TSF_UI_STATE_FILE = STATE_FILE
process.env.TSF_PLANNER_CLAUDE_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CODEX_COMMAND = path.join(HERE, 'fixtures', 'does-not-exist-binary')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { createRequestHandler } = await import('../server/http-server.mjs')
const { loadState, saveState } = await import('../server/data-store.mjs')
const { readProjectCanonicalBase } = await import('../server/project-canonical-base-store.mjs')
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

// Minimal, real, valid onboarding record -- mirrors test/onboarded-
// project-projection.test.mjs's own baseAnalysis fixture (the canonical
// minimal shape projectOnboardedProject/server/project-catalog.mjs's
// projectsById actually requires), NOT the {repoPath, lastAnalysis: null}
// shortcut command-adoption-execution-server.test.mjs uses for its own
// direct (non-HTTP) calls -- that shortcut is invisible to projectsById,
// so a project seeded that way would never appear in this route's own
// project catalog at all.
function seedOnboardedProjectForHttp(projectId, displayName, repoPath) {
  const opState = loadState()
  saveState({
    ...opState,
    onboardedProjects: {
      ...opState.onboardedProjects,
      [projectId]: {
        acceptedAt: '2026-09-10T00:00:00.000Z',
        receipts: [],
        lastAnalysis: {
          projectId,
          displayName,
          repoPath,
          analyzedAt: '2026-09-10T00:00:00.000Z',
          maturity: 'DEVELOPING',
          identity: { branch: 'main', head: 'seed000', tree: 'seedtree' },
          migrationClassification: { classification: 'SAFE_TO_ONBOARD_NOW', reasons: [] },
          handoffReconciliation: { hasHandoff: false },
          orcaRegistration: { checked: false, registered: false },
          discovery: { commandGuidance: { hasKnownTestCommand: false, testCommands: [], lintCommands: [], buildCommands: [] } },
          direction: { purpose: null, recommendedNextMission: null, upgradeCandidates: [], unfinishedSummary: null, completedSummary: null, alignment: 'UNKNOWN', live: false },
          health: { status: 'HEALTHY', findings: [], observedAt: '2026-09-10T00:00:00.000Z' }
        }
      }
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

const clock = () => new Date('2026-09-10T12:00:00.000Z')

async function withServer(fn) {
  const handler = createRequestHandler()
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function chat(base, body) {
  const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}

test('Overnight V2 Lane L: "adopt X" over real HTTP genuinely executes a real git merge, on Global Command exact-match', async () => {
  await withServer(async (base) => {
    const projectId = 'lane-l-adopt-global'
    const canonicalRepoPath = initFixtureRepo('lane-l-adopt-global-canonical')
    const worktree = createCandidateWorktree(canonicalRepoPath, 'lane-l-adopt-global-candidate', 'command/lane-l-adopt-global', 'a real, verified fix')
    seedOnboardedProjectForHttp(projectId, 'Lane L Adopt Global', canonicalRepoPath)
    seedCompleteKeepGoingRun(projectId, worktree, clock)
    const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()

    const result = await chat(base, { projectId: null, message: `adopt ${projectId}` })

    assert.equal(result.body.intent, 'ADOPTION_COMMAND', 'must reach the real execution bridge, not the report-only responder')
    assert.match(result.body.text, /adopted: canonical advanced/i)
    const newHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
    assert.notEqual(newHead, priorHead, 'the real canonical branch must genuinely advance')
    assert.equal(git(canonicalRepoPath, ['log', '-1', '--format=%s']).trim(), 'a real, verified fix')

    const canonicalBase = readProjectCanonicalBase(projectId)
    assert.equal(canonicalBase.history.at(-1).action, 'ADVANCED')
    assert.equal(canonicalBase.history.at(-1).resultingSha, newHead)
  })
})

test('Overnight V2 Lane L: "adopt it" over real HTTP genuinely executes a real git merge, on per-project Planner Chat', async () => {
  await withServer(async (base) => {
    const projectId = 'lane-l-adopt-per-project'
    const canonicalRepoPath = initFixtureRepo('lane-l-adopt-pp-canonical')
    const worktree = createCandidateWorktree(canonicalRepoPath, 'lane-l-adopt-pp-candidate', 'command/lane-l-adopt-pp', 'per-project real fix')
    seedOnboardedProjectForHttp(projectId, 'Lane L Adopt Per Project', canonicalRepoPath)
    seedCompleteKeepGoingRun(projectId, worktree, clock)
    const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()

    const result = await chat(base, { projectId, message: 'adopt it' })

    assert.equal(result.body.intent, 'ADOPTION_COMMAND')
    assert.match(result.body.text, /adopted: canonical advanced/i)
    const newHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()
    assert.notEqual(newHead, priorHead)
  })
})

test('Overnight V2 Lane L: duplicate delivery -- "adopt X" delivered twice over real HTTP merges exactly once, second call is honestly ALREADY_INCLUDED', async () => {
  await withServer(async (base) => {
    const projectId = 'lane-l-adopt-duplicate'
    const canonicalRepoPath = initFixtureRepo('lane-l-adopt-dup-canonical')
    const worktree = createCandidateWorktree(canonicalRepoPath, 'lane-l-adopt-dup-candidate', 'command/lane-l-adopt-dup', 'duplicate-delivery real fix')
    seedOnboardedProjectForHttp(projectId, 'Lane L Adopt Duplicate', canonicalRepoPath)
    seedCompleteKeepGoingRun(projectId, worktree, clock)

    const first = await chat(base, { projectId: null, message: `adopt ${projectId}` })
    assert.match(first.body.text, /adopted: canonical advanced/i)
    const afterFirstHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()

    const second = await chat(base, { projectId: null, message: `adopt ${projectId}` })
    assert.match(second.body.text, /already adopted/i, 'the duplicate call must be honestly reported as already-included, never a false re-adoption')
    assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), afterFirstHead, 'no second merge -- HEAD unchanged by the duplicate delivery')
    const log = git(canonicalRepoPath, ['log', '--oneline']).trim().split('\n')
    assert.equal(log.length, 2, 'no duplicate merge commit was created')
  })
})

// TSF Overnight Control-Plane Burn-In V2, Lane E (race/TOCTOU, explicitly
// named P0 territory) -- real, live-confirmed finding (not guessed),
// severe: N GENUINELY concurrent "adopt it" HTTP calls (Promise.all, not
// sequential like the duplicate-delivery test above) for the same
// project raced past executeCommandAdoption's own ancestry/
// alreadyIncluded check -- every concurrent caller read the SAME
// pre-merge canonical HEAD before any of them had merged, so all of them
// classified the candidate as FAST_FORWARD_AVAILABLE and attempted
// ffOnlyMerge. A real `git merge --ff-only` to a SHA the repo is ALREADY
// at (because an earlier concurrent caller's merge already landed) is
// NOT an error -- git honestly reports "already up to date" and the
// merge call succeeds -- so the engine's own post-merge verification
// could not distinguish "I just performed the real merge" from "someone
// else already did," and FALSELY reported a fresh "adopted: canonical
// advanced" with a brand-new, distinct receipt for EVERY concurrent
// caller. Live-confirmed before the fix: 10 genuinely concurrent calls
// produced 9 separate, real, durably-persisted FALSE ADOPTED receipts
// for a single real merge. Fixed in server/command-adoption-execution.mjs
// with a real per-project lock (an in-process promise-chain queue
// layered over the real cross-process file lock -- see that file's own
// header comment for why both layers are needed).
test('Overnight V2 Lane E: N genuinely concurrent "adopt it" HTTP calls for the same project merge exactly once -- every other call is honestly ALREADY_INCLUDED, never a false duplicate ADOPTED claim/receipt', async () => {
  await withServer(async (base) => {
    const projectId = 'lane-e-concurrent-adopt'
    const canonicalRepoPath = initFixtureRepo('lane-e-concurrent-adopt-canonical')
    const worktree = createCandidateWorktree(canonicalRepoPath, 'lane-e-concurrent-adopt-candidate', 'command/lane-e-concurrent-adopt', 'a real fix, requested N times concurrently')
    seedOnboardedProjectForHttp(projectId, 'Lane E Concurrent Adopt', canonicalRepoPath)
    seedCompleteKeepGoingRun(projectId, worktree, clock)

    const N = 10
    const results = await Promise.all(
      Array.from({ length: N }, () => chat(base, { projectId, message: 'adopt it' }))
    )

    const adopted = results.filter((r) => /adopted: canonical advanced/i.test(r.body.text ?? ''))
    const alreadyAdopted = results.filter((r) => /already adopted/i.test(r.body.text ?? ''))
    assert.equal(adopted.length, 1, `exactly one of ${N} genuinely concurrent adopt calls must actually perform the real merge`)
    assert.equal(alreadyAdopted.length, N - 1, 'every other concurrent call must be honestly ALREADY_INCLUDED, never a second false "adopted" claim')

    const log = git(canonicalRepoPath, ['log', '--oneline']).trim().split('\n')
    assert.equal(log.length, 2, `exactly one real merge commit despite ${N} genuinely concurrent duplicate calls`)

    const finalState = loadState()
    assert.equal(finalState.onboardedProjects[projectId].receipts.length, N, `exactly one receipt per real HTTP call (1 ADOPTED + ${N - 1} ALREADY_INCLUDED) -- never a false extra ADOPTED receipt`)
    assert.equal(finalState.onboardedProjects[projectId].receipts.filter((r) => r.result?.outcome === 'ADOPTED').length, 1, 'exactly one real ADOPTED receipt, never a duplicate')
  })
})

test('Overnight V2 Lane L: a message combining "adopt X" with a genuinely consequential clause is refused in full (TIM_REQUIRED) -- never partially executes the adoption', async () => {
  await withServer(async (base) => {
    const projectId = 'lane-l-adopt-tim-required'
    const canonicalRepoPath = initFixtureRepo('lane-l-adopt-tim-canonical')
    const worktree = createCandidateWorktree(canonicalRepoPath, 'lane-l-adopt-tim-candidate', 'command/lane-l-adopt-tim', 'must not be merged')
    seedOnboardedProjectForHttp(projectId, 'Lane L Adopt Tim Required', canonicalRepoPath)
    seedCompleteKeepGoingRun(projectId, worktree, clock)
    const priorHead = git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim()

    const result = await chat(base, { projectId: null, message: `adopt ${projectId} and then deploy it to production` })

    assert.equal(result.body.decisionClass, 'TIM_REQUIRED', 'the consequential clause must win a full refusal')
    assert.doesNotMatch(result.body.text, /adopted: canonical advanced/i, 'must never claim/perform an adoption when the whole message should have been refused')
    assert.equal(git(canonicalRepoPath, ['rev-parse', 'HEAD']).trim(), priorHead, 'the real repo must NOT be merged as a side effect of a message that should have been refused in full')
  })
})

// Independent-review finding (real, live-confirmed, SEVERE -- correctly
// blocked merge until fixed): the FIRST version of this fix trusted
// `project` as the adoption target unconditionally. That's correct for
// Global Command's exact-match path (there, `project` IS derived from
// THIS message's own text, earlier in the same function) but WRONG for
// per-project Planner Chat, where `project` comes from body.projectId --
// the conversation's fixed scope, with no relationship to what the
// message text names. Live-reproduced BEFORE the fix: chatting in
// Project A's own thread and typing "adopt proj-b" (a real, different,
// ready-for-adoption project) genuinely merged Project A -- never
// touching Project B, exactly backwards from what the message said.
// Fixed by independently re-deriving the message's own exact project
// mentions and refusing (never guessing) whenever one names a DIFFERENT
// project than the request's actual scope.
test('Overnight V2 Lane L: per-project Planner Chat scoped to A, message explicitly names a DIFFERENT real project B -- refuses honestly, never merges A (wrong project) or B (never asked)', async () => {
  await withServer(async (base) => {
    const repoA = initFixtureRepo('lane-l-wrongproj-a-canonical')
    const wtA = createCandidateWorktree(repoA, 'lane-l-wrongproj-a-candidate', 'command/lane-l-wrongproj-a', 'must not be merged as a side effect')
    seedOnboardedProjectForHttp('lane-l-wrongproj-a', 'Lane L Wrongproj A', repoA)
    seedCompleteKeepGoingRun('lane-l-wrongproj-a', wtA, clock)

    const repoB = initFixtureRepo('lane-l-wrongproj-b-canonical')
    const wtB = createCandidateWorktree(repoB, 'lane-l-wrongproj-b-candidate', 'command/lane-l-wrongproj-b', 'must never be silently merged either -- never asked')
    seedOnboardedProjectForHttp('lane-l-wrongproj-b', 'Lane L Wrongproj B', repoB)
    seedCompleteKeepGoingRun('lane-l-wrongproj-b', wtB, clock)

    const priorHeadA = git(repoA, ['rev-parse', 'HEAD']).trim()
    const priorHeadB = git(repoB, ['rev-parse', 'HEAD']).trim()

    const result = await chat(base, { projectId: 'lane-l-wrongproj-a', message: 'adopt lane-l-wrongproj-b' })

    assert.equal(result.body.decisionClass, 'NEEDS_OWNER', 'a scope/message conflict must be an honest refusal, never a guess either way')
    assert.doesNotMatch(result.body.text, /adopted: canonical advanced/i, 'must never claim either project was adopted')
    assert.equal(git(repoA, ['rev-parse', 'HEAD']).trim(), priorHeadA, 'the SCOPED project (A) must not be merged just because the request landed in its thread')
    assert.equal(git(repoB, ['rev-parse', 'HEAD']).trim(), priorHeadB, 'the NAMED project (B) must not be merged either -- the user was never asked to confirm')

    // Sanity: "adopt it" (no explicit conflicting name) in the SAME scope
    // still works normally -- this fix must not break the common case.
    const sane = await chat(base, { projectId: 'lane-l-wrongproj-a', message: 'adopt it' })
    assert.match(sane.body.text, /adopted: canonical advanced/i)
    assert.notEqual(git(repoA, ['rev-parse', 'HEAD']).trim(), priorHeadA, '"adopt it" in the correctly-scoped thread must still really adopt A')
  })
})

// SECOND independent-review finding (real, live-confirmed, fixed here
// BEFORE merge): the wrong-project guard above originally only counted a
// NON-fuzzy mention of a different project as conflicting. A message
// naming most (not all) of a different real project's own display-name
// tokens -- clearly legible to a human, and resolveProjectsFromText's own
// FUZZY_CONFIDENCE_FLOOR (0.6) genuinely flags it -- resolved with
// matchedOn: 'fuzzy' and silently bypassed the guard, reproducing the
// identical wrong-project merge the guard exists to prevent.
// Live-reproduced: scoped to Project A, "adopt the trail overhaul"
// fuzzy-matched (0.667 confidence, 2/3 tokens) a real, differently-named
// Project B ("Redwood Trail Overhaul") and silently merged A anyway.
// Fixed by no longer excluding fuzzy matches from the conflict check --
// deliberately MORE conservative than the "only exact is trusted enough
// to ACT on" convention this codebase otherwise uses, since a
// false-positive refusal here is far cheaper than a real, irreversible
// wrong-project merge.
test('Overnight V2 Lane L: a FUZZY (not exact) mention of a different real project in per-project chat also refuses honestly, never merges either project', async () => {
  await withServer(async (base) => {
    const repoA = initFixtureRepo('lane-l-fuzzy-wrongproj-a-canonical')
    const wtA = createCandidateWorktree(repoA, 'lane-l-fuzzy-wrongproj-a-candidate', 'command/lane-l-fuzzy-wrongproj-a', 'must not be merged as a side effect')
    seedOnboardedProjectForHttp('lane-l-fuzzy-wrongproj-a', 'Lane L Fuzzy Wrongproj A', repoA)
    seedCompleteKeepGoingRun('lane-l-fuzzy-wrongproj-a', wtA, clock)

    const repoB = initFixtureRepo('lane-l-fuzzy-wrongproj-b-canonical')
    const wtB = createCandidateWorktree(repoB, 'lane-l-fuzzy-wrongproj-b-candidate', 'command/lane-l-fuzzy-wrongproj-b', 'the real intended target -- never confirmed, must not be merged either')
    seedOnboardedProjectForHttp('lane-l-redwood-trail-overhaul', 'Redwood Trail Overhaul', repoB)
    seedCompleteKeepGoingRun('lane-l-redwood-trail-overhaul', wtB, clock)

    const priorHeadA = git(repoA, ['rev-parse', 'HEAD']).trim()
    const priorHeadB = git(repoB, ['rev-parse', 'HEAD']).trim()

    const result = await chat(base, { projectId: 'lane-l-fuzzy-wrongproj-a', message: 'adopt the trail overhaul' })

    assert.equal(result.body.decisionClass, 'NEEDS_OWNER', 'a fuzzy scope/message conflict must also be an honest refusal, never a guess either way')
    assert.doesNotMatch(result.body.text, /adopted: canonical advanced/i, 'must never claim either project was adopted')
    assert.equal(git(repoA, ['rev-parse', 'HEAD']).trim(), priorHeadA, 'the SCOPED project (A) must not be merged just because the request landed in its thread')
    assert.equal(git(repoB, ['rev-parse', 'HEAD']).trim(), priorHeadB, 'the FUZZY-named project (B) must not be merged either -- the user was never asked to confirm')
  })
})

// TSF Overnight Control-Plane Burn-In V2, Lane C (stateful conversational
// sequences) -- a capstone integration test tying tonight's whole PAUSE/
// RESUME + ADOPTION HTTP-wiring fix together into one realistic
// per-project Planner Chat conversation: status -> adopt -> status,
// against a real disposable git repo, now that BOTH capabilities finally
// work end to end from this surface.
//
// CORRECTED scope note (verified by direct investigation, not assumed):
// the assertion below proves attachDueAttentionNotices' own real
// notification-dedup (a due READY_FOR_ADOPTION event is not re-notified
// once already delivered in this same session/thread -- the SAME
// property MULTI_PROJECT_COMMAND_ORCHESTRATION_OVERNIGHT_V1_CHECKPOINT.md
// already dogfood-proved earlier this mission) -- it does NOT prove the
// underlying candidate is actually recognized as adopted. Investigated
// directly and confirmed a real, separate, DISCLOSED (not fixed
// tonight) finding: domain/live-work-feed.mjs's projectLiveWorkFeedState
// classifies READY_FOR_ADOPTION purely from `run.state === 'COMPLETE'`,
// and executeCommandAdoption never updates the Keep Going run's own
// state after a real, successful merge (only the receipt/canonical-base
// stores are updated) -- so a FRESH attention check (confirmed live via
// a direct GET /api/attention call, not gated by any chat-thread dedup)
// still lists an ALREADY-adopted project as READY_FOR_ADOPTION with the
// same stale "run reached COMPLETE..." reason, indefinitely. Recorded in
// the overnight queue memory as real follow-up work -- not fixed here,
// since the real, safe fix requires either a Keep Going run
// state-machine extension (COMPLETE is otherwise the one intentionally
// terminal state, per tonight's own Lane H property test) or a
// cross-cutting fix to the attention-aggregation read path, both a
// larger, more careful change than this session's remaining scope
// warrants tonight.
test('Overnight V2 Lane C: a real per-project conversation -- status, then adopt it, then status again -- the SAME-session notification correctly does not repeat (dedup, not staleness-awareness -- see comment above)', async () => {
  await withServer(async (base) => {
    const repo = initFixtureRepo('capstone-canonical')
    const wt = createCandidateWorktree(repo, 'capstone-candidate', 'command/capstone', 'a real fix for the capstone flow')
    seedOnboardedProjectForHttp('capstone-proj', 'Capstone Proj', repo)
    seedCompleteKeepGoingRun('capstone-proj', wt, clock)
    const priorHead = git(repo, ['rev-parse', 'HEAD']).trim()

    const before = await chat(base, { projectId: 'capstone-proj', message: 'what is the status?' })
    assert.match(before.body.text, /Capstone Proj\*\* is ready for adoption/, 'before the real merge, the status honestly says the candidate is ready for adoption')

    const adopted = await chat(base, { projectId: 'capstone-proj', message: 'adopt it' })
    assert.equal(adopted.body.intent, 'ADOPTION_COMMAND')
    assert.match(adopted.body.text, /adopted: canonical advanced/i)
    const newHead = git(repo, ['rev-parse', 'HEAD']).trim()
    assert.notEqual(newHead, priorHead, 'the real repo must genuinely be merged mid-conversation')

    const after = await chat(base, { projectId: 'capstone-proj', message: 'what is the status?' })
    assert.doesNotMatch(after.body.text, /Capstone Proj\*\* is ready for adoption/, 'the SAME-session notification for the SAME unchanged event must not repeat (real dedup); this does NOT prove the underlying classification is adoption-aware -- see this test\'s own header comment')
  })
})
