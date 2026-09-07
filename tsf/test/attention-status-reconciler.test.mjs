// Phase 5/7 proof: reconcile-then-deliver-lazily, restart-safe, dedup under
// real concurrency. Every test uses INJECTED deps (never the real global
// project/run/mission stores) so this stays fast and deterministic -- only
// the durable event store itself (an isolated state file, like every other
// store test in this codebase) is real, since that persistence IS what
// Phase 7 proves.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-attention-status-reconciler-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { reconcileFleetAttentionItems, drainDueAttentionNotifications } = await import('../server/attention-status-reconciler.mjs')
const { listAttentionNotificationEvents } = await import('../server/attention-notification-event-store.mjs')
const { createOvernightRun, markStalled } = await import('../domain/keep-going.mjs')
const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { buildResourcePressureState } = await import('../domain/resource-pressure-governor.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.attention-notification-event.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-07T12:00:00.000Z')

function project(id, overrides = {}) {
  return { id, displayName: id, mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] }, ...overrides }
}

function emptyDeps(overrides = {}) {
  return {
    projects: [],
    keepGoingRuns: {},
    researchMissions: {},
    plannerMissionRecords: {},
    selfImprovementFindings: {},
    resourcePressureState: buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 8e9, availableBytes: 8e9 } }, clock),
    ...overrides
  }
}

function rawFinding(overrides = {}) {
  return {
    sourceDetector: 'GOLDEN_PATH_EVAL',
    severity: 'P2',
    evidence: { caseId: 'case-1' },
    reproduction: { command: 'node --test' },
    affectedSurface: 'golden-path:platform',
    confidence: 0.8,
    verificationMethod: 'EVAL_PACK_RERUN',
    ...overrides
  }
}

function needsOwnerFinding(surface) {
  let finding = createFinding(rawFinding({ affectedSurface: surface }), clock)
  finding = transitionFinding(finding, 'VERIFIED', { reason: 'x' }, clock)
  finding = transitionFinding(finding, 'NEEDS_OWNER', { reason: 'AUTOFIX_ELIGIBILITY_CLASSIFIED' }, clock)
  return finding
}

test('a fresh NEEDS_OWNER-worthy state creates exactly one UNSEEN event; the SAME state reconciled again creates zero new events (dedup)', async (t) => {
  t.after(cleanupStateFile)
  const finding = needsOwnerFinding('dedup-surface')
  const deps = emptyDeps({ selfImprovementFindings: { [finding.findingId]: finding } })

  const first = await reconcileFleetAttentionItems(clock, deps)
  assert.equal(first.length, 1)
  assert.equal(first[0].state, 'UNSEEN')

  const second = await reconcileFleetAttentionItems(clock, deps)
  assert.equal(second.length, 0, 'no new event on an unchanged, already-recorded state')
  assert.equal(listAttentionNotificationEvents().length, 1)
})

test('drainDueAttentionNotifications delivers all UNSEEN, marks them DELIVERED, and a second call returns nothing new for the same unchanged state', async (t) => {
  t.after(cleanupStateFile)
  const finding = needsOwnerFinding('drain-surface')
  const deps = emptyDeps({ selfImprovementFindings: { [finding.findingId]: finding } })

  const notices = await drainDueAttentionNotifications(clock, deps)
  assert.equal(notices.length, 1)
  assert.match(notices[0].text, /needs you/)

  const events = listAttentionNotificationEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].state, 'DELIVERED')

  const secondNotices = await drainDueAttentionNotifications(clock, deps)
  assert.equal(secondNotices.length, 0, 'nothing new to deliver on an unchanged state')
})

test('PHASE 7 REQUIRED: restart-equivalent -- a fresh reconcile call after a prior UNSEEN event was already recorded creates no duplicate, and the original event survives untouched', async (t) => {
  t.after(cleanupStateFile)
  const finding = needsOwnerFinding('restart-surface')
  const deps = emptyDeps({ selfImprovementFindings: { [finding.findingId]: finding } })

  await reconcileFleetAttentionItems(clock, deps)
  const beforeRestart = listAttentionNotificationEvents()
  assert.equal(beforeRestart.length, 1)
  assert.equal(beforeRestart[0].state, 'UNSEEN')

  // "Restart" here means: a completely fresh call against the same
  // persisted store state -- no in-memory state from the prior call reused.
  const afterRestart = await reconcileFleetAttentionItems(clock, deps)
  assert.equal(afterRestart.length, 0, 'no duplicate created on re-observation after a simulated restart')
  const events = listAttentionNotificationEvents()
  assert.equal(events.length, 1, 'still exactly one record')
  assert.equal(events[0].eventId, beforeRestart[0].eventId)
  assert.equal(events[0].state, 'UNSEEN', 'not lost, not duplicated, not silently delivered')
})

