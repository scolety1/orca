// CAS-store-level proof, isolated state file (mirrors self-improvement-
// finding-store.test.mjs's own pattern). Covers what the pure domain tests
// can't: real cross-process-file-lock atomicity, race-free register-if-
// absent, and the schema-version guard at the real durable read boundary.
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
  `operator-state.test-attention-notification-event-store-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const {
  listAttentionNotificationEvents,
  withAttentionNotificationEvent,
  registerAttentionNotificationEventIfAbsent
} = await import('../server/attention-notification-event-store.mjs')
const { createAttentionNotificationEvent, attentionNotificationEventIdFor } = await import(
  '../domain/attention-notification-event.mjs'
)
const { loadState, saveState } = await import('../server/data-store.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.attention-notification-event.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()

const clock = () => new Date('2026-09-07T12:00:00.000Z')

function eventFields(overrides = {}) {
  return {
    category: 'NEEDS_OWNER',
    sourceKind: 'SELF_IMPROVEMENT_FINDING',
    sourceId: 'finding:abc',
    transitionSignature: 'NEEDS_OWNER',
    label: 'surface',
    reason: 'why',
    deepLink: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:abc' },
    severity: 'P1',
    ...overrides
  }
}

test('attention notification event store', async (t) => {
  try {
    await t.test('registerAttentionNotificationEventIfAbsent creates on first call', async () => {
      const { event, created } = await registerAttentionNotificationEventIfAbsent(() =>
        createAttentionNotificationEvent(eventFields(), clock)
      )
      assert.equal(created, true)
      assert.equal(event.state, 'UNSEEN')
      assert.deepEqual(listAttentionNotificationEvents().map((e) => e.eventId), [event.eventId])
    })

    await t.test('a second call with the SAME eventId returns the existing record, created:false', async () => {
      const before = listAttentionNotificationEvents().length
      const { event, created } = await registerAttentionNotificationEventIfAbsent(() =>
        createAttentionNotificationEvent(eventFields(), clock)
      )
      assert.equal(created, false)
      assert.equal(event.eventId, attentionNotificationEventIdFor(eventFields()))
      assert.equal(listAttentionNotificationEvents().length, before, 'no second record was created')
    })

    await t.test('a genuinely different sourceId creates a distinct record', async () => {
      const before = listAttentionNotificationEvents().length
      await registerAttentionNotificationEventIfAbsent(() =>
        createAttentionNotificationEvent(eventFields({ sourceId: 'finding:different' }), clock)
      )
      assert.equal(listAttentionNotificationEvents().length, before + 1)
    })

    await t.test('two near-simultaneous registrations for the same eventId never both create', async () => {
      const fields = eventFields({ sourceId: 'finding:concurrency-test' })
      const [a, b] = await Promise.all([
        registerAttentionNotificationEventIfAbsent(() => createAttentionNotificationEvent(fields, clock)),
        registerAttentionNotificationEventIfAbsent(() => createAttentionNotificationEvent(fields, clock))
      ])
      const createdCount = [a, b].filter((r) => r.created).length
      assert.equal(createdCount, 1, 'exactly one of the two concurrent calls actually creates a new record')
      assert.equal(a.event.eventId, b.event.eventId)
      const matching = listAttentionNotificationEvents().filter((e) => e.eventId === a.event.eventId)
      assert.equal(matching.length, 1, 'never two durable records for the same content-addressed eventId')
    })

    await t.test('withAttentionNotificationEvent: concurrent writers on the SAME eventId are serialized, not lost', async () => {
      const eventId = 'attention-event:concurrency-test'
      const writers = Array.from({ length: 10 }, () =>
        withAttentionNotificationEvent(eventId, (current) => ({
          ...(current ?? { schemaVersion: 'TSF_ATTENTION_NOTIFICATION_EVENT_V1', eventId, count: 0 }),
          count: (current?.count ?? 0) + 1
        }))
      )
      await Promise.all(writers)
      const final = listAttentionNotificationEvents().find((e) => e.eventId === eventId)
      assert.equal(final.count, 10, 'every one of 10 concurrent increments must land -- none silently lost')
    })

    await t.test('version-guard rejects an unrecognized schemaVersion on read (fail-closed)', async () => {
      const { event } = await registerAttentionNotificationEventIfAbsent(() =>
        createAttentionNotificationEvent(eventFields({ sourceId: 'finding:version-guard-test' }), clock)
      )
      const opState = loadState()
      opState.attentionNotificationEvents[event.eventId] = {
        ...opState.attentionNotificationEvents[event.eventId],
        schemaVersion: 'TSF_ATTENTION_NOTIFICATION_EVENT_V99_FROM_THE_FUTURE'
      }
      saveState(opState)

      assert.throws(() => listAttentionNotificationEvents(), (error) => {
        assert.equal(error.code, 'TSF_UNSUPPORTED_ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION')
        return true
      })
      await assert.rejects(
        withAttentionNotificationEvent(event.eventId, (e) => e),
        (error) => {
          assert.equal(error.code, 'TSF_UNSUPPORTED_ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION')
          return true
        }
      )

      // Clean up the corrupted record so it doesn't poison a later test in
      // this same file (mirrors research-mission-store-schema-version.test.mjs's
      // own isolated-mutation discipline).
      const fresh = loadState()
      delete fresh.attentionNotificationEvents[event.eventId]
      saveState(fresh)
    })

    await t.test('a malformed/corrupt state value is handled the same way self-improvement-finding-store.mjs handles it (missing schemaVersion fails closed)', async () => {
      const opState = loadState()
      const corruptId = 'attention-event:corrupt-missing-version'
      opState.attentionNotificationEvents[corruptId] = { eventId: corruptId, state: 'UNSEEN' }
      saveState(opState)

      assert.throws(() => listAttentionNotificationEvents(), (error) => {
        assert.equal(error.code, 'TSF_ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION_MISSING')
        return true
      })

      const fresh = loadState()
      delete fresh.attentionNotificationEvents[corruptId]
      saveState(fresh)
    })
  } finally {
    cleanupStateFile()
  }
})
