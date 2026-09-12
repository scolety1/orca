import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLiveWorkFeedLookup, liveWorkFeedBadgeVariant } from './work-feed-lookup.ts'
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

test('an empty WorkSummary -> an empty lookup', () => {
  assert.equal(buildLiveWorkFeedLookup(emptyWork()).size, 0)
})

test('a project with a run in any run-driven bucket is looked up by id', () => {
  const work = emptyWork({
    stalled: [
      {
        id: 'proj-1',
        liveWorkFeed: { state: 'STALLED', reason: 'run state is STALLED' }
      } as WorkSummary['stalled'][number]
    ]
  })
  const lookup = buildLiveWorkFeedLookup(work)
  assert.deepEqual(lookup.get('proj-1'), { state: 'STALLED', reason: 'run state is STALLED' })
})

test('a legacy blocked project (no liveWorkFeed) is never entered -- honestly absent, not a fabricated feed', () => {
  const work = emptyWork({
    blocked: [{ id: 'proj-legacy' } as WorkSummary['blocked'][number]]
  })
  assert.equal(buildLiveWorkFeedLookup(work).has('proj-legacy'), false)
})

test('liveWorkFeedBadgeVariant: STALLED reads as blocked (urgent), READY_FOR_ADOPTION as healthy', () => {
  assert.equal(liveWorkFeedBadgeVariant('STALLED'), 'blocked')
  assert.equal(liveWorkFeedBadgeVariant('READY_FOR_ADOPTION'), 'healthy')
})

test('liveWorkFeedBadgeVariant: an unrecognized state falls back to neutral, never throws', () => {
  assert.equal(liveWorkFeedBadgeVariant('SOMETHING_NEW'), 'neutral')
})

// TSF Reconcile & Upgrade Protocol V1, Lane 5: BLOCKED_EXTERNAL (a real,
// active project execution hold's category, now merged into
// GlobalRunStatusIndicator by global-run-status.ts's
// selectExtraAttentionItems) must read as urgent (blocked), never fall
// back to the bland 'neutral' default -- that fallback would silently
// understate a real, active hold.
test('liveWorkFeedBadgeVariant: BLOCKED_EXTERNAL (a real active project execution hold) reads as blocked, not the neutral fallback', () => {
  assert.equal(liveWorkFeedBadgeVariant('BLOCKED_EXTERNAL'), 'blocked')
})
