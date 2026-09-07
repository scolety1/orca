// THE master adoption gate for the Native Self-Improvement Loop V1.
// Mirrors cleanup-owner-authorization-gate.mjs EXACTLY (REUSE_PATTERN, same
// two-signal shape, same dependency-injection discipline) -- a fully-
// verified repair mission stops at READY_FOR_ADOPTION until BOTH real
// signals below agree. Fails closed by default -- nothing in this wave
// (code, script, or test) ever sets either condition against the REAL
// process environment or the REAL flag file:
//
//   1. process.env.TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION === the
//      exact literal marker below.
//   2. A real flag file exists at
//      SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION_FLAG_PATH (gitignored
//      .local-state) whose trimmed content equals the SAME marker.
//
// Both `env` and `flagFilePath` are dependency-injected with real defaults
// so this wave's own tests prove "gate open -> proceeds" against
// FABRICATED env objects/temp files without ever touching the real,
// global gate.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getStateFilePath } from './data-store.mjs'

export const ADOPTION_AUTHORIZATION_MARKER = 'OWNER_AUTHORIZED_SELF_IMPROVEMENT_ADOPTION_V1'

export function defaultAdoptionAuthorizationFlagPath() {
  return path.join(path.dirname(getStateFilePath()), 'SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION.flag')
}

// Never throws -- returns a fully-explained closed state on any read
// failure rather than letting an exception propagate somewhere that might
// be caught and misread as open.
export function readAdoptionAuthorizationGateState(env = process.env, flagFilePath = defaultAdoptionAuthorizationFlagPath()) {
  const envMarkerPresent = env?.TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION === ADOPTION_AUTHORIZATION_MARKER
  let flagFilePresent = false
  try {
    flagFilePresent = existsSync(flagFilePath) && readFileSync(flagFilePath, 'utf8').trim() === ADOPTION_AUTHORIZATION_MARKER
  } catch {
    flagFilePresent = false
  }
  const open = envMarkerPresent && flagFilePresent
  return {
    open,
    envMarkerPresent,
    flagFilePresent,
    flagFilePath,
    reason: open
      ? 'both the environment marker and the flag file agree -- gate open'
      : !envMarkerPresent && !flagFilePresent
        ? 'neither the environment marker nor the flag file is present -- gate closed (default state)'
        : !envMarkerPresent
          ? 'flag file present but environment marker missing -- gate closed'
          : 'environment marker present but flag file missing -- gate closed'
  }
}

export function assertAdoptionAuthorizationGateOpen(env, flagFilePath) {
  const state = readAdoptionAuthorizationGateState(env, flagFilePath)
  if (!state.open) {
    const error = new Error(`self-improvement adoption-authorization gate is closed: ${state.reason}`)
    error.code = 'TSF_SELF_IMPROVEMENT_ADOPTION_GATE_CLOSED'
    error.gateState = state
    throw error
  }
  return state
}
