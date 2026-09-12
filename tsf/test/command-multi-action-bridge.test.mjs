// Multi-Project Command + Real Fleet Orchestration Overnight V1, Parts
// A4-A6: integration coverage for the real multi-action bridge wired into
// respondCommand. Isolated-state-file pattern (mirrors command-responder.
// test.mjs exactly) since this really writes a durable project execution
// hold through the real store.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { rmSync } from 'node:fs'

const NONEXISTENT = path.join(import.meta.dirname, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
// Forces HEALTHY deterministically -- same seam chat-dispatch-bridge.test.mjs
// uses -- so this file's real-dispatch-path assertions are never flaky
// against this (shared, contended) host's actual live memory.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)
const STATE_FILE = path.join(
  import.meta.dirname,
  '..',
  'server',
  '.local-state',
  `operator-state.test-command-multi-action-bridge-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of [
    '',
    '.tmp',
    '.self-improvement-finding.lock',
    '.project-execution-hold.lock'
  ]) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { respondCommand } = await import('../server/command-responder.mjs')
const { classifyMultiActionEntries, classifySingleTargetHoldEntries, respondMultiActionCommand } =
  await import('../server/command-multi-action-bridge.mjs')
const { readProjectExecutionHold, withProjectExecutionHold } =
  await import('../server/project-execution-hold-store.mjs')
const { createProjectExecutionHold, releaseProjectExecutionHold } =
  await import('../domain/project-execution-hold.mjs')
const { createOvernightRun, completeRun } = await import('../domain/keep-going.mjs')
const { withKeepGoingRun, readKeepGoingRun } = await import('../server/keep-going-run-store.mjs')

const clock = () => new Date('2026-09-07T09:00:00.000Z')

function project(id, displayName, overrides = {}) {
  return {
    id,
    displayName,
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] },
    ...overrides
  }
}

const PROJECTS = [
  project('niners-war-room', 'Niners War Room'),
  project(
    'worldforge-sablewake-live-runtime-repair-v3',
    'Worldforge-Sablewake-Live-Runtime-Repair-V3'
  ),
  project('easylifehq-github-io', 'EasyLifeHQ'),
  project('tsf-orca', 'TSF Orca')
]

const opState = { keepGoingRuns: {} }

const MISSION_MESSAGE =
  'NWR is being handled by another AI, leave it alone. Nytheria looks good, adopt that run and keep going overnight. EasyLife needs serious work -- get EasyWorkouts up so I can start logging workouts.'

test("classifyMultiActionEntries: the mission's own literal message clears the gate (3 targets, distinct intents)", () => {
  const entries = classifyMultiActionEntries(MISSION_MESSAGE, PROJECTS, undefined)
  assert.ok(entries)
  assert.equal(new Set(entries.map((e) => e.target)).size, 3)
})

test("classifyMultiActionEntries: a same-action-to-N-projects message (dispatchAndRespond's own job) never clears the gate", () => {
  assert.equal(
    classifyMultiActionEntries(
      'get niners-war-room and worldforge-sablewake-live-runtime-repair-v3 ready',
      PROJECTS,
      undefined
    ),
    null
  )
})

test('classifyMultiActionEntries: an ordinary single-project message never clears the gate', () => {
  assert.equal(
    classifyMultiActionEntries('go ahead and fix niners-war-room', PROJECTS, undefined),
    null
  )
})

test("respondCommand: the mission's own literal message produces a real, grouped-by-project, per-action response", async () => {
  // A real, live-feed READY_FOR_ADOPTION run for WorldForge -- so
  // ADOPT_CANDIDATE_REPORT's "can't adopt" honesty is exercised against a
  // real ready candidate, not just the (also real, also honest) "nothing
  // ready" empty case.
  const readyRun = completeRun(
    createOvernightRun(
      {
        id: 'run-worldforge',
        projectId: 'worldforge-sablewake-live-runtime-repair-v3',
        originalGoal: 'Repair the runtime.',
        acceptanceCriteria: ['X']
      },
      clock
    ),
    clock
  )
  const opStateWithReadyRun = {
    keepGoingRuns: { 'worldforge-sablewake-live-runtime-repair-v3': readyRun }
  }
  const result = await respondCommand({
    message: MISSION_MESSAGE,
    projects: PROJECTS,
    opState: opStateWithReadyRun,
    clock
  })

  assert.equal(result.intent, 'MULTI_ACTION')
  assert.equal(result.scope, 'MULTI_PROJECT')
  assert.deepEqual(
    new Set(result.resolvedProjectIds),
    new Set([
      'niners-war-room',
      'worldforge-sablewake-live-runtime-repair-v3',
      'easylifehq-github-io'
    ])
  )

  // A6: grouped by project, real headers.
  assert.match(result.text, /\*\*Niners War Room\*\*/)
  assert.match(result.text, /\*\*Worldforge-Sablewake-Live-Runtime-Repair-V3\*\*/)
  assert.match(result.text, /\*\*EasyLifeHQ\*\*/)

  // NWR: really, durably held -- not just a claimed intention.
  assert.match(result.text, /Held --/)
  const nwrHold = readProjectExecutionHold('niners-war-room')
  assert.equal(nwrHold.status, 'ACTIVE')
  assert.equal(nwrHold.reason, 'EXTERNAL_WORK_ACTIVE')
  assert.equal(nwrHold.setBy, 'OPERATOR_CHAT')

  // WorldForge: Fleet Dispatch Readiness + Explicit Command Adoption V1,
  // Part A -- explicit "adopt" language now genuinely ATTEMPTS a real
  // execution (never report-only for explicit intent any more). This
  // fixture project has no real repository root, so it fails honestly
  // (never silently claims success, never silently falls back to the old
  // report-only text).
  assert.match(result.text, /couldn't adopt/)
  assert.doesNotMatch(result.text, /ADOPT_CANDIDATE_EXECUTE/)

  // A4: resultItems reflects the FULL multi-project result set, not one child's.
  assert.ok(Array.isArray(result.resultItems))
  assert.deepEqual(
    new Set(result.resultItems.map((i) => i.project?.id)),
    new Set([
      'niners-war-room',
      'worldforge-sablewake-live-runtime-repair-v3',
      'easylifehq-github-io'
    ])
  )
})

test('A5: a held target refuses its own action honestly while the other targets in the SAME message still execute/report normally', async () => {
  await withProjectExecutionHold('worldforge-sablewake-live-runtime-repair-v3', () =>
    createProjectExecutionHold(
      {
        projectId: 'worldforge-sablewake-live-runtime-repair-v3',
        reason: 'EXTERNAL_WORK_ACTIVE',
        setBy: 'test-setup',
        note: 'pre-seeded for this test'
      },
      clock
    )
  )
  // Stubs the real dispatch-chain prerequisites (worktree/identity) to
  // reach the REAL hold check inside planAndDispatchFromChat -- these
  // fixture projects have no real `root`, so without this the dispatch
  // would honestly fail earlier at TSF_REPOSITORY_NOT_REGISTERED, never
  // reaching the hold gate this test is actually proving.
  const dispatchDeps = {
    findRegisteredOrcaRepo: async () => ({ ok: true, registered: true, repo: { id: 'stub-repo' } }),
    createOrcaWorktree: async () => ({ ok: true, worktreePath: 'C:/stub-worktree' }),
    resolveRepositoryIdentity: async () => ({
      ok: true,
      identity: {
        root: 'C:/stub-repo',
        worktree: 'C:/stub-worktree',
        branch: 'main',
        head: 'a'.repeat(40),
        tree: 'a'.repeat(40)
      }
    }),
    invokeLiveStructuredAnalysis: async () => ({
      ok: false,
      reason: 'STUBBED_NO_LIVE_CALL',
      detail: 'test stub -- never a real live call'
    }),
    // Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C:
    // ensureWorktreeForDispatch now resolves a real canonical base ref
    // before creating a worktree -- stubbed here (this fixture's `root`
    // doesn't really exist on disk) so this test still reaches the REAL
    // hold check it's actually proving, same deps-injection convention as
    // every other stub above.
    resolveProjectCanonicalBase: async () => ({
      resolved: true,
      ref: 'main',
      source: 'REPO_STANDARD_DEFAULT'
    })
  }
  // A local project list with a real `root` (unlike the shared PROJECTS
  // fixture) -- required to reach past ensureWorktreeForDispatch's own
  // upfront "no known repository root" guard and into the REAL hold check
  // this test is proving; dispatchDeps stubs everything downstream of that
  // guard so nothing here ever touches a real repo or real live provider.
  const projectsWithRoot = PROJECTS.map((p) => ({ ...p, root: 'C:/stub-repo-root' }))
  const message =
    'NWR needs serious work. WorldForge: keep going overnight. EasyLife: adopt that run.'
  const result = await respondCommand({
    message,
    projects: projectsWithRoot,
    opState,
    clock,
    deps: dispatchDeps
  })

  assert.equal(result.intent, 'MULTI_ACTION')
  // The held target's own line is an honest refusal naming the real hold reason.
  assert.match(
    result.text,
    /Worldforge-Sablewake-Live-Runtime-Repair-V3[\s\S]*couldn't start[\s\S]*EXTERNAL_WORK_ACTIVE/
  )
  // The other two targets are NOT dropped/crashed -- each still has its own real section.
  assert.match(result.text, /\*\*Niners War Room\*\*/)
  assert.match(result.text, /\*\*EasyLifeHQ\*\*/)
  assert.deepEqual(
    new Set(result.resolvedProjectIds),
    new Set([
      'niners-war-room',
      'worldforge-sablewake-live-runtime-repair-v3',
      'easylifehq-github-io'
    ])
  )
})

test('A5: a TIM_REQUIRED clause on one target refuses that action only, independent of the other targets in the same message', async () => {
  const message =
    'TSF Orca: push it to production. Nytheria looks good, adopt that run and keep going overnight.'
  const result = await respondCommand({ message, projects: PROJECTS, opState, clock })
  assert.equal(result.intent, 'MULTI_ACTION')
  assert.match(result.text, /TSF Orca[\s\S]*consequential decision/)
  // The independent, ungated target still got its own real report/dispatch attempt.
  assert.match(result.text, /\*\*Worldforge-Sablewake-Live-Runtime-Repair-V3\*\*/)
  assert.doesNotMatch(
    result.text,
    /Worldforge-Sablewake-Live-Runtime-Repair-V3[\s\S]*consequential decision/
  )
})

test('Stage 2 Phase 1 convergence: a PAUSE entry reaches the canonical action-executor boundary (deps.executeAction), not a direct pauseProjectRun call', async () => {
  const target = project('convergence-pause-target', 'ConvergencePauseTarget')
  const calls = []
  await respondMultiActionCommand({
    projects: [target, project('convergence-adopt-target', 'ConvergenceAdoptTarget')],
    opState,
    clock,
    entries: [
      { target: target.id, intent: 'PAUSE', rawClause: 'pause ConvergencePauseTarget' },
      {
        target: 'convergence-adopt-target',
        intent: 'ADOPT_CANDIDATE_REPORT',
        rawClause: 'adopt ConvergenceAdoptTarget'
      }
    ],
    deps: {
      // Type-aware: both PAUSE and ADOPT now converge on this SAME
      // deps.executeAction seam (Stage 2 Phase 2), so a spy that ignores
      // request.type would wrongly intercept the ADOPT entry too and hand
      // it back a PAUSE-shaped result -- only PAUSE is spied on here; ADOPT
      // gets a real adoption-shaped stub result, matching what the real
      // executor would produce.
      executeAction: async (request) => {
        if (request.type === 'PAUSE') {
          calls.push(request)
          return { ok: true, action: 'PAUSE' }
        }
        return {
          ok: true,
          alreadyIncluded: false,
          priorCanonicalSha: 'a'.repeat(40),
          resultingCanonicalSha: 'b'.repeat(40),
          receipt: { receiptHash: 'c'.repeat(64) }
        }
      }
    }
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].type, 'PAUSE')
  assert.equal(calls[0].target, target.id)
})

test('Stage 2 Phase 3 convergence: EXTERNAL_WORK_HOLD/RELEASE_HOLD entries reach deps.executeAction, not withProjectExecutionHold directly', async () => {
  const holdTarget = project('convergence-hold-target', 'ConvergenceHoldTarget')
  const releaseTarget = project('convergence-release-target', 'ConvergenceReleaseTarget')
  const calls = []
  const spy = async (request) => {
    calls.push(request)
    return request.type === 'HOLD'
      ? { ok: true, action: 'HOLD', hold: { note: 'x' } }
      : { ok: true, action: 'RELEASE_HOLD', releasedSomething: true }
  }
  await respondMultiActionCommand({
    projects: [holdTarget, releaseTarget],
    opState,
    clock,
    entries: [
      {
        target: holdTarget.id,
        intent: 'EXTERNAL_WORK_HOLD',
        rawClause: 'leave ConvergenceHoldTarget alone'
      },
      {
        target: releaseTarget.id,
        intent: 'RELEASE_HOLD',
        rawClause: 'release the hold on ConvergenceReleaseTarget'
      }
    ],
    deps: { executeAction: spy }
  })
  assert.deepEqual(
    calls.map((c) => [c.type, c.target]),
    [
      ['HOLD', holdTarget.id],
      ['RELEASE_HOLD', releaseTarget.id]
    ]
  )
})

test("PAUSE/RESUME failures are reported per target and never block another target's adoption", async () => {
  const pauseTarget = project('pause-failure-target', 'PauseFailureTarget')
  const resumeTarget = project('resume-failure-target', 'ResumeFailureTarget')
  const adoptionTarget = project('adoption-after-run-failures', 'AdoptionAfterRunFailures')
  let adoptionCalls = 0
  const result = await respondMultiActionCommand({
    projects: [pauseTarget, resumeTarget, adoptionTarget],
    opState,
    clock,
    entries: [
      { target: pauseTarget.id, intent: 'PAUSE', rawClause: 'pause PauseFailureTarget' },
      { target: resumeTarget.id, intent: 'RESUME', rawClause: 'resume ResumeFailureTarget' },
      {
        target: adoptionTarget.id,
        intent: 'ADOPT_CANDIDATE_REPORT',
        rawClause: 'adopt AdoptionAfterRunFailures'
      }
    ],
    deps: {
      pauseProjectRun: async () => {
        throw new Error('pause refused')
      },
      classifyContinueAction: () => 'RESUME',
      resumeProjectRun: async () => {
        throw new Error('resume refused')
      },
      executeCommandAdoption: async () => {
        adoptionCalls++
        return {
          ok: true,
          alreadyIncluded: false,
          priorCanonicalSha: 'a'.repeat(40),
          resultingCanonicalSha: 'b'.repeat(40),
          receipt: { receiptHash: 'c'.repeat(64) }
        }
      }
    }
  })

  assert.match(result.text, /couldn't pause -- pause refused\./)
  assert.match(result.text, /couldn't resume -- resume refused\./)
  assert.match(result.text, /adopted -- canonical advanced/)
  assert.equal(adoptionCalls, 1)
})

// FIXED (real, live-confirmed P0 -- Full Conversational Control Plane
// Exhaustive Gauntlet V1, Batch 2): "Don't adopt NWR; adopt EasyLife." used
// to have the WHOLE message refused (both projects), because both clauses
// decomposed to the same negation-blind ADOPT_CANDIDATE_REPORT intent, so
// classifyMultiActionEntries' own >=2-distinguishing-intents gate never
// fired and the message fell through to the single-message-level
// classifyAdoptionCommandIntent check instead -- which correctly found the
// negation, but has no per-target concept at all, so it wrongly suppressed
// EasyLife's completely separate, legitimate request too.
test('A5/Batch-2: a negated adoption request for one project never suppresses a genuine, separate adoption request for a different project in the same message', async () => {
  const message = "Don't adopt niners-war-room; adopt EasyLifeHQ."
  const gated = classifyMultiActionEntries(message, PROJECTS, undefined)
  assert.ok(gated, 'the negation-aware decomposition must clear the multi-action gate')
  const result = await respondCommand({ message, projects: PROJECTS, opState, clock })
  assert.equal(result.intent, 'MULTI_ACTION')
  // NWR: honestly reported, never executed.
  assert.match(result.text, /Niners War Room[\s\S]*(?:nothing ready for adoption|couldn't adopt)/i)
  // EasyLifeHQ: a REAL adoption attempt was made (not silently skipped) --
  // it fails here only because this fixture has no real repository root,
  // never because of NWR's unrelated negation.
  assert.match(result.text, /EasyLifeHQ[\s\S]*couldn't adopt/i)
  assert.doesNotMatch(result.text, /EasyLifeHQ[\s\S]*nothing ready for adoption/i)
})

// FIXED (real, BLOCKING, confirmed via real end-to-end dispatch --
// adversarial review, Batch 3): "Don't keep going on niners-war-room;
// EasyLifeHQ needs serious work." used to actually dispatch a brand-new
// Keep Going mission for niners-war-room despite the explicit "Don't" --
// nothing downstream of the decomposer caught it (the per-clause
// TIM_REQUIRED check doesn't recognize "keep going"/"assess" as
// consequential at all). This is a real end-to-end proof through the
// actual dispatch pipeline (same dispatchDeps-stubbing convention as the
// "A5: a held target" test above) that this negated clause now produces
// zero dispatch.
test('Batch-3: a negated "keep going" request never dispatches real work, even when a genuine request for a different project is in the same message', async () => {
  // MULTI_ACTION_DECLINED (domain/command-multi-action-decomposition.mjs)
  // is a pure, synchronous, zero-I/O branch -- no dispatch stubbing is
  // needed to prove NWR gets no action; EasyLifeHQ's own real attempt is
  // allowed to fail honestly (no real repo root in this fixture), which is
  // exactly what "not a fabricated success" looks like.
  const message = "Don't keep going on niners-war-room; EasyLifeHQ needs serious work."
  const result = await respondCommand({ message, projects: PROJECTS, opState, clock })
  assert.equal(result.intent, 'MULTI_ACTION')
  assert.match(result.text, /Niners War Room[\s\S]*no action taken/i)
  assert.doesNotMatch(result.text, /Niners War Room[\s\S]*(?:new mission started|dispatched)/i)
})

// FIXED (real, SHOULD-FIX -- final red-team review): a negated hold
// request must never write a real, durable execution hold. Real
// end-to-end proof, checking the actual durable store, not just the
// response text.
test('Batch-4: a negated hold request never writes a real, durable project execution hold', async () => {
  // A fresh, dedicated project id -- PROJECTS' own niners-war-room is
  // touched by earlier tests in this file (a real, intentionally-durable
  // hold from the mission-literal-message test), so it is not a clean
  // slate here.
  const freshProject = {
    id: 'batch4-fresh-hold-target',
    displayName: 'Batch4FreshHoldTarget',
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
  const before = readProjectExecutionHold(freshProject.id)
  assert.equal(before, null, 'sanity: no pre-existing hold for this fresh fixture project')
  // Needs a second, genuinely distinguishing action on a different target
  // to even reach classifyMultiActionEntries' own gate at all (requires
  // >=2 targets by design). A genuinely single-project negated hold
  // request instead goes through classifySingleTargetHoldEntries (see
  // below) -- also proven negation-safe there, since decomposeMultiAction
  // itself (shared by both gates) correctly classifies a negated hold
  // clause as GENERAL, never EXTERNAL_WORK_HOLD.
  const message =
    "Don't leave batch4-fresh-hold-target alone, keep working on it directly. EasyLifeHQ needs serious work."
  const result = await respondCommand({
    message,
    projects: [...PROJECTS, freshProject],
    opState,
    clock
  })
  assert.equal(result.intent, 'MULTI_ACTION')
  assert.match(result.text, /Batch4FreshHoldTarget[\s\S]*no action taken/i)
  const after = readProjectExecutionHold(freshProject.id)
  assert.equal(after, null, 'no durable hold must have been written')
})

// TSF Overnight Control-Plane Burn-In V2, real finding (not guessed):
// classifyMultiActionEntries' own >=2-target gate is deliberately
// conservative "so an ordinary single-target message... is never
// rerouted away from their own existing, correct handling" -- but a
// genuinely single-target EXTERNAL_WORK_HOLD request never actually had
// any other real handling anywhere in this codebase. Live-reproduced
// over the real HTTP route before fixing (see http-chat-hold-command.
// test.mjs for the full HTTP-level proof): a natural, single-project
// hold request on both per-project chat and Global Command exact-match
// never set a real hold. Fixed with classifySingleTargetHoldEntries, a
// narrower ADDITIONAL gate reusing the same real per-clause decomposer.
test('real finding, FIXED: a genuinely single-target hold request now really sets a durable execution hold via respondCommand', async () => {
  const freshProject = {
    id: 'single-target-hold-fixture',
    displayName: 'SingleTargetHoldFixture',
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
  const before = readProjectExecutionHold(freshProject.id)
  assert.equal(before, null, 'sanity: no pre-existing hold for this fresh fixture project')

  const message =
    'single-target-hold-fixture is being handled by another agent right now, leave it alone -- do not touch it.'
  const result = await respondCommand({
    message,
    projects: [...PROJECTS, freshProject],
    opState,
    clock
  })
  assert.match(result.text, /SingleTargetHoldFixture[\s\S]*Held/)

  const after = readProjectExecutionHold(freshProject.id)
  assert.ok(after, 'a real, durable hold must actually have been written')
  assert.equal(after.status, 'ACTIVE')
  assert.equal(after.reason, 'EXTERNAL_WORK_ACTIVE')
})

// Pre-UI Productization V1, Priority 2, real finding: "release hold" was
// recognized syntactically (domain/command-act-model.mjs) but wired to
// ZERO real execution anywhere -- releaseProjectExecutionHold (already
// real, already tested) was never called from any chat/command path.
test('real finding, FIXED: a genuinely single-target release request really lifts a durable execution hold via respondCommand', async () => {
  const freshProject = {
    id: 'single-target-release-fixture',
    displayName: 'SingleTargetReleaseFixture',
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
  await withProjectExecutionHold(freshProject.id, () =>
    createProjectExecutionHold(
      { projectId: freshProject.id, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test-setup' },
      clock
    )
  )
  const before = readProjectExecutionHold(freshProject.id)
  assert.equal(
    before.status,
    'ACTIVE',
    'sanity: a real, active hold exists before the release request'
  )

  const message = 'release the hold on single-target-release-fixture.'
  const result = await respondCommand({
    message,
    projects: [...PROJECTS, freshProject],
    opState,
    clock
  })
  assert.match(result.text, /SingleTargetReleaseFixture[\s\S]*Released/)

  const after = readProjectExecutionHold(freshProject.id)
  assert.equal(after.status, 'RELEASED', 'the hold must really, durably flip to RELEASED')
  assert.equal(after.releasedBy, 'OPERATOR_CHAT')
})

test('real finding, FIXED: releasing a project with no active hold is an honest no-op, never a fabricated "released" claim', async () => {
  const freshProject = {
    id: 'release-nothing-fixture',
    displayName: 'ReleaseNothingFixture',
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
  assert.equal(
    readProjectExecutionHold(freshProject.id),
    null,
    'sanity: no hold at all for this fresh fixture'
  )

  const message = 'release the hold on release-nothing-fixture.'
  const result = await respondCommand({
    message,
    projects: [...PROJECTS, freshProject],
    opState,
    clock
  })
  assert.match(result.text, /Nothing to release/)
  assert.doesNotMatch(result.text, /Released/)
  assert.equal(
    readProjectExecutionHold(freshProject.id),
    null,
    'must never fabricate a hold record that was never real'
  )
})

test('real finding, FIXED: a negated release request classifies MULTI_ACTION_DECLINED, never really releases -- "Don\'t release the hold on niners-war-room."', async () => {
  const projectId = 'negated-release-fixture'
  const freshProject = {
    id: projectId,
    displayName: 'NegatedReleaseFixture',
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
  await withProjectExecutionHold(projectId, () =>
    createProjectExecutionHold(
      { projectId, reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test-setup' },
      clock
    )
  )

  const message = `Don't release the hold on ${projectId}.`
  const result = await respondCommand({
    message,
    projects: [...PROJECTS, freshProject],
    opState,
    clock
  })
  assert.doesNotMatch(result.text, /Released/)

  const after = readProjectExecutionHold(projectId)
  assert.equal(
    after.status,
    'ACTIVE',
    'a negated release request must never actually lift the real hold'
  )
})

