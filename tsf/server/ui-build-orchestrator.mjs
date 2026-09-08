// Real, bounded, single-in-flight UI rebuild trigger (stale-UI-build-
// prevention spec). Fixes the exact live incident this program exists for:
// a running tsf/server backend serving a UI bundle built from a stale
// commit, previously requiring a manual `npm run build`. Reuses
// runtime-identity-tracker.mjs's getRuntimeIdentity wholesale (no second
// identity system) and composes it with domain/ui-build-state.mjs's pure
// withBuildActionState. Module-level in-memory state only -- this only
// needs to be safe within one server process's lifetime (spec's own
// explicit scope), not cross-process locking.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getRuntimeIdentity } from './runtime-identity-tracker.mjs'
import { withBuildActionState } from '../domain/ui-build-state.mjs'

// Same Windows npm.cmd-vs-npm resolution convention already established
// across this repo's own build scripts (e.g. config/scripts/check-react-
// doctor-changed.mjs's `pnpm.cmd` on win32) -- npm on Windows is a .cmd
// shim, not a directly-spawnable .exe, so a bare 'npm' fails without a
// shell hop (which this codebase's spawn convention deliberately avoids).
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function defaultSpawn(args, cwd) {
  return spawn(npmCommand(), args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

// In-memory only, by design (see header). IDLE until a rebuild is ever
// attempted this process's lifetime.
let buildAction = { status: 'IDLE', reason: null }
let buildInFlight = null

export function getUiBuildActionState() {
  return buildAction
}

// Exported for tests only -- normal callers never need to reset process-
// lifetime state mid-run.
export function resetUiBuildActionStateForTest() {
  buildAction = { status: 'IDLE', reason: null }
  buildInFlight = null
}

function runBuild({ uiDir, spawnFn, log }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnFn(['run', 'build'], uiDir)
    } catch (error) {
      return resolve({ ok: false, reason: `failed to start npm run build: ${error.message}` })
    }
    let stderrTail = ''
    let settled = false
    const settle = (result) => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }
    child.stdout?.on('data', (chunk) => log(chunk.toString()))
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      stderrTail = (stderrTail + text).slice(-4096)
      log(text)
    })
    child.on('error', (error) => {
      settle({ ok: false, reason: `npm run build failed to start: ${error.message}` })
    })
    child.on('exit', (code) => {
      if (code === 0) {
        return settle({ ok: true })
      }
      settle({
        ok: false,
        reason: `npm run build exited with code ${code}${stderrTail ? ` -- ${stderrTail.trim().slice(-500)}` : ''}`
      })
    })
  })
}

// Fire-and-forget entry point, meant to be called once from
// startStandaloneServer's own startup-recovery pattern -- never throws,
// always resolves to a real outcome. Only ever triggers a real build when
// the CURRENT identity is genuinely UI_BUNDLE_STALE: never for
// LIVE_RUNTIME_STALE (that needs a process restart, out of scope here) and
// never when already UP_TO_DATE.
export async function triggerUiRebuildIfStale({
  uiDir,
  distDir,
  spawnFn = defaultSpawn,
  existsFn = existsSync,
  getRuntimeIdentityFn = getRuntimeIdentity,
  log = () => {}
} = {}) {
  if (buildInFlight) {
    return { ok: true, skipped: true, reason: 'a UI rebuild is already in progress' }
  }
  const identity = await getRuntimeIdentityFn(distDir)
  if (identity.state !== 'UI_BUNDLE_STALE') {
    return { ok: true, skipped: true, reason: `no rebuild needed (state: ${identity.state})` }
  }
  // Explicit mission constraint: never run an uncontrolled `npm install`.
  // Honest, actionable FAILED state (not an indefinite UI_BUNDLE_STALE the
  // launcher would poll forever against) rather than silently doing nothing.
  if (!existsFn(path.join(uiDir, 'node_modules'))) {
    buildAction = {
      status: 'FAILED',
      reason:
        'tsf/ui/node_modules is missing -- run `npm install` inside tsf/ui manually, then restart the TSF server'
    }
    return { ok: false, skipped: true, reason: buildAction.reason }
  }
  buildAction = { status: 'BUILDING', reason: null }
  buildInFlight = runBuild({ uiDir, spawnFn, log })
  try {
    const result = await buildInFlight
    if (result.ok) {
      buildAction = { status: 'IDLE', reason: null }
      log('UI rebuild succeeded')
      return { ok: true, skipped: false }
    }
    buildAction = { status: 'FAILED', reason: result.reason }
    log(`UI rebuild failed: ${result.reason}`)
    return { ok: false, skipped: false, reason: result.reason }
  } finally {
    buildInFlight = null
  }
}

// The single read both first-run-setup.html and the Command bridge use --
// real runtime identity composed with whatever this process's own build
// action state currently is. distDir defaults to the same tsf/ui/dist path
// runtime-identity-tracker.mjs and static-ui-server.mjs already use.
export async function getRuntimeIdentityWithBuildState(
  distDir = path.join(import.meta.dirname, '..', 'ui', 'dist'),
  { getRuntimeIdentityFn = getRuntimeIdentity } = {}
) {
  const identity = await getRuntimeIdentityFn(distDir)
  return withBuildActionState(identity, buildAction)
}
