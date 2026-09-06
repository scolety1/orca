// Resolves a runnable command for a provider agent CLI already installed on
// this machine, for headless (piped stdio) invocation. Mirrors the
// entry-resolution pattern in safe-provider-launch.mjs (finding the real
// executable behind the npm global shim so Windows doesn't need a .cmd/shell
// hop) but is kept separate: that script launches an interactive
// stdio:'inherit' terminal session inside an isolated worktree; this resolves
// for tsf/server/live-planner.mjs's non-interactive `-p`/print-mode calls,
// which need none of that.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveCodexStandalonePackage } from './resolve-codex-standalone-package.mjs'

const CANDIDATES = {
  'claude-code': [
    { envOverride: 'TSF_PLANNER_CLAUDE_COMMAND' },
    // Current @anthropic-ai/claude-code ships a native launcher binary.
    {
      npmPackage: '@anthropic-ai/claude-code',
      relPath: ['bin', 'claude.exe'],
      directExecutable: true
    },
    // Older layout shipped a Node entry point instead.
    { npmPackage: '@anthropic-ai/claude-code', relPath: ['cli.js'], directExecutable: false },
    { fallbackCommand: 'claude' }
  ],
  codex: [
    { envOverride: 'TSF_PLANNER_CODEX_COMMAND' },
    // Checked before the npm/PATH candidates: on the machines that still
    // have it, the standalone installer is the current, preferred Windows
    // distribution -- see resolve-codex-standalone-package.mjs for why its
    // PATH-shim/fallbackCommand form is refused instead, below.
    { standalonePackage: true },
    { npmPackage: '@openai/codex', relPath: ['bin', 'codex.js'], directExecutable: false },
    { fallbackCommand: 'codex' }
  ]
}

// Real V1 stabilization finding (Planner Chat live-use defect): resolves the
// same npm-global install layout as the `npmPackage` candidate above, but
// derived from os.homedir() (a Windows API call, reliable regardless of
// which env vars a real Orca-hosted child process happens to inherit --
// see adapters/windows-user-env.mjs) rather than process.env.APPDATA alone.
// Defense in depth: even before this candidate existed, server startup
// already repairs APPDATA when derivable, but this closes the gap for any
// other reason APPDATA might still be absent, without ever touching
// process.env here.
function npmGlobalCandidatePaths(relPath, homedirFn) {
  const appData = process.env.APPDATA
  const home = homedirFn()
  const paths = []
  if (appData) {
    paths.push(join(appData, 'npm', 'node_modules', ...relPath))
  }
  if (home) {
    const homeDerived = join(home, 'AppData', 'Roaming', 'npm', 'node_modules', ...relPath)
    if (!paths.includes(homeDerived)) {
      paths.push(homeDerived)
    }
  }
  return paths
}

// homedirFn defaults to the real os.homedir() -- injectable so tests can
// point the homedir-derived candidate at a hermetic fixture directory
// instead of this machine's real npm global install.
export function resolveAgentEntry(agentId, { homedirFn = homedir } = {}) {
  const candidates = CANDIDATES[agentId]
  if (!candidates) {
    return null
  }
  for (const candidate of candidates) {
    if (candidate.envOverride) {
      const value = process.env[candidate.envOverride]
      if (!value) {
        continue
      }
      // Tests point this at a .mjs/.js stub script, which needs a node hop;
      // a real override (an .exe or PATH command) runs directly.
      if (value.endsWith('.mjs') || value.endsWith('.js')) {
        return { command: process.execPath, args: [value], viaShell: false }
      }
      return { command: value, args: [], viaShell: false }
    }
    if (candidate.standalonePackage) {
      const entry = resolveCodexStandalonePackage({ homedirFn })
      if (!entry) {
        continue
      }
      return { command: entry, args: [], viaShell: false }
    }
    if (candidate.npmPackage) {
      const entry = npmGlobalCandidatePaths(
        [candidate.npmPackage, ...candidate.relPath],
        homedirFn
      ).find(existsSync)
      if (!entry) {
        continue
      }
      return candidate.directExecutable
        ? { command: entry, args: [], viaShell: false }
        : { command: process.execPath, args: [entry], viaShell: false }
    }
    if (candidate.fallbackCommand) {
      // Real V1 stabilization finding (Planner Chat live-use defect,
      // reproduced live): on Windows this resolves to a PATH .cmd shim,
      // which Node can only invoke via shell:true -- and shell:true does
      // ZERO argument escaping (Node's own DEP0190 deprecation warning:
      // "arguments are not escaped, only concatenated"). Reproduced
      // directly: a real multi-line JSON system prompt sent this way is
      // silently shredded by cmd.exe's own re-tokenization into dozens of
      // wrongly-split fragments before the child process ever sees it --
      // a 2214-character argument arrived as a 9-character fragment, and a
      // 6-word chat message arrived as its first word alone. This is the
      // exact root cause of a real defect: the CLI still exits 0 and
      // returns well-formed JSON with a real session/model (so every
      // existing malformed-response/error check passes and the UI shows a
      // healthy PLANNER_DEEP indicator), but Claude answers the corrupted
      // fragment it actually received -- generic ("Hi! How can I help you
      // today?") or self-reporting the truncation ("It looks like your
      // message got cut off..."), because that IS what it received.
      // live-planner.mjs's callers always send this shape of argument, so
      // this path is never actually safe for them on Windows -- refuse
      // honestly (falls through to PROVIDER_UNAVAILABLE, identical to "no
      // runnable entry found") rather than silently corrupt input in a way
      // the caller has no way to detect. POSIX is unaffected: a PATH-
      // resolved shebang script execs directly without any shell
      // re-parsing, so shell:true was never actually needed there either
      // -- corrected to false.
      if (process.platform === 'win32') {
        continue
      }
      return { command: candidate.fallbackCommand, args: [], viaShell: false }
    }
  }
  return null
}
