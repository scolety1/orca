// M7: pure domain functions for project-scoped memory (Facts,
// Preferences, Experiences-Lessons). Decisions deliberately have NO new
// storage or mutation path here -- receipts.mjs's existing hash-chained,
// append-only receipt chain already satisfies "explicit user decisions
// cannot be silently overwritten" structurally; see
// projectDecisionsFromReceipts below, a pure projection over that
// existing chain, not a new store.
//
// One flat, append-only records[] array (mirroring receipts.mjs's own
// single-chain shape) rather than separate arrays per class -- `class`
// is a filter discriminator, not a storage split. Every record's
// `explicit` flag is the ONE thing that gates supersession, matching the
// acceptance criterion's own wording verbatim: "Stale facts can be
// superseded; explicit user decisions cannot be silently overwritten."
// A non-explicit (inferred/observed) record of any class can be
// superseded by a newer, contradicting observation with no
// authorization; an explicit (Tim directly stated it) record requires
// the same authorizedBy:'TIM' + reason gate keep-going.mjs's own
// replaceGoal already uses for the original goal -- never a silent
// overwrite, and the old value is always preserved, never deleted.
import { isoNow, sha256 } from './canonical.mjs'

export const MEMORY_CLASSES = Object.freeze(['FACT', 'PREFERENCE', 'EXPERIENCE'])
export const MEMORY_SOURCE_KINDS = Object.freeze([
  'RECEIPT',
  'RESULT_CAPSULE',
  'CHAT',
  'TIM_EXPLICIT'
])

function assertSource(source) {
  if (!source || !MEMORY_SOURCE_KINDS.includes(source.kind)) {
    throw new Error(`memory record source.kind must be one of ${MEMORY_SOURCE_KINDS.join(', ')}`)
  }
  if (!source.ref) {
    throw new Error('memory record source.ref is required')
  }
}

function createRecord({ class: memoryClass, statement, source, explicit }, clock) {
  if (!MEMORY_CLASSES.includes(memoryClass)) {
    throw new Error(`unsupported memory class: ${memoryClass}`)
  }
  if (!statement?.trim()) {
    throw new Error('memory record statement is required')
  }
  assertSource(source)
  const body = {
    schemaVersion: 'TSF_PROJECT_MEMORY_RECORD_V1',
    class: memoryClass,
    statement,
    explicit: explicit === true,
    source: { kind: source.kind, ref: source.ref, at: source.at ?? isoNow(clock) },
    createdAt: isoNow(clock),
    supersededAt: null,
    supersededBy: null
  }
  return { ...body, id: sha256(body) }
}

export function emptyProjectMemory() {
  return { schemaVersion: 'TSF_PROJECT_MEMORY_V1', records: [] }
}

// Adds a new memory record. Facts/Preferences are typically not
// `explicit` (observed/inferred); pass `explicit: true` only for a
// record built from Tim's own direct, deliberate statement.
export function addMemoryRecord(memory, input, clock) {
  const record = createRecord(input, clock)
  return { ...memory, records: [...(memory.records ?? []), record] }
}

// Supersedes an existing record with a new one, preserving the old value
// (never deleted) via supersededAt/supersededBy. A non-explicit record
// can be superseded freely (a stale fact ages out). An explicit record
// requires authorization.authorizedBy === 'TIM' plus a non-empty reason
// -- mirroring keep-going.mjs's replaceGoal exactly -- and throws
// TSF_MEMORY_EXPLICIT_IMMUTABLE otherwise, never silently overwriting.
export function supersedeMemoryRecord(memory, recordId, replacementInput, authorization, clock) {
  const records = memory.records ?? []
  const idx = records.findIndex((r) => r.id === recordId)
  if (idx === -1) {
    throw new Error(`no memory record with id ${recordId} to supersede`)
  }
  const existing = records[idx]
  if (existing.supersededAt) {
    throw new Error(`memory record ${recordId} was already superseded by ${existing.supersededBy}`)
  }
  if (existing.explicit) {
    if (authorization?.authorizedBy !== 'TIM') {
      const error = new Error(
        'an explicit, Tim-stated memory record can only be superseded by explicit Tim authorization'
      )
      error.code = 'TSF_MEMORY_EXPLICIT_IMMUTABLE'
      throw error
    }
    if (!authorization.reason?.trim()) {
      throw new Error('a reason is required to supersede an explicit memory record')
    }
  }
  const next = createRecord(
    {
      class: existing.class,
      statement: replacementInput.statement,
      source: replacementInput.source,
      explicit: existing.explicit
    },
    clock
  )
  const nextRecords = [...records]
  nextRecords[idx] = { ...existing, supersededAt: isoNow(clock), supersededBy: next.id }
  nextRecords.push(next)
  return { ...memory, records: nextRecords }
}

// Active (non-superseded) records of a class, oldest first.
export function activeRecordsOfClass(memory, memoryClass) {
  return (memory.records ?? []).filter((r) => r.class === memoryClass && !r.supersededAt)
}

// Bounded, project-scoped retrieval feeding live-planner.mjs's
// `do_not_repeat_lessons` field -- mirrors that function's own
// `.slice(-N)` discipline for every sibling array field. Only active
// (non-superseded) EXPERIENCE records, most recent first, capped at
// `limit` -- never the full history, per the "no giant transcript
// injection" requirement.
export function retrieveExperiencesForCapsule(memory, limit = 5) {
  return activeRecordsOfClass(memory, 'EXPERIENCE')
    .slice(-limit)
    .map((r) => r.statement)
}

// Pure projection over the EXISTING receipt chain (tsf/domain/
// receipts.mjs) -- no new storage, no new mutation path. Decisions are
// already durable, provenance-aware, and supersession-safe via the
// chain's own hash-linking; this only reshapes decision-bearing
// receipts into a compact, retrievable list, bounded the same way.
export function projectDecisionsFromReceipts(receiptChain, limit = 5) {
  return (receiptChain ?? [])
    .filter((r) => r.decision)
    .slice(-limit)
    .map((r) => `${r.kind}: ${r.decision} (${r.timestamp})`)
}
