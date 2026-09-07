// Unit-level coverage for respondCommand's resolution-confidence safety
// gate -- deliberately hand-built, controlled project fixtures rather than
// realistic slugified names, so the fuzzy/exact/ambiguous scenarios below
// are exact and reliable rather than dependent on incidental string
// engineering against a real repo's derived displayName.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
// This machine has a real, working planner CLI available -- a GENERAL-
// intent, zero-match message now reaches command-scope-classifier.mjs's
// live-planner call (Command architecture fix, hands-on pilot round 2).
// Every test in this file must refuse it explicitly, or an ordinary test
// run would make a real, billable live call. See
// command-scope-classifier.test.mjs for the dedicated live-planner-path
// coverage (via the stub CLI).
const NONEXISTENT = path.join(import.meta.dirname, 'fixtures', 'does-not-exist-binary')
process.env.TSF_PLANNER_CLAUDE_COMMAND = NONEXISTENT
process.env.TSF_PLANNER_CODEX_COMMAND = NONEXISTENT
// Operator Attention V1, Wave 2: NEEDS_YOU_QUERY now calls the real
// readAllFindings() (self-improvement-finding-store.mjs) unconditionally --
// isolated here the same way every other test file in this suite isolates
// its durable state, so this file never reads/writes the shared default
// local-state file on a machine that may have other concurrent sessions.
// REQUIRED: command-responder.mjs (and its transitive data-store.mjs
// dependency) must be imported DYNAMICALLY, after TSF_UI_STATE_FILE is set --
// a STATIC `import` here would be hoisted and evaluated before this file's
// own env-var assignment ever runs (real ESM footgun, empirically confirmed:
// data-store.mjs's `STATE_FILE` is a module-top-level const, frozen at
// data-store.mjs's own evaluation time, which for a static import happens
// before ANY of this module's own top-level statements -- regardless of
// their textual order relative to the import line).
import { rmSync } from 'node:fs'
const STATE_FILE = path.join(import.meta.dirname, '..', 'server', '.local-state', `operator-state.test-command-responder-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.self-improvement-finding.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)
const { respondCommand } = await import('../server/command-responder.mjs')
const { withFinding } = await import('../server/self-improvement-finding-store.mjs')
const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')

const clock = () => new Date('2026-08-25T00:00:00.000Z')

function project(id, displayName, sourceClass = 'REAL') {
  return {
    id,
    displayName,
    sourceClass,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] }
  }
}

const projects = [
  project('alpha-widgets', 'Alpha Widgets'),
  project('alpha-gadgets', 'Alpha Gadgets')
]
const opState = { keepGoingRuns: {} }

// Adversarial-review finding, pinned here: a message that only fuzzy-
// matches a project (no exact id/displayName hit) must never trigger a
// real dispatch -- respondCommand must ask for clarification instead of
// guessing which project to act on.
test('a fuzzy-only single match never dispatches -- asks for clarification instead', async () => {
  // "widgets" alone overlaps only one of "Alpha Widgets"'s two tokens
  // (ratio 0.5, below the 0.6 fuzzy floor) -- use a phrase that clears the
  // floor without being an exact id/displayName match.
  const result = await respondCommand({
    message: 'go ahead and fix the alpha widgets thing, not an exact name',
    projects: [project('totally-different-id', 'Alpha Widgets Repo')],
    opState,
    clock
  })
  // "Alpha Widgets Repo" tokens: alpha/widgets/repo -- message contains
  // alpha+widgets (2/3 = 0.667 >= 0.6), a genuine fuzzy match, no exact hit.
  assert.equal(result.dispatchResults, undefined, 'no dispatch was ever attempted')
  assert.match(result.text, /not confident/i)
  assert.deepEqual(result.resolvedProjectIds, ['totally-different-id'])
})

test('an ambiguous multi-fuzzy match never dispatches to either guessed project', async () => {
  // Reordered so neither displayName appears as its own literal contiguous
  // phrase (which would be an EXACT match instead) -- both projects' full
  // token sets are still present, scoring a genuine fuzzy match (ratio 1.0)
  // for each, with zero exact matches -- resolveProjectsFromText's real
  // definition of "ambiguous".
  const result = await respondCommand({
    message: 'go ahead and fix the widgets alpha thing and the gadgets alpha thing too',
    projects,
    opState,
    clock
  })
  assert.equal(result.dispatchResults, undefined)
  assert.match(result.text, /not confident/i)
  assert.deepEqual([...result.resolvedProjectIds].sort(), ['alpha-gadgets', 'alpha-widgets'])
})

test('an exact single match DOES dispatch (the safety gate only withholds on low confidence)', async () => {
  const result = await respondCommand({
    message: 'go ahead and fix alpha-widgets',
    projects,
    opState,
    clock,
    deps: {
      // Stub the real dispatch call so this stays a fast, pure unit test --
      // proves the gate lets an exact match through, not the dispatch
      // mechanics themselves (already proven end-to-end in
      // http-command.test.mjs).
      resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' })
    }
  })
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
  assert.ok(result.dispatchResults, 'a real dispatch attempt was made for the exact match')
})

test('a multi-project message with a mix of exact and fuzzy matches dispatches ONLY to the exact one', async () => {
  const result = await respondCommand({
    // "gadgets alpha" (reordered, not the literal "Alpha Gadgets" phrase)
    // still fuzzy-matches alpha-gadgets (both tokens present); alpha-widgets
    // is named exactly.
    message: 'go ahead and fix alpha-widgets and also the gadgets alpha thing',
    projects,
    opState,
    clock,
    deps: {
      resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' })
    }
  })
  assert.ok(result.dispatchResults)
  assert.deepEqual(
    result.dispatchResults.map((r) => r.projectId),
    ['alpha-widgets']
  )
  // Adversarial-review finding, pinned here: resolvedProjectIds (used by
  // CommandPanel's "Targeting" chips) must never include a project that
  // was never actually dispatched to -- it previously included the fuzzy
  // co-match (alpha-gadgets) too, misrepresenting it as acted-on.
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
  // A second, related adversarial-review finding: scope must match the
  // actual resolvedProjectIds it's returned alongside -- previously scope
  // was computed once up front against the wider exact+fuzzy set, so this
  // exact response would say scope: 'MULTI_PROJECT' next to a single-entry
  // resolvedProjectIds, an internally inconsistent shape.
  assert.equal(result.scope, 'PROJECT')
})

test('a fleet-wide status question may still use a fuzzy match informationally -- read-only, never gated', async () => {
  const result = await respondCommand({
    message: "what's running on the alpha widgets project?",
    projects: [project('totally-different-id', 'Alpha Widgets Repo')],
    opState,
    clock
  })
  assert.equal(result.intent, 'STATUS')
  assert.deepEqual(result.resolvedProjectIds, ['totally-different-id'])
  assert.match(result.text, /running right now/i)
})

// Hands-on pilot round 3, UX polish: a small idle fleet still names each
// project (the exact regression this threshold fixes -- collapsing even a
// one-project answer to a bare count broke "what about that project?",
// which resolves to exactly one project and must still say its name); a
// large idle fleet collapses to a count instead of listing every one
// individually, the original noise complaint.
test('UX polish: a small idle fleet (<= 3) still names each project -- collapsing is a many-projects concern, not a one-or-two-projects one', async () => {
  const result = await respondCommand({
    message: "what's running right now?",
    projects: [project('alpha-widgets', 'Alpha Widgets'), project('alpha-gadgets', 'Alpha Gadgets')],
    opState,
    clock
  })
  assert.match(result.text, /Alpha Widgets/)
  assert.match(result.text, /Alpha Gadgets/)
  assert.doesNotMatch(result.text, /project\(s\) are idle/)
})

test('UX polish: a large idle fleet (> 3) collapses to a human-first summary instead of listing every project individually', async () => {
  const manyProjects = Array.from({ length: 7 }, (_, i) => project(`p${i}`, `Project ${i}`))
  const result = await respondCommand({ message: "what's running right now?", projects: manyProjects, opState, clock })
  assert.match(result.text, /Nothing is running right now\. 7 project\(s\) are idle/)
  assert.doesNotMatch(result.text, /Project 0/, 'individual idle projects are not enumerated once the fleet is large')
})

// Phase 2: bounded follow-up conversational context. Deliberately narrow --
// covered here rather than a separate file since it's a small addition to
// this exact resolution-confidence gate the rest of this file already
// exercises.
function opStateWithLastTurn(resolvedProjectIds) {
  return {
    keepGoingRuns: {},
    chatThreads: {
      __command__: [
        { role: 'user', content: 'run alpha widgets', at: clock().toISOString() },
        { role: 'assistant', content: 'ok', at: clock().toISOString(), decisionClass: 'AUTO_DECIDE', intent: 'STATUS', resolvedProjectIds, scope: resolvedProjectIds.length === 1 ? 'PROJECT' : 'FLEET' }
      ]
    }
  }
}

test('a bounded back-reference ("what about that project?") resolves to the prior turn\'s single resolved project', async () => {
  const result = await respondCommand({
    message: 'what about that project?',
    projects: [project('alpha-widgets', 'Alpha Widgets')],
    opState: opStateWithLastTurn(['alpha-widgets']),
    clock
  })
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
  assert.equal(result.scope, 'PROJECT')
  assert.match(result.text, /Alpha Widgets/)
})

test('a back-reference never resolves to a project that has since been removed from the catalog', async () => {
  const result = await respondCommand({
    message: 'how is that one doing?',
    projects: [project('someone-else', 'Someone Else')],
    opState: opStateWithLastTurn(['alpha-widgets']), // no longer in `projects`
    clock
  })
  assert.match(result.text, /couldn't tell which project/i)
  assert.deepEqual(result.resolvedProjectIds, [])
})

test('a back-reference never resolves when the prior turn itself resolved to more than one project (ambiguous history is not silently narrowed)', async () => {
  const result = await respondCommand({
    message: 'what about that project?',
    projects: [project('alpha-widgets', 'Alpha Widgets'), project('alpha-gadgets', 'Alpha Gadgets')],
    opState: opStateWithLastTurn(['alpha-widgets', 'alpha-gadgets']),
    clock
  })
  assert.match(result.text, /couldn't tell which project/i)
})

test('a bare pronoun ("it") is NOT treated as a back-reference -- too common a word to trust alone', async () => {
  // GENERAL intent (not one of the fleet-wide-fallback STATUS_LIKE_INTENTS)
  // so a resolved "Alpha Widgets" answer could only come from the new
  // back-reference path, never HEALTH/STATUS's own pre-existing
  // no-project-named fleet-wide fallback -- isolates what this test means
  // to prove.
  const result = await respondCommand({
    message: 'tell me about it',
    projects: [project('alpha-widgets', 'Alpha Widgets')],
    opState: opStateWithLastTurn(['alpha-widgets']),
    clock
  })
  assert.equal(result.intent, 'GENERAL')
  assert.match(result.text, /couldn't tell which project/i)
})

// Command architecture round 3: actionable follow-up context. A resolved
// back-reference now IS trusted enough to dispatch -- "context resolves
// identity only" (a per-file adversarial-review discipline this suite
// already applies to exact/alias/fuzzy resolution) means the SAME real
// dispatch pipeline and SAME real gates a directly-named project gets, not
// a weaker path. The STUB dispatch dep below only proves an attempt was
// made -- the mechanics themselves are already proven end to end in
// http-command.test.mjs.
const STUB_DISPATCH_DEPS = { resolveRepositoryIdentity: async () => ({ ok: false, reason: 'REPOSITORY_UNAVAILABLE' }) }

test('actionable follow-up: "go ahead and fix that project" now resolves the prior turn\'s project and attempts a REAL dispatch', async () => {
  const result = await respondCommand({
    message: 'go ahead and fix that project',
    projects: [project('alpha-widgets', 'Alpha Widgets')],
    opState: opStateWithLastTurn(['alpha-widgets']),
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
  assert.ok(result.dispatchResults, 'a real dispatch attempt was made, not a fabricated "started"')
})

test('actionable follow-up: bare "run it"/"fix it" (no back-reference phrase at all) also resolves the prior turn\'s project', async () => {
  const runIt = await respondCommand({ message: 'run it', projects: [project('alpha-widgets', 'Alpha Widgets')], opState: opStateWithLastTurn(['alpha-widgets']), clock, deps: STUB_DISPATCH_DEPS })
  assert.deepEqual(runIt.resolvedProjectIds, ['alpha-widgets'])
  assert.ok(runIt.dispatchResults)

  const fixIt = await respondCommand({ message: 'fix it', projects: [project('alpha-widgets', 'Alpha Widgets')], opState: opStateWithLastTurn(['alpha-widgets']), clock, deps: STUB_DISPATCH_DEPS })
  assert.deepEqual(fixIt.resolvedProjectIds, ['alpha-widgets'])
  assert.ok(fixIt.dispatchResults)
})

test('actionable follow-up: an explicitly-NAMED project in the same message always wins over stale back-reference context -- never overridden', async () => {
  const result = await respondCommand({
    message: 'go ahead and fix alpha-gadgets',
    projects: [project('alpha-widgets', 'Alpha Widgets'), project('alpha-gadgets', 'Alpha Gadgets')],
    opState: opStateWithLastTurn(['alpha-widgets']), // prior turn was about a DIFFERENT project
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.deepEqual(result.resolvedProjectIds, ['alpha-gadgets'], 'the explicitly named project must win, never the stale referent')
})

test('actionable follow-up: a follow-up action still refuses when the prior turn resolved to more than one project -- ambiguous history is never silently narrowed to a guess', async () => {
  const result = await respondCommand({
    message: 'go ahead and fix that project',
    projects: [project('alpha-widgets', 'Alpha Widgets'), project('alpha-gadgets', 'Alpha Gadgets')],
    opState: opStateWithLastTurn(['alpha-widgets', 'alpha-gadgets']),
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.equal(result.dispatchResults, undefined, 'no dispatch was ever attempted from an ambiguous prior turn')
  assert.match(result.text, /couldn't tell which project|not confident/i)
})

test('actionable follow-up: a project referenced in a prior turn but since REMOVED from the catalog is never dispatched to -- context never outlives the real catalog', async () => {
  const result = await respondCommand({
    message: 'run it',
    projects: [project('someone-else', 'Someone Else')], // alpha-widgets no longer exists
    opState: opStateWithLastTurn(['alpha-widgets']),
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.equal(result.dispatchResults, undefined)
  assert.match(result.text, /couldn't tell which project|not confident/i)
})

test('actionable follow-up: a TIM_REQUIRED (consequential) message is refused BEFORE any back-reference resolution is even attempted -- context can never grant authorization a named project wouldn\'t already need', async () => {
  const result = await respondCommand({
    message: 'push it to production',
    projects: [project('alpha-widgets', 'Alpha Widgets')],
    opState: opStateWithLastTurn(['alpha-widgets']),
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.equal(result.decisionClass, 'TIM_REQUIRED')
  assert.equal(result.dispatchResults, undefined, 'a consequential action is never silently authorized via conversational context')
})

test('actionable follow-up: a negated action ("don\'t run it") is never honored, even with a real resolvable back-reference', async () => {
  const result = await respondCommand({
    message: "don't run it",
    projects: [project('alpha-widgets', 'Alpha Widgets')],
    opState: opStateWithLastTurn(['alpha-widgets']),
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.equal(result.dispatchResults, undefined)
})

// Hands-on pilot round 2, Finding 1: a message naming no project that asks
// about the fleet in the abstract must not be treated as a failed project
// lookup. Covered here through the REAL respondCommand entry point (the
// dedicated classifier unit tests live in command-scope-classifier.test.mjs);
// this file's own top-of-file env vars keep this on the deterministic
// fallback path, deliberately -- proves the fix holds even with no live
// planner available, the worst case.
test('GLOBAL_ADVISORY: "are there any projects here that are safe to mess around with?" no longer says "I couldn\'t tell which project"', async () => {
  const result = await respondCommand({
    message: 'are there any projects here that are safe to mess around with?',
    projects: [project('tsf-ui-capability-check', 'TSF UI Capability Check', 'FIXTURE')],
    opState,
    clock
  })
  assert.doesNotMatch(result.text, /couldn't tell which project/i)
  assert.match(result.text, /TSF UI Capability Check/)
  // Advisory never DISPATCHES on its own (no dispatchResults here) -- but
  // with exactly one safe candidate, it IS remembered as a back-reference
  // target so a later "run that" resolves it (dogfood sequence C).
  assert.equal(result.dispatchResults, undefined, 'advisory alone never dispatches')
  assert.deepEqual(result.resolvedProjectIds, ['tsf-ui-capability-check'])
})

test('GLOBAL_ADVISORY natural variants all avoid the generic failure, without one exact-phrase regex', async () => {
  const variants = [
    'is there anything safe we can test on?',
    "which projects here don't matter?",
    'give me a disposable project to mess with',
    'what can we safely run tests against?'
  ]
  for (const message of variants) {
    const result = await respondCommand({ message, projects: [project('fixture-one', 'Fixture One', 'FIXTURE')], opState, clock })
    assert.doesNotMatch(result.text, /couldn't tell which project/i, `"${message}" still hit the generic failure`)
  }
})

// Finding 4: a registered alias whose canonical target isn't in THIS
// catalog gets a distinct, honest answer -- never the generic failure a
// truly-unrecognized name gets.
test('alias UX: a known alias resolving to a project absent from the catalog says so explicitly, both for a read-only question and a dispatch attempt', async () => {
  const readOnly = await respondCommand({ message: 'what is the current state of nytheria', projects: [project('some-other-project', 'Some Other Project')], opState, clock })
  assert.match(readOnly.text, /nytheria.*resolves to.*worldforge-sablewake-live-runtime-repair-v3.*isn'?t available/is)
  assert.doesNotMatch(readOnly.text, /^I couldn't tell which project this is about/i)

  const dispatchAttempt = await respondCommand({ message: 'run nytheria', projects: [project('some-other-project', 'Some Other Project')], opState, clock })
  assert.match(dispatchAttempt.text, /nytheria.*resolves to.*worldforge-sablewake-live-runtime-repair-v3.*isn'?t available/is)
  assert.equal(dispatchAttempt.dispatchResults, undefined, 'no dispatch was ever attempted')
})

test('alias UX: an alias whose target IS in the catalog is completely unaffected -- normal resolution still wins', async () => {
  const result = await respondCommand({
    message: 'what is the current state of nytheria',
    projects: [project('worldforge-sablewake-live-runtime-repair-v3', 'WorldForge')],
    opState,
    clock
  })
  assert.deepEqual(result.resolvedProjectIds, ['worldforge-sablewake-live-runtime-repair-v3'])
  assert.doesNotMatch(result.text, /isn'?t available/i)
})

test('alias UX: a genuinely unrecognized name still gets the honest generic failure, not a fabricated alias claim', async () => {
  const result = await respondCommand({ message: 'what is the state of zzz-totally-unknown-zzz', projects: [project('alpha-widgets', 'Alpha Widgets')], opState, clock })
  assert.match(result.text, /couldn't tell which project/i)
})

test('NEEDS_YOU_QUERY: "what needs me?" surfaces real outstanding Needs You across the fleet, honest empty state otherwise', async () => {
  const empty = await respondCommand({ message: 'what needs me?', projects: [], opState, clock })
  assert.match(empty.text, /nothing needs you/i)
  assert.deepEqual(empty.resolvedProjectIds, [])
  assert.equal(empty.scope, 'FLEET')

  const withOpenItem = {
    // Operator Attention V1, Wave 2: NEEDS_YOU_QUERY now goes through
    // buildFleetAttentionItems, whose real contract (via summarizeWorkFromRuns
    // -> fleetWorkStatus) reads run.checkpoints unconditionally (for
    // lastCheckpointAt) -- a bare literal missing it (fine for the old,
    // narrower fleetNeedsYouStatus) now needs this one extra real-shaped field.
    keepGoingRuns: { 'alpha-widgets': { needsYou: [{ id: 'q1', question: 'A real decision is pending', resolvedAt: null }], checkpoints: [] } }
  }
  const result = await respondCommand({ message: 'what needs me?', projects: [project('alpha-widgets', 'Alpha Widgets')], opState: withOpenItem, clock })
  assert.match(result.text, /Alpha Widgets/)
  assert.match(result.text, /A real decision is pending/)
  // Phase 6 fix: a real project-sourced Needs You item now deep-links back
  // to its own project (CommandPanel.tsx's existing "Targeting" chip),
  // instead of the previously-hardcoded empty/FLEET.
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
  assert.equal(result.scope, 'PROJECT')
})

// Phase 6 finding, F18 follow-up: Planner Context Lifecycle's own
// checkpoint.needsYou (planner-mission-checkpoint.mjs's raisePlannerNeedsYou)
// previously never reached this real "what needs me?" query path at all --
// fleetNeedsYouStatus had no 4th source. Proven here against the SAME real
// respondCommand entry point Tim's own "what needs me?" message reaches,
// not against the domain function in isolation.
test('NEEDS_YOU_QUERY: a real Planner Context Lifecycle needsYou item is now discoverable via the same "what needs me?" query', async () => {
  const opStateWithPlannerNeedsYou = {
    keepGoingRuns: {},
    researchMissions: {},
    plannerMissions: {
      'planner-mission-1': {
        lease: null,
        checkpoint: {
          schemaVersion: 'TSF_PLANNER_MISSION_CHECKPOINT_V1',
          missionId: 'planner-mission-1',
          revision: 1,
          missionState: 'ACTIVE',
          missionGoal: 'ship it',
          phase: 'BUILD',
          repoState: { branch: 'main', sha: 'a'.repeat(40), worktreePath: null },
          decisions: [],
          blockers: [],
          needsYou: [{ id: 'pq1', question: 'Planner needs an authority grant', category: 'AUTHORITY_REQUIRED', at: clock().toISOString(), resolvedAt: null, resolution: null }],
          workers: {},
          verifierResults: [],
          completedTasks: [],
          outstandingTasks: [],
          resourceState: null,
          authority: { grants: [] },
          lessons: [],
          lastAction: null,
          nextIntendedAction: null,
          createdAt: clock().toISOString(),
          updatedAt: clock().toISOString()
        }
      }
    }
  }
  const result = await respondCommand({ message: 'what needs me?', projects: [], opState: opStateWithPlannerNeedsYou, clock })
  assert.match(result.text, /Planner needs an authority grant/)
  assert.match(result.text, /planner-mission-1/)
  // No reliable project association on a planner checkpoint -- honestly no
  // deep link fabricated for this item.
  assert.deepEqual(result.resolvedProjectIds, [])
})

// Operator Attention V1, Wave 2: real gap this closes -- a self-improvement
// finding the eligibility classifier declined to autofix was previously
// invisible outside command-self-improvement-bridge.mjs's own narrow "what
// did TSF find?" question. NEEDS_YOU_QUERY now goes through
// buildFleetAttentionItems (a strict superset of the old fleetNeedsYouStatus
// alone), so the SAME real finding is now also discoverable via "what needs
// me?" -- proven here against the real, durable finding store (writing
// through the real domain constructors), not a fabricated fixture shape.
test('NEEDS_YOU_QUERY: a real self-improvement NEEDS_OWNER finding is now discoverable via the same "what needs me?" query', async () => {
  let finding = createFinding(
    {
      sourceDetector: 'GOLDEN_PATH_EVAL',
      severity: 'P2',
      evidence: { caseId: 'case-1' },
      reproduction: { command: 'node --test' },
      affectedSurface: 'command-responder-needs-owner-surface',
      confidence: 0.8,
      verificationMethod: 'EVAL_PACK_RERUN'
    },
    clock
  )
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  await withFinding(finding.findingId, () => finding)

  const result = await respondCommand({ message: 'what needs me?', projects: [], opState, clock })
  assert.match(result.text, /command-responder-needs-owner-surface/)
  assert.match(result.text, /needs your call/)
  // No project is associated with this finding (projectId null) -- honestly
  // no deep link fabricated, same convention as the PLANNER case above.
  assert.deepEqual(result.resolvedProjectIds, [])
})

// Multi-project actions round 3: the "everything"/"all projects" quantifier.
test('multi-project: "run everything except TSF" dispatches to every project except the explicitly excluded one', async () => {
  const result = await respondCommand({
    message: 'run everything except tsf-orca',
    projects: [project('nwr', 'NWR'), project('nytheria-proj', 'Nytheria'), project('tsf-orca', 'TSF Orca')],
    opState,
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.deepEqual(new Set(result.resolvedProjectIds), new Set(['nwr', 'nytheria-proj']))
  assert.ok(!result.resolvedProjectIds.includes('tsf-orca'), 'the explicitly excluded project must never be dispatched to')
})

test('multi-project: "pause everything" (no exclusions) really pauses every real project with a run', async () => {
  const result = await respondCommand({
    message: 'pause everything',
    projects: [project('alpha-widgets', 'Alpha Widgets'), project('alpha-gadgets', 'Alpha Gadgets')],
    opState,
    clock
  })
  // No single project resolved -- classifyRunActionVerb's PAUSE branch only
  // ever targets ONE project (named or referenced); "everything" is a
  // dispatch-only quantifier today (disclosed scope: bulk pause is real,
  // valuable follow-up work, not built this round). Proves this stays an
  // honest non-match rather than silently pausing an arbitrary one project.
  assert.match(result.text, /couldn't tell which project/i)
})

// Phase 7 dogfood finding: real, reproduced via respondCommand against a
// live fixture fleet with genuine prior conversational context (the
// no-prior-context test above only proves the coincidental case where the
// back-reference lookup already returns null). With a real prior turn on
// record, "pause everything except X" used to silently fall through to
// classifyRunActionVerb's back-reference resolver, which resolved to
// whatever project that EARLIER, unrelated turn happened to reference --
// pausing only that one project (ignoring the quantifier and the exclusion
// entirely) while still claiming success ("Paused **Alpha Widgets**").
// A quantifier must win over a stale back-reference here exactly like it
// already does for dispatch (dispatchAndRespond's own documented ordering).
test('Phase 7 fix: "pause everything except X" with a stale prior back-reference honestly declines instead of pausing the wrong (back-referenced) project', async () => {
  const result = await respondCommand({
    message: 'pause everything except alpha-gadgets',
    projects,
    opState: opStateWithLastTurn(['alpha-widgets']), // a real, unrelated prior turn referenced alpha-widgets
    clock
  })
  assert.match(result.text, /couldn't tell which project/i)
  assert.deepEqual(result.resolvedProjectIds, [])
  assert.doesNotMatch(result.text, /^Paused/, 'must never claim a pause happened against the wrong (back-referenced) target')
})

test('multi-project: "everything" quantified with EVERY project excluded dispatches to nothing, honestly', async () => {
  const result = await respondCommand({
    message: 'run everything except alpha-widgets and except alpha-gadgets',
    projects: [project('alpha-widgets', 'Alpha Widgets'), project('alpha-gadgets', 'Alpha Gadgets')],
    opState,
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.equal(result.dispatchResults, undefined)
  assert.match(result.text, /nothing left to act on/i)
})

test('multi-project: a message naming a specific project is completely unaffected by the "everything" quantifier machinery -- normal exact-match resolution still wins', async () => {
  const result = await respondCommand({
    message: 'go ahead and fix alpha-widgets',
    projects: [project('alpha-widgets', 'Alpha Widgets'), project('alpha-gadgets', 'Alpha Gadgets')],
    opState,
    clock,
    deps: STUB_DISPATCH_DEPS
  })
  assert.deepEqual(result.resolvedProjectIds, ['alpha-widgets'])
})
