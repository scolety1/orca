// TSF Owner Dogfood/Critique Loop V1: the safety-critical non-execution
// gate. While a dogfood session is ACTIVE for a request's scope (global,
// or a specific project), the incoming message is captured as a
// DogfoodTurn and NEVER reaches classifyIntent/respondCommand/
// executeAction/dispatchAndRespond or any other live-execution path.
// Start/pause/resume/end trigger phrases are handled here too, and are
// themselves never captured as transcript content.
import {
  appendDogfoodTurn,
  createDogfoodSession,
  detectDogfoodSessionTrigger,
  endDogfoodSession,
  pauseDogfoodSession,
  resumeDogfoodSession
} from '../domain/dogfood-session.mjs'
import { withDogfoodSessions } from './dogfood-session-store.mjs'

function findSessionForScope(sessions, projectId, states) {
  // A project-scoped session takes precedence over a global one for a
  // request that resolved to a specific project -- but a global session
  // (started with no project in view) captures everything regardless of
  // which project a later turn happens to resolve to.
  const scoped =
    projectId != null
      ? Object.values(sessions).find((s) => s.projectId === projectId && states.includes(s.state))
      : null
  if (scoped) {
    return scoped
  }
  return (
    Object.values(sessions).find((s) => s.projectId === null && states.includes(s.state)) ?? null
  )
}

function response(text, session) {
  return {
    ok: true,
    dogfood: true,
    text,
    sessionId: session.id,
    sessionState: session.state,
    transcriptLength: session.transcript.length
  }
}

// Returns a real chat response object if this message was consumed by the
// dogfood gate (started/paused/resumed/ended a session, or was captured
// as a critique turn), or `null` if there is nothing to gate here and the
// caller should proceed with normal live processing.
export async function processDogfoodChatTurn({ message, projectId, route }) {
  const clock = () => new Date()
  const trigger = detectDogfoodSessionTrigger(message)
  let outcome = null

  await withDogfoodSessions((sessions) => {
    const active = findSessionForScope(sessions, projectId, ['ACTIVE'])
    const paused = findSessionForScope(sessions, projectId, ['PAUSED'])

    if (trigger === 'START') {
      // Refuse a double-start for the EXACT scope this turn would create
      // (not the "nearest applicable" session found above) -- a global
      // session already running does not block starting a new
      // project-scoped one, and vice versa; only an exact scope clash
      // (same projectId, including both null) refuses.
      const exactScopeOpen = Object.values(sessions).find(
        (s) => s.projectId === projectId && ['ACTIVE', 'PAUSED'].includes(s.state)
      )
      if (exactScopeOpen) {
        outcome = response(
          'A dogfood session is already open for this scope -- end it first before starting a new one.',
          exactScopeOpen
        )
        return sessions
      }
      const id = `dogfood:${projectId ?? 'global'}:${clock().getTime()}`
      const session = createDogfoodSession({ id, projectId, route }, clock)
      outcome = response(
        'Dogfood session started. Go ahead -- nothing you say will execute until you end the session.',
        session
      )
      return { ...sessions, [session.id]: session }
    }

    if (trigger === 'PAUSE') {
      if (!active) {
        outcome = null
        return sessions
      }
      const next = pauseDogfoodSession(active, clock)
      outcome = response('Dogfood capture paused.', next)
      return { ...sessions, [next.id]: next }
    }

    if (trigger === 'RESUME') {
      if (!paused) {
        outcome = null
        return sessions
      }
      const next = resumeDogfoodSession(paused, clock)
      outcome = response('Dogfood capture resumed.', next)
      return { ...sessions, [next.id]: next }
    }

    if (trigger === 'END') {
      const session = active ?? paused
      if (!session) {
        outcome = null
        return sessions
      }
      const next = endDogfoodSession(session, clock)
      outcome = response(
        `Dogfood session ended. ${next.transcript.length} thing(s) captured.`,
        next
      )
      return { ...sessions, [next.id]: next }
    }

    // Not a trigger phrase. Only capture when a session is actively
    // recording (ACTIVE, not PAUSED) for this scope.
    if (!active) {
      outcome = null
      return sessions
    }
    const next = appendDogfoodTurn(active, { role: 'OWNER', content: message, route }, clock)
    outcome = response('Got it -- noted.', next)
    return { ...sessions, [next.id]: next }
  })

  return outcome
}

// Thin HTTP-facing wrapper: writes the response and returns true when the
// gate consumed this message, so chat-http-routes.mjs's two call sites
// can each early-return in one line without reaching a live-execution
// branch. `json`/`res` are the same request-scoped helpers
// handleChatRoute already receives.
export async function gateDogfoodChatTurn(json, res, message, projectId, rawRoute) {
  const route = typeof rawRoute === 'string' ? rawRoute.slice(0, 2000) : null
  const dogfoodResult = await processDogfoodChatTurn({ message, projectId, route })
  if (!dogfoodResult) {
    return false
  }
  json(res, 200, dogfoodResult)
  return true
}
