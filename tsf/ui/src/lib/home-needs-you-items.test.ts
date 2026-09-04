import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHomeNeedsYouItems, homeNeedsYouItemKey } from './home-needs-you-items.ts'
import type { WorkSummary } from './types.ts'

function emptyWork(overrides: Partial<WorkSummary> = {}): WorkSummary {
  return {
    active: [],
    queued: [],
    verifying: [],
    needsYou: [],
    stalled: [],
    blocked: [],
    readyForAdoption: [],
    recentlyCompleted: [],
    ...overrides
  }
}

test('an empty WorkSummary -> no items', () => {
  assert.deepEqual(buildHomeNeedsYouItems(emptyWork()), [])
})

// Independent-verification real reproduction: a project with a legacy
// BLOCKED mission.state that ALSO has a live NEEDS_YOU run appears in both
// work.blocked and work.needsYou -- domain/work-feed-summary.mjs computes
// them independently, so this genuinely happens.
test('the same project id in both work.blocked and work.needsYou produces two entries with distinct keys, not a collision', () => {
  const work = emptyWork({
    needsYou: [{ id: 'proj-1' } as WorkSummary['needsYou'][number]],
    blocked: [{ id: 'proj-1' } as WorkSummary['blocked'][number]]
  })
  const items = buildHomeNeedsYouItems(work)
  assert.equal(items.length, 2)
  const keys = items.map(homeNeedsYouItemKey)
  assert.equal(new Set(keys).size, 2, `expected 2 distinct keys, got ${JSON.stringify(keys)}`)
})

test('every bucket contributes its items with a distinguishing key prefix', () => {
  const work = emptyWork({
    needsYou: [{ id: 'a' } as WorkSummary['needsYou'][number]],
    stalled: [{ id: 'b' } as WorkSummary['stalled'][number]],
    blocked: [{ id: 'c' } as WorkSummary['blocked'][number]],
    readyForAdoption: [{ id: 'd' } as WorkSummary['readyForAdoption'][number]]
  })
  const keys = buildHomeNeedsYouItems(work).map(homeNeedsYouItemKey)
  assert.deepEqual(keys, ['needs-you-a', 'stalled-b', 'blocked-c', 'ready-for-adoption-d'])
})
