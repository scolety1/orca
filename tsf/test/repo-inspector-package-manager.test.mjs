// Real V1 stabilization finding: package-manager detection used to check
// only JS lockfiles and default anything else to the single string
// 'UNKNOWN' -- which health-repair.mjs's own DEPENDENCY_HEALTH repair then
// defaulted to `npm install`, really running `npm install` inside real
// non-npm repos (NWR, route-reader) and leaving a stray package-lock.json
// behind in their real working trees. Each of these is a real,
// distinguishable repo shape that must resolve to its own real manager,
// never a guess -- see health-repair-io.test.mjs for the matching repair-
// action-side coverage (never installs for an unrecognized manager).
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { discoverCommandGuidance } from '../server/repo-inspector.mjs'

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})
function tracked(dir) {
  tempDirs.push(dir)
  return dir
}

function fixtureDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-pkgmgr-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content)
  }
  return dir
}

test('discoverCommandGuidance: detects pnpm/yarn/npm from their real lockfiles', () => {
  for (const [lockfile, expected] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm']
  ]) {
    const dir = tracked(fixtureDir({ 'package.json': '{}', [lockfile]: '' }))
    assert.equal(discoverCommandGuidance(dir, '{}').packageManager, expected)
  }
})

test('discoverCommandGuidance: detects bun from bun.lockb without needing a package.json script to hint at it', () => {
  const dir = tracked(fixtureDir({ 'package.json': '{}', 'bun.lockb': '' }))
  assert.equal(discoverCommandGuidance(dir, '{}').packageManager, 'bun')
})

test('discoverCommandGuidance: a declared packageManager field is trusted over lockfile inference', () => {
  const dir = tracked(fixtureDir({ 'package.json': '{}', 'package-lock.json': '' }))
  const guidance = discoverCommandGuidance(dir, '{"packageManager":"pnpm@8.15.0"}')
  assert.equal(guidance.packageManager, 'pnpm')
})

test('discoverCommandGuidance: a real package.json with no lockfile signal is UNKNOWN, not npm -- genuinely ambiguous, never guessed', () => {
  const dir = tracked(fixtureDir({ 'package.json': '{}' }))
  const guidance = discoverCommandGuidance(dir, '{}')
  assert.equal(guidance.packageManager, 'UNKNOWN')
  // Still a real JS project -- node_modules is a real fact worth checking.
  assert.equal(guidance.dependenciesInstalled, false)
})

test('discoverCommandGuidance: a real Python project (pyproject.toml/requirements.txt/Pipfile) is classified python, never UNKNOWN-then-npm', () => {
  for (const manifest of ['pyproject.toml', 'requirements.txt', 'Pipfile']) {
    const dir = tracked(fixtureDir({ [manifest]: '' }))
    const guidance = discoverCommandGuidance(dir, null)
    assert.equal(guidance.packageManager, 'python')
    // node_modules will never exist for a Python project -- honestly not
    // a dependency-health signal, not a permanent false DEPENDENCY_HEALTH
    // flag on every real Python repo.
    assert.equal(guidance.dependenciesInstalled, true)
  }
})

// Real V1 stabilization finding: discovery had NO Python support at all --
// a real Python project (NWR) always read hasKnownTestCommand: false
// (BASELINE_UNKNOWN) no matter how confidently packageManager was
// detected, since only package.json `scripts` were ever inspected.
test('discoverCommandGuidance: a real Python project with pytest/ruff configured in pyproject.toml discovers real, exact commands', () => {
  const pyprojectText =
    '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n\n[tool.ruff]\nline-length = 100\n'
  const dir = tracked(fixtureDir({ 'pyproject.toml': pyprojectText }))
  const guidance = discoverCommandGuidance(dir, null, pyprojectText)
  assert.equal(guidance.packageManager, 'python')
  assert.deepEqual(guidance.testCommands, ['pytest'])
  assert.deepEqual(guidance.lintCommands, ['ruff check .'])
  assert.equal(guidance.hasKnownTestCommand, true)
})

test('discoverCommandGuidance: a Python project with neither pytest nor ruff configured discovers no commands, never invents one', () => {
  const pyprojectText = '[project]\nname = "x"\n'
  const dir = tracked(fixtureDir({ 'pyproject.toml': pyprojectText }))
  const guidance = discoverCommandGuidance(dir, null, pyprojectText)
  assert.equal(guidance.packageManager, 'python')
  assert.deepEqual(guidance.testCommands, [])
  assert.deepEqual(guidance.lintCommands, [])
  assert.equal(guidance.hasKnownTestCommand, false)
})

test('discoverCommandGuidance: package.json scripts still take priority discovery path when the manager is a real JS manager, never confused with Python detection', () => {
  const dir = tracked(fixtureDir({ 'package.json': '{}', 'package-lock.json': '' }))
  const guidance = discoverCommandGuidance(dir, '{"scripts":{"test":"vitest"}}', null)
  assert.equal(guidance.packageManager, 'npm')
  assert.deepEqual(guidance.testCommands, ['npm run test'])
})

test('discoverCommandGuidance: a real Rust/Go project is classified cargo/go, and a repo with no manifest at all is none', () => {
  assert.equal(
    discoverCommandGuidance(tracked(fixtureDir({ 'Cargo.toml': '' })), null).packageManager,
    'cargo'
  )
  assert.equal(
    discoverCommandGuidance(tracked(fixtureDir({ 'go.mod': '' })), null).packageManager,
    'go'
  )
  assert.equal(discoverCommandGuidance(tracked(fixtureDir({})), null).packageManager, 'none')
})
