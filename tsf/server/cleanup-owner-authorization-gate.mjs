// THE master destructive-execution gate for Cleanup V1. Fails closed by
// default -- nothing in this phase (code, script, or test) ever sets either
// condition below against the REAL process environment or the REAL flag
// file. Both are required (defense in depth: an accidental single env var
// in some other script must not be enough to open real destructive
// capability):
//
//   1. process.env.TSF_CLEANUP_V1_OWNER_AUTHORIZATION === the exact literal
//      marker below (not a secret -- the point is nothing sets it, not that
//      it is hard to guess).
//   2. A real flag file exists at CLEANUP_V1_OWNER_AUTHORIZATION_FLAG_PATH
//      (gitignored .local-state, like operator-state.json) whose trimmed
//      content equals the SAME marker.
//
// Both `env` and `flagFilePath` are dependency-injected with real defaults
// so callers never need to touch process.env or the real filesystem to
// exercise this logic -- and so this phase's own tests can prove "gate
// open -> proceeds" against FABRICATED env objects/temp files without ever
// flipping the real, global gate this machine's actual owner controls.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getStateFilePath } from './data-store.mjs'

export const OWNER_AUTHORIZATION_MARKER = 'OWNER_AUTHORIZED_DESTRUCTIVE_EXECUTION_V1'

export function defaultOwnerAuthorizationFlagPath() {
  return path.join(path.dirname(getStateFilePath()), 'CLEANUP_V1_OWNER_AUTHORIZATION.flag')
}

// Never throws -- returns a fully-explained closed state on any read
// failure (missing file, permission error) rather than letting an
// exception propagate somewhere that might be caught and misread as open.
export function readOwnerAuthorizationGateState(env = process.env, flagFilePath = defaultOwnerAuthorizationFlagPath()) {
  const envMarkerPresent = env?.TSF_CLEANUP_V1_OWNER_AUTHORIZATION === OWNER_AUTHORIZATION_MARKER
  let flagFilePresent = false
  try {
    flagFilePresent = existsSync(flagFilePath) && readFileSync(flagFilePath, 'utf8').trim() === OWNER_AUTHORIZATION_MARKER
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

export function assertOwnerAuthorizationGateOpen(env, flagFilePath) {
  const state = readOwnerAuthorizationGateState(env, flagFilePath)
  if (!state.open) {
    const error = new Error(`owner-authorization gate is closed: ${state.reason}`)
    error.code = 'TSF_CLEANUP_OWNER_GATE_CLOSED'
    error.gateState = state
    throw error
  }
  return state
}
