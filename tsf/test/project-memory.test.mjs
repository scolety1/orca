import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyProjectMemory,
  addMemoryRecord,
  supersedeMemoryRecord,
  activeRecordsOfClass,
  retrieveExperiencesForCapsule,
  projectDecisionsFromReceipts
} from '../domain/project-memory.mjs'

function tick(ms) {
  let t = ms
  return () => new Date(t++)
}

test('addMemoryRecord requires a real, recognized source', () => {
  const memory = emptyProjectMemory()
  assert.throws(
    () =>
      addMemoryRecord(
        memory,
        { class: 'FACT', statement: 'uses TypeScript strict mode', source: null },
        tick(0)
      ),
    /source\.kind/
  )
  assert.throws(
    () =>
      addMemoryRecord(
        memory,
        { class: 'FACT', statement: 'uses TypeScript strict mode', source: { kind: 'MADE_UP' } },
        tick(0)
      ),
    /source\.kind/
  )
})

test('addMemoryRecord rejects an unsupported class', () => {
  const memory = emptyProjectMemory()
  assert.throws(
    () =>
      addMemoryRecord(
        memory,
        { class: 'RUMOR', statement: 'x', source: { kind: 'CHAT', ref: 'msg-1' } },
        tick(0)
      ),
    /unsupported memory class/
  )
})

test('a new fact is added as an active, non-superseded record', () => {
  const memory = emptyProjectMemory()
  const next = addMemoryRecord(
    memory,
    {
      class: 'FACT',
      statement: 'uses TypeScript strict mode',
      source: { kind: 'CHAT', ref: 'msg-1' }
    },
    tick(0)
  )
  assert.equal(next.records.length, 1)
  const active = activeRecordsOfClass(next, 'FACT')
  assert.equal(active.length, 1)
  assert.equal(active[0].statement, 'uses TypeScript strict mode')
  assert.equal(active[0].supersededAt, null)
})

test('a non-explicit fact can be superseded with no authorization at all', () => {
  const memory = emptyProjectMemory()
  const withFact = addMemoryRecord(
    memory,
    { class: 'FACT', statement: 'uses npm', source: { kind: 'CHAT', ref: 'msg-1' } },
    tick(0)
  )
  const factId = withFact.records[0].id
  const next = supersedeMemoryRecord(
    withFact,
    factId,
    { statement: 'uses pnpm now', source: { kind: 'CHAT', ref: 'msg-2' } },
    undefined,
    tick(1000)
  )
  const active = activeRecordsOfClass(next, 'FACT')
  assert.equal(active.length, 1)
  assert.equal(active[0].statement, 'uses pnpm now')
  const old = next.records.find((r) => r.id === factId)
  assert.ok(old.supersededAt)
  assert.equal(old.supersededBy, active[0].id)
  // The stale fact is never deleted, only marked.
  assert.equal(next.records.length, 2)
})

test('an explicit record cannot be superseded without authorizedBy: TIM', () => {
  const memory = emptyProjectMemory()
  const withDecision = addMemoryRecord(
    memory,
    {
      class: 'PREFERENCE',
      statement: 'Tim wants all PRs squash-merged',
      source: { kind: 'TIM_EXPLICIT', ref: 'chat:2026-08-20' },
      explicit: true
    },
    tick(0)
  )
  const recordId = withDecision.records[0].id
  assert.throws(
    () =>
      supersedeMemoryRecord(
        withDecision,
        recordId,
        { statement: 'actually rebase-merge', source: { kind: 'CHAT', ref: 'msg-9' } },
        undefined,
        tick(1000)
      ),
    /TSF_MEMORY_EXPLICIT_IMMUTABLE|explicit Tim authorization/
  )
  assert.throws(
    () =>
      supersedeMemoryRecord(
        withDecision,
        recordId,
        { statement: 'actually rebase-merge', source: { kind: 'CHAT', ref: 'msg-9' } },
        { authorizedBy: 'SOMEONE_ELSE', reason: 'because' },
        tick(1000)
      ),
    /TSF_MEMORY_EXPLICIT_IMMUTABLE|explicit Tim authorization/
  )
})

test('an explicit record CAN be superseded with authorizedBy: TIM and a reason', () => {
  const memory = emptyProjectMemory()
  const withDecision = addMemoryRecord(
    memory,
    {
      class: 'PREFERENCE',
      statement: 'Tim wants all PRs squash-merged',
      source: { kind: 'TIM_EXPLICIT', ref: 'chat:2026-08-20' },
      explicit: true
    },
    tick(0)
  )
  const recordId = withDecision.records[0].id
  const next = supersedeMemoryRecord(
    withDecision,
    recordId,
    {
      statement: 'actually rebase-merge from now on',
      source: { kind: 'TIM_EXPLICIT', ref: 'chat:2026-08-21' }
    },
    { authorizedBy: 'TIM', reason: 'Tim changed his mind' },
    tick(1000)
  )
  const active = activeRecordsOfClass(next, 'PREFERENCE')
  assert.equal(active.length, 1)
  assert.equal(active[0].statement, 'actually rebase-merge from now on')
  assert.equal(
    active[0].explicit,
    true,
    'the replacement inherits explicit status from the original'
  )
})

