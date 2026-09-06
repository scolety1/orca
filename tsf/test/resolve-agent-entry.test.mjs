// Real V1 stabilization finding (Planner Chat live-use defect): resolving
// to a bare PATH command on Windows forces shell:true, which silently
// shreds a large/multi-line argument (a real system prompt) into wrongly-
// split fragments before the child process ever sees it -- see
// providers/resolve-agent-entry.mjs's fallbackCommand branch for the real,
// reproduced root cause and tsf/test/planner-chat-arg-safety.test.mjs for
// the direct proof of the corruption mechanism itself.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveAgentEntry } from '../providers/resolve-agent-entry.mjs'

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

function withEnv(overrides, fn) {
  const original = {}
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key]
    if (overrides[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = overrides[key]
    }
  }
  try {
    return fn()
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original[key]
      }
    }
  }
}

test('resolveAgentEntry: an unknown agent id resolves to null', () => {
  assert.equal(resolveAgentEntry('does-not-exist'), null)
})

test('resolveAgentEntry: envOverride pointing at a .mjs script gets a node hop', () => {
  withEnv({ TSF_PLANNER_CLAUDE_COMMAND: 'C:/fake/stub.mjs' }, () => {
    const entry = resolveAgentEntry('claude-code')
    assert.equal(entry.command, process.execPath)
    assert.deepEqual(entry.args, ['C:/fake/stub.mjs'])
    assert.equal(entry.viaShell, false)
  })
})

test('resolveAgentEntry: envOverride pointing at a real command runs directly, no shell', () => {
  withEnv({ TSF_PLANNER_CLAUDE_COMMAND: 'claude' }, () => {
    const entry = resolveAgentEntry('claude-code')
    assert.equal(entry.command, 'claude')
    assert.equal(entry.viaShell, false)
  })
})

