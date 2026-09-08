// Multi-Project Command + Real Fleet Orchestration Overnight V1, Part A2.
// Real, representative fixture mirroring the mission's own literal example:
// TSF_ORCA stalled, TSF UI Capability Check ready-for-adoption, NWR
// needs-you, WorldForge ready-for-adoption -- real AttentionItem-shaped
// objects (see domain/fleet-attention-status.mjs), not ad hoc strings.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCommandReferent } from '../domain/command-referent-resolution.mjs'

const FIXTURE_ITEMS = [
  {
    id: 'run:tsf-orca:stalled',
    category: 'FAILED_REQUIRES_ATTENTION',
    label: 'TSF_ORCA',
    project: { id: 'tsf-orca', displayName: 'TSF_ORCA' },
    reason: 'run is stalled -- no progress in the last checkpoint window'
  },
  {
    id: 'run:tsf-ui-capability-check:readyForAdoption',
    category: 'READY_FOR_ADOPTION',
    label: 'TSF UI Capability Check',
    project: { id: 'tsf-ui-capability-check', displayName: 'TSF UI Capability Check' },
    reason: 'ready for adoption'
  },
  {
    id: 'needsyou:PROJECT:q1',
    category: 'NEEDS_OWNER',
    label: 'NWR',
    project: { id: 'niners-war-room', displayName: 'NWR' },
    reason: 'a real decision is pending'
  },
  {
    id: 'run:worldforge-sablewake-live-runtime-repair-v3:readyForAdoption',
    category: 'READY_FOR_ADOPTION',
    label: 'Worldforge-Sablewake-Live-Runtime-Repair-V3',
    project: { id: 'worldforge-sablewake-live-runtime-repair-v3', displayName: 'Worldforge-Sablewake-Live-Runtime-Repair-V3' },
    reason: 'ready for adoption'
  }
]

test('"the stalled one" resolves to the FAILED_REQUIRES_ATTENTION item only', () => {
  const result = resolveCommandReferent({ message: 'what about the stalled one?', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'run:tsf-orca:stalled')
})

test('"the UI one" resolves to the TSF UI Capability Check item only, not TSF_ORCA', () => {
  const result = resolveCommandReferent({ message: 'go ahead and adopt the UI one', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'run:tsf-ui-capability-check:readyForAdoption')
})

test('"those two" resolves to the full item list only when exactly two were present', () => {
  const twoItems = [FIXTURE_ITEMS[0], FIXTURE_ITEMS[1]]
  const result = resolveCommandReferent({ message: 'do those two', resultItems: twoItems })
  assert.equal(result.resolved, true)
  assert.deepEqual(result.items, twoItems)
})

test('"those two" against a real 4-item prior turn is honestly ambiguous, never guessed', () => {
  const result = resolveCommandReferent({ message: 'go ahead with those two', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, false)
  assert.equal(result.ambiguous, true)
  assert.match(result.text, /which two/i)
})

test('"both of those" resolves the same way "those two" does', () => {
  const twoItems = [FIXTURE_ITEMS[2], FIXTURE_ITEMS[3]]
  const result = resolveCommandReferent({ message: 'handle both of those', resultItems: twoItems })
  assert.equal(result.resolved, true)
  assert.deepEqual(result.items, twoItems)
})

test('"the WorldForge one" resolves via the project displayName, hyphens and all', () => {
  const result = resolveCommandReferent({ message: 'adopt the WorldForge one and keep going', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].project.id, 'worldforge-sablewake-live-runtime-repair-v3')
})

test('"leave the NWR one alone" resolves to the NWR item AND signals exclusion intent', () => {
  const result = resolveCommandReferent({ message: 'leave the NWR one alone', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].project.id, 'niners-war-room')
  assert.equal(result.exclude, true)
})

test('a plain project mention with no referring phrase falls through (caller resolves directly)', () => {
  const result = resolveCommandReferent({ message: 'go ahead and fix niners-war-room', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, false)
  assert.equal(result.reason, 'NO_REFERRING_PHRASE')
})

test('a real referring phrase with no prior items at all is an honest "nothing to resolve", never fabricated', () => {
  const result = resolveCommandReferent({ message: 'the stalled one', resultItems: [] })
  assert.equal(result.resolved, false)
  assert.equal(result.reason, 'NO_PRIOR_ITEMS')
})

test('a real referring phrase matching nothing in the prior turn is an honest not-found, never a guess', () => {
  const result = resolveCommandReferent({ message: 'the quokka one', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, false)
  assert.equal(result.reason, 'NO_MATCH')
})

test('"the two TSF ones" matches both real TSF-labeled items when the count genuinely agrees', () => {
  const result = resolveCommandReferent({ message: 'status on the two TSF ones', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, true)
  assert.deepEqual(
    new Set(result.items.map((i) => i.id)),
    new Set(['run:tsf-orca:stalled', 'run:tsf-ui-capability-check:readyForAdoption'])
  )
})

test('a mismatched numbered count is honestly ambiguous rather than silently truncated/padded', () => {
  const result = resolveCommandReferent({ message: 'the three TSF ones', resultItems: FIXTURE_ITEMS })
  assert.equal(result.resolved, false)
  assert.equal(result.ambiguous, true)
})
