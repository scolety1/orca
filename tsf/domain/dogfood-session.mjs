import { isoNow } from './canonical.mjs'

export const DOGFOOD_SESSION_SCHEMA_VERSION = 'TSF_DOGFOOD_SESSION_V1'
export const DOGFOOD_SESSION_STATES = Object.freeze(['ACTIVE', 'PAUSED', 'ENDED'])
export const DOGFOOD_TURN_ROLES = Object.freeze(['OWNER', 'TSF'])

const TRIGGER_PATTERNS = Object.freeze([
  ['START', /^(?:start|begin) dogfood (?:mode|session)$/i],
  ['PAUSE', /^pause dogfood(?: (?:mode|session|capture))?$/i],
  ['RESUME', /^(?:resume|continue) dogfood(?: (?:mode|session|capture))?$/i],
  ['END', /^(?:end|stop) dogfood(?: (?:mode|session|capture))?$/i],
  ['END', /^(?:that's|thats) everything$/i]
])

function normalizedRoute(route) {
  return typeof route === 'string' && route.trim() ? route.trim() : null
}

function assertState(session, expected, action) {
  if (!session || session.state !== expected) {
    const error = new Error(`cannot ${action} dogfood session unless it is ${expected}`)
    error.code = 'TSF_DOGFOOD_SESSION_INVALID_TRANSITION'
    throw error
  }
}

export function createDogfoodSession({ id, projectId = null, route = null }, clock) {
  if (!id) {
    throw new Error('id is required to create a dogfood session')
  }
  return {
    schemaVersion: DOGFOOD_SESSION_SCHEMA_VERSION,
    id,
    projectId: projectId ?? null,
    route: normalizedRoute(route),
    state: 'ACTIVE',
    startedAt: isoNow(clock),
    endedAt: null,
    transcript: []
  }
}

export function appendDogfoodTurn(session, { role, content, route = null }, clock) {
  assertState(session, 'ACTIVE', 'append to')
  if (!DOGFOOD_TURN_ROLES.includes(role)) {
    throw new Error(`unknown dogfood turn role: ${role}`)
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('content is required to append a dogfood turn')
  }
  return {
    ...session,
    transcript: [
      ...session.transcript,
      { role, content, at: isoNow(clock), route: normalizedRoute(route) }
    ]
  }
}

export function pauseDogfoodSession(session, _clock) {
  assertState(session, 'ACTIVE', 'pause')
  return { ...session, state: 'PAUSED' }
}

export function resumeDogfoodSession(session, _clock) {
  assertState(session, 'PAUSED', 'resume')
  return { ...session, state: 'ACTIVE' }
}

export function endDogfoodSession(session, clock) {
  if (!session || !['ACTIVE', 'PAUSED'].includes(session.state)) {
    const error = new Error('cannot end dogfood session unless it is ACTIVE or PAUSED')
    error.code = 'TSF_DOGFOOD_SESSION_INVALID_TRANSITION'
    throw error
  }
  return { ...session, state: 'ENDED', endedAt: isoNow(clock) }
}

export function detectDogfoodSessionTrigger(message) {
  const candidate = String(message ?? '')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim()
  return TRIGGER_PATTERNS.find(([, pattern]) => pattern.test(candidate))?.[0] ?? null
}