test('resolveAgentEntry: finds the real npm-global exe via APPDATA, direct executable, no shell', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-appdata-'))
  try {
    const binDir = path.join(dir, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(path.join(binDir, 'claude.exe'), '')
    withEnv({ TSF_PLANNER_CLAUDE_COMMAND: undefined, APPDATA: dir }, () => {
      const entry = resolveAgentEntry('claude-code')
      assert.equal(entry.command, path.join(binDir, 'claude.exe'))
      assert.equal(entry.viaShell, false)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Real V1 stabilization finding: the homedir-derived candidate is defense
// in depth for when APPDATA genuinely cannot be found -- mirrors
// adapters/windows-user-env.mjs's own reasoning that os.homedir() stays
// reliable independent of which env vars a real Orca-hosted child process
// happens to inherit.
test('resolveAgentEntry: falls back to a homedir-derived npm-global path when APPDATA is missing', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-homedir-'))
  try {
    const binDir = path.join(
      home,
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin'
    )
    mkdirSync(binDir, { recursive: true })
    writeFileSync(path.join(binDir, 'claude.exe'), '')
    withEnv({ TSF_PLANNER_CLAUDE_COMMAND: undefined, APPDATA: undefined }, () => {
      const entry = resolveAgentEntry('claude-code', { homedirFn: () => home })
      assert.equal(entry.command, path.join(binDir, 'claude.exe'))
      assert.equal(entry.viaShell, false)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('resolveAgentEntry: APPDATA-derived path is tried before the homedir-derived one when both exist', () => {
  const appDataDir = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-both-appdata-'))
  const home = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-both-home-'))
  try {
    const appDataBin = path.join(
      appDataDir,
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin'
    )
    const homeBin = path.join(
      home,
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin'
    )
    mkdirSync(appDataBin, { recursive: true })
    mkdirSync(homeBin, { recursive: true })
    writeFileSync(path.join(appDataBin, 'claude.exe'), '')
    writeFileSync(path.join(homeBin, 'claude.exe'), '')
    withEnv({ TSF_PLANNER_CLAUDE_COMMAND: undefined, APPDATA: appDataDir }, () => {
      const entry = resolveAgentEntry('claude-code', { homedirFn: () => home })
      assert.equal(entry.command, path.join(appDataBin, 'claude.exe'))
    })
  } finally {
    rmSync(appDataDir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

// The core fix: this is the exact real defect. Before this fix, this case
// returned { command: 'claude', viaShell: true } -- unsafe for the large,
// multi-line arguments live-planner.mjs always sends on Windows.
test('resolveAgentEntry: no runnable entry found anywhere resolves to null on Windows (never an unsafe shell fallback)', () => {
  const emptyHome = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-none-'))
  try {
    withPlatform('win32', () => {
      withEnv({ TSF_PLANNER_CLAUDE_COMMAND: undefined, APPDATA: undefined }, () => {
        const entry = resolveAgentEntry('claude-code', { homedirFn: () => emptyHome })
        assert.equal(entry, null)
      })
    })
  } finally {
    rmSync(emptyHome, { recursive: true, force: true })
  }
})

test('resolveAgentEntry: codex has the same no-runnable-entry-found safety on Windows', () => {
  const emptyHome = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-codex-none-'))
  try {
    withPlatform('win32', () => {
      // CODEX_HOME cleared: this process's own real, inherited CODEX_HOME
      // (e.g. Orca's runtime home on a dev machine) must never leak into a
      // test asserting "nothing resolves" -- codexHome defaults to
      // process.env.CODEX_HOME now, so this is real isolation, not
      // redundant.
      withEnv({ TSF_PLANNER_CODEX_COMMAND: undefined, APPDATA: undefined, CODEX_HOME: undefined }, () => {
        const entry = resolveAgentEntry('codex', { homedirFn: () => emptyHome })
        assert.equal(entry, null)
      })
    })
  } finally {
    rmSync(emptyHome, { recursive: true, force: true })
  }
})

// Codex Physical-Launcher Repair: a real standalone-installer layout
// (current -> releases/<version>/bin/codex.exe, the CURRENT Windows
// distribution method) resolves directly, ahead of the now-often-absent
// npm-global candidate -- the real, live-reproduced fix for the PATH-shim
// codex.exe hanging/failing to launch its own Windows sandbox helper.
test('resolveAgentEntry: codex resolves the real standalone-package binary when present, ahead of npm', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-codex-standalone-'))
  try {
    const releaseDir = path.join(home, '.codex', 'packages', 'standalone', 'releases', '0.148.0-x86_64-pc-windows-msvc')
    mkdirSync(path.join(releaseDir, 'bin'), { recursive: true })
    writeFileSync(path.join(releaseDir, 'bin', 'codex.exe'), 'fake')
    symlinkSync(releaseDir, path.join(home, '.codex', 'packages', 'standalone', 'current'), 'junction')
    withPlatform('win32', () => {
      withEnv({ TSF_PLANNER_CODEX_COMMAND: undefined, APPDATA: undefined, CODEX_HOME: undefined }, () => {
        const entry = resolveAgentEntry('codex', { homedirFn: () => home })
        assert.equal(entry.command, path.join(releaseDir, 'bin', 'codex.exe'))
        assert.equal(entry.viaShell, false)
      })
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// CODEX_HOME-aware resolution (real, live-reproduced finding): the
// official Windows installer can update the standalone package under a
// DIFFERENT effective CODEX_HOME (e.g. Orca's own runtime home) than the
// bare %USERPROFILE%\.codex default -- resolution must follow whichever
// tree this process's own effective CODEX_HOME actually points at,
// never always the bare default.
test('resolveAgentEntry: codex resolves the standalone package under an explicit CODEX_HOME, not the bare default', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-codex-defaulthome-'))
  const orcaHome = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-codex-orcahome-'))
  try {
    // Both trees genuinely exist, at DIFFERENT versions -- exactly the
    // real machine state after the official installer updated only one.
    const defaultRelease = path.join(home, '.codex', 'packages', 'standalone', 'releases', '0.148.0-x86_64-pc-windows-msvc')
    mkdirSync(path.join(defaultRelease, 'bin'), { recursive: true })
    writeFileSync(path.join(defaultRelease, 'bin', 'codex.exe'), 'fake 0.148.0')
    symlinkSync(defaultRelease, path.join(home, '.codex', 'packages', 'standalone', 'current'), 'junction')

    const orcaRelease = path.join(orcaHome, 'packages', 'standalone', 'releases', '0.153.4-x86_64-pc-windows-msvc')
    mkdirSync(path.join(orcaRelease, 'bin'), { recursive: true })
    writeFileSync(path.join(orcaRelease, 'bin', 'codex.exe'), 'fake 0.153.4')
    symlinkSync(orcaRelease, path.join(orcaHome, 'packages', 'standalone', 'current'), 'junction')

    withPlatform('win32', () => {
      withEnv({ TSF_PLANNER_CODEX_COMMAND: undefined, APPDATA: undefined, CODEX_HOME: undefined }, () => {
        // No effective CODEX_HOME at all -> the bare default tree.
        const noHome = resolveAgentEntry('codex', { homedirFn: () => home })
        assert.equal(noHome.command, path.join(defaultRelease, 'bin', 'codex.exe'))

        // This process's own real, inherited CODEX_HOME (the default
        // param, not an explicit override) -> that tree, not the default.
        withEnv({ CODEX_HOME: orcaHome }, () => {
          const withOrcaHome = resolveAgentEntry('codex', { homedirFn: () => home })
          assert.equal(withOrcaHome.command, path.join(orcaRelease, 'bin', 'codex.exe'))
        })
      })
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(orcaHome, { recursive: true, force: true })
  }
})

// POSIX is unaffected by the defect (a PATH-resolved shebang script execs
// directly, no shell re-parsing risk) -- the bare-PATH fallback remains
// available there, corrected to viaShell:false (it never actually needed
// shell:true either).
test('resolveAgentEntry: the bare PATH fallback still resolves on non-Windows, without shell', () => {
  const emptyHome = mkdtempSync(path.join(tmpdir(), 'tsf-resolve-agent-posix-'))
  try {
    withPlatform('linux', () => {
      withEnv({ TSF_PLANNER_CLAUDE_COMMAND: undefined, APPDATA: undefined }, () => {
        const entry = resolveAgentEntry('claude-code', { homedirFn: () => emptyHome })
        assert.equal(entry.command, 'claude')
        assert.equal(entry.viaShell, false)
      })
    })
  } finally {
    rmSync(emptyHome, { recursive: true, force: true })
  }
})
