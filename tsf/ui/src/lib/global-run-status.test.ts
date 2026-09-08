import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attentionItemToGlobalRunStatusItem,
  buildGlobalRunStatusItems,
  resolveAttentionDeepLink,
  selectExtraAttentionItems,
  sortByUrgency,
  mostUrgentState
} from './global-run-status.ts'
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

// Global-indicator hardening (tsf-operator-hardening-v2): PAUSED is never
// its own liveWorkFeed.state -- domain/live-work-feed.mjs maps a paused
// run to WAITING (state string 'WAITING', reason 'run state is PAUSED'),
// same bucket a genuinely dispatch-tick-held run also lands in (reason
// 'a dispatch tick currently holds the run lock'). Both real, both
// legitimately WAITING, but operator-meaningfully different situations
// (one is deliberate, one is transient/automatic) -- this proves the
// real distinguishing reason text survives all the way through this
// module, not collapsed into one indistinguishable "Waiting" label.
test('WAITING vs WAITING: a paused run and a dispatch-lock-held run share the same state but keep their own distinct, real reason text', () => {
  const paused = item('paused-proj', 'WAITING', {
    liveWorkFeed: { state: 'WAITING', reason: 'run state is PAUSED' }
  })
  const lockHeld = item('lock-proj', 'WAITING', {
    liveWorkFeed: { state: 'WAITING', reason: 'a dispatch tick currently holds the run lock' }
  })
  const items = buildGlobalRunStatusItems(emptyWork({ active: [paused, lockHeld] }))
  assert.equal(items.find((i) => i.id === 'paused-proj')?.reason, 'run state is PAUSED')
  assert.equal(items.find((i) => i.id === 'lock-proj')?.reason, 'a dispatch tick currently holds the run lock')
})

// A run genuinely started but with no checkpoint activity beyond its own
// creation yet (a real, honest, reachable state -- see keep-going-
// controller.mjs's own projection) must pass through as null, never a
// fabricated timestamp standing in for "no real heartbeat exists yet."
test('lastCheckpointAt: a genuinely null value (no real checkpoint yet) passes through honestly, never fabricated', () => {
  const noCheckpointYet = item('fresh-proj', 'PLANNING', { lastCheckpointAt: null })
  const items = buildGlobalRunStatusItems(emptyWork({ active: [noCheckpointYet] }))
  assert.equal(items[0].lastCheckpointAt, null)
})

// Multiple real, simultaneously-tracked projects each in a genuinely
// different urgency state -- proves the indicator's own item list and
// its urgency-derived summary never contradict each other or silently
// drop/merge a project when several are active at once (the closest real
// analog to "multiple simultaneous missions": one mission per project,
// but many projects with their own real, independent mission at the same
// time, which the domain model genuinely supports).
test('MULTIPLE PROJECTS: several real projects each in a different urgency state are all present, none dropped, none merged, and the most urgent one alone drives the summary', () => {
  const work = emptyWork({
    active: [item('working-proj', 'WORKING')],
    verifying: [item('verifying-proj', 'VERIFYING')],
    needsYou: [item('needs-you-proj', 'NEEDS_YOU')],
    stalled: [item('stalled-proj', 'STALLED')],
    readyForAdoption: [item('ready-proj', 'READY_FOR_ADOPTION')]
  })
  const items = buildGlobalRunStatusItems(work)
  assert.equal(items.length, 5, 'every real project must be individually present, none dropped')
  assert.equal(new Set(items.map((i) => i.id)).size, 5, 'none merged/collapsed into a shared entry')
  assert.equal(
    mostUrgentState(items),
    'NEEDS_YOU',
    'the single most urgent real state must drive the summary, not an average or a count'
  )
})

function attentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'finding:x',
    category: 'NEEDS_OWNER',
    severity: 'P2',
    project: null,
    label: 'some-surface',
    reason: 'Not eligible for autofix -- needs your call.',
    changedAt: '2026-09-03T00:00:00.000Z',
    deepLink: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:x' },
    source: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:x' },
    ...overrides
  }
}

