import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureWindowsUserEnv } from '../adapters/windows-user-env.mjs'
import { resolveCodexStandalonePackage } from './resolve-codex-standalone-package.mjs'

// Real V1 stabilization finding: this is a genuinely separate process
// entry point (Orca invokes it directly, not as a child of tsf/server),
// so it needs its own call -- fixing tsf/server's own environment does
// not reach here. Must run before npmAgentEntry()'s own process.env.APPDATA
// read below. See adapters/windows-user-env.mjs for the real, reproduced
// root cause.
ensureWindowsUserEnv()

const FORBIDDEN_ARGUMENTS = [
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  'bypasspermissions',
  'danger-full-access'
]

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }))
  process.exit(2)
}

function parseArguments(argv) {
  const separator = argv.indexOf('--')
  const control = separator === -1 ? argv : argv.slice(0, separator)
  const providerArguments = separator === -1 ? [] : argv.slice(separator + 1)
  const value = (flag) => {
    const index = control.indexOf(flag)
    return index === -1 ? null : (control[index + 1] ?? null)
  }
  return {
    provider: value('--provider'),
    workspace: value('--workspace'),
    checkOnly: control.includes('--check'),
    providerArguments
  }
}

function git(workspace, ...args) {
  try {
    return execFileSync(
      'git',
      ['-c', `safe.directory=${workspace.replaceAll('\\', '/')}`, '-C', workspace, ...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    ).trim()
  } catch (error) {
    const detail = error?.stderr?.toString().trim().split(/\r?\n/)[0] || 'Git preflight failed'
    fail(detail)
  }
}

function validateIsolatedWorktree(workspace) {
  const root = resolve(git(workspace, 'rev-parse', '--show-toplevel'))
  if (root.toLowerCase() !== resolve(workspace).toLowerCase()) {
    fail('workspace must be the exact Git top-level')
  }
  const branch = git(workspace, 'branch', '--show-current')
  if (!branch || ['main', 'master', 'trunk'].includes(branch.toLowerCase())) {
    fail(`refusing default or detached branch: ${branch || '(detached)'}`)
  }
  const gitDir = resolve(workspace, git(workspace, 'rev-parse', '--git-dir'))
  const commonDir = resolve(workspace, git(workspace, 'rev-parse', '--git-common-dir'))
  if (gitDir.toLowerCase() === commonDir.toLowerCase()) {
    fail('workspace is not an isolated linked worktree')
  }
  if (git(workspace, 'status', '--porcelain')) {
    fail('isolated worktree must start clean')
  }
  return { root, branch, gitDir, commonDir }
}

function rejectUnsafeArguments(args) {
  const normalized = args.map((arg) => arg.toLowerCase())
  for (const forbidden of FORBIDDEN_ARGUMENTS) {
    if (normalized.some((arg) => arg.includes(forbidden))) {
      fail(`forbidden provider argument: ${forbidden}`)
    }
  }
  const approvalIndex = normalized.indexOf('--ask-for-approval')
  if (approvalIndex !== -1 && normalized[approvalIndex + 1] === 'never') {
    fail('approval policy never is forbidden')
  }
}

function npmAgentEntry(packageName, entryName) {
  const appData = process.env.APPDATA
  if (!appData) {
    return null
  }
  const candidate = join(appData, 'npm', 'node_modules', packageName, entryName)
  return existsSync(candidate) ? candidate : null
}

function resolveProviderCommand(provider) {
  if (provider === 'codex') {
    // TSF_CODEX_ENTRY / npm-global still win first (operator override,
    // and the older, still-real install method) -- checked before the
    // standalone-package resolver so neither of those regresses.
    const entry = process.env.TSF_CODEX_ENTRY || npmAgentEntry('@openai/codex', 'bin/codex.js')
    if (entry && existsSync(entry)) {
      return { command: process.execPath, prefix: [entry] }
    }
    // Real, live-reproduced Windows bug: the PATH-shim codex.exe
    // (AppData\Local\Programs\OpenAI\Codex\bin, a symlink chain) fails or
    // hangs launching the Windows sandbox setup helper; the SAME binary's
    // real, non-symlinked release-directory path works every time -- see
    // resolve-codex-standalone-package.mjs. Tried before the win32
    // PATH-command refusal below so a healthy standalone install is used
    // directly rather than failing past a fixable case.
    const standalone = resolveCodexStandalonePackage()
    if (standalone) {
      return { command: standalone, prefix: [] }
    }
    if (process.platform !== 'win32') {
      return { command: 'codex', prefix: [] }
    }
    fail('Codex executable entry is unavailable')
  }
  if (provider === 'claude') {
    const entry =
      process.env.TSF_CLAUDE_ENTRY || npmAgentEntry('@anthropic-ai/claude-code', 'cli.js')
    if (entry && existsSync(entry)) {
      return { command: process.execPath, prefix: [entry] }
    }
    if (process.platform !== 'win32') {
      return { command: 'claude', prefix: [] }
    }
    fail('Claude Code executable entry is unavailable')
  }
  fail(`unsupported provider: ${provider}`)
}

const input = parseArguments(process.argv.slice(2))
if (!input.provider || !input.workspace) {
  fail('provider and workspace are required')
}
if (!['codex', 'claude'].includes(input.provider)) {
  fail('provider must be codex or claude')
}
rejectUnsafeArguments(input.providerArguments)
const worktree = validateIsolatedWorktree(input.workspace)
const resolvedCommand = resolveProviderCommand(input.provider)
const codexHome = resolve(process.env.TSF_CODEX_HOME || join(homedir(), '.codex'))

const safeArguments =
  input.provider === 'codex'
    ? [
        ...resolvedCommand.prefix,
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'on-request',
        '-c',
        'sandbox_workspace_write.network_access=false',
        '-C',
        worktree.root,
        ...input.providerArguments
      ]
    : [...resolvedCommand.prefix, '--permission-mode', 'default', ...input.providerArguments]

if (input.checkOnly) {
  console.log(
    JSON.stringify({
      ok: true,
      provider: input.provider,
      workspace: worktree.root,
      branch: worktree.branch,
      isolatedWorktree: true,
      blanketBypass: false,
      network: input.provider === 'codex' ? 'disabled' : 'host_enforcement_required',
      codexHome: input.provider === 'codex' ? codexHome : undefined
    })
  )
  process.exit(0)
}

const providerEnvironment = { ...process.env }
if (input.provider === 'codex') {
  // Orca's isolated runtime home made the signed Codex 0.144.1 Windows sandbox
  // setup helper fail with 0xc0000142 in two fixture runs. The normal supported
  // Codex user home completed both a direct control and an Orca-managed control
  // without weakening sandbox, approval, network, or worktree restrictions.
  providerEnvironment.CODEX_HOME = codexHome
}

const child = spawn(resolvedCommand.command, safeArguments, {
  cwd: worktree.root,
  env: providerEnvironment,
  shell: false,
  stdio: 'inherit',
  windowsHide: true
})
child.on('error', (error) => fail(error.message))
child.on('exit', (code, signal) => (process.exitCode = signal ? 1 : (code ?? 1)))
