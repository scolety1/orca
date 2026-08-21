// M5: bridges TSF's capacity-aware routing to Orca's real
// `orca account list --json` command -- the exact real, already-proven
// capacity signal this whole program has used by hand (a manual shell
// call) throughout M2/M3/M4's own live dogfood proofs. Same spawn-and-
// fail-honestly pattern as orca-orchestration-bridge.mjs (sibling module,
// kept independent for the same reason: a bounded wave shouldn't edit a
// file another concurrent session may be touching). Never fabricates a
// usage percentage it didn't observe -- on any failure, returns
// {ok:false, reason, detail} so tsf/domain/capacity-policy.mjs can report
// UNKNOWN honestly rather than guessing.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const TIMEOUT_MS = 15000

// Mirrors orca-orchestration-bridge.mjs's own resolution order exactly.
function candidateEntries() {
  const override = process.env.TSF_ORCA_CLI_COMMAND
  const candidates = []
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
  candidates.push({ command: 'orca', args: [], viaShell: process.platform === 'win32' })
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
    }, TIMEOUT_MS)
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
          detail: `orca CLI did not respond within ${TIMEOUT_MS}ms`
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

// Reshapes the real `orca account list` response's rateLimits block into
// the compact snapshot tsf/domain/capacity-policy.mjs actually consumes.
// A missing block (provider not configured, or the CLI's own shape ever
// changes) reports `null`, never a guessed 0% -- the policy layer must
// treat that as UNKNOWN, not as healthy capacity.
function extractSnapshot(rateLimits) {
  const claude = rateLimits?.claude
  const codex = rateLimits?.codex
  return {
    claude: claude
      ? {
          sessionUsedPercent: claude.session?.usedPercent ?? null,
          weeklyUsedPercent: claude.weekly?.usedPercent ?? null,
          status: claude.status ?? null
        }
      : null,
    codex: codex
      ? {
          weeklyUsedPercent: codex.weekly?.usedPercent ?? null,
          status: codex.status ?? null
        }
      : null
  }
}

// The one real capacity signal this whole program has ever used --
// previously only ever invoked by hand as a manual shell command during a
// live dogfood proof (M2/M3/M4's own program history). This is that exact
// command, wrapped as real, callable, honestly-failing application code.
export async function fetchCapacitySnapshot() {
  const result = await runOrca(['account', 'list'])
  if (!result.ok) {
    return result
  }
  return { ok: true, result: extractSnapshot(result.result?.rateLimits) }
}
