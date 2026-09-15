import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeCards,
  activeResearchItems,
  isResearchWorkItem,
  needsYouCards,
  needsYouResearchItems,
  projectWorkCards,
  readyForAdoptionCards,
  recentlyCompletedCards,
  recentlyCompletedResearchItems,
  verifyingCards,
  waitingCards
} from './operator-work-cards.ts'
import type { ProjectCard } from './types.ts'
import type { OperatorSnapshot, OwnerWorkItem } from './operator-snapshot-types.ts'

function projectCard(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: 'p1',
    displayName: 'Project One',
    sourceClass: 'REAL',
    lifecycle: 'ACTIVE',
    activeFleet: true,
    workSet: true,
    missionState: 'ACTIVE',
    blockedReason: null,
    healthStatus: 'HEALTHY',
    topFinding: null,
    migrationClassification: null,
    restrictions: [],
    release: { head: null, tree: null },
    candidateState: null,
    ...overrides
  }
}

// Mirrors tsf/domain/owner-primary-state.mjs's own mapping table -- kept
// as a small, explicit lookup here rather than importing the real .mjs
// (a different module-resolution boundary than this UI package), so test
// fixtures stay honest about what the real backend actually returns for
// each `state` rather than hand-picking values that happen to make a test
// pass.
const PRIMARY_STATE_BY_STATE: Record<
  OwnerWorkItem['state'],
  { primary: string; label: string | null }
> = {
  PLANNING: { primary: 'WAITING', label: 'Preparing' },
  WORKING: { primary: 'WORKING', label: null },
  WAITING: { primary: 'WAITING', label: 'Resources' },
  VERIFYING: { primary: 'WAITING', label: 'Verifying' },
  NEEDS_YOU: { primary: 'NEEDS_YOU', label: null },
  READY: { primary: 'NEEDS_YOU', label: 'Ready for adoption' },
  DONE: { primary: 'DONE', label: null },
  FAILED: { primary: 'NEEDS_YOU', label: 'Stalled' },
  PAUSED: { primary: 'WAITING', label: 'Paused' }
}

function workItem(overrides: Partial<OwnerWorkItem> = {}): OwnerWorkItem {
  const state = overrides.state ?? 'WORKING'
  const primary = PRIMARY_STATE_BY_STATE[state]
  return {
    id: 'run:r1',
    projectId: 'p1',
    goalId: null,
    kind: 'KEEP_GOING_RUN',
    parentId: null,
    state,
    reason: 'in-flight wave',
    primaryState: primary.primary as OwnerWorkItem['primaryState'],
    primaryReasonLabel: primary.label,
    progress: null,
    startedAt: null,
    updatedAt: null,
    availableActions: [],
    ...overrides
  }
}

function snapshot(overrides: Partial<OperatorSnapshot> = {}): OperatorSnapshot {
  return {
    revision: 1,
    generatedAt: '2026-09-13T00:00:00.000Z',
    projects: [],
    goals: [],
    work: [],
    waiting: [],
    needsYou: [],
    recentlyDone: [],
    capacity: null,
    attention: [],
    ...overrides
  }
}

test('projectWorkCards: joins a work item with its real project card by projectId, never reclassifying state/reason', () => {
  const cards = projectWorkCards(
    snapshot({
      projects: [projectCard({ id: 'p1', displayName: 'Real Project', healthStatus: 'DEGRADED' })],
      work: [workItem({ projectId: 'p1', state: 'WORKING', reason: 'in-flight wave' })]
    })
  )
  assert.equal(cards.length, 1)
  assert.equal(cards[0].displayName, 'Real Project')
  assert.equal(cards[0].healthStatus, 'DEGRADED')
  assert.equal(cards[0].state, 'WORKING')
  assert.equal(cards[0].reason, 'in-flight wave')
})

test('projectWorkCards: excludes research items entirely -- they render from the raw OwnerWorkItem via researchWorkItems instead', () => {
  const cards = projectWorkCards(
    snapshot({
      work: [workItem({ id: 'research:m1', kind: 'RESEARCH_MISSION', missionId: 'm1' })]
    })
  )
  assert.deepEqual(cards, [])
})

test('isResearchWorkItem: distinguishes RESEARCH_MISSION from every other kind', () => {
  assert.equal(isResearchWorkItem(workItem({ kind: 'RESEARCH_MISSION' })), true)
  assert.equal(isResearchWorkItem(workItem({ kind: 'KEEP_GOING_RUN' })), false)
  assert.equal(isResearchWorkItem(workItem({ kind: 'PROJECT' })), false)
})

test('needsYouCards: NEEDS_YOU, FAILED, and READY all land in the combined needs-you grouping (mirrors the legacy needsYou+stalled+blocked+readyForAdoption fold)', () => {
  const cards = projectWorkCards(
    snapshot({
      projects: [
        projectCard({ id: 'p1' }),
        projectCard({ id: 'p2' }),
        projectCard({ id: 'p3' }),
        projectCard({ id: 'p4' })
      ],
      work: [
        workItem({ id: 'a', projectId: 'p1', state: 'NEEDS_YOU' }),
        workItem({ id: 'b', projectId: 'p2', state: 'FAILED' }),
        workItem({ id: 'c', projectId: 'p3', state: 'READY' }),
        workItem({ id: 'd', projectId: 'p4', state: 'WORKING' })
      ]
    })
  )
  assert.deepEqual(new Set(needsYouCards(cards).map((c) => c.id)), new Set(['a', 'b', 'c']))
})