// Round-2 independent-review finding (real, live-reproduced by the
// reviewer at the respondCommand level, fixed here): the original
// singleTargetHoldEntries check returned immediately on a match, before
// classifyRunActionVerb ever ran -- so a message combining a genuine
// PAUSE directive with a genuine hold directive for the SAME project,
// reaching respondCommand via Global Command's own ambiguous-match path,
// silently applied the hold and dropped the pause entirely (the run
// stayed ACTIVE while the response read as complete success). Fixed by
// computing the hold entries without an early return, then merging a
// matching hold into whichever PAUSE/RESUME outcome actually fires.
test('real finding (round 2), FIXED: a message combining a real PAUSE directive with a real hold directive for the SAME project executes BOTH via respondCommand, never silently drops either', async () => {
  const freshProject = {
    id: 'pause-and-hold-fixture',
    displayName: 'PauseAndHoldFixture',
    sourceClass: 'REAL',
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
  await withKeepGoingRun(freshProject.id, () =>
    createOvernightRun(
      {
        id: `run-${freshProject.id}`,
        projectId: freshProject.id,
        originalGoal: 'Test goal.',
        acceptanceCriteria: ['X']
      },
      clock
    )
  )
  const before = readProjectExecutionHold(freshProject.id)
  assert.equal(before, null, 'sanity: no pre-existing hold for this fresh fixture project')

  const message =
    'Pause PauseAndHoldFixture. It is being handled by another agent right now, leave it alone -- do not touch it.'
  const result = await respondCommand({
    message,
    projects: [...PROJECTS, freshProject],
    opState,
    clock
  })
  assert.match(result.text, /Paused/, 'the real pause must still execute')
  assert.match(result.text, /Held/, 'the real hold must ALSO execute -- never silently dropped')

  assert.equal(readKeepGoingRun(freshProject.id).state, 'PAUSED', 'the run must really be paused')
  const after = readProjectExecutionHold(freshProject.id)
  assert.ok(after, 'a real, durable hold must ALSO have been written')
  assert.equal(after.status, 'ACTIVE')
})

test('classifySingleTargetHoldEntries: a negated single-target hold request is never classified as a real hold entry', () => {
  const freshProject = { id: 'negated-single-hold', displayName: 'NegatedSingleHold' }
  const entries = classifySingleTargetHoldEntries(
    "Don't hold negated-single-hold, keep working on it directly.",
    [freshProject],
    {}
  )
  assert.equal(
    entries,
    null,
    'a negated hold clause must never classify as a real EXTERNAL_WORK_HOLD entry'
  )
})

test("classifySingleTargetHoldEntries: a genuinely 2-target message is left to classifyMultiActionEntries' own gate, never double-handled here", () => {
  const projectA = { id: 'dual-target-a', displayName: 'DualTargetA' }
  const projectB = { id: 'dual-target-b', displayName: 'DualTargetB' }
  const entries = classifySingleTargetHoldEntries(
    'dual-target-a is being handled by another agent, leave it alone. dual-target-b needs serious work.',
    [projectA, projectB],
    {}
  )
  assert.equal(
    entries,
    null,
    'a genuinely 2-target message must be left to classifyMultiActionEntries, never matched by this narrower single-target gate'
  )
})

// Independent-review finding (real, test-quality gap found and fixed
// here, not a production bug): the existing HTTP-level "wrong project"
// test (http-chat-hold-command.test.mjs) proves the end-to-end outcome
// (neither A nor B ever held) but doesn't isolate WHICH of the two real
// safety layers is doing the work -- chat-http-routes.mjs's own
// `projects: [project]` scoping into classifySingleTargetHoldEntries, and
// respondMultiActionCommand's own independent `projects.find(...)` lookup
// before ever writing anything. The reviewer confirmed (their own
// mutation) that breaking ONLY the first layer still leaves that HTTP
// test green, fully masked by the second -- a real regression there alone
// would ship silently. This test isolates the FIRST layer specifically,
// calling classifySingleTargetHoldEntries directly (no HTTP, no
// respondMultiActionCommand) with the exact same scoped-projects-array
// shape chat-http-routes.mjs actually passes: `[project]` never includes
// the other, differently-named real project a message might mention.
test('classifySingleTargetHoldEntries: scoped to ONLY project A ([project], never the full catalog), a message naming a DIFFERENT real project B can never produce an entry targeting B', () => {
  const projectA = { id: 'scoped-hold-a', displayName: 'ScopedHoldA' }
  const projectB = { id: 'scoped-hold-b', displayName: 'ScopedHoldB' }
  // decomposeMultiAction is given ONLY [projectA] -- exactly what chat-
  // http-routes.mjs's own holdCommandResult block passes -- so it has no
  // knowledge of projectB at all, regardless of what the message text says.
  const entries = classifySingleTargetHoldEntries(
    'scoped-hold-b is being handled by another agent, leave it alone.',
    [projectA],
    {}
  )
  if (entries) {
    for (const entry of entries) {
      assert.notEqual(
        entry.target,
        projectB.id,
        'a message naming project B must never produce an entry whose target is B, when B was never in the passed-in projects array'
      )
    }
  }
  // The real, expected outcome given B is entirely unknown to this call:
  // no entry can resolve to any real project at all, so this returns null
  // -- asserted explicitly, not just the weaker "never targets B" check
  // above, since a null result is the strongest possible proof here.
  assert.equal(
    entries,
    null,
    'with B entirely absent from the projects array, no real entry can be produced for it -- not even an empty non-null array'
  )
})

// Full Control Plane Exhaustive Gauntlet V1, Batch 6: STATEFUL, MULTI-TURN
// sequence coverage. Every hold-related test above either pre-seeds the
// hold directly into the store, or checks a hold set and used within the
// SAME message -- none had ever verified the real, end-to-end, CROSS-TURN
// round trip: a hold created through one genuine chat call correctly
// blocks a dispatch attempted in a completely SEPARATE, later chat call.
// The comment on dispatchAction (above) already claimed this works via
// planAndDispatchFromChat's own real hold check -- verified true here with
// real code across two independent respondCommand calls, not assumed.
function stubbedDispatchDeps() {
  return {
    findRegisteredOrcaRepo: async () => ({ ok: true, registered: true, repo: { id: 'stub-repo' } }),
    createOrcaWorktree: async () => ({ ok: true, worktreePath: 'C:/stub-worktree' }),
    resolveRepositoryIdentity: async () => ({
      ok: true,
      identity: {
        root: 'C:/stub-repo',
        worktree: 'C:/stub-worktree',
        branch: 'main',
        head: 'a'.repeat(40),
        tree: 'a'.repeat(40)
      }
    }),
    invokeLiveStructuredAnalysis: async () => ({
      ok: false,
      reason: 'STUBBED_NO_LIVE_CALL',
      detail: 'test stub -- never a real live call'
    }),
    resolveProjectCanonicalBase: async () => ({
      resolved: true,
      ref: 'main',
      source: 'REPO_STANDARD_DEFAULT'
    })
  }
}
const STATEFUL_PROJECTS = [
  project('batch6-held-project', 'Batch6HeldProject', { root: 'C:/stub-repo-root' }),
  project('batch6-other-project', 'Batch6OtherProject', { root: 'C:/stub-repo-root' })
]

test('Batch-6: a hold created via one real chat turn blocks a dispatch attempted in a SEPARATE, later chat turn', async () => {
  const dispatchDeps = stubbedDispatchDeps()
  const turn1 =
    'batch6-held-project is being handled by another AI, leave it alone. batch6-other-project needs serious work.'
  await respondCommand({
    message: turn1,
    projects: STATEFUL_PROJECTS,
    opState,
    clock,
    deps: dispatchDeps
  })
  assert.equal(readProjectExecutionHold('batch6-held-project')?.status, 'ACTIVE')

  // A genuinely separate later call -- not the same message, not a
  // pre-seeded store write.
  const turn2 =
    'batch6-held-project needs serious work. batch6-other-project: keep going overnight.'
  const result = await respondCommand({
    message: turn2,
    projects: STATEFUL_PROJECTS,
    opState,
    clock,
    deps: dispatchDeps
  })
  assert.match(
    result.text,
    /Batch6HeldProject[\s\S]*couldn't start[\s\S]*PROJECT_EXECUTION_HOLD_ACTIVE/
  )
  // The unrelated project's own dispatch attempt still reaches the same
  // real downstream (fails only at the stubbed live-call point, never at
  // a hold it was never under).
  assert.match(result.text, /Batch6OtherProject[\s\S]*STUBBED_NO_LIVE_CALL/)
})

test('Batch-6: releasing a hold (directly through the real store, orthogonal to whether chat can also do it) lets a LATER turn dispatch again', async () => {
  const dispatchDeps = stubbedDispatchDeps()
  const heldProject = project('batch6-release-then-redispatch', 'Batch6ReleaseThenRedispatch', {
    root: 'C:/stub-repo-root'
  })
  const otherProject = project(
    'batch6-release-then-redispatch-other',
    'Batch6ReleaseThenRedispatchOther',
    { root: 'C:/stub-repo-root' }
  )
  const projects = [heldProject, otherProject]

  const turn1 =
    'batch6-release-then-redispatch is being handled by another AI, leave it alone. batch6-release-then-redispatch-other needs serious work.'
  await respondCommand({ message: turn1, projects, opState, clock, deps: dispatchDeps })
  assert.equal(readProjectExecutionHold(heldProject.id)?.status, 'ACTIVE')

  await withProjectExecutionHold(heldProject.id, (current) =>
    releaseProjectExecutionHold(current, { releasedBy: 'test-operator' }, clock)
  )
  assert.equal(readProjectExecutionHold(heldProject.id)?.status, 'RELEASED')

  const turn3 =
    'batch6-release-then-redispatch needs serious work. batch6-release-then-redispatch-other: keep going overnight.'
  const result = await respondCommand({
    message: turn3,
    projects,
    opState,
    clock,
    deps: dispatchDeps
  })
  assert.doesNotMatch(
    result.text,
    /Batch6ReleaseThenRedispatch\*\*[\s\S]*PROJECT_EXECUTION_HOLD_ACTIVE/
  )
  assert.match(result.text, /Batch6ReleaseThenRedispatch\*\*[\s\S]*STUBBED_NO_LIVE_CALL/)
})

// Mutation-testing finding (Batch 7, self-caught): the ORIGINAL version of
// this test reused the EXACT same message text for both turns under a
// FROZEN clock -- which meant a mutant that deletes the idempotency guard
// entirely (applyExternalWorkHold always overwriting with a freshly
// created hold instead of preserving `current`) still produced identical-
// looking final state (same note text, same frozen setAt, a fresh 1-entry
// history each time), so the assertions below passed even against that
// real regression. Rewritten so the SECOND turn uses genuinely DIFFERENT
// hold-request phrasing (a different real note) -- only a truly idempotent
// implementation preserves the FIRST turn's note; an always-overwrite
// mutant leaks the second turn's different text through.
test('Batch-6: a duplicate/retried hold-request turn is idempotent -- the original note/setAt survive a differently-worded restatement', async () => {
  const heldProject = project('batch6-duplicate-hold-turn', 'Batch6DuplicateHoldTurn')
  const otherProject = project('batch6-duplicate-hold-turn-other', 'Batch6DuplicateHoldTurnOther')
  const projects = [heldProject, otherProject]
  const firstMessage =
    'batch6-duplicate-hold-turn is being handled by another AI, leave it alone. batch6-duplicate-hold-turn-other needs serious work.'
  // Genuinely different wording (still a real EXTERNAL_WORK_HOLD trigger --
  // "hold off on X") so the note text actually differs from firstMessage's.
  const secondMessage =
    'hold off on batch6-duplicate-hold-turn. batch6-duplicate-hold-turn-other needs serious work.'

  await respondCommand({ message: firstMessage, projects, opState, clock })
  const first = readProjectExecutionHold(heldProject.id)
  assert.match(first.note, /being handled by another AI/)

  // A genuinely separate second call, differently worded -- a real
  // duplicate-delivery/restatement scenario, not a single function call
  // invoked twice in the same tick.
  await respondCommand({ message: secondMessage, projects, opState, clock })
  const second = readProjectExecutionHold(heldProject.id)

  assert.equal(
    second.note,
    first.note,
    'a duplicate/restated turn must never overwrite the original note with the later wording'
  )
  assert.equal(
    second.setAt,
    first.setAt,
    'a duplicate turn must never overwrite the original setAt'
  )
  assert.equal(
    second.history.length,
    first.history.length,
    'a duplicate turn must never append a second SET history entry'
  )
  assert.equal(second.history.length, 1)
})

// Full Control Plane Exhaustive Gauntlet V1, Batch 7: real RACE/TOCTOU
// coverage -- GENUINELY concurrent (Promise.all, not sequential) duplicate
// delivery of the SAME hold-request message for the SAME project. Batch 6's
// duplicate-turn test above proves idempotency across two SEQUENTIAL calls;
// this proves it holds under true concurrency too (e.g. a real client
// retry firing before the first response returns), where the underlying
// store-level idempotency test (project-execution-hold-store.test.mjs)
// only exercises a NOTE-APPENDING mutateFn, never applyExternalWorkHold's
// own real idempotent-or-create shape.
test('Batch-7: N genuinely concurrent duplicate hold-request chat calls for the same project are idempotent -- exactly one SET record', async () => {
  const heldProject = project('batch7-concurrent-duplicate', 'Batch7ConcurrentDuplicate')
  const otherProject = project(
    'batch7-concurrent-duplicate-other',
    'Batch7ConcurrentDuplicateOther'
  )
  const projects = [heldProject, otherProject]
  const message =
    'batch7-concurrent-duplicate is being handled by another AI, leave it alone. batch7-concurrent-duplicate-other needs serious work.'

  const N = 10
  const results = await Promise.all(
    Array.from({ length: N }, () => respondCommand({ message, projects, opState, clock }))
  )

  assert.ok(
    results.every((r) => /Held --/.test(r.text)),
    'every one of the N concurrent calls must report the hold as held, never an error'
  )
  const hold = readProjectExecutionHold(heldProject.id)
  assert.equal(hold.status, 'ACTIVE')
  assert.equal(
    hold.history.length,
    1,
    `exactly one SET history entry despite ${N} genuinely concurrent duplicate calls`
  )
})
