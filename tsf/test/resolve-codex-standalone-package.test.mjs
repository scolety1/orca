// Real, live-reproduced Windows bug (Codex Physical-Launcher Repair): the
// PATH-shim codex.exe (a symlink chain) fails/hangs launching the Windows
// sandbox setup helper; the real, non-symlinked release-directory binary
// works every time -- proven interactively before this resolver existed.
// `current` is itself a symlink Codex's own updater regenerates on every
// version change -- these tests use a real junction (no elevation needed
// on Windows, unlike a plain directory symlink) so resolution is proven
// against real symlink-following behavior, not just string concatenation.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveCodexStandalonePackage } from '../providers/resolve-codex-standalone-package.mjs'

function buildFakeInstall(version) {
  const home = mkdtempSync(path.join(tmpdir(), 'tsf-codex-standalone-'))
  const standaloneDir = path.join(home, '.codex', 'packages', 'standalone')
  const releaseDir = path.join(standaloneDir, 'releases', version)
  mkdirSync(path.join(releaseDir, 'bin'), { recursive: true })
  writeFileSync(path.join(releaseDir, 'bin', 'codex.exe'), 'fake binary')
  symlinkSync(releaseDir, path.join(standaloneDir, 'current'), 'junction')
  return home
}

test('resolves the real, non-symlinked bin/codex.exe path through the current -> release symlink', () => {
  const home = buildFakeInstall('0.148.0-x86_64-pc-windows-msvc')
  try {
    const entry = resolveCodexStandalonePackage({ platform: 'win32', homedirFn: () => home })
    assert.equal(
      entry,
      path.join(home, '.codex', 'packages', 'standalone', 'releases', '0.148.0-x86_64-pc-windows-msvc', 'bin', 'codex.exe')
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a version upgrade (current repointed at a new release) is picked up dynamically -- never hardcoded', () => {
  const home = buildFakeInstall('0.148.0-x86_64-pc-windows-msvc')
  try {
    const before = resolveCodexStandalonePackage({ platform: 'win32', homedirFn: () => home })
    assert.match(before, /0\.148\.0/)

    // Simulate `codex update`: a new release directory appears, and
    // `current` is regenerated to point at it -- exactly what Codex's own
    // updater does, never something this resolver drives itself.
    const standaloneDir = path.join(home, '.codex', 'packages', 'standalone')
    const newRelease = path.join(standaloneDir, 'releases', '0.153.4-x86_64-pc-windows-msvc')
    mkdirSync(path.join(newRelease, 'bin'), { recursive: true })
    writeFileSync(path.join(newRelease, 'bin', 'codex.exe'), 'fake newer binary')
    rmSync(path.join(standaloneDir, 'current'), { force: true })
    symlinkSync(newRelease, path.join(standaloneDir, 'current'), 'junction')

    const after = resolveCodexStandalonePackage({ platform: 'win32', homedirFn: () => home })
    assert.match(after, /0\.153\.4/)
    assert.notEqual(after, before)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('fails closed (null) when the current symlink does not exist at all -- no unsafe fallback', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'tsf-codex-standalone-missing-'))
  try {
    const entry = resolveCodexStandalonePackage({ platform: 'win32', homedirFn: () => home })
    assert.equal(entry, null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('fails closed (null) when current resolves but bin/codex.exe is missing from that release', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'tsf-codex-standalone-nobin-'))
  try {
    const standaloneDir = path.join(home, '.codex', 'packages', 'standalone')
    const releaseDir = path.join(standaloneDir, 'releases', '0.148.0-x86_64-pc-windows-msvc')
    mkdirSync(releaseDir, { recursive: true })
    symlinkSync(releaseDir, path.join(standaloneDir, 'current'), 'junction')
    const entry = resolveCodexStandalonePackage({ platform: 'win32', homedirFn: () => home })
    assert.equal(entry, null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('never activates on a non-Windows platform, even with a real install present', () => {
  const home = buildFakeInstall('0.148.0-x86_64-pc-windows-msvc')
  try {
    const entry = resolveCodexStandalonePackage({ platform: 'darwin', homedirFn: () => home })
    assert.equal(entry, null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a homedirFn returning nothing fails closed, never throws', () => {
  assert.equal(resolveCodexStandalonePackage({ platform: 'win32', homedirFn: () => null }), null)
})
