// Real filesystem + real git + real Phase 2 planner-mission-store fixtures
// (isolated state file), never a mocked-away safety check.
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-revalidation-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { probeFileLock, collectFreshSafetyContext } = await import('../server/cleanup-revalidation.mjs')
const { resolveCanonicalPath } = await import('../server/resource-auditor-path-identity.mjs')
const { mutateCheckpoint } = await import('../server/planner-mission-store.mjs')
const { createPlannerMissionCheckpoint } = await import('../domain/planner-mission-checkpoint.mjs')

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-revalidation-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))
const clock = () => new Date('2026-09-06T12:00:00.000Z')

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'ignore' })
}

test('probeFileLock: false for a normally-openable file', () => {
  const filePath = path.join(ROOT, 'openable.txt')
  writeFileSync(filePath, 'x')
  assert.equal(probeFileLock(filePath), false)
})

test('probeFileLock: false (not locked) for a non-existent path', () => {
  assert.equal(probeFileLock(path.join(ROOT, 'does-not-exist.txt')), false)
})

test('probeFileLock: false for a directory (EISDIR is not a file-handle-lock concern)', () => {
  const dirPath = path.join(ROOT, 'a-directory')
  mkdirSync(dirPath)
  assert.equal(probeFileLock(dirPath), false)
})

test('collectFreshSafetyContext resolves protectedPath from the REAL, canonical path -- not the caller-supplied string', async () => {
  const registry = { paths: ['C:/definitely-protected'], branches: [] }
  const { context } = await collectFreshSafetyContext({ targetIdentity: { realPath: path.join(ROOT, 'unprotected-thing') }, callerProtectedRegistry: registry }, clock)
  assert.equal(context.protectedPath, false)
})

test('PATH-ALIAS/JUNCTION fixture: a real Windows junction pointing INTO a protected path is still caught, because the check resolves the real target, not the alias string', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('junctions are a Windows-specific mechanism')
    return
  }
  const realTarget = path.join(ROOT, 'real-protected-target')
  mkdirSync(realTarget)
  // collectFreshSafetyContext itself now canonicalizes every registry entry
  // (Phase 14 fix, see canonicalizeRegistryPaths in cleanup-revalidation.mjs)
  // -- registering the raw, un-resolved realTarget string here is exactly
  // what a real caller/env-var config does; no pre-resolution needed.
  const junction = path.join(ROOT, 'alias-junction')
  symlinkSync(realTarget, junction, 'junction')

  const registry = { paths: [realTarget], branches: [] }
  const { context, resolvedRealPath } = await collectFreshSafetyContext(
    { targetIdentity: { realPath: junction }, callerProtectedRegistry: registry },
    clock
  )
  const canonicalRealTarget = await resolveCanonicalPath(realTarget)
  assert.equal(resolvedRealPath.toLowerCase(), canonicalRealTarget.toLowerCase())
  assert.equal(context.protectedPath, true, 'the junction alias must not be usable to dodge the real-path protected check')
})

test('SECURITY (Phase 14, real bug fixed): a protected registry entry configured via an ALIAS (e.g. a junction, exactly how TSF_CLEANUP_EXTRA_PROTECTED_PATHS or any callerProtectedRegistry is realistically supplied) still protects the SAME real directory when a candidate targets it directly, bypassing the alias entirely', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('junctions are a Windows-specific mechanism')
    return
  }
  const realProtectedTarget = path.join(ROOT, 'registry-alias-real-target')
  mkdirSync(realProtectedTarget)
  const operatorConfiguredAlias = path.join(ROOT, 'registry-alias-operator-alias')
  symlinkSync(realProtectedTarget, operatorConfiguredAlias, 'junction')

  // The registry records the ALIAS, unresolved -- exactly what an operator
  // typing TSF_CLEANUP_EXTRA_PROTECTED_PATHS, or any programmatic
  // callerProtectedRegistry, would naturally supply.
  const registry = { paths: [operatorConfiguredAlias], branches: [] }
  // The candidate never mentions the alias at all -- it names the real
  // directory directly, exactly like a targetIdentity.realPath a caller
  // supplied via a different, non-aliased route would.
  const { context } = await collectFreshSafetyContext(
    { targetIdentity: { realPath: realProtectedTarget }, callerProtectedRegistry: registry },
    clock
  )
  assert.equal(
    context.protectedPath,
    true,
    'a protected path registered via an alias must still protect the same real directory reached directly -- before the Phase 14 fix this was false (VULNERABLE: bypassed the protected-path check entirely)'
  )
})

test('collectFreshSafetyContext checkGit=true reflects real, live git dirty/clean state', async () => {
  const repo = path.join(ROOT, 'git-check-repo')
  git(ROOT, ['init', '-q', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'fixture@example.com'])
  git(repo, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(repo, 'a.txt'), 'a')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-q', '-m', 'initial'])

  const clean = await collectFreshSafetyContext({ targetIdentity: { realPath: repo }, checkGit: true }, clock)
  assert.equal(clean.context.git.clean, true)

  writeFileSync(path.join(repo, 'b.txt'), 'uncommitted')
  const dirty = await collectFreshSafetyContext({ targetIdentity: { realPath: repo }, checkGit: true }, clock)
  assert.equal(dirty.context.git.clean, false)
})

test('collectFreshSafetyContext reflects a REAL active-mission reference from the durable planner-mission store', async () => {
  const missionId = 'mission:cleanup-revalidation-active'
  await mutateCheckpoint(
    missionId,
    () =>
      createPlannerMissionCheckpoint(
        { missionId, missionGoal: 'active lane', phase: 'BUILD', repoState: { branch: 'tsf/feature/revalidation-target', sha: 'e'.repeat(40) } },
        clock
      ),
    clock
  )
  const { context } = await collectFreshSafetyContext({ targetIdentity: { realPath: path.join(ROOT, 'unrelated'), branch: 'tsf/feature/revalidation-target' } }, clock)
  assert.equal(context.activeMissionReferenced, true)
})

test('checkFileLock=false (default) never populates context.fileLocked -- optional field convention honored', async () => {
  const { context } = await collectFreshSafetyContext({ targetIdentity: { realPath: path.join(ROOT, 'irrelevant') } }, clock)
  assert.equal(context.fileLocked, undefined)
})
