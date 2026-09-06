// Registers a real completion watch against the resolved ResearchMission,
// or answers honestly if it's already terminal/already watched. Own file
// to keep command-research-bridge.mjs's own dispatch branch small.
import { createCompletionWatch } from '../domain/completion-watch.mjs'
import { registerCompletionWatchIfAbsent } from './completion-watch-store.mjs'
import { readResearchMissionStatus } from './research-mission-driver.mjs'

function alreadyTerminalReply(missionId, status) {
  return status.state === 'COMPLETE'
    ? `**${missionId}** already reached COMPLETE -- nothing further to watch for.`
    : `**${missionId}** was already cancelled, not completed -- nothing further to watch for.`
}

// Never fakes a push notification -- TSF has none; this surfaces on
// Tim's next real message instead (see domain/completion-watch.mjs).
export async function registerResearchCompletionWatch(missionId, message, clock) {
  const status = readResearchMissionStatus(missionId)
  if (!status) {
    return `I don't have a research mission called ${missionId}.`
  }
  if (status.state === 'COMPLETE' || status.state === 'BLOCKED') {
    return alreadyTerminalReply(missionId, status)
  }
  const id = `watch:research-mission:${missionId}:${clock().getTime()}`
  const { created } = await registerCompletionWatchIfAbsent('RESEARCH_MISSION', missionId, () =>
    createCompletionWatch({ id, kind: 'RESEARCH_MISSION', targetId: missionId, requestedByText: message }, clock)
  )
  if (!created) {
    return `Already watching **${missionId}** -- I'll flag it here next time we talk once it reaches COMPLETE (or say honestly if it's cancelled or needs your input instead).`
  }
  return `Yes -- I'll flag it here the next time we talk once **${missionId}** reaches COMPLETE. If it's cancelled or needs your input instead, I'll say that honestly too. (TSF has no way to push you a message outside this chat, so this surfaces on your next message here, not an interrupt.)`
}
