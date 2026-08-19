// Bridges TSF's Keep Going governance layer (tsf/domain/keep-going.mjs) to
// Orca's native orchestration CLI graph (`orca orchestration <cmd>`) instead
// of duplicating a scheduler. Sibling to orca-cli-bridge.mjs: same
// spawn-and-fail-honestly pattern (CLI_UNAVAILABLE/TIMEOUT/CLI_ERROR/
// MALFORMED_RESPONSE, never a fabricated success/result). Kept as an
// independent module rather than sharing code with orca-cli-bridge.mjs so
// this bounded wave doesn't edit a file another concurrent session may be
// touching. See docs/tsf/M2_KEEP_GOING_DESIGN_V1.md for the primitive
// mapping. No live dispatch is exercised by this wave's tests -- callers
// must gate real `dispatchOrchestrationTask` use behind Codex sandbox-crash
// clearance and capacity recovery per program state (Section G).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const TIMEOUT_MS = 15000

// Mirrors tsf/adapters/orca-cli-bridge.mjs's resolution order: env override,
// then known install locations, then bare PATH command as a last resort.
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

// A Run is a namespace/home inbox only -- it never schedules or places
// workers (that's task-create + dispatch below).
export async function createOrchestrationRun({ objective, from } = {}) {
  if (!objective?.trim()) {
    return { ok: false, reason: 'INVALID_ARGS', detail: 'objective is required' }
  }
  const args = ['orchestration', 'run-create', '--objective', objective]
  if (from) {
    args.push('--from', from)
  }
  return runOrca(args)
}

export async function createOrchestrationTask({
  spec,
  run,
  taskTitle,
  displayName,
  deps,
  parent,
  from
} = {}) {
  if (!spec?.trim()) {
    return { ok: false, reason: 'INVALID_ARGS', detail: 'spec is required' }
  }
  const args = ['orchestration', 'task-create', '--spec', spec]
  if (run) {
    args.push('--run', run)
  }
  if (taskTitle) {
    args.push('--task-title', taskTitle)
  }
  if (displayName) {
    args.push('--display-name', displayName)
  }
  if (deps) {
    args.push('--deps', JSON.stringify(deps))
  }
  if (parent) {
    args.push('--parent', parent)
  }
  if (from) {
    args.push('--from', from)
  }
  return runOrca(args)
}

// Callers must gate this behind Codex sandbox-crash clearance + capacity
// recovery (program state providerCapacityStatus) -- this function itself
// does not check either; it only wraps the CLI honestly.
export async function dispatchOrchestrationTask({ task, to, run, from, inject, dryRun } = {}) {
  if (!task || !to) {
    return { ok: false, reason: 'INVALID_ARGS', detail: 'task and to are required' }
  }
  const args = ['orchestration', 'dispatch', '--task', task, '--to', to]
  if (run) {
    args.push('--run', run)
  }
  if (from) {
    args.push('--from', from)
  }
  if (inject) {
    args.push('--inject')
  }
  if (dryRun) {
    args.push('--dry-run')
  }
  return runOrca(args)
}

// Terminal state is process/resource accounting, reported separately from
// task status (a completed task can still own a live terminal) -- feeds
// keep-going.mjs's detectStall via the caller's own heartbeat projection.
export async function listOrchestrationWorkers({ run, terminalState } = {}) {
  const args = ['orchestration', 'worker-list']
  if (run) {
    args.push('--run', run)
  }
  if (terminalState) {
    args.push('--terminal-state', terminalState)
  }
  return runOrca(args)
}

// Needs You / human decision gate -- blocks a task until gate-resolve.
export async function createOrchestrationGate({ task, question, options, from } = {}) {
  if (!task || !question?.trim()) {
    return { ok: false, reason: 'INVALID_ARGS', detail: 'task and question are required' }
  }
  const args = ['orchestration', 'gate-create', '--task', task, '--question', question]
  if (options) {
    args.push('--options', JSON.stringify(options))
  }
  if (from) {
    args.push('--from', from)
  }
  return runOrca(args)
}