// Operator Attention V1, Wave 2
test('selectExtraAttentionItems: includes every self-improvement-sourced item and the host-wide resource-pressure item, excludes everything else', () => {
  const selfImprovementReady = attentionItem({ id: 'finding:y', category: 'READY_FOR_ADOPTION' })
  const resourcePressure = attentionItem({
    id: 'resource-pressure:CRITICAL',
    category: 'WAITING_FOR_RESOURCES',
    project: null,
    source: { kind: 'RESOURCE_PRESSURE_TIER', id: 'CRITICAL' }
  })
  const projectNeedsOwner = attentionItem({ id: 'needsyou:PROJECT:1', source: { kind: 'KEEP_GOING_RUN', id: 'p1' } })
  const projectStalled = attentionItem({ id: 'run:p1:stalled', category: 'FAILED_REQUIRES_ATTENTION', source: { kind: 'KEEP_GOING_RUN', id: 'p1' } })

  const result = selectExtraAttentionItems([attentionItem(), selfImprovementReady, resourcePressure, projectNeedsOwner, projectStalled])
  assert.deepEqual(
    result.map((i) => i.id).sort(),
    ['finding:x', 'finding:y', 'resource-pressure:CRITICAL'].sort()
  )
})

// Operator Polish V1, Wave A: a planner needsYou item has no liveWorkFeed of
// its own (same reasoning as a self-improvement finding), so it must merge
// into this indicator's combined list too.
test('selectExtraAttentionItems: includes a planner-mission-needsYou-sourced item', () => {
  const plannerNeedsYou = attentionItem({
    id: 'needsyou:PLANNER:entry-1',
    project: null,
    deepLink: { kind: 'PLANNER_MISSION', id: 'mission-1' },
    source: { kind: 'PLANNER_MISSION_NEEDS_YOU', id: 'entry-1' }
  })
  const projectNeedsOwner = attentionItem({ id: 'needsyou:PROJECT:1', source: { kind: 'KEEP_GOING_RUN', id: 'p1' } })

  const result = selectExtraAttentionItems([plannerNeedsYou, projectNeedsOwner])
  assert.deepEqual(result.map((i) => i.id), ['needsyou:PLANNER:entry-1'])
})

test('resolveAttentionDeepLink: a PROJECT deep link resolves to the real project route; every other kind is honestly null (no route exists yet)', () => {
  assert.equal(resolveAttentionDeepLink(attentionItem({ deepLink: { kind: 'PROJECT', id: 'proj-1' } })), '/projects/proj-1')
  assert.equal(resolveAttentionDeepLink(attentionItem({ deepLink: { kind: 'RESEARCH_MISSION', id: 'm1' } })), null)
  assert.equal(resolveAttentionDeepLink(attentionItem({ deepLink: { kind: 'PLANNER_MISSION', id: 'm1' } })), null)
  assert.equal(resolveAttentionDeepLink(attentionItem({ deepLink: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:x' } })), null)
  assert.equal(resolveAttentionDeepLink(attentionItem({ deepLink: { kind: 'RESOURCE_PRESSURE', id: null } })), null)
})

test('attentionItemToGlobalRunStatusItem: maps a real attention item field-for-field, falling back to label when no project is known', () => {
  const mapped = attentionItemToGlobalRunStatusItem(attentionItem())
  assert.deepEqual(mapped, {
    id: 'finding:x',
    displayName: 'some-surface',
    runId: null,
    state: 'NEEDS_OWNER',
    reason: 'Not eligible for autofix -- needs your call.',
    lastCheckpointAt: '2026-09-03T00:00:00.000Z',
    linkTo: null
  })
})

test('attentionItemToGlobalRunStatusItem: uses the real project displayName when a project is known', () => {
  const mapped = attentionItemToGlobalRunStatusItem(
    attentionItem({ project: { id: 'proj-1', displayName: 'Project One' }, deepLink: { kind: 'PROJECT', id: 'proj-1' } })
  )
  assert.equal(mapped.displayName, 'Project One')
  assert.equal(mapped.linkTo, '/projects/proj-1')
})

// Operator Polish V1, Wave A: a planner needsYou item has a real label/
// reason/changedAt but honestly no project and no route yet -- must map
// through with a null link, never a fabricated one.
test('attentionItemToGlobalRunStatusItem: a planner needsYou item maps with honest null project and null link', () => {
  const mapped = attentionItemToGlobalRunStatusItem(
    attentionItem({
      id: 'needsyou:PLANNER:entry-1',
      project: null,
      label: 'mission-alpha',
      reason: 'Should this go forward with option A or B?',
      changedAt: '2026-09-05T00:00:00.000Z',
      deepLink: { kind: 'PLANNER_MISSION', id: 'mission-1' },
      source: { kind: 'PLANNER_MISSION_NEEDS_YOU', id: 'entry-1' }
    })
  )
  assert.deepEqual(mapped, {
    id: 'needsyou:PLANNER:entry-1',
    displayName: 'mission-alpha',
    runId: null,
    state: 'NEEDS_OWNER',
    reason: 'Should this go forward with option A or B?',
    lastCheckpointAt: '2026-09-05T00:00:00.000Z',
    linkTo: null
  })
})
