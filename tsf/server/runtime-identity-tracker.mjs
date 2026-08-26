// Captures TSF's own live runtime identity (spec Phase 1) once per real
// server process, at module load -- not per-request -- so it genuinely
// answers "what commit did the CURRENTLY RUNNING process start from,"
// independent of whatever has changed on disk since. Also writes a small,
// real runtime-metadata file (PID + commit + startedAt) other tooling can
// use to detect a stale/orphaned tsf/server process (spec Phase 5) --
// mirrors the PID-liveness-via-metadata-file pattern already established
// for Orca's own process (see docs/tsf/M14_DESKTOP_LAUNCH_REMEDIATION_V1.md),
// TSF-owned instead of reusing Orca's file (a different process entirely).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getCurrentCommit } from '../adapters/git-identity.mjs'
import { classifyLiveRuntimeState } from '../domain/runtime-identity.mjs'
import { getStateFilePath } from './data-store.mjs'

const REPO_ROOT = import.meta.dirname // tsf/server -- git auto-discovers .git upward
const STARTED_AT = new Date().toISOString()
const PID = process.pid

// Sibling to the local operator state file, so tests that already isolate
// TSF_UI_STATE_FILE per test also isolate this metadata file for free,
// without a second env var to remember.
function runtimeMetadataPath() {
  return `${getStateFilePath()}.runtime.json`
}

// Captured once, lazily, the first time it's asked for -- a module-level
// top-level await would block every test that imports this module (even
// ones that never call getRuntimeIdentity) on a real git spawn.
let runningCommitPromise = null
function runningCommit() {
  if (!runningCommitPromise) {
    runningCommitPromise = getCurrentCommit(REPO_ROOT)
  }
  return runningCommitPromise
}

// Writes the real PID/commit/startedAt this process is actually running as
// -- called once at server startup. A later reader (e.g. the desktop
// launcher, or a future "is a TSF server already running for this state
// file" check) compares the recorded PID's liveness against this file
// rather than guessing.
export async function writeRuntimeMetadata() {
  const running = await runningCommit()
  const metadata = {
    schemaVersion: 'TSF_RUNTIME_METADATA_V1',
    pid: PID,
    commit: running.ok ? running.commit : null,
    startedAt: STARTED_AT
  }
  mkdirSync(path.dirname(runtimeMetadataPath()), { recursive: true })
  writeFileSync(runtimeMetadataPath(), JSON.stringify(metadata, null, 2))
  return metadata
}

export function readRuntimeMetadata() {
  const file = runtimeMetadataPath()
  if (!existsSync(file)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// True only when `pid` is a real, currently-alive process -- signal 0
// sends nothing, it only probes whether the process exists and this
// process has permission to signal it (the standard, side-effect-free
// liveness check on both POSIX and Windows via Node's own translation).
export function isProcessAlive(pid) {
  if (!pid) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readUiBundleCommit(distDir) {
  const identityFile = path.join(distDir, 'build-identity.json')
  if (!existsSync(identityFile)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(identityFile, 'utf8')).commit ?? null
  } catch {
    return null
  }
}

// distDir: the same tsf/ui/dist path static-ui-server.mjs serves from.
export async function getRuntimeIdentity(distDir) {
  const running = await runningCommit()
  const diskResult = await getCurrentCommit(REPO_ROOT)
  const identity = {
    runningCommit: running.ok ? running.commit : null,
    diskCommit: diskResult.ok ? diskResult.commit : null,
    uiBundleCommit: readUiBundleCommit(distDir),
    startedAt: STARTED_AT,
    pid: PID
  }
  const classification = classifyLiveRuntimeState(identity)
  return { ...identity, ...classification }
}
