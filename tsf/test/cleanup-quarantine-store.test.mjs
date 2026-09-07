// Real filesystem fixtures under os.tmpdir() only. Covers reversible
// quarantine/restore, idempotent restore, and the partial-failure-recovery
// state machine -- including a REAL Windows held-file-handle fixture
// (win32 only) proving a lock blocks gracefully rather than corrupting.
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  moveToQuarantine,
  readQuarantineManifest,
  recoverIncompleteQuarantine,
  restoreFromQuarantine
} from '../server/cleanup-quarantine-store.mjs'

const ROOT = mkdtempSync(path.join(tmpdir(), 'tsf-cleanup-quarantine-'))
const QUARANTINE_ROOT = path.join(ROOT, 'quarantine')
test.after(() => rmSync(ROOT, { recursive: true, force: true }))

const clock = () => new Date('2026-09-06T12:00:00.000Z')

test('MOVE mode: a file round-trips through quarantine and restore, content intact', () => {
  const original = path.join(ROOT, 'artifact-a.txt')
  writeFileSync(original, 'important scratch content')
  const manifest = moveToQuarantine({ requestId: 'req-a', actionClass: 'QUARANTINE_ARTIFACT', originalPath: original, mode: 'MOVE' }, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(manifest.status, 'QUARANTINED')
  assert.equal(existsSync(original), false)
  assert.equal(existsSync(manifest.quarantinedPath), true)

  const outcome = restoreFromQuarantine(manifest.quarantineId, original, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(outcome.ok, true)
  assert.equal(readFileSync(original, 'utf8'), 'important scratch content')
})

test('MOVE mode: a directory (with nested files) round-trips intact', () => {
  const original = path.join(ROOT, 'artifact-dir')
  mkdirSync(path.join(original, 'nested'), { recursive: true })
  writeFileSync(path.join(original, 'top.txt'), 'top')
  writeFileSync(path.join(original, 'nested', 'inner.txt'), 'inner')
  const manifest = moveToQuarantine({ requestId: 'req-dir', actionClass: 'QUARANTINE_ARTIFACT', originalPath: original, mode: 'MOVE' }, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(existsSync(original), false)

  restoreFromQuarantine(manifest.quarantineId, original, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(readFileSync(path.join(original, 'nested', 'inner.txt'), 'utf8'), 'inner')
})

test('COPY mode leaves the original in place (used by worktree removal, where the NEXT real step deletes it)', () => {
  const original = path.join(ROOT, 'worktree-like-dir')
  mkdirSync(original)
  writeFileSync(path.join(original, 'file.txt'), 'x')
  const manifest = moveToQuarantine({ requestId: 'req-copy', actionClass: 'REMOVE_DISPOSABLE_WORKTREE', originalPath: original, mode: 'COPY' }, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(manifest.status, 'COPIED_ORIGINAL_STILL_PRESENT')
  assert.equal(existsSync(original), true, 'COPY mode must not touch the original')
  assert.equal(existsSync(manifest.quarantinedPath), true)
})

test('restoreFromQuarantine refuses (never overwrites) when the destination already exists', () => {
  const original = path.join(ROOT, 'conflict-src.txt')
  writeFileSync(original, 'src')
  const manifest = moveToQuarantine({ requestId: 'req-conflict', actionClass: 'QUARANTINE_ARTIFACT', originalPath: original, mode: 'MOVE' }, { quarantineRoot: QUARANTINE_ROOT, clock })
  writeFileSync(original, 'someone recreated this path in the meantime')
  assert.throws(
    () => restoreFromQuarantine(manifest.quarantineId, original, { quarantineRoot: QUARANTINE_ROOT, clock }),
    (error) => error.code === 'TSF_CLEANUP_RESTORE_DESTINATION_CONFLICT'
  )
})

test('DUPLICATE-REQUEST fixture: restoring an already-RESTORED quarantine a second time is idempotent, not an error', () => {
  const original = path.join(ROOT, 'idempotent-restore.txt')
  writeFileSync(original, 'x')
  const manifest = moveToQuarantine({ requestId: 'req-idem', actionClass: 'QUARANTINE_ARTIFACT', originalPath: original, mode: 'MOVE' }, { quarantineRoot: QUARANTINE_ROOT, clock })
  const first = restoreFromQuarantine(manifest.quarantineId, original, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(first.alreadyRestored, false)
  const second = restoreFromQuarantine(manifest.quarantineId, original, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(second.alreadyRestored, true)
  assert.equal(second.restoredPath, original)
})

test('recoverIncompleteQuarantine: manifest IN_PROGRESS, quarantined copy exists, original gone -> reconciles to QUARANTINED (the move actually finished; only the manifest write lagged)', () => {
  const quarantineId = 'fixture-reconcile-1'
  const dir = path.join(QUARANTINE_ROOT, quarantineId)
  mkdirSync(dir, { recursive: true })
  const quarantinedPath = path.join(dir, 'thing.txt')
  writeFileSync(quarantinedPath, 'moved')
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ quarantineId, originalPath: path.join(ROOT, 'never-existed-anymore.txt'), quarantinedPath, status: 'QUARANTINE_IN_PROGRESS' })
  )
  const recovery = recoverIncompleteQuarantine(quarantineId, { quarantineRoot: QUARANTINE_ROOT })
  assert.equal(recovery.status, 'RECONCILED_TO_QUARANTINED')
  assert.equal(recovery.requiresOwnerReview, false)
})

test('recoverIncompleteQuarantine: manifest IN_PROGRESS, nothing moved yet -> FAILED_NEVER_STARTED, safe to retry cleanly', () => {
  const quarantineId = 'fixture-never-started'
  const dir = path.join(QUARANTINE_ROOT, quarantineId)
  mkdirSync(dir, { recursive: true })
  const original = path.join(ROOT, 'still-here.txt')
  writeFileSync(original, 'x')
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ quarantineId, originalPath: original, quarantinedPath: path.join(dir, 'thing.txt'), status: 'QUARANTINE_IN_PROGRESS' })
  )
  const recovery = recoverIncompleteQuarantine(quarantineId, { quarantineRoot: QUARANTINE_ROOT })
  assert.equal(recovery.status, 'FAILED_NEVER_STARTED')
  assert.equal(existsSync(original), true, 'the never-touched original must remain exactly as it was')
})

test('PARTIAL-DELETION-FAILURE fixture: both copy AND original exist (a copy succeeded but original removal did not) -> QUARANTINE_SOURCE_STILL_PRESENT, requires owner review, data lost nowhere', () => {
  const quarantineId = 'fixture-partial-failure'
  const dir = path.join(QUARANTINE_ROOT, quarantineId)
  mkdirSync(dir, { recursive: true })
  const original = path.join(ROOT, 'partial-failure-original.txt')
  const quarantinedPath = path.join(dir, 'thing.txt')
  writeFileSync(original, 'still here too')
  writeFileSync(quarantinedPath, 'copied here')
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ quarantineId, originalPath: original, quarantinedPath, status: 'QUARANTINE_IN_PROGRESS' })
  )
  const recovery = recoverIncompleteQuarantine(quarantineId, { quarantineRoot: QUARANTINE_ROOT })
  assert.equal(recovery.status, 'QUARANTINE_SOURCE_STILL_PRESENT')
  assert.equal(recovery.requiresOwnerReview, true)
  assert.equal(existsSync(original), true)
  assert.equal(existsSync(quarantinedPath), true)
})

