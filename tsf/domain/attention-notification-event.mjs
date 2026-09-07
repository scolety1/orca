// Operator Attention V1, Phase 5: the durable "Tim was notified of this"
// record. Mirrors completion-watch.mjs's shape exactly but with a 2-state
// lifecycle (UNSEEN -> DELIVERED) -- unlike a completion watch, detection
// here IS the firing, so there is no separate PENDING phase. eventId is
// content-addressed (mirrors self-improvement-finding.mjs's findingIdFor) so
// re-observing the SAME live attention item on a later reconcile cycle
// naturally dedupes instead of re-firing.
import { isoNow, sha256 } from './canonical.mjs'

export const ATTENTION_NOTIFICATION_EVENT_STATES = Object.freeze(['UNSEEN', 'DELIVERED'])
export const ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION = 'TSF_ATTENTION_NOTIFICATION_EVENT_V1'

export function attentionNotificationEventIdFor({ category, sourceKind, sourceId, transitionSignature }) {
  const fingerprint = sha256({ category, sourceKind, sourceId, transitionSignature })
  return `attention-event:${fingerprint.slice(0, 24)}`
}

export function createAttentionNotificationEvent(
  { category, sourceKind, sourceId, transitionSignature, label, reason, deepLink, severity },
  clock
) {
  const at = isoNow(clock)
  return {
    schemaVersion: ATTENTION_NOTIFICATION_EVENT_SCHEMA_VERSION,
    eventId: attentionNotificationEventIdFor({ category, sourceKind, sourceId, transitionSignature }),
    category,
    sourceKind,
    sourceId,
    transitionSignature,
    label,
    reason,
    deepLink,
    severity,
    state: 'UNSEEN',
    createdAt: at,
    updatedAt: at,
    deliveredAt: null
  }
}

// Idempotent: a no-op unless the event is still UNSEEN -- mirrors
// markCompletionWatchDelivered exactly (never re-fires, never overwrites an
// already-recorded delivery).
export function markAttentionNotificationEventDelivered(event, clock) {
  if (event.state !== 'UNSEEN') {
    return event
  }
  const now = isoNow(clock)
  return { ...event, state: 'DELIVERED', deliveredAt: now, updatedAt: now }
}
