// Durable CAS store for TSF_ATTENTION_NOTIFICATION_EVENT_V1, keyed by the
// content-addressed eventId. Mirrors completion-watch-store.mjs's file-lock
// + opState-collection shape exactly, but version-checks on every read the
// way self-improvement-finding-store.mjs does (completion-watch-store.mjs
// does not -- a pre-existing minor inconsistency, deliberately not carried
// forward into this fresh store).
import { withFileLock } from './cross-process-file-lock.mjs'
import { assertSupportedAttentionNotificationEventSchemaVersion } from '../domain/research-schema-versioning.mjs'
import { getStateFilePath, loadState, saveState } from './data-store.mjs'

function lockPath() {
  return `${getStateFilePath()}.attention-notification-event.lock`
}

function versionCheckedEvent(event) {
  if (event) { assertSupportedAttentionNotificationEventSchemaVersion(event) }
  return event
}

export function listAttentionNotificationEvents() {
  const events = loadState().attentionNotificationEvents ?? {}
  for (const event of Object.values(events)) { versionCheckedEvent(event) }
  return Object.values(events)
}

// mutateFn(current | null) -> next; synchronous, no `await` inside (same
// constraint every other withXxx in this codebase has).
export async function withAttentionNotificationEvent(eventId, mutateFn) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const current = versionCheckedEvent(opState.attentionNotificationEvents?.[eventId] ?? null)
    const next = mutateFn(current)
    saveState({
      ...opState,
      attentionNotificationEvents: { ...opState.attentionNotificationEvents, [eventId]: next }
    })
    return next
  })
}

// Race-free dedup: the existence check and the create share one lock
// acquisition, so two near-simultaneous reconcile cycles observing the same
// live attention item can never both register -- the second sees the
// first's event and reports created:false. Unlike registerCompletionWatchIfAbsent
// (keyed by a separate (kind, targetId) compound key), the existence check
// here is simply "does this eventId already exist" -- the id itself is
// already content-addressed, so no separate lookup key is needed.
export async function registerAttentionNotificationEventIfAbsent(buildEvent) {
  return withFileLock(lockPath(), undefined, () => {
    const opState = loadState()
    const events = opState.attentionNotificationEvents ?? {}
    const event = buildEvent()
    const existing = versionCheckedEvent(events[event.eventId] ?? null)
    if (existing) {
      return { event: existing, created: false }
    }
    saveState({
      ...opState,
      attentionNotificationEvents: { ...events, [event.eventId]: event }
    })
    return { event, created: true }
  })
}