// TSF UI FINDINGS #2-#16 RECONCILE & UPGRADE, Finding #5/#7: PLANNING and
// PAUSED moved OUT of activeCards (which now means ONLY primaryState
// WORKING -- genuinely progressing right now) and INTO waitingCards.
// VERIFYING collapses to primaryState WAITING too, but stays out of
// waitingCards (its own dedicated section, verifyingCards, already exists
// -- see operator-work-cards.ts's own comment on why double-rendering it
// would be wrong).
test('activeCards/waitingCards/verifyingCards/readyForAdoptionCards/recentlyCompletedCards: each canonical state lands in exactly one bucket', () => {
  const projects = [projectCard({ id: 'p1' })]
  const cards = projectWorkCards(
    snapshot({
      projects,
      work: [
        workItem({ id: 'planning', projectId: 'p1', state: 'PLANNING' }),
        workItem({ id: 'working', projectId: 'p1', state: 'WORKING' }),
        workItem({ id: 'paused', projectId: 'p1', state: 'PAUSED' }),
        workItem({ id: 'waiting', projectId: 'p1', state: 'WAITING' }),
        workItem({ id: 'verifying', projectId: 'p1', state: 'VERIFYING' }),
        workItem({ id: 'ready', projectId: 'p1', state: 'READY' }),
        workItem({ id: 'done', projectId: 'p1', state: 'DONE' })
      ]
    })
  )
  assert.deepEqual(new Set(activeCards(cards).map((c) => c.id)), new Set(['working']))
  assert.deepEqual(
    new Set(waitingCards(cards).map((c) => c.id)),
    new Set(['planning', 'paused', 'waiting'])
  )
  assert.deepEqual(
    verifyingCards(cards).map((c) => c.id),
    ['verifying']
  )
  assert.deepEqual(
    readyForAdoptionCards(cards).map((c) => c.id),
    ['ready']
  )
  assert.deepEqual(
    recentlyCompletedCards(cards).map((c) => c.id),
    ['done']
  )
})

test('Finding #7: a real active execution hold moves a WORKING run out of activeCards and into waitingCards with the Execution hold label', () => {
  const cards = projectWorkCards(
    snapshot({
      projects: [projectCard({ id: 'p1' })],
      work: [
        workItem({
          id: 'held',
          projectId: 'p1',
          state: 'WORKING',
          primaryState: 'WAITING',
          primaryReasonLabel: 'Execution hold'
        })
      ]
    })
  )
  assert.deepEqual(activeCards(cards), [])
  assert.equal(waitingCards(cards).length, 1)
  assert.equal(waitingCards(cards)[0].primaryReasonLabel, 'Execution hold')
  assert.equal(
    waitingCards(cards)[0].state,
    'WORKING',
    'the richer internal state stays real, unmodified'
  )
})

test('Finding #2: needsYouCards keys off primaryState, so a held NEEDS_YOU/FAILED/READY item moves out of Needs You into Waiting', () => {
  const cards = projectWorkCards(
    snapshot({
      projects: [projectCard({ id: 'p1' })],
      work: [
        workItem({
          id: 'held-ready',
          projectId: 'p1',
          state: 'READY',
          primaryState: 'WAITING',
          primaryReasonLabel: 'Execution hold'
        })
      ]
    })
  )
  assert.deepEqual(needsYouCards(cards), [])
  assert.equal(waitingCards(cards).length, 1)
})

// Real, confirmed divergence: a research mission's WAITING_FOR_RESOURCES
// phase is 'active' in the legacy aggregation (no separate research
// waiting section), unlike a Keep Going run's WAITING -- this must not
// get smoothed over during migration.
test('activeResearchItems: a WAITING research item counts as active (no separate research waiting section, unlike Keep Going); PAUSED does not (that is a real operator cancel)', () => {
  const items = [
    workItem({ id: 'r-waiting', kind: 'RESEARCH_MISSION', state: 'WAITING' }),
    workItem({ id: 'r-working', kind: 'RESEARCH_MISSION', state: 'WORKING' }),
    workItem({ id: 'r-paused', kind: 'RESEARCH_MISSION', state: 'PAUSED' })
  ]
  assert.deepEqual(
    new Set(activeResearchItems(items).map((i) => i.id)),
    new Set(['r-waiting', 'r-working'])
  )
})

test('needsYouResearchItems/recentlyCompletedResearchItems: research items bucket by the same real owner state as project items', () => {
  const items = [
    workItem({ id: 'r-needs-you', kind: 'RESEARCH_MISSION', state: 'NEEDS_YOU' }),
    workItem({ id: 'r-done', kind: 'RESEARCH_MISSION', state: 'DONE' }),
    workItem({ id: 'r-working', kind: 'RESEARCH_MISSION', state: 'WORKING' })
  ]
  assert.deepEqual(
    needsYouResearchItems(items).map((i) => i.id),
    ['r-needs-you']
  )
  assert.deepEqual(
    recentlyCompletedResearchItems(items).map((i) => i.id),
    ['r-done']
  )
})