test('an explicit-authorization supersede without a reason is rejected', () => {
  const memory = emptyProjectMemory()
  const withDecision = addMemoryRecord(
    memory,
    {
      class: 'FACT',
      statement: 'x',
      source: { kind: 'TIM_EXPLICIT', ref: 'chat:1' },
      explicit: true
    },
    tick(0)
  )
  assert.throws(
    () =>
      supersedeMemoryRecord(
        withDecision,
        withDecision.records[0].id,
        { statement: 'y', source: { kind: 'TIM_EXPLICIT', ref: 'chat:2' } },
        { authorizedBy: 'TIM', reason: '   ' },
        tick(1000)
      ),
    /reason is required/
  )
})

test('supersedeMemoryRecord rejects an already-superseded record rather than double-chaining silently', () => {
  const memory = emptyProjectMemory()
  const withFact = addMemoryRecord(
    memory,
    { class: 'FACT', statement: 'v1', source: { kind: 'CHAT', ref: 'msg-1' } },
    tick(0)
  )
  const id = withFact.records[0].id
  const once = supersedeMemoryRecord(
    withFact,
    id,
    { statement: 'v2', source: { kind: 'CHAT', ref: 'msg-2' } },
    undefined,
    tick(1000)
  )
  assert.throws(
    () =>
      supersedeMemoryRecord(
        once,
        id,
        { statement: 'v3', source: { kind: 'CHAT', ref: 'msg-3' } },
        undefined,
        tick(2000)
      ),
    /already superseded/
  )
})

test('retrieveExperiencesForCapsule returns only active experiences, most recent first, bounded to limit', () => {
  let memory = emptyProjectMemory()
  const clock = tick(0)
  for (let i = 0; i < 8; i++) {
    memory = addMemoryRecord(
      memory,
      {
        class: 'EXPERIENCE',
        statement: `lesson ${i}`,
        source: { kind: 'RESULT_CAPSULE', ref: `mission-${i}` }
      },
      clock
    )
  }
  const retrieved = retrieveExperiencesForCapsule(memory, 5)
  assert.equal(retrieved.length, 5)
  assert.deepEqual(retrieved, ['lesson 3', 'lesson 4', 'lesson 5', 'lesson 6', 'lesson 7'])
})

test('retrieveExperiencesForCapsule excludes superseded experiences', () => {
  let memory = emptyProjectMemory()
  const clock = tick(0)
  memory = addMemoryRecord(
    memory,
    {
      class: 'EXPERIENCE',
      statement: 'old lesson',
      source: { kind: 'RESULT_CAPSULE', ref: 'mission-1' }
    },
    clock
  )
  const id = memory.records[0].id
  memory = supersedeMemoryRecord(
    memory,
    id,
    { statement: 'corrected lesson', source: { kind: 'RESULT_CAPSULE', ref: 'mission-2' } },
    undefined,
    clock
  )
  const retrieved = retrieveExperiencesForCapsule(memory, 5)
  assert.deepEqual(retrieved, ['corrected lesson'])
})

test('retrieveExperiencesForCapsule never returns more than limit even with a long history (no giant transcript injection)', () => {
  let memory = emptyProjectMemory()
  const clock = tick(0)
  for (let i = 0; i < 500; i++) {
    memory = addMemoryRecord(
      memory,
      { class: 'EXPERIENCE', statement: `lesson ${i}`, source: { kind: 'CHAT', ref: `msg-${i}` } },
      clock
    )
  }
  assert.equal(retrieveExperiencesForCapsule(memory, 5).length, 5)
})

test('projectDecisionsFromReceipts is a pure projection over the existing receipt chain, bounded and reversed-recent-first', () => {
  const chain = [
    { kind: 'MISSION_CREATED', decision: null, timestamp: 't0' },
    { kind: 'ADOPTION_DECISION', decision: 'ADOPTED', timestamp: 't1' },
    { kind: 'VERIFIER_RESULT', decision: 'REJECT_CURRENT_CANDIDATE', timestamp: 't2' },
    { kind: 'RELEASE_PROMOTION', decision: 'PROMOTED_TO_STABLE', timestamp: 't3' }
  ]
  const decisions = projectDecisionsFromReceipts(chain, 2)
  assert.deepEqual(decisions, [
    'VERIFIER_RESULT: REJECT_CURRENT_CANDIDATE (t2)',
    'RELEASE_PROMOTION: PROMOTED_TO_STABLE (t3)'
  ])
})

test('projectDecisionsFromReceipts handles an empty/undefined chain honestly', () => {
  assert.deepEqual(projectDecisionsFromReceipts(undefined), [])
  assert.deepEqual(projectDecisionsFromReceipts([]), [])
})
