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

// Real live-acceptance finding: npm on Windows is a `.cmd` shim, not a
// directly-spawnable .exe -- naming `npm.cmd` and spawning it with
// `shell: false` (this codebase's own default spawn convention) throws a
// real, synchronous `spawn EINVAL` on current Node (the engine's own
// CVE-2024-27980 hardening refuses to directly exec a `.bat`/`.cmd`
// without going through a real shell) -- reproduced live on this exact
// host/Node version.
//
// First attempt reused Orca-core's own real, already-adopted fix for
// exactly this problem (src/main/claude-accounts/windows-command-
// invocation.ts's buildWindowsCommandInvocation -- explicit
// `cmd.exe /d /v:off /s /c "<quoted line>"`, `shell: false`,
// `windowsVerbatimArguments: true`) reimplemented natively (TSF's own
// worktree must never import Orca-core source directly). That fixed the
// EINVAL crash but then hit a SECOND, real, empirically-confirmed bug
// specific to this real npm.cmd (`C:\Program Files\nodejs\npm.cmd`)'s own
// internal script: it re-derives its real npm-cli.js path via a nested
// `FOR /F` capturing `node npm-prefix.js`'s own output, and -- reproduced
// directly, isolated flag-by-flag -- that inner resolution becomes
// unreliable specifically when BOTH the executable name and its arguments
// are individually quoted before being handed through cmd.exe's `/c`
// (regardless of which of /d, /v:off, /s were present), intermittently
// resolving a nonexistent `<cwd>\node_modules\npm\bin\npm-cli.js` instead
// of the real global one. Not a TSF-side bug to route around by more
// clever quoting; a real fragility in that specific npm.cmd script under
// that specific invocation shape.
//
// The call this module ever makes is always the same two fixed literals
// (`spawnFn(['run', 'build'], uiDir)`, this file's only call site) --
// never caller-influenced, dynamic, or dependent on any value this module
// receives from an untrusted source, so the shell-injection concern
// `shell: false` normally guards against does not apply here. `shell:
// true` with a single literal string (not an array -- an array under
// `shell: true` triggers Node's own DEP0190 unescaped-concatenation
// warning even though nothing here is actually unsafe to concatenate)
// is empirically verified reliable (multiple repeated real runs, real
// successful `vite build` output) and is the fix actually adopted here.
function defaultSpawn(args, cwd) {
  const command = process.platform === 'win32' ? `npm.cmd ${args.join(' ')}` : `npm ${args.join(' ')}`
  return spawn(command, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
