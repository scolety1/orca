// Reconciles + delivers completion watches (domain/completion-watch.mjs).
// Adding a new target kind later is one OUTCOME_RESOLVERS entry, never a
// second watch/store/scheduler. Reconciles lazily on every chat turn
// (attachDueCompletionNotices) -- no new background scheduler.
import { markCompletionWatchFired, markCompletionWatchDelivered } from '../domain/completion-watch.mjs'
import { listCompletionWatches, withCompletionWatch } from './completion-watch-store.mjs'
import { readResearchMissionStatus } from './research-mission-driver.mjs'

// BLOCKED is treated as terminal (CANCELLED): today it's only ever
// reached via cancelResearchMissionDurable, and resumeResearchMission
// (domain/research-mission.mjs) has no real caller anywhere -- if that
// ever changes, this resolver would need a look at needsYou/nodes to
// tell a true cancel from a recoverable block.
function resolveResearchMissionOutcome(targetId) {
  const status = readResearchMissionStatus(targetId)
  if (!status) {
    return null // target vanished -- honestly ignored, never fired
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

// Reconciles, then delivers every FIRED_UNSEEN watch exactly once,
// marking each DELIVERED before returning -- never re-delivered later.
export async function drainDueCompletionNotifications(clock) {
  await reconcilePendingCompletionWatches(clock)
  const due = listCompletionWatches().filter((w) => w.state === 'FIRED_UNSEEN')
  const notices = []
  for (const watch of due) {
    // wonDelivery is true only for whichever concurrent caller's mutateFn
    // actually observes FIRED_UNSEEN under the lock -- never double-delivers.
    let wonDelivery = false
    // eslint-disable-next-line no-await-in-loop -- see reconcile's own comment
    await withCompletionWatch(watch.id, (current) => {
      if (!current || current.state !== 'FIRED_UNSEEN') {
        return current
      }
      wonDelivery = true
      return markCompletionWatchDelivered(current, clock)
    })
    if (wonDelivery) {
      notices.push({ watchId: watch.id, text: describeCompletionOutcome(watch) })
    }
  }
  return notices
}

// Prepends any due notices to a chat payload, surfacing them unprompted
// on Tim's next message regardless of what it's about.
export async function attachDueCompletionNotices(payload, clock) {
  let notices
  try {
    notices = await drainDueCompletionNotifications(clock)
  } catch (error) {
    // Never turn an already-persisted chat answer into a failed response
    // over this augmentation (e.g. a lock timeout under contention).
    console.error('completion-watch reconciliation failed:', error)
    return payload
  }
  if (!notices.length) {
    return payload
  }
  return { ...payload, text: [...notices.map((n) => n.text), payload.text].join('\n\n') }
}
