// Generic reconciliation + delivery for completion watches
// (domain/completion-watch.mjs). For each PENDING watch, asks this watch's
// `kind` resolver whether the real target has reached a terminal outcome,
// and if so, fires it; then delivers every FIRED_UNSEEN watch exactly once
// to the next real chat turn. Only RESEARCH_MISSION is wired today --
// smallest correct scope for Round 4. The dispatch-table shape below is
// what makes this "the smallest correct generic WORK_COMPLETION_
// NOTIFICATION capability" rather than a Research-specific hack: adding
// Keep Going/Health Repair/verification/Ready-for-Adoption completions
// later is one new OUTCOME_RESOLVERS entry, never a second watch
// mechanism, a second store, or a second scheduler.
//
// No new background scheduler is introduced: this reconciles lazily, on
// every real chat turn (see attachDueCompletionNotices below), which is
// also the only honest notion of "notify Tim" available -- TSF has no
// push channel to him at all (see domain/completion-watch.mjs's header).
import { markCompletionWatchFired, markCompletionWatchDelivered } from '../domain/completion-watch.mjs'
import { listCompletionWatches, withCompletionWatch } from './completion-watch-store.mjs'
import { readResearchMissionStatus } from './research-mission-driver.mjs'

// Returns { terminal: false } | { terminal: true, outcome: 'COMPLETE' | 'CANCELLED' } | null (target vanished -- honestly ignored, never fired).
function resolveResearchMissionOutcome(targetId) {
  const status = readResearchMissionStatus(targetId)
  if (!status) {
    return null
  }
  if (status.state === 'COMPLETE') {
    return { terminal: true, outcome: 'COMPLETE' }
  }
  if (status.state === 'BLOCKED') {
    return { terminal: true, outcome: 'CANCELLED' }
  }
  return { terminal: false }
}

const OUTCOME_RESOLVERS = { RESEARCH_MISSION: resolveResearchMissionOutcome }

export async function reconcilePendingCompletionWatches(clock) {
  const fired = []
  for (const watch of listCompletionWatches()) {
    if (watch.state !== 'PENDING') {
      continue
    }
    const resolver = OUTCOME_RESOLVERS[watch.kind]
    if (!resolver) {
      continue
    }
    const resolved = resolver(watch.targetId)
    if (!resolved?.terminal) {
      continue
    }
    // eslint-disable-next-line no-await-in-loop -- bounded by real watch count, mirrors driveOneCycle's own sequential-await precedent
    const next = await withCompletionWatch(watch.id, (current) =>
      current ? markCompletionWatchFired(current, resolved.outcome, clock) : current
    )
    if (next) {
      fired.push(next)
    }
  }
  return fired
}

function describeCompletionOutcome(watch) {
  if (watch.kind !== 'RESEARCH_MISSION') {
    return `**${watch.targetId}** reached a terminal state (${watch.outcome}).`
  }
  return watch.outcome === 'COMPLETE'
    ? `The research you asked me to flag (**${watch.targetId}**) has reached COMPLETE.`
    : `The research you asked me to flag (**${watch.targetId}**) was cancelled before completing -- it did not finish.`
}

// Reconciles first (so a target that just went terminal is caught even if
// nothing else has touched it recently), then delivers every FIRED_UNSEEN
// watch exactly once, marking each DELIVERED durably before returning --
// never re-delivered on a later call, even if the caller never uses the
// returned text.
export async function drainDueCompletionNotifications(clock) {
  await reconcilePendingCompletionWatches(clock)
  const due = listCompletionWatches().filter((w) => w.state === 'FIRED_UNSEEN')
  const notices = []
  for (const watch of due) {
    const text = describeCompletionOutcome(watch)
    // eslint-disable-next-line no-await-in-loop -- see reconcile's own comment
    await withCompletionWatch(watch.id, (current) =>
      current ? markCompletionWatchDelivered(current, clock) : current
    )
    notices.push({ watchId: watch.id, text })
  }
  return notices
}

// Chat-turn integration point: prepends any due completion notices to
// whatever the normal response text would have been, so they surface
// unprompted on Tim's very next message -- regardless of what that
// message is actually about. Kept as one small wrapper so http-server.mjs
// (already at its own size discipline) only needs to change the payload
// each existing `json(res, 200, ...)` call already sends, never grow.
export async function attachDueCompletionNotices(payload, clock) {
  const notices = await drainDueCompletionNotifications(clock)
  if (!notices.length) {
    return payload
  }
  return { ...payload, text: [...notices.map((n) => n.text), payload.text].join('\n\n') }
}