test('PHASE 7 REQUIRED: two near-simultaneous concurrent reconciles against the same qualifying state produce exactly one event, never two', async (t) => {
  t.after(cleanupStateFile)
  const finding = needsOwnerFinding('concurrency-surface')
  const deps = emptyDeps({ selfImprovementFindings: { [finding.findingId]: finding } })

  const [a, b] = await Promise.all([reconcileFleetAttentionItems(clock, deps), reconcileFleetAttentionItems(clock, deps)])
  const totalCreated = a.length + b.length
  assert.equal(totalCreated, 1, 'exactly one of the two concurrent reconciles actually creates the event')
  assert.equal(listAttentionNotificationEvents().length, 1, 'the store\'s own race-free registration prevents a duplicate')
})

test('PHASE 7 REQUIRED: a finding that stays NEEDS_OWNER across 5 consecutive reconcile calls produces exactly one event total, never re-fired/re-delivered after its first drain', async (t) => {
  t.after(cleanupStateFile)
  const finding = needsOwnerFinding('persistent-surface')
  const deps = emptyDeps({ selfImprovementFindings: { [finding.findingId]: finding } })

  await drainDueAttentionNotifications(clock, deps)
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential, proving repeated cycles never re-fire
    const notices = await drainDueAttentionNotifications(clock, deps)
    assert.equal(notices.length, 0, `cycle ${i + 2} must deliver nothing new`)
  }
  assert.equal(listAttentionNotificationEvents().length, 1)
})

test('PHASE 7 REQUIRED: multiple distinct projects independently reaching a notify-worthy state each get one distinct event, never merged/lost/cross-attributed', async (t) => {
  t.after(cleanupStateFile)
  const runA = markStalled(createOvernightRun({ id: 'run-a', projectId: 'proj-a', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] }, clock), [], clock)
  const runB = markStalled(createOvernightRun({ id: 'run-b', projectId: 'proj-b', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] }, clock), [], clock)
  const deps = emptyDeps({
    projects: [project('proj-a'), project('proj-b')],
    keepGoingRuns: { 'proj-a': runA, 'proj-b': runB }
  })

  const registered = await reconcileFleetAttentionItems(clock, deps)
  assert.equal(registered.length, 2)
  const sourceIds = registered.map((e) => e.sourceId).sort()
  assert.deepEqual(sourceIds, ['proj-a', 'proj-b'])
  assert.notEqual(registered[0].eventId, registered[1].eventId)
})

test('PHASE 7 REQUIRED, documented behavior: a resource-pressure tier oscillating CRITICAL -> HEALTHY -> CRITICAL across three reconciles does NOT re-fire a second onset event for the same tier (no durable previous-tier tracker exists to tell a real re-onset apart from the same episode -- see attention-status-reconciler.mjs\'s transitionSignatureFor comment)', async (t) => {
  t.after(cleanupStateFile)
  const critical = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 2e9, availableBytes: 2e9 } }, clock)
  const healthy = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 8e9, availableBytes: 8e9 } }, clock)

  const first = await reconcileFleetAttentionItems(clock, emptyDeps({ resourcePressureState: critical }))
  assert.equal(first.length, 1)
  assert.equal(first[0].sourceId, 'CRITICAL')

  const second = await reconcileFleetAttentionItems(clock, emptyDeps({ resourcePressureState: healthy }))
  assert.equal(second.length, 0, 'HEALTHY produces no item at all -- nothing to register')

  const third = await reconcileFleetAttentionItems(clock, emptyDeps({ resourcePressureState: critical }))
  assert.equal(third.length, 0, 'documented choice: re-entering the SAME tier does not re-fire')

  assert.equal(listAttentionNotificationEvents().length, 1, 'still exactly one CRITICAL event across the whole oscillation')
})

test('a genuine escalation from CRITICAL to EMERGENCY DOES fire a second, distinct event (a strictly worse tier is a real, new transition)', async (t) => {
  t.after(cleanupStateFile)
  const critical = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 2e9, availableBytes: 2e9 } }, clock)
  const emergency = buildResourcePressureState({ hostMemory: { totalBytes: 16e9, freeBytes: 1e9, availableBytes: 1e9 } }, clock)

  await reconcileFleetAttentionItems(clock, emptyDeps({ resourcePressureState: critical }))
  const escalated = await reconcileFleetAttentionItems(clock, emptyDeps({ resourcePressureState: emergency }))
  assert.equal(escalated.length, 1)
  assert.equal(escalated[0].sourceId, 'EMERGENCY')
  assert.equal(listAttentionNotificationEvents().length, 2)
})

test('BLOCKED_EXTERNAL is real in the live view but never generates a notification event (not on the notify-worthy list)', async (t) => {
  t.after(cleanupStateFile)
  const deps = emptyDeps({
    projects: [project('proj-blocked', { mission: { state: 'BLOCKED_X', id: null, blockedReason: 'sensitive' } })]
  })
  const registered = await reconcileFleetAttentionItems(clock, deps)
  assert.deepEqual(registered, [])
  assert.equal(listAttentionNotificationEvents().length, 0)
})
