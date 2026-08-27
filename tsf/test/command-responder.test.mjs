// Unit-level coverage for respondCommand's resolution-confidence safety
// gate -- deliberately hand-built, controlled project fixtures rather than
// realistic slugified names, so the fuzzy/exact/ambiguous scenarios below
// are exact and reliable rather than dependent on incidental string
// engineering against a real repo's derived displayName.
import assert from 'node:assert/strict'
import test from 'node:test'
import { respondCommand } from '../server/command-responder.mjs'

const clock = () => new Date('2026-08-25T00:00:00.000Z')

function project(id, displayName) {
  return {
    id,
    displayName,
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
