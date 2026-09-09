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
const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-command-multi-action-bridge-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.self-improvement-finding.lock', '.project-execution-hold.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { respondCommand } = await import('../server/command-responder.mjs')
const { classifyMultiActionEntries } = await import('../server/command-multi-action-bridge.mjs')
const { readProjectExecutionHold, withProjectExecutionHold } = await import('../server/project-execution-hold-store.mjs')
const { createProjectExecutionHold } = await import('../domain/project-execution-hold.mjs')
const { createOvernightRun, completeRun } = await import('../domain/keep-going.mjs')

const clock = () => new Date('2026-09-07T09:00:00.000Z')

function project(id, displayName, overrides = {}) {
  return { id, displayName, sourceClass: 'REAL', mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] }, ...overrides }
}

const PROJECTS = [
  project('niners-war-room', 'Niners War Room'),
  project('worldforge-sablewake-live-runtime-repair-v3', 'Worldforge-Sablewake-Live-Runtime-Repair-V3'),
  project('easylifehq-github-io', 'EasyLifeHQ'),
  project('tsf-orca', 'TSF Orca')
]

const opState = { keepGoingRuns: {} }

const MISSION_MESSAGE =
  "NWR is being handled by another AI, leave it alone. Nytheria looks good, adopt that run and keep going overnight. EasyLife needs serious work -- get EasyWorkouts up so I can start logging workouts."

test('classifyMultiActionEntries: the mission\'s own literal message clears the gate (3 targets, distinct intents)', () => {
  const entries = classifyMultiActionEntries(MISSION_MESSAGE, PROJECTS, undefined)
  assert.ok(entries)
  assert.equal(new Set(entries.map((e) => e.target)).size, 3)
})

test('classifyMultiActionEntries: a same-action-to-N-projects message (dispatchAndRespond\'s own job) never clears the gate', () => {
  assert.equal(classifyMultiActionEntries('get niners-war-room and worldforge-sablewake-live-runtime-repair-v3 ready', PROJECTS, undefined), null)
})

test('classifyMultiActionEntries: an ordinary single-project message never clears the gate', () => {
  assert.equal(classifyMultiActionEntries('go ahead and fix niners-war-room', PROJECTS, undefined), null)
})

test('respondCommand: the mission\'s own literal message produces a real, grouped-by-project, per-action response', async () => {
  // A real, live-feed READY_FOR_ADOPTION run for WorldForge -- so
  // ADOPT_CANDIDATE_REPORT's "can't adopt" honesty is exercised against a
  // real ready candidate, not just the (also real, also honest) "nothing
  // ready" empty case.
  const readyRun = completeRun(createOvernightRun({ id: 'run-worldforge', projectId: 'worldforge-sablewake-live-runtime-repair-v3', originalGoal: 'Repair the runtime.', acceptanceCriteria: ['X'] }, clock), clock)
  const opStateWithReadyRun = { keepGoingRuns: { 'worldforge-sablewake-live-runtime-repair-v3': readyRun } }
  const result = await respondCommand({ message: MISSION_MESSAGE, projects: PROJECTS, opState: opStateWithReadyRun, clock })

  assert.equal(result.intent, 'MULTI_ACTION')
  assert.equal(result.scope, 'MULTI_PROJECT')
  assert.deepEqual(new Set(result.resolvedProjectIds), new Set(['niners-war-room', 'worldforge-sablewake-live-runtime-repair-v3', 'easylifehq-github-io']))

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
    new Set(['niners-war-room', 'worldforge-sablewake-live-runtime-repair-v3', 'easylifehq-github-io'])
  )
})

test('A5: a held target refuses its own action honestly while the other targets in the SAME message still execute/report normally', async () => {
  await withProjectExecutionHold('worldforge-sablewake-live-runtime-repair-v3', () =>
    createProjectExecutionHold(
      { projectId: 'worldforge-sablewake-live-runtime-repair-v3', reason: 'EXTERNAL_WORK_ACTIVE', setBy: 'test-setup', note: 'pre-seeded for this test' },
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
      identity: { root: 'C:/stub-repo', worktree: 'C:/stub-worktree', branch: 'main', head: 'a'.repeat(40), tree: 'a'.repeat(40) }
    }),
    invokeLiveStructuredAnalysis: async () => ({ ok: false, reason: 'STUBBED_NO_LIVE_CALL', detail: 'test stub -- never a real live call' }),
    // Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C:
    // ensureWorktreeForDispatch now resolves a real canonical base ref
    // before creating a worktree -- stubbed here (this fixture's `root`
    // doesn't really exist on disk) so this test still reaches the REAL
    // hold check it's actually proving, same deps-injection convention as
    // every other stub above.
    resolveProjectCanonicalBase: async () => ({ resolved: true, ref: 'main', source: 'REPO_STANDARD_DEFAULT' })
  }
  // A local project list with a real `root` (unlike the shared PROJECTS
  // fixture) -- required to reach past ensureWorktreeForDispatch's own
  // upfront "no known repository root" guard and into the REAL hold check
  // this test is proving; dispatchDeps stubs everything downstream of that
  // guard so nothing here ever touches a real repo or real live provider.
  const projectsWithRoot = PROJECTS.map((p) => ({ ...p, root: 'C:/stub-repo-root' }))
  const message = 'NWR needs serious work. WorldForge: keep going overnight. EasyLife: adopt that run.'
  const result = await respondCommand({ message, projects: projectsWithRoot, opState, clock, deps: dispatchDeps })

  assert.equal(result.intent, 'MULTI_ACTION')
  // The held target's own line is an honest refusal naming the real hold reason.
  assert.match(result.text, /Worldforge-Sablewake-Live-Runtime-Repair-V3[\s\S]*couldn't start[\s\S]*EXTERNAL_WORK_ACTIVE/)
  // The other two targets are NOT dropped/crashed -- each still has its own real section.
  assert.match(result.text, /\*\*Niners War Room\*\*/)
  assert.match(result.text, /\*\*EasyLifeHQ\*\*/)
  assert.deepEqual(new Set(result.resolvedProjectIds), new Set(['niners-war-room', 'worldforge-sablewake-live-runtime-repair-v3', 'easylifehq-github-io']))
})

test('A5: a TIM_REQUIRED clause on one target refuses that action only, independent of the other targets in the same message', async () => {
  const message = 'TSF Orca: push it to production. Nytheria looks good, adopt that run and keep going overnight.'
  const result = await respondCommand({ message, projects: PROJECTS, opState, clock })
  assert.equal(result.intent, 'MULTI_ACTION')
  assert.match(result.text, /TSF Orca[\s\S]*consequential decision/)
  // The independent, ungated target still got its own real report/dispatch attempt.
  assert.match(result.text, /\*\*Worldforge-Sablewake-Live-Runtime-Repair-V3\*\*/)
  assert.doesNotMatch(result.text, /Worldforge-Sablewake-Live-Runtime-Repair-V3[\s\S]*consequential decision/)
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
