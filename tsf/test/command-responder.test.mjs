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
import { respondCommand } from '../server/command-responder.mjs'

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

test('a back-reference is never honored for a dispatch-worthy message -- real action still requires naming the project again', async () => {
  const result = await respondCommand({
    message: 'go ahead and fix that project',
    projects: [project('alpha-widgets', 'Alpha Widgets')],
    opState: opStateWithLastTurn(['alpha-widgets']),
    clock
  })
  assert.equal(result.dispatchResults, undefined, 'no dispatch was ever attempted from a back-reference alone')
  assert.match(result.text, /couldn't tell which project|not confident/i)
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
  assert.equal(result.resolvedProjectIds.length, 0, 'advisory is informational -- it never resolves/targets a project for action')
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

  const withOpenItem = {
    keepGoingRuns: { 'alpha-widgets': { needsYou: [{ id: 'q1', question: 'A real decision is pending', resolvedAt: null }] } }
  }
  const result = await respondCommand({ message: 'what needs me?', projects: [project('alpha-widgets', 'Alpha Widgets')], opState: withOpenItem, clock })
  assert.match(result.text, /Alpha Widgets/)
  assert.match(result.text, /A real decision is pending/)
})
