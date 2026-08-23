// Real V1 stabilization finding: the live desktop TSF server (a child
// process Orca spawns) can be started with an incomplete environment
// missing APPDATA. Reproduced directly against the real installed binary,
// not guessed: `orca.exe repo list --json` with a minimal env (PATH,
// SystemRoot, ComSpec only) fails with exactly the real, observed error --
// "APPDATA is not set, so the Orca runtime metadata path cannot be
// resolved." -- and the SAME failure reproduces with LOCALAPPDATA and
// USERPROFILE both present and only APPDATA missing, proving APPDATA
// specifically (not derivable from those) is what orca.exe's own runtime-
// metadata resolution requires. The Claude/Codex provider CLIs resolve
// their own config/credential paths the same Windows-conventional way, so
// the same missing var plausibly explains this session's real
// PLANNER_UNAVAILABLE findings across the fleet too.
//
// os.homedir() stays reliable regardless -- confirmed directly: it still
// resolves correctly even with USERPROFILE, APPDATA, and LOCALAPPDATA all
// stripped, because Node falls back to a Windows API call
// (GetUserProfileDirectory), not these env vars. That makes it the one
// dependable source to reconstruct from.
//
// This mutates process.env for the CALLING PROCESS ONLY -- an in-memory
// correction a Node process makes for its own future child spawns (which
// inherit process.env by default). It never touches the real Windows
// environment (registry, setx, other processes, other sessions) -- that
// would be the "globally mutate Windows environment variables" this
// deliberately is not.
import os from 'node:os'
import path from 'node:path'

// Idempotent and cheap: safe to call from every real TSF process entry
// point (main.mjs, server/http-server.mjs, providers/safe-provider-
// launch.mjs) -- a value already present is never overwritten, so calling
// this more than once, or in a process where the real environment is
// already complete, is always a no-op. Returns what (if anything) was
// derived, so a caller can log/report it rather than it happening
// silently.
export function ensureWindowsUserEnv(env = process.env) {
  if (process.platform !== 'win32') {
    return { platform: process.platform, applied: false, derived: {} }
  }
  const home = env.USERPROFILE || os.homedir()
  const derived = {}
  if (!env.APPDATA && home) {
    derived.APPDATA = path.join(home, 'AppData', 'Roaming')
  }
  if (!env.LOCALAPPDATA && home) {
    derived.LOCALAPPDATA = path.join(home, 'AppData', 'Local')
  }
  if (!env.USERPROFILE && home) {
    derived.USERPROFILE = home
  }
  Object.assign(env, derived)
  return {
    platform: process.platform,
    applied: Object.keys(derived).length > 0,
    derived,
    homeSource: env.USERPROFILE === home && !derived.USERPROFILE ? 'USERPROFILE' : 'os.homedir()'
  }
}
