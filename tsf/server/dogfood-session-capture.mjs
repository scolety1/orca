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
  DOGFOOD_SYNTHESIS_MAX_ATTEMPTS,
  endDogfoodSession,
  markDogfoodSynthesisDone,
  markDogfoodSynthesisFailed,
  markDogfoodSynthesisRunning,
  pauseDogfoodSession,
  resumeDogfoodSession
} from '../domain/dogfood-session.mjs'
import { readAllDogfoodSessions, withDogfoodSessions } from './dogfood-session-store.mjs'
import { synthesizeDogfoodSession } from './dogfood-synthesis.mjs'

const OPEN_STATES = ['ACTIVE', 'PAUSED']

// Safety review finding (real, reproduced): the original version fell
// through to a global session whenever the PROJECT session didn't match
// the requested `states` filter -- so pausing a project-scoped session
// (which flips it out of 'ACTIVE') made the NEXT lookup for 'ACTIVE'
// silently find an unrelated global session instead, capturing project
// messages into the wrong transcript. Fixed: once a project has its own
// OPEN session (ACTIVE or PAUSED, regardless of which), that session
// governs this scope EXCLUSIVELY -- global is never consulted for it,
// even if the project's own session doesn't currently match `states`
// (correctly returns null, meaning "no ACTIVE session for this scope,"
// rather than silently borrowing a differently-scoped one).
function findSessionForScope(sessions, projectId, states) {
  if (projectId != null) {
    const projectSession = Object.values(sessions).find(
      (s) => s.projectId === projectId && OPEN_STATES.includes(s.state)
    )
    if (projectSession) {
      return states.includes(projectSession.state) ? projectSession : null
    }
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
  // Set only on a real END transition -- synthesis (a real, potentially
  // slow LLM call) must run AFTER the file lock below is released, never
  // inside the synchronous CAS mutator.
  let endedSession = null

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
      let next = endDogfoodSession(session, clock)
      // Owner-trial-prep finding (real, crash-recovery): mark synthesis as
      // owed in the SAME atomic write as the ENDED transition, so a crash
      // any time after this point is durably recoverable at the next
      // server startup (recoverInterruptedDogfoodSynthesis below) -- never
      // a separate, later write that could itself be lost. Only when there
      // is something to synthesize (matches synthesizeDogfoodSession's own
      // NOTHING_CAPTURED short-circuit) -- an empty transcript has nothing
      // to recover, so it is never marked RUNNING.
      if (next.transcript.some((t) => t.role === 'OWNER')) {
        next = markDogfoodSynthesisRunning(next, clock)
      }
      endedSession = next
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

  if (endedSession) {
    outcome.text += ` ${await synthesisSummary(endedSession, clock)}`
  }
  return outcome
}

// Real, potentially slow LLM call -- run only after the session is
// durably ENDED and the store's file lock is released. Never throws:
// every failure path (no provider configured, resource pressure, a
// structurally invalid response) degrades to an honest status message so
// the raw transcript is never silently lost even when synthesis can't run.
async function synthesisSummary(session, clock) {
  const result = await synthesizeDogfoodSession(session, { clock })
  await recordSynthesisOutcome(session.id, result, clock)
  if (!result.ok) {
    if (result.reason === 'NOTHING_CAPTURED') {
      return 'Nothing was captured, so there is nothing to synthesize.'
    }
    return `Synthesis could not run right now (${result.reason}) -- the raw transcript is safely saved and will be automatically retried.`
  }
  const actionable = result.observations.filter((o) => o.disposition !== 'DO_NOT_ACT')
  const protectedCount = result.observations.filter(
    (o) => o.category === 'GOOD_AS_IS_PROTECT'
  ).length
  return (
    `Synthesized ${result.observations.length} observation(s): ` +
    `${actionable.length} actionable (${result.findingIds.length} tracked as real findings), ` +
    `${protectedCount} marked GOOD AS-IS/protected, ` +
    `${result.observations.length - actionable.length - protectedCount} other (question/idea/preference/ambiguous/retracted).`
  )
}

// Durably records the real outcome of a synthesis attempt -- a SEPARATE
// write from the one that marked RUNNING (that one had to happen before
// the LLM call even started; this one can only happen after it resolves).
// A crash between the two leaves the session honestly stuck at RUNNING,
// which recoverInterruptedDogfoodSynthesis below correctly treats as
// "needs a retry," not silently forgotten. NOTHING_CAPTURED is not an
// outcome to record -- that session was never marked RUNNING in the
// first place (see the END handler above), so there is nothing to update.
async function recordSynthesisOutcome(sessionId, result, clock) {
  if (!result.ok && result.reason === 'NOTHING_CAPTURED') {
    return
  }
  await withDogfoodSessions((sessions) => {
    const current = sessions[sessionId]
    if (!current || current.synthesisStatus !== 'RUNNING') {
      return sessions
    }
    const next = result.ok
      ? markDogfoodSynthesisDone(current, result.findingIds, clock)
      : markDogfoodSynthesisFailed(current, result.reason, clock)
    return { ...sessions, [sessionId]: next }
  })
}

// Fire-and-forget, called once at server startup -- same convention as
// recoverInterruptedPrepareForWorkOperations/recoverStaleStalledKeepGoingRuns
// (http-server.mjs's own startStandaloneServer). A session still RUNNING
// at startup was, by definition, interrupted by the previous process
// dying -- this process is the first chance to notice. A FAILED session
// is retried too, up to a bounded attempt budget (mirrors the
// retry-budget-aware posture of the Keep Going stalled-run recovery
// scan), so a transient planner outage does not require manual
// intervention, but a session does not retry forever either. Never
// throws: one session's recovery failure must not block the rest or
// startup itself.
export async function recoverInterruptedDogfoodSynthesis(clock = () => new Date(), deps = {}) {
  const readSessions = deps.readAllDogfoodSessions ?? readAllDogfoodSessions
  const runSynthesisSummary = deps.synthesisSummary ?? synthesisSummary
  const stalled = Object.values(readSessions()).filter(
    (s) =>
      s.state === 'ENDED' &&
      (s.synthesisStatus === 'RUNNING' ||
        (s.synthesisStatus === 'FAILED' &&
          (s.synthesisAttempts ?? 0) < DOGFOOD_SYNTHESIS_MAX_ATTEMPTS))
  )
  const recovered = []
  for (const session of stalled) {
    try {
      let claimed = false
      // eslint-disable-next-line no-await-in-loop -- bounded by real stalled-session count, mirrors keep-going-stalled-run-recovery.mjs's own sequential-recovery-scan precedent
      const remarked = await withDogfoodSessions((sessions) => {
        const current = sessions[session.id]
        // Defense-in-depth (real review finding): re-checks the FULL
        // eligibility condition against the fresh read inside the lock,
        // not just `state === 'ENDED'` -- this function is only ever
        // called once, synchronously, at startup today, so this can't
        // actually race yet, but a future concurrent caller (e.g. an
        // HTTP-triggered manual "retry now" action) must not be able to
        // re-arm and double-dispatch a session a different concurrent
        // scan already claimed. Same discipline verifyAndRouteToOwner
        // already applies for the synthesis-completion race.
        const stillEligible =
          current?.state === 'ENDED' &&
          (current.synthesisStatus === 'RUNNING' ||
            (current.synthesisStatus === 'FAILED' &&
              (current.synthesisAttempts ?? 0) < DOGFOOD_SYNTHESIS_MAX_ATTEMPTS))
        if (!stillEligible) {
          return sessions
        }
        claimed = true
        return { ...sessions, [session.id]: markDogfoodSynthesisRunning(current, clock) }
      })
      if (!claimed) {
        continue
      }
      // eslint-disable-next-line no-await-in-loop -- see above
      await runSynthesisSummary(remarked[session.id], clock)
      recovered.push(session.id)
    } catch (error) {
      console.error(`dogfood synthesis startup recovery failed for ${session.id}:`, error)
    }
  }
  return recovered
}

// Safety review finding (real, reproduced): the fleet-wide/ambiguous
// Command path (chat-http-routes.mjs's respondCommand branch, no single
// project resolved) can execute a QUANTIFIED/multi-project action
// ("pause everything") that reaches across every project, including one
// under active dogfood review -- the ordinary scope-matched gate above
// only ever checked the GLOBAL session for this call site, never a
// project-scoped one, since no specific project was resolved here to
// match against. Rather than guess which of several open sessions an
// ambiguous message might belong to (real risk of mis-capturing an
// unrelated conversation into the wrong project's transcript), this
// fails closed: if ANY dogfood session is open anywhere (global or any
// project), a fleet-wide/ambiguous command is refused outright rather
// than risking it reaching a project currently under review.
export async function gateAmbiguousFleetWideCommand(json, res) {
  const openSessions = Object.values(readAllDogfoodSessions()).filter((s) =>
    ['ACTIVE', 'PAUSED'].includes(s.state)
  )
  if (openSessions.length === 0) {
    return false
  }
  json(res, 200, {
    ok: true,
    dogfood: true,
    text: 'A dogfood session is currently open -- fleet-wide or multi-project commands are paused until every open session ends, so a broad action never reaches a project under review. Say "end dogfood mode" to finish, or be specific about a single project.',
    openSessionCount: openSessions.length
  })
  return true
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
