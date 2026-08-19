// Resolves a runnable command for a provider agent CLI already installed on
// this machine, for headless (piped stdio) invocation. Mirrors the
// entry-resolution pattern in safe-provider-launch.mjs (finding the real
// executable behind the npm global shim so Windows doesn't need a .cmd/shell
// hop) but is kept separate: that script launches an interactive
// stdio:'inherit' terminal session inside an isolated worktree; this resolves
// for tsf/server/live-planner.mjs's non-interactive `-p`/print-mode calls,
// which need none of that.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CANDIDATES = {
  'claude-code': [
    { envOverride: 'TSF_PLANNER_CLAUDE_COMMAND' },
    // Current @anthropic-ai/claude-code ships a native launcher binary.
    { npmPackage: '@anthropic-ai/claude-code', relPath: ['bin', 'claude.exe'], directExecutable: true },
    // Older layout shipped a Node entry point instead.
    { npmPackage: '@anthropic-ai/claude-code', relPath: ['cli.js'], directExecutable: false },
    { fallbackCommand: 'claude' }
  ],
  codex: [
    { envOverride: 'TSF_PLANNER_CODEX_COMMAND' },
    { npmPackage: '@openai/codex', relPath: ['bin', 'codex.js'], directExecutable: false },
    { fallbackCommand: 'codex' }
  ]
}

// Returns { command, args, viaShell } or null if nothing runnable was found.
export function resolveAgentEntry(agentId) {
  const candidates = CANDIDATES[agentId]
  if (!candidates) return null
  for (const candidate of candidates) {
    if (candidate.envOverride) {
      const value = process.env[candidate.envOverride]
      if (!value) continue
      // Tests point this at a .mjs/.js stub script, which needs a node hop;
      // a real override (an .exe or PATH command) runs directly.
      if (value.endsWith('.mjs') || value.endsWith('.js')) return { command: process.execPath, args: [value], viaShell: false }
      return { command: value, args: [], viaShell: false }
    }
    if (candidate.npmPackage) {
      const appData = process.env.APPDATA
      if (!appData) continue
      const entry = join(appData, 'npm', 'node_modules', candidate.npmPackage, ...candidate.relPath)
      if (!existsSync(entry)) continue
      return candidate.directExecutable ? { command: entry, args: [], viaShell: false } : { command: process.execPath, args: [entry], viaShell: false }
    }
    if (candidate.fallbackCommand) {
      // Last resort: rely on PATH resolution. On Windows this is typically a
      // .cmd shim, which needs a shell hop; POSIX shebang scripts don't.
      return { command: candidate.fallbackCommand, args: [], viaShell: process.platform === 'win32' }
    }
  }
  return null
}
