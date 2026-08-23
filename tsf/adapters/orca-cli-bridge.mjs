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

// Read per-call, not frozen at module load, so tests can override it without
// needing a fresh process (mirrors tsf/server/live-planner.mjs's timeoutMs()).
function timeoutMs() {
  return Number(process.env.TSF_ORCA_CLI_TIMEOUT_MS) || 15000
}
// One bounded retry, not endless: a real M7 migration finding showed
// `orca repo list` failing transiently (e.g. right after Orca itself just
// started, before its own RPC surface was fully up) even though Orca was
// genuinely running and TSF was itself hosted inside it — retrying once,
// briefly, distinguishes that from Orca genuinely being unreachable.
const RETRY_DELAY_MS = 400
const TRANSIENT_REASONS = new Set(['TIMEOUT', 'SPAWN_ERROR'])

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Known install locations, checked in order; overridable for tests/other
// machines. Mirrors the resolution pattern in
// tsf/providers/resolve-agent-entry.mjs (env override, then known
// locations, then bare PATH command as a last resort).
// Exported for a direct regression test of the bare-'orca'-fallback safety
// fix below (normal callers never call this directly).
export function candidateEntries() {
  const override = process.env.TSF_ORCA_CLI_COMMAND
  const candidates = []
  // Tests point this at a .mjs/.js stub script, which needs a node hop; a
  // real override (an .exe or PATH command) runs directly. Marked
  // `forced: true` so resolveEntry() returns it unconditionally — an
  // explicit override must win (or fail explicitly on spawn) rather than
  // silently falling through to a different, unintended real install.
  if (override && (override.endsWith('.mjs') || override.endsWith('.js'))) {
    candidates.push({ command: process.execPath, args: [override], viaShell: false, forced: true })
  } else if (override) {
    candidates.push({ command: override, args: [], viaShell: false, forced: true })
  }
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles
  if (localAppData) {
    candidates.push({
      command: path.join(localAppData, 'Programs', 'orca', 'resources', 'bin', 'orca.exe'),
      args: [],
      viaShell: false
    })
  }
  if (programFiles) {
    candidates.push({
      command: path.join(programFiles, 'orca', 'resources', 'bin', 'orca.exe'),
      args: [],
      viaShell: false
    })
  }
  candidates.push({
    command: 'C:\\TSF_FOUNDATION_EVAL\\installed\\orca\\resources\\bin\\orca.exe',
    args: [],
    viaShell: false
  })
  // Real V1 stabilization finding (sibling of the Planner Chat live-use
  // defect, see providers/resolve-agent-entry.mjs): viaShell:true was never
  // actually needed here and is unsafe for registerOrcaRepo's real,
  // arbitrary repoPath argument (can contain spaces) -- Node's shell:true
  // spawn does zero argument escaping on Windows, silently shredding a
  // space-containing path via cmd.exe's own re-tokenization. Unlike an
  // npm-installed CLI (which ships a .cmd/.ps1 shim requiring a shell hop),
  // `orca` on PATH is a real installed .exe (confirmed directly: `orca`
  // resolves and runs correctly via spawn with shell:false, no shell needed
  // at all) -- corrected to false.
  candidates.push({ command: 'orca', args: [], viaShell: false })
  return candidates
}

function resolveEntry() {
  for (const candidate of candidateEntries()) {
    if (candidate.forced || candidate.command === 'orca' || existsSync(candidate.command)) {
      return candidate
    }
  }
  return null
}

function spawnCli(entry, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(entry.command, args, {
        shell: !!entry.viaShell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      return resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs())
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        return resolve({
          ok: false,
          reason: 'TIMEOUT',
          detail: `orca CLI did not respond within ${timeoutMs()}ms`
        })
      }
      if (code !== 0) {
        return resolve({
          ok: false,
          reason: 'CLI_ERROR',
          detail: (stderr || stdout).trim().slice(0, 500) || `exit code ${code}`
        })
      }
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        return resolve({ ok: false, reason: 'MALFORMED_RESPONSE', detail: stdout.slice(0, 500) })
      }
      if (parsed.ok === false) {
        return resolve({
          ok: false,
          reason: 'CLI_ERROR',
          detail: parsed.error?.message ?? JSON.stringify(parsed).slice(0, 500)
        })
      }
      resolve({ ok: true, result: parsed.result })
    })
  })
}

async function runOrca(args) {
  const entry = resolveEntry()
  if (!entry) {
    return { ok: false, reason: 'CLI_UNAVAILABLE', detail: 'orca CLI not found on this machine' }
  }
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
//
// `status` distinguishes what onboarding actually needs to show, rather than
// collapsing every non-success outcome into a single "unreachable": a
// transient failure (worth a bounded retry, and worth telling Tim it's
// probably temporary) is not the same as the CLI genuinely not existing on
// this machine (ORCA_UNKNOWN — no real signal either way) or a real answer
// (REGISTERED / NOT_REGISTERED).
export async function findRegisteredOrcaRepo(repoPath, { retry = true } = {}) {
  let listed = await runOrca(['repo', 'list'])
  if (!listed.ok && retry && TRANSIENT_REASONS.has(listed.reason)) {
    await delay(RETRY_DELAY_MS)
    listed = await runOrca(['repo', 'list'])
  }
  if (!listed.ok) {
    const status =
      listed.reason === 'CLI_UNAVAILABLE' ? 'ORCA_UNKNOWN' : 'ORCA_TEMPORARILY_UNAVAILABLE'
    return { ok: false, reason: listed.reason, detail: listed.detail, status }
  }
  const target = normalizeForCompare(repoPath)
  const match = (listed.result?.repos ?? []).find(
    (repo) => normalizeForCompare(repo.path) === target
  )
  return {
    ok: true,
    registered: !!match,
    repo: match ?? null,
    status: match ? 'REGISTERED' : 'NOT_REGISTERED'
  }
}

// Only called from the onboarding commit step, never during read-only
// analysis. Idempotent from the caller's perspective: checks registration
// first and returns the existing repo rather than double-adding.
export async function registerOrcaRepo(repoPath) {
  const existing = await findRegisteredOrcaRepo(repoPath)
  if (existing.ok && existing.registered) {
    return { ok: true, alreadyRegistered: true, repo: existing.repo }
  }
  if (!existing.ok) {
    return { ok: false, reason: existing.reason, detail: existing.detail }
  }
  const added = await runOrca(['repo', 'add', '--path', repoPath])
  if (!added.ok) {
    return { ok: false, reason: added.reason, detail: added.detail }
  }
  return { ok: true, alreadyRegistered: false, repo: added.result?.repo ?? null }
}
