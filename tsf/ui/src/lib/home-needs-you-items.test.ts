import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHomeNeedsYouItems,
  buildSelfImprovementNeedsYouItems,
  countDistinctNeedsYouProjects,
  homeNeedsYouItemKey
} from './home-needs-you-items.ts'
import type { AttentionItem, WorkSummary } from './types.ts'

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

// Real-project adversarial-hardening finding (tsf-operator-hardening-v2):
// the Home page's "Needs you: N" tile used a bare items.length, which
// double-counts a project appearing in more than one bucket at once (the
// exact real combination the test above proves is possible) -- the tile
// must report how many DISTINCT projects need attention, not how many
// reason-entries exist across them.
test('countDistinctNeedsYouProjects: a project in two buckets at once counts as one project, not two', () => {
  const work = emptyWork({
    needsYou: [{ id: 'proj-1' } as WorkSummary['needsYou'][number]],
    blocked: [{ id: 'proj-1' } as WorkSummary['blocked'][number]]
  })
  const items = buildHomeNeedsYouItems(work)
  assert.equal(items.length, 2, 'sanity: the detail list itself still has both real reason-entries')
  assert.equal(countDistinctNeedsYouProjects(items), 1)
})

test('countDistinctNeedsYouProjects: distinct projects across different buckets each count once', () => {
  const work = emptyWork({
    needsYou: [{ id: 'a' } as WorkSummary['needsYou'][number]],
    stalled: [{ id: 'b' } as WorkSummary['stalled'][number]]
  })
  assert.equal(countDistinctNeedsYouProjects(buildHomeNeedsYouItems(work)), 2)
})

test('countDistinctNeedsYouProjects: empty input counts zero, never a fabricated number', () => {
  assert.equal(countDistinctNeedsYouProjects([]), 0)
})

function attentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'finding:x',
    category: 'NEEDS_OWNER',
    severity: 'P2',
    project: null,
    label: 'some-surface',
    reason: 'Not eligible for autofix -- needs your call.',
    changedAt: null,
    deepLink: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:x' },
    source: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:x' },
    ...overrides
  }
}

test('buildSelfImprovementNeedsYouItems: empty input -> no items', () => {
  assert.deepEqual(buildSelfImprovementNeedsYouItems([]), [])
})

test('buildSelfImprovementNeedsYouItems: a real NEEDS_OWNER self-improvement finding appears, with an honest null project when none exists', () => {
  const items = buildSelfImprovementNeedsYouItems([attentionItem()])
  assert.equal(items.length, 1)
  assert.equal(items[0].findingId, 'finding:x')
  assert.equal(items[0].label, 'some-surface')
  assert.equal(items[0].projectId, null)
})

test('buildSelfImprovementNeedsYouItems: excludes non-self-improvement NEEDS_OWNER items and non-NEEDS_OWNER self-improvement items', () => {
  const projectNeedsOwner = attentionItem({
    id: 'needsyou:PROJECT:1',
    source: { kind: 'KEEP_GOING_RUN', id: 'p1' }
  })
  const readyForAdoption = attentionItem({
    id: 'finding:y',
    category: 'READY_FOR_ADOPTION',
    source: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:y' }
  })
  assert.deepEqual(buildSelfImprovementNeedsYouItems([projectNeedsOwner, readyForAdoption]), [])
})

test('buildSelfImprovementNeedsYouItems: a finding with a real project carries its real projectId', () => {
  const items = buildSelfImprovementNeedsYouItems([attentionItem({ project: { id: 'proj-1', displayName: 'Project One' } })])
  assert.equal(items[0].projectId, 'proj-1')
})
