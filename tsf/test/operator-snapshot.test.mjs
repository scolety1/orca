// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 5. Proves buildOperatorSnapshot
// reads project/run/mission state EXACTLY ONCE (never the legacy "call
// /portfolio, then /work, then /attention" pattern Stage 0's own
// archaeology found), and assembles a coherent snapshot from that one read.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOperatorSnapshot, currentOperatorRevision } from '../server/operator-snapshot.mjs'
import { createOvernightRun, completeRun, raiseNeedsYou } from '../domain/keep-going.mjs'

const clock = () => new Date('2026-09-13T00:00:00.000Z')

function project(id, overrides = {}) {
  return {
    id,
    displayName: id,
    mission: { state: 'ONBOARDED', id: null, blockedReason: null },
    candidate: null,
    receipts: { chain: [] },
    health: { status: 'HEALTHY', findings: [] },
    release: null,
    ...overrides
  }
}

function baseDeps(overrides = {}) {
  return {
    buildResourcePressureState: () => ({
      tier: 'HEALTHY',
      reason: null,
      observedAt: clock().toISOString()
    }),
    collectHostMemoryEvidence: () => ({ totalBytes: 16e9, freeBytes: 8e9 }),
    getStateFilePath: () => '/does/not/exist/for/this/test.json',
    ...overrides
  }
}

test('buildOperatorSnapshot reads project/run/mission state EXACTLY ONCE (never the legacy multi-fetch pattern)', () => {
  let projectsByIdCalls = 0
  const run = createOvernightRun(
    { id: 'r1', projectId: 'p1', originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
  buildOperatorSnapshot(
    clock,
    baseDeps({
      projectsById: () => {
        projectsByIdCalls += 1
        return { map: new Map([['p1', project('p1')]]), opState: { keepGoingRuns: { p1: run } } }
      }
    })
  )
  assert.equal(
    projectsByIdCalls,
    1,
    'exactly one real read -- work/attention/needsYou/projects must all derive from the SAME captured opState'
  )
})

test('buildOperatorSnapshot assembles a coherent snapshot: projects, work, capacity, revision, generatedAt all present', () => {
  const run = createOvernightRun(
    { id: 'r1', projectId: 'p1', originalGoal: 'ship it', acceptanceCriteria: ['X'] },
    clock
  )
  const snapshot = buildOperatorSnapshot(
    clock,
    baseDeps({
      projectsById: () => ({
        map: new Map([['p1', project('p1')]]),
        opState: { keepGoingRuns: { p1: run } }
      })
    })
  )
  assert.equal(snapshot.generatedAt, clock().toISOString())
  assert.deepEqual(
    snapshot.projects.map((p) => p.id),
    ['p1']
  )
  assert.equal(snapshot.work.length, 1)
  assert.equal(snapshot.work[0].state, 'PLANNING')
  assert.equal(snapshot.capacity.tier, 'HEALTHY')
  assert.deepEqual(snapshot.goals, [], 'Stage 6 territory -- honestly empty, never fabricated')
  assert.equal(typeof snapshot.revision, 'number')
})

test('buildOperatorSnapshot: recentlyDone only includes real DONE items (a real ADVANCED adoption merge), not merely READY ones', () => {
  const readyRun = completeRun(
    createOvernightRun(
      { id: 'r1', projectId: 'p1', originalGoal: 'x', acceptanceCriteria: ['X'] },
      clock
    ),
    clock
  )
  const doneRun = completeRun(
    createOvernightRun(
      { id: 'r2', projectId: 'p2', originalGoal: 'x', acceptanceCriteria: ['X'] },
      clock
    ),
    clock
  )
  const canonicalBases = {
    p2: { history: [{ action: 'ADVANCED', missionId: doneRun.id, at: clock().toISOString() }] }
  }
  const snapshot = buildOperatorSnapshot(
    clock,
    baseDeps({
      projectsById: () => ({
        map: new Map([
          ['p1', project('p1')],
          ['p2', project('p2')]
        ]),
        opState: {
          keepGoingRuns: { p1: readyRun, p2: doneRun },
          projectCanonicalBases: canonicalBases
        }
      })
    })
  )
  assert.deepEqual(
    snapshot.recentlyDone.map((i) => i.id),
    ['run:r2']
  )
  assert.equal(snapshot.work.find((i) => i.id === 'run:r1').state, 'READY')
})

test('buildOperatorSnapshot: needsYou reflects the real fleetNeedsYouStatus aggregation (a project-scoped open question)', () => {
  const run = raiseNeedsYou(
    createOvernightRun(
      { id: 'r1', projectId: 'p1', originalGoal: 'x', acceptanceCriteria: ['X'] },
      clock
    ),
    { question: 'which provider?' },
    clock,
    0
  )
  const snapshot = buildOperatorSnapshot(
    clock,
    baseDeps({
      projectsById: () => ({
        map: new Map([['p1', project('p1')]]),
        opState: { keepGoingRuns: { p1: run } }
      })
    })
  )
  assert.equal(snapshot.needsYou.length, 1)
  assert.equal(snapshot.needsYou[0].source, 'PROJECT')
  assert.equal(snapshot.needsYou[0].question, 'which provider?')
})

test('buildOperatorSnapshot: waiting reflects the complete real 3-source resource-wait aggregation, not just Keep Going', () => {
  const finding = {
    schemaVersion: 'TSF_SELF_IMPROVEMENT_FINDING_V1',
    findingId: 'f1',
    status: 'FIX_MISSION_CREATED',
    projectId: 'p1',
    affectedSurface: 'x',
    severity: 'P2',
    transitions: [],
    updatedAt: clock().toISOString()
  }
  const plannerMissionId = 'mission:selfimprove:f1'
  const plannerRecord = {
    checkpoint: {
      resourceState: {
        tier: 'CRITICAL',
        reason: 'host memory critical',
        observedAt: clock().toISOString()
      }
    }
  }
  const snapshot = buildOperatorSnapshot(
    clock,
    baseDeps({
      projectsById: () => ({
        map: new Map([['p1', project('p1')]]),
        opState: {
          keepGoingRuns: {},
          selfImprovementFindings: { f1: finding },
          plannerMissions: { [plannerMissionId]: plannerRecord }
        }
      })
    })
  )
  assert.equal(snapshot.waiting.length, 1)
  assert.equal(snapshot.waiting[0].source.kind, 'SELF_IMPROVEMENT_FINDING')
})

test('currentOperatorRevision: an honest 0 when the state file has never been written, never a fabricated number', () => {
  const revision = currentOperatorRevision({
    getStateFilePath: () => '/does/not/exist/at/all.json'
  })
  assert.equal(revision, 0)
})

test('currentOperatorRevision: reflects the real state file mtime when injected', () => {
  const revision = currentOperatorRevision({
    getStateFilePath: () => '/fake/path.json',
    statSync: () => ({ mtimeMs: 12345 })
  })
  assert.equal(revision, 12345)
})
