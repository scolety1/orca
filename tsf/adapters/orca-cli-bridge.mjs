// Bridges TSF onboarding to Orca's own supported repo registration API
// (`orca repo list` / `orca repo add`) rather than duplicating any Orca
// runtime/worktree logic. Read-only by default (list/lookup); `repo add`
// is only ever called from the onboarding *commit* step (never during
// read-only analysis), and only registers repo metadata — it does not
// touch Git history or create a worktree. Fails honestly: if the CLI
// isn't resolvable or no Orca runtime is reachable, callers get an
// explicit unavailable status, never a fabricated "registered".
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

const TIMEOUT_MS = 15000

// Known install locations, checked in order; overridable for tests/other
// machines. Mirrors the resolution pattern in
// tsf/providers/resolve-agent-entry.mjs (env override, then known
// locations, then bare PATH command as a last resort).
function candidateEntries() {
  const override = process.env.TSF_ORCA_CLI_COMMAND
  const candidates = []
  // Tests point this at a .mjs/.js stub script, which needs a node hop; a
  // real override (an .exe or PATH command) runs directly. Marked
  // `forced: true` so resolveEntry() returns it unconditionally — an
  // explicit override must win (or fail explicitly on spawn) rather than
  // silently falling through to a different, unintended real install.
  if (override && (override.endsWith('.mjs') || override.endsWith('.js'))) candidates.push({ command: process.execPath, args: [override], viaShell: false, forced: true })
  else if (override) candidates.push({ command: override, args: [], viaShell: false, forced: true })
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles
  if (localAppData) candidates.push({ command: path.join(localAppData, 'Programs', 'orca', 'resources', 'bin', 'orca.exe'), args: [], viaShell: false })
  if (programFiles) candidates.push({ command: path.join(programFiles, 'orca', 'resources', 'bin', 'orca.exe'), args: [], viaShell: false })
  candidates.push({ command: 'C:\\TSF_FOUNDATION_EVAL\\installed\\orca\\resources\\bin\\orca.exe', args: [], viaShell: false })
  candidates.push({ command: 'orca', args: [], viaShell: process.platform === 'win32' })
  return candidates
}

function resolveEntry() {
  for (const candidate of candidateEntries()) {
    if (candidate.forced || candidate.command === 'orca' || existsSync(candidate.command)) return candidate
  }
  return null
}

function spawnCli(entry, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(entry.command, args, { shell: !!entry.viaShell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      return resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return resolve({ ok: false, reason: 'TIMEOUT', detail: `orca CLI did not respond within ${TIMEOUT_MS}ms` })
      if (code !== 0) return resolve({ ok: false, reason: 'CLI_ERROR', detail: (stderr || stdout).trim().slice(0, 500) || `exit code ${code}` })
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        return resolve({ ok: false, reason: 'MALFORMED_RESPONSE', detail: stdout.slice(0, 500) })
      }
      if (parsed.ok === false) return resolve({ ok: false, reason: 'CLI_ERROR', detail: parsed.error?.message ?? JSON.stringify(parsed).slice(0, 500) })
      resolve({ ok: true, result: parsed.result })
    })
  })
}

async function runOrca(args) {
  const entry = resolveEntry()
  if (!entry) return { ok: false, reason: 'CLI_UNAVAILABLE', detail: 'orca CLI not found on this machine' }
  return spawnCli(entry, [...entry.args, ...args, '--json'])
}

// Resolves to the real canonical path where possible — Windows 8.3
// short-name paths (e.g. under some temp/profile dirs) and case differences
// would otherwise compare as different paths for the exact same repo,
// risking a duplicate registration for what is really one project.
function normalizeForCompare(p) {
  const resolved = path.resolve(String(p || ''))
  let real = resolved
  try {
    // .native uses the Win32 API directly and resolves 8.3 short-name path
    // components (e.g. `CODEX-~1`) to their real long form; the plain JS
    // implementation does not, and can silently miss a real duplicate.
    real = realpathSync.native ? realpathSync.native(resolved) : realpathSync(resolved)
  } catch {
    /* path may not exist on this machine (a stubbed/test path) — fall back to resolve() */
  }
  return real.replace(/\\/g, '/').toLowerCase()
}

// Read-only: lists Orca-registered repos and looks for one matching this
// path (case/slash-normalized so Windows path variants don't create
// duplicate registrations).
export async function findRegisteredOrcaRepo(repoPath) {
  const listed = await runOrca(['repo', 'list'])
  if (!listed.ok) return { ok: false, reason: listed.reason, detail: listed.detail }
  const target = normalizeForCompare(repoPath)
  const match = (listed.result?.repos ?? []).find((repo) => normalizeForCompare(repo.path) === target)
  return { ok: true, registered: !!match, repo: match ?? null }
}

// Only called from the onboarding commit step, never during read-only
// analysis. Idempotent from the caller's perspective: checks registration
// first and returns the existing repo rather than double-adding.
export async function registerOrcaRepo(repoPath) {
  const existing = await findRegisteredOrcaRepo(repoPath)
  if (existing.ok && existing.registered) return { ok: true, alreadyRegistered: true, repo: existing.repo }
  if (!existing.ok) return { ok: false, reason: existing.reason, detail: existing.detail }
  const added = await runOrca(['repo', 'add', '--path', repoPath])
  if (!added.ok) return { ok: false, reason: added.reason, detail: added.detail }
  return { ok: true, alreadyRegistered: false, repo: added.result?.repo ?? null }
}
