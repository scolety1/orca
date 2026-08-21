// M9 wave 5: turns one MEMORY eval case into a real actual output by
// ACTUALLY calling project-memory.mjs's real functions -- never a
// fabricated stand-in for what real memory retrieval/supersession would
// produce.
import {
  activeRecordsOfClass,
  addMemoryRecord,
  emptyProjectMemory,
  retrieveExperiencesForCapsule,
  supersedeMemoryRecord
} from '../domain/project-memory.mjs'

// queryWrongProject simulates a real isolation regression (e.g. a server-
// layer bug that reads the wrong project's memory map entry) by
// deliberately retrieving from project B's real memory instead of
// project A's -- exercising the real retrieveExperiencesForCapsule
// function with genuinely different real input, not a hand-typed fake
// failure.
function runIsolationCase(clock, { queryWrongProject = false } = {}) {
  let memoryA = emptyProjectMemory()
  memoryA = addMemoryRecord(
    memoryA,
    {
      class: 'EXPERIENCE',
      statement: 'Project A lesson: avoid X',
      source: { kind: 'TIM_EXPLICIT', ref: 'eval' }
    },
    clock
  )
  let memoryB = emptyProjectMemory()
  memoryB = addMemoryRecord(
    memoryB,
    {
      class: 'EXPERIENCE',
      statement: 'Project B lesson: avoid Y',
      source: { kind: 'TIM_EXPLICIT', ref: 'eval' }
    },
    clock
  )
  const queried = queryWrongProject ? memoryB : memoryA
  return { projectALessons: retrieveExperiencesForCapsule(queried) }
}

function runImmutabilityCase(clock) {
  let memory = emptyProjectMemory()
  memory = addMemoryRecord(
    memory,
    {
      class: 'PREFERENCE',
      statement: 'Always use TypeScript strict mode',
      source: { kind: 'TIM_EXPLICIT', ref: 'eval' },
      explicit: true
    },
    clock
  )
  const record = memory.records[0]
  let threw = false
  try {
    supersedeMemoryRecord(
      memory,
      record.id,
      { class: 'PREFERENCE', statement: 'x', source: { kind: 'CHAT', ref: 'eval' } },
      { authorizedBy: 'SOME_AGENT', reason: 'attempted, unauthorized' },
      clock
    )
  } catch {
    threw = true
  }
  return { unauthorizedSupersedeThrew: threw }
}

function runSupersessionCase(clock) {
  let memory = emptyProjectMemory()
  memory = addMemoryRecord(
    memory,
    {
      class: 'FACT',
      statement: 'v1: the API endpoint is at /api/v1',
      source: { kind: 'CHAT', ref: 'eval' }
    },
    clock
  )
  const oldRecord = memory.records[0]
  memory = supersedeMemoryRecord(
    memory,
    oldRecord.id,
    {
      class: 'FACT',
      statement: 'v2: the API endpoint moved to /api/v2',
      source: { kind: 'CHAT', ref: 'eval' }
    },
    { authorizedBy: 'ANYONE', reason: 'endpoint moved' },
    clock
  )
  const active = activeRecordsOfClass(memory, 'FACT')
  const oldRecordStillPresent = memory.records.some((r) => r.id === oldRecord.id && r.supersededAt)
  return { activeStatementAfterSupersede: active[0]?.statement ?? null, oldRecordStillPresent }
}

export function runMemoryEvalCase(evalCase, clock = () => new Date()) {
  const { input } = evalCase
  if (input.kind === 'ISOLATION') {
    return runIsolationCase(clock, { queryWrongProject: input.queryWrongProject })
  }
  if (input.kind === 'IMMUTABILITY') {
    return runImmutabilityCase(clock)
  }
  if (input.kind === 'SUPERSESSION') {
    return runSupersessionCase(clock)
  }
  throw new Error(`unknown memory eval case input kind: ${input.kind}`)
}

export function runMemoryEvalPack(pack, clock = () => new Date()) {
  const actualOutputsByCaseId = {}
  for (const evalCase of pack.cases) {
    actualOutputsByCaseId[evalCase.id] = runMemoryEvalCase(evalCase, clock)
  }
  return actualOutputsByCaseId
}