test('recoverIncompleteQuarantine: neither path exists -> INCONSISTENT_REQUIRES_OWNER_REVIEW, never fabricates a conclusion', () => {
  const quarantineId = 'fixture-inconsistent'
  const dir = path.join(QUARANTINE_ROOT, quarantineId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ quarantineId, originalPath: path.join(ROOT, 'nope.txt'), quarantinedPath: path.join(dir, 'nope2.txt'), status: 'QUARANTINE_IN_PROGRESS' })
  )
  const recovery = recoverIncompleteQuarantine(quarantineId, { quarantineRoot: QUARANTINE_ROOT })
  assert.equal(recovery.status, 'INCONSISTENT_REQUIRES_OWNER_REVIEW')
  assert.equal(recovery.requiresOwnerReview, true)
})

test('recoverIncompleteQuarantine: no manifest at all -> NO_MANIFEST, and an already-terminal manifest is reported as-is (not re-processed)', () => {
  assert.equal(recoverIncompleteQuarantine('does-not-exist-at-all', { quarantineRoot: QUARANTINE_ROOT }).status, 'NO_MANIFEST')

  const original = path.join(ROOT, 'terminal.txt')
  writeFileSync(original, 'x')
  const manifest = moveToQuarantine({ requestId: 'req-terminal', actionClass: 'QUARANTINE_ARTIFACT', originalPath: original, mode: 'MOVE' }, { quarantineRoot: QUARANTINE_ROOT, clock })
  const recovery = recoverIncompleteQuarantine(manifest.quarantineId, { quarantineRoot: QUARANTINE_ROOT })
  assert.equal(recovery.status, 'QUARANTINED')
  assert.equal(recovery.requiresOwnerReview, false)
})

