import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION,
  attentionNotificationEventIdFor,
  createAttentionNotificationEvent,
  markAttentionNotificationEventDelivered
} from '../domain/attention-notification-event.mjs'

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const later = () => new Date('2026-09-07T13:00:00.000Z')

function fields(overrides = {}) {
  return {
    category: 'NEEDS_OWNER',
    sourceKind: 'SELF_IMPROVEMENT_FINDING',
    sourceId: 'finding:abc',
    transitionSignature: 'NEEDS_OWNER',
    ...overrides
  }
}

test('attentionNotificationEventIdFor: same input twice -> same id', () => {
  assert.equal(attentionNotificationEventIdFor(fields()), attentionNotificationEventIdFor(fields()))
})

test('attentionNotificationEventIdFor: different category -> different id', () => {
  assert.notEqual(
    attentionNotificationEventIdFor(fields({ category: 'NEEDS_OWNER' })),
    attentionNotificationEventIdFor(fields({ category: 'FAILED_REQUIRES_ATTENTION' }))
  )
})

test('attentionNotificationEventIdFor: different sourceId -> different id', () => {
  assert.notEqual(
    attentionNotificationEventIdFor(fields({ sourceId: 'finding:abc' })),
    attentionNotificationEventIdFor(fields({ sourceId: 'finding:xyz' }))
  )
})

test('attentionNotificationEventIdFor: different transitionSignature -> different id (a genuinely new transition into the same category is a new event)', () => {
  assert.notEqual(
    attentionNotificationEventIdFor(fields({ transitionSignature: 'NEEDS_OWNER' })),
    attentionNotificationEventIdFor(fields({ transitionSignature: 'REOPENED' }))
  )
})

test('createAttentionNotificationEvent produces a valid UNSEEN record', () => {
  const event = createAttentionNotificationEvent(
    { ...fields(), label: 'surface', reason: 'why', deepLink: { kind: 'SELF_IMPROVEMENT_FINDING', id: 'finding:abc' }, severity: 'P1' },
    clock
  )
  assert.equal(event.schemaVersion, ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION)
  assert.equal(event.eventId, attentionNotificationEventIdFor(fields()))
  assert.equal(event.state, 'UNSEEN')
  assert.equal(event.createdAt, clock().toISOString())
  assert.equal(event.updatedAt, clock().toISOString())
  assert.equal(event.deliveredAt, null)
  assert.equal(event.label, 'surface')
  assert.equal(event.reason, 'why')
  assert.equal(event.severity, 'P1')
})

test('markAttentionNotificationEventDelivered: UNSEEN -> DELIVERED, sets deliveredAt/updatedAt', () => {
  const event = createAttentionNotificationEvent({ ...fields(), label: 'l', reason: 'r', deepLink: null, severity: 'P1' }, clock)
  const delivered = markAttentionNotificationEventDelivered(event, later)
  assert.equal(delivered.state, 'DELIVERED')
  assert.equal(delivered.deliveredAt, later().toISOString())
  assert.equal(delivered.updatedAt, later().toISOString())
})

test('markAttentionNotificationEventDelivered is idempotent: calling twice never double-updates deliveredAt', () => {
  const event = createAttentionNotificationEvent({ ...fields(), label: 'l', reason: 'r', deepLink: null, severity: 'P1' }, clock)
  const once = markAttentionNotificationEventDelivered(event, later)
  const twice = markAttentionNotificationEventDelivered(once, () => new Date('2026-09-07T14:00:00.000Z'))
  assert.equal(twice.deliveredAt, later().toISOString(), 'a second call must not move deliveredAt forward')
  assert.deepEqual(twice, once)
})

test('markAttentionNotificationEventDelivered on a non-UNSEEN event is a true no-op', () => {
  const event = { ...createAttentionNotificationEvent({ ...fields(), label: 'l', reason: 'r', deepLink: null, severity: 'P1' }, clock), state: 'DELIVERED', deliveredAt: clock().toISOString() }
  const result = markAttentionNotificationEventDelivered(event, later)
  assert.deepEqual(result, event)
})
