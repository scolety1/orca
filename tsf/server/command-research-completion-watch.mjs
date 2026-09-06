// Round 4: "let me know when it's done" / "notify me when this finishes"
// -- registers a real, durable completion watch (completion-watch-store.mjs)
// against the resolved ResearchMission, or answers honestly if it's
// already terminal / already being watched. Kept as its own file so
// command-research-bridge.mjs (already at its own size discipline) gains
// only a small dispatch branch, matching this codebase's own established
// max-lines-driven extraction convention.
import { createCompletionWatch } from '../domain/completion-watch.mjs'
import { findActiveCompletionWatch, withCompletionWatch } from './completion-watch-store.mjs'
import { readResearchMissionStatus } from './research-mission-driver.mjs'

function alreadyTerminalReply(missionId, status) {
  return status.state === 'COMPLETE'
    ? `**${missionId}** already reached COMPLETE -- nothing further to watch for.`
    : `**${missionId}** was already cancelled, not completed -- nothing further to watch for.`
}

// IMPORTANT -- never fakes a push notification: TSF has no OS/desktop/
// email/SSE channel to Tim at all (see domain/completion-watch.mjs's
// header). What this genuinely does: durably record the request, and
// surface it unprompted on Tim's very next real message to TSF -- not an
// interrupt, not a push, but also not something Tim has to remember to
// ask about again.
export async function registerResearchCompletionWatch(missionId, message, clock) {
  const status = readResearchMissionStatus(missionId)
  if (!status) {
    return `I don't have a research mission called ${missionId}.`
  }
  if (status.state === 'COMPLETE' || status.state === 'BLOCKED') {
    return alreadyTerminalReply(missionId, status)
  }
  const existing = findActiveCompletionWatch('RESEARCH_MISSION', missionId)
  if (existing) {
    return `Already watching **${missionId}** -- I'll flag it here next time we talk once it reaches COMPLETE (or say honestly if it's cancelled or needs your input instead).`
  }
  const id = `watch:research-mission:${missionId}:${clock().getTime()}`
  await withCompletionWatch(id, () =>
    createCompletionWatch({ id, kind: 'RESEARCH_MISSION', targetId: missionId, requestedByText: message }, clock)
  )
  return `Yes -- I'll flag it here the next time we talk once **${missionId}** reaches COMPLETE. If it's cancelled or needs your input instead, I'll say that honestly too. (TSF has no way to push you a message outside this chat, so this surfaces on your next message here, not an interrupt.)`
}
