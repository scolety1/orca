import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGlobalRunStatusItems, sortByUrgency, mostUrgentState } from './global-run-status.ts'
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

function item(id: string, state: string, overrides = {}) {
  return {
    id,
    displayName: id,
    runId: `run-${id}`,
    liveWorkFeed: { state, reason: `reason for ${state}` },
    lastCheckpointAt: '2026-09-03T00:00:00.000Z',
    ...overrides
  } as WorkSummary['active'][number]
}

test('an empty WorkSummary -> no items', () => {
  assert.deepEqual(buildGlobalRunStatusItems(emptyWork()), [])
})

test('a legacy work.blocked/active project with no liveWorkFeed is honestly excluded -- no run to report on', () => {
  const work = emptyWork({ active: [{ id: 'legacy-1', displayName: 'legacy' } as WorkSummary['active'][number]] })
  assert.deepEqual(buildGlobalRunStatusItems(work), [])
})

test('every run-driven bucket contributes its items', () => {
  const work = emptyWork({
    active: [item('a', 'WORKING')],
    verifying: [item('b', 'VERIFYING')],
    needsYou: [item('c', 'NEEDS_YOU')],
    stalled: [item('d', 'STALLED')],
    readyForAdoption: [item('e', 'READY_FOR_ADOPTION')]
  })
  const items = buildGlobalRunStatusItems(work)
  assert.deepEqual(
    items.map((i) => i.id),
    ['a', 'b', 'c', 'd', 'e']
  )
  assert.equal(items[0].runId, 'run-a')
  assert.equal(items[0].lastCheckpointAt, '2026-09-03T00:00:00.000Z')
})

test('sortByUrgency: NEEDS_YOU and STALLED sort before READY_FOR_ADOPTION, which sorts before ordinary progress states', () => {
  const items = buildGlobalRunStatusItems(
    emptyWork({
      active: [item('working', 'WORKING'), item('planning', 'PLANNING')],
      verifying: [item('verifying', 'VERIFYING')],
      needsYou: [item('needs-you', 'NEEDS_YOU')],
      stalled: [item('stalled', 'STALLED')],
      readyForAdoption: [item('ready', 'READY_FOR_ADOPTION')]
    })
  )
  const order = sortByUrgency(items).map((i) => i.state)
  assert.deepEqual(order, [
    'NEEDS_YOU',
    'STALLED',
    'READY_FOR_ADOPTION',
    'VERIFYING',
    'WORKING',
    'PLANNING'
  ])
})

test('mostUrgentState: empty -> null, honestly, never a fabricated "all clear"', () => {
  assert.equal(mostUrgentState([]), null)
})

test('mostUrgentState: a NEEDS_YOU entry wins over everything else present', () => {
  const items = buildGlobalRunStatusItems(
    emptyWork({
      active: [item('a', 'WORKING')],
      needsYou: [item('b', 'NEEDS_YOU')],
      stalled: [item('c', 'STALLED')]
    })
  )
  assert.equal(mostUrgentState(items), 'NEEDS_YOU')
})
