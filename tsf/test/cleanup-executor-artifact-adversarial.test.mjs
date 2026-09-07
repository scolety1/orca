// Real filesystem fixtures + a real spawned disposable child process for
// RETIRE_SESSION, run through the full runGovernedCleanupAction pipeline.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-cleanup-executor-artifact-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE
const QUARANTINE_DIR = path.join(HERE, '..', 'server', '.local-state', `cleanup-quarantine-test-artifact-${process.pid}`)
process.env.TSF_CLEANUP_QUARANTINE_DIR = QUARANTINE_DIR

const { runGovernedCleanupAction } = await import('../server/cleanup-executor.mjs')

function cleanupIsolatedState() {
  for (const suffix of ['', '.tmp', '.planner-mission.lock', '.cleanup-request.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
  rmSync(QUARANTINE_DIR, { recursive: true, force: true })
}
cleanupIsolatedState()
test.after(cleanupIsolatedState)

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-executor-artifact-'))
test.after(() => rmSync(ROOT, { recursive: true, force: true }))
const clock = () => new Date('2026-09-06T12:00:00.000Z')
const openGate = () => ({ open: true, reason: 'test-injected open gate' })

test('QUARANTINE_ARTIFACT then RESTORE_QUARANTINE: full round trip through the governed pipeline, content intact', async () => {
  const artifact = path.join(ROOT, 'stray-artifact.txt')
  writeFileSync(artifact, 'valuable stray content')

  const quarantineOutcome = await runGovernedCleanupAction({
    actionClass: 'QUARANTINE_ARTIFACT',
    targetIdentity: { realPath: artifact },
    rationale: 'a stray artifact worth preserving but relocating',
    mutationParams: {},
    gateCheck: openGate,
    clock
  })
  assert.equal(quarantineOutcome.status, 'COMPLETED')
  assert.equal(existsSync(artifact), false)
  const quarantineId = quarantineOutcome.execution.result.quarantineId
  assert.ok(quarantineId)

  const restoreOutcome = await runGovernedCleanupAction({
    actionClass: 'RESTORE_QUARANTINE',
    targetIdentity: { realPath: artifact },
    rationale: 'restore the previously quarantined artifact',
    mutationParams: { quarantineId, destinationPath: artifact },
    gateCheck: openGate,
    clock
  })
  assert.equal(restoreOutcome.status, 'COMPLETED')
  assert.equal(readFileSync(artifact, 'utf8'), 'valuable stray content')
})

test('CLEAR_SAFE_GENERATED_CACHE: an allowlisted cache directory name is actually deleted', async () => {
  const cacheDir = path.join(ROOT, 'some-project', '.turbo')
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(path.join(cacheDir, 'entry.bin'), 'regenerable')

  const outcome = await runGovernedCleanupAction({
    actionClass: 'CLEAR_SAFE_GENERATED_CACHE',
    targetIdentity: { realPath: cacheDir },
    rationale: 'regenerable build cache',
    mutationParams: {},
    gateCheck: openGate,
    clock
  })
  assert.equal(outcome.status, 'COMPLETED')
  assert.equal(existsSync(cacheDir), false)
})

test('CLEAR_SAFE_GENERATED_CACHE: a non-allowlisted directory name is refused at the executor level even with the gate open', async () => {
  const notACache = path.join(ROOT, 'some-project', 'src')
  mkdirSync(notACache, { recursive: true })
  writeFileSync(path.join(notACache, 'important.js'), 'real source code')

  const outcome = await runGovernedCleanupAction({
    actionClass: 'CLEAR_SAFE_GENERATED_CACHE',
    targetIdentity: { realPath: notACache },
    rationale: 'attempted misuse: this is not actually a cache directory',
    mutationParams: {},
    gateCheck: openGate,
    clock
  })
  assert.equal(outcome.status, 'EXECUTION_FAILED')
  assert.equal(outcome.error.code, 'TSF_CLEANUP_CACHE_NAME_NOT_ALLOWLISTED')
  assert.equal(existsSync(notACache), true, 'non-allowlisted content must never be deleted, regardless of the gate')
})

test('REMOVE_STALE_TEMPORARY_STATE: a temp-shaped, sufficiently old path is actually deleted', async () => {
  const tempDir = path.join(ROOT, 'run-tmp-abc123')
  mkdirSync(tempDir)
  writeFileSync(path.join(tempDir, 'scratch.bin'), 'x')
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  utimesSync(tempDir, old, old)

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_STALE_TEMPORARY_STATE',
    targetIdentity: { realPath: tempDir },
    rationale: 'stale temp run directory',
    mutationParams: { olderThanMs: 24 * 60 * 60 * 1000 },
    gateCheck: openGate,
    clock
  })
  assert.equal(outcome.status, 'COMPLETED')
  assert.equal(existsSync(tempDir), false)
})

