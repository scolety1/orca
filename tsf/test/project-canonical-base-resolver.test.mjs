// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C: real
// server-layer resolver proof against disposable fixture repos (mirrors
// self-improvement-adoption.test.mjs's own fixture-repo pattern) -- never
// C:\TSF_ORCA.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-canonical-base-resolver-'))
process.env.TSF_UI_STATE_FILE = path.join(ROOT, 'operator-state.json')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const { resolveProjectCanonicalBase } = await import('../server/project-canonical-base-resolver.mjs')
const { setProjectCanonicalBaseRef } = await import('../server/project-canonical-base-store.mjs')

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initFixtureRepo(name, branch) {
  const dir = path.join(ROOT, name)
  git(ROOT, ['init', '-q', '-b', branch, dir])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'file.txt'), 'x\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

const clock = () => new Date('2026-09-07T00:00:00.000Z')

test('main-based repo: resolves via the standard default', async () => {
  const root = initFixtureRepo('main-repo', 'main')
  const result = await resolveProjectCanonicalBase({ id: 'proj-main', root })
  assert.deepEqual(result, { resolved: true, ref: 'main', source: 'REPO_STANDARD_DEFAULT' })
})

test('master-based repo: resolves via the standard default', async () => {
  const root = initFixtureRepo('master-repo', 'master')
  const result = await resolveProjectCanonicalBase({ id: 'proj-master', root })
  assert.deepEqual(result, { resolved: true, ref: 'master', source: 'REPO_STANDARD_DEFAULT' })
})

test('explicit-base-configured repo: explicit wins even though a standard default also exists', async () => {
  const root = initFixtureRepo('explicit-repo', 'main')
  git(root, ['checkout', '-q', '-b', 'release/2026'])
  await setProjectCanonicalBaseRef({ projectId: 'proj-explicit', ref: 'release/2026', setBy: 'OPERATOR_CHAT', reason: 'deliberate release-branch designation' }, clock)
  const result = await resolveProjectCanonicalBase({ id: 'proj-explicit', root })
  assert.deepEqual(result, { resolved: true, ref: 'release/2026', source: 'EXPLICIT_CONFIGURED' })
})

test('no standard default and no explicit config: fails closed, never a lexical guess among work/* branches', async () => {
  const root = initFixtureRepo('nostandard-repo', 'work/feature-x')
  const result = await resolveProjectCanonicalBase({ id: 'proj-nostandard', root })
  assert.equal(result.resolved, false)
  assert.equal(result.reason, 'NO_RESOLVABLE_CANONICAL_BASE')
})

test('stale configured base: the durable config points at a branch that no longer exists -- honest failure, never a silent fallback guess', async () => {
  const root = initFixtureRepo('stale-repo', 'main')
  await setProjectCanonicalBaseRef({ projectId: 'proj-stale', ref: 'release/does-not-exist', setBy: 'OPERATOR_CHAT', reason: 'a designation that later went stale' }, clock)
  const result = await resolveProjectCanonicalBase({ id: 'proj-stale', root })
  assert.equal(result.resolved, false)
  assert.equal(result.reason, 'STALE_CONFIGURED_CANONICAL_BASE')
  // Never silently falls through to the repo's own real main default even
  // though one exists here -- an operator's stale designation must be
  // reported honestly, not silently second-guessed.
  assert.notEqual(result.ref, 'main')
})