// A plain fs.openSync('r+') held open does NOT block a rename on modern
// Windows/libuv (FILE_SHARE_DELETE is granted by default) -- so this
// fixture uses a genuinely reliable OS-level lock instead: a real, live
// child process whose CURRENT WORKING DIRECTORY is inside the target
// directory. Windows refuses to rename/delete a directory that is any
// live process's cwd, exactly the class of "held handle" hazard this
// requirement targets, reproduced for real rather than assumed.
function spawnCwdHolder(cwd) {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd, stdio: 'ignore' })
}

function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const poll = () => {
      try {
        process.kill(pid, 0)
      } catch {
        resolve(true)
        return
      }
      if (Date.now() > deadline) {
        resolve(false)
        return
      }
      setTimeout(poll, 25)
    }
    poll()
  })
}

test('WINDOWS FILE-LOCK fixture: a real live process holding the target directory as its cwd blocks the quarantine move gracefully -- original stays fully intact, no corruption -- and a retry after release succeeds', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('this fixture depends on Windows-specific directory-in-use semantics')
    return
  }
  const original = path.join(ROOT, 'locked-dir')
  mkdirSync(original)
  writeFileSync(path.join(original, 'payload.txt'), 'locked content')

  const holder = spawnCwdHolder(original)
  await new Promise((resolve) => setTimeout(resolve, 300)) // let the child actually start and chdir

  try {
    assert.throws(
      () => moveToQuarantine({ requestId: 'req-locked', actionClass: 'QUARANTINE_ARTIFACT', originalPath: original, mode: 'MOVE' }, { quarantineRoot: QUARANTINE_ROOT, clock }),
      undefined,
      'a directory in use as a live process cwd must not be movable'
    )
    assert.equal(existsSync(original), true, 'the original must remain intact after a blocked move attempt')
    assert.equal(readFileSync(path.join(original, 'payload.txt'), 'utf8'), 'locked content', 'content must not be corrupted/truncated')
  } finally {
    process.kill(holder.pid)
    await waitForExit(holder.pid, 5000)
  }

  // Once released, the SAME operation succeeds cleanly.
  const manifest = moveToQuarantine({ requestId: 'req-locked', actionClass: 'QUARANTINE_ARTIFACT', originalPath: original, mode: 'MOVE' }, { quarantineRoot: QUARANTINE_ROOT, clock })
  assert.equal(manifest.status, 'QUARANTINED')
  const persisted = readQuarantineManifest(QUARANTINE_ROOT, manifest.quarantineId)
  assert.equal(persisted.status, 'QUARANTINED')
})
