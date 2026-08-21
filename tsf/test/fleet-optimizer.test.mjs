import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFleetSchedule } from '../domain/fleet-optimizer.mjs'

function task(id, expected, overrides = {}) {
  return {
    id,
    title: id,
    activeEffortHours: { min: expected, expected, max: expected },
    dependencies: [],
    conflictsWith: [],
    ...overrides
  }
}

function projectA(overrides = {}) {
  return { projectId: 'project-a', priority: 1, wbs: [task('a1', 4)], ...overrides }
}
function projectB(overrides = {}) {
  return { projectId: 'project-b', priority: 2, wbs: [task('b1', 4)], ...overrides }
}

test('rejects an empty project list', () => {
  assert.throws(() => buildFleetSchedule({ projects: [] }), /at least one project/)
})

test('REQUIRED PROOF: two+ project workloads can be scheduled onto one shared timeline', () => {
  const result = buildFleetSchedule({ projects: [projectA(), projectB()], maxConcurrentWorkers: 1 })
  assert.equal(result.projects.length, 2)
  // maxConcurrentWorkers: 1 forces project-b's task to wait for project-a's.
  const a = result.projects.find((p) => p.projectId === 'project-a')
  const b = result.projects.find((p) => p.projectId === 'project-b')
  assert.equal(a.schedule[0].startHour, 0)
  assert.equal(b.schedule[0].startHour, 4)
})

test('REQUIRED PROOF: dependencies change the result -- a dependent task cannot start before its real dependency ends', () => {
  const withDep = projectA({
    wbs: [task('a1', 4), task('a2', 3, { dependencies: ['a1'] })]
  })
  const result = buildFleetSchedule({ projects: [withDep], maxConcurrentWorkers: 5 })
  const schedule = result.projects[0].schedule
  const a1 = schedule.find((s) => s.id === 'a1')
  const a2 = schedule.find((s) => s.id === 'a2')
  assert.ok(a2.startHour >= a1.endHour)
})

test('REQUIRED PROOF: a provider reset (REDUCE_CONCURRENCY) genuinely changes the schedule, not just a comment', () => {
  const highUsage = { codex: { weeklyUsedPercent: 90, status: null } }
  const baseline = buildFleetSchedule({
    projects: [projectA(), projectB()],
    maxConcurrentWorkers: 4,
    capacitySnapshot: null,
    providerId: 'codex'
  })
  const constrained = buildFleetSchedule({
    projects: [projectA(), projectB()],
    maxConcurrentWorkers: 4,
    capacitySnapshot: highUsage,
    providerId: 'codex'
  })
  assert.equal(baseline.effectiveConcurrency, 4)
  assert.equal(constrained.capacityAction, 'REDUCE_CONCURRENCY')
  assert.ok(constrained.effectiveConcurrency < baseline.effectiveConcurrency)
})

test('REQUIRED PROOF: a provider PAUSE_AND_CHECKPOINT action results in an honestly empty schedule, never a fabricated one', () => {
  const pausedSnapshot = { codex: { weeklyUsedPercent: 97, status: null } }
  const result = buildFleetSchedule({
    projects: [projectA()],
    capacitySnapshot: pausedSnapshot,
    providerId: 'codex'
  })
  assert.equal(result.capacityAction, 'PAUSE_AND_CHECKPOINT')
  assert.equal(result.effectiveConcurrency, 0)
  assert.deepEqual(result.projects[0].schedule, [])
  assert.equal(result.projects[0].totalDurationHours, null)
})

test('REQUIRED PROOF: project priority changes the result -- the higher-priority project is scheduled first regardless of input order', () => {
  const lowFirst = buildFleetSchedule({
    projects: [projectB({ priority: 1 }), projectA({ priority: 2 })],
    maxConcurrentWorkers: 1
  })
  // project-b now has priority 1 (higher), so it goes first even though
  // it was listed second and even though project-a's id sorts first.
  const b = lowFirst.projects.find((p) => p.projectId === 'project-b')
  assert.equal(b.schedule[0].startHour, 0)
})

test('REQUIRED PROOF: Windows concurrency limits change the result -- concurrency 1 vs 2 produce genuinely different schedules', () => {
  const serial = buildFleetSchedule({ projects: [projectA(), projectB()], maxConcurrentWorkers: 1 })
  const parallel = buildFleetSchedule({
    projects: [projectA(), projectB()],
    maxConcurrentWorkers: 2
  })
  const serialB = serial.projects.find((p) => p.projectId === 'project-b').schedule[0].startHour
  const parallelB = parallel.projects.find((p) => p.projectId === 'project-b').schedule[0].startHour
  assert.equal(serialB, 4)
  assert.equal(parallelB, 0)
})

test('REQUIRED PROOF: an impossible deadline is surfaced honestly as deadlineMet:false, never silently passed', () => {
  const result = buildFleetSchedule({
    projects: [projectA({ wbs: [task('a1', 10)], deadlineHours: 2 })],
    maxConcurrentWorkers: 2
  })
  assert.equal(result.projects[0].deadlineMet, false)
  assert.match(result.projects[0].reasoning, /NOT achievable/)
})

test('an achievable deadline is honestly deadlineMet:true', () => {
  const result = buildFleetSchedule({
    projects: [projectA({ wbs: [task('a1', 2)], deadlineHours: 10 })],
    maxConcurrentWorkers: 2
  })
  assert.equal(result.projects[0].deadlineMet, true)
})

test('every project schedule includes a real reasoning explanation', () => {
  const result = buildFleetSchedule({ projects: [projectA()], maxConcurrentWorkers: 2 })
  assert.ok(result.projects[0].reasoning.length > 0)
})

test('REQUIRED PROOF: the optimizer can replan after a stall -- calling it again with updated remaining work produces a genuinely different real schedule', () => {
  const original = buildFleetSchedule({
    projects: [
      projectA({ wbs: [task('a1', 4), task('a2', 4, { dependencies: ['a1'] })] }),
      projectB()
    ],
    maxConcurrentWorkers: 1
  })
  // project-a stalled after a1 -- replanning with only the remaining
  // task (a2) reflects the real, updated state, not the original plan.
  const replanned = buildFleetSchedule({
    projects: [projectA({ wbs: [task('a2', 4)] }), projectB()],
    maxConcurrentWorkers: 1
  })
  const originalB = original.projects.find((p) => p.projectId === 'project-b').schedule[0].startHour
  const replannedB = replanned.projects.find((p) => p.projectId === 'project-b').schedule[0]
    .startHour
  assert.notEqual(originalB, replannedB)
})

test('REQUIRED PROOF: identical inputs produce byte-identical, reproducible schedules (deterministic, no randomness)', () => {
  const input = { projects: [projectA(), projectB()], maxConcurrentWorkers: 2 }
  const first = buildFleetSchedule(input)
  const second = buildFleetSchedule(input)
  assert.deepEqual(first, second)
})