test('REMOVE_STALE_TEMPORARY_STATE: a temp-shaped but NOT-YET-STALE path is refused, never deleted early', async () => {
  const tempDir = path.join(ROOT, 'run-tmp-freshly-made')
  mkdirSync(tempDir)

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_STALE_TEMPORARY_STATE',
    targetIdentity: { realPath: tempDir },
    rationale: 'attempted early removal of a fresh temp directory',
    mutationParams: { olderThanMs: 24 * 60 * 60 * 1000 },
    gateCheck: openGate,
    clock
  })
  assert.equal(outcome.status, 'EXECUTION_FAILED')
  assert.equal(outcome.error.code, 'TSF_CLEANUP_NOT_STALE_ENOUGH')
  assert.equal(existsSync(tempDir), true)
})

test('REMOVE_STALE_TEMPORARY_STATE: a path NOT shaped like temp state is refused regardless of age', async () => {
  const notTemp = path.join(ROOT, 'permanent-looking-directory')
  mkdirSync(notTemp)
  const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
  utimesSync(notTemp, old, old)

  const outcome = await runGovernedCleanupAction({
    actionClass: 'REMOVE_STALE_TEMPORARY_STATE',
    targetIdentity: { realPath: notTemp },
    rationale: 'attempted removal of a non-temp-shaped path',
    mutationParams: {},
    gateCheck: openGate,
    clock
  })
  assert.equal(outcome.status, 'EXECUTION_FAILED')
  assert.equal(outcome.error.code, 'TSF_CLEANUP_NOT_TEMP_STATE_SHAPED')
  assert.equal(existsSync(notTemp), true)
})

test('RETIRE_SESSION: a real spawned disposable child process is retired through the full governed pipeline', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 200))

  const outcome = await runGovernedCleanupAction({
    actionClass: 'RETIRE_SESSION',
    targetIdentity: { realPath: path.join(ROOT, `session-${child.pid}`) }, // a logical identity, not a real fs path
    rationale: 'a disposable fixture session no longer needed',
    mutationParams: { pid: child.pid, graceMs: 500 },
    gateCheck: openGate,
    clock
  })
  assert.equal(outcome.status, 'COMPLETED')
  assert.equal(outcome.execution.result.ok, true)

  let alive = true
  try {
    process.kill(child.pid, 0)
  } catch {
    alive = false
  }
  assert.equal(alive, false, 'the real child process must actually have been retired')
})

test('NOT_IMPLEMENTED_V0 ELEVATED classes: classified and planned, but the executor refuses to even reach the owner gate, let alone mutate anything', async () => {
  for (const actionClass of ['PROCESS_TERMINATION', 'ARBITRARY_FILESYSTEM_DELETION', 'REMOTE_BRANCH_DELETION', 'GIT_PRUNE_GC', 'REMOVE_DIRTY_WORKTREE']) {
    const outcome = await runGovernedCleanupAction({
      actionClass,
      targetIdentity: { realPath: path.join(ROOT, `not-implemented-${actionClass}`) },
      rationale: `attempted use of unimplemented class ${actionClass}`,
      mutationParams: {},
      gateCheck: () => {
        throw new Error('the gate must never even be consulted for a NOT_IMPLEMENTED_V0 class')
      },
      clock
    })
    assert.equal(outcome.status, 'NOT_IMPLEMENTED_V0_CLASSIFICATION_ONLY')
    assert.ok(outcome.plan, 'the PLAN stage must still exist -- the taxonomy distinction is modeled in the data, not just skipped entirely')
  }
})
