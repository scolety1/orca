// TSF OWNER DOGFOOD / CRITIQUE LOOP V1 round 3: resolves a Command turn's
// real, exact-matched turn-target ids AND whether "I meant X" corrected
// them, in one call -- server/chat-http-routes.mjs needs BOTH values at
// two separate nextCommandFocus call sites (the respondCommand fallback
// and the single-exact-match short-circuit), and this is the one place
// with access to both resolution.matches and the domain's own correction
// logic. See domain/command-conversation-focus.mjs's own
// correctedSwitchTarget/correctedTurnTargetIds for why a genuine
// correction can only ever be verified against the real exactMatches,
// never guessed from message text alone.
import {
  correctedSwitchTarget,
  correctedTurnTargetIds
} from '../domain/command-conversation-focus.mjs'

export function resolveCommandTurnTargets(message, resolution) {
  const exactMatches = resolution.matches.filter((m) => m.matchedOn !== 'fuzzy')
  const ids = correctedTurnTargetIds(message, exactMatches)
  // Attached rather than returned as a separate value -- lets every
  // caller keep passing this single array around (turnTargetProjectIds
  // still just works, JSON.stringify still only serializes the indexed
  // elements) while still being able to ask "was this actually a
  // verified correction" wherever it's needed.
  ids.corrected = correctedSwitchTarget(message, exactMatches) !== null
  return ids
}
