import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLEANUP_ACTION_CLASSES,
  V0_IMPLEMENTED_ACTION_CLASSES,
  actionClassTier,
  isKnownActionClass,
  isV0Implemented,
  requiresQuarantineFirst
} from '../domain/cleanup-action-taxonomy.mjs'

test('every action class is exactly STANDARD or ELEVATED', () => {
  for (const [name, def] of Object.entries(CLEANUP_ACTION_CLASSES)) {
    assert.ok(['STANDARD', 'ELEVATED'].includes(def.tier), `${name} has an invalid tier`)
  }
})

test('the 7 required STANDARD classes and 6 required ELEVATED classes are present, modeled separately', () => {
  const standard = Object.entries(CLEANUP_ACTION_CLASSES).filter(([, d]) => d.tier === 'STANDARD').map(([k]) => k)
  const elevated = Object.entries(CLEANUP_ACTION_CLASSES).filter(([, d]) => d.tier === 'ELEVATED').map(([k]) => k)
  assert.deepEqual(
    standard.sort(),
    [
      'CLEAR_SAFE_GENERATED_CACHE',
      'QUARANTINE_ARTIFACT',
      'REMOVE_DISPOSABLE_WORKTREE',
      'REMOVE_STALE_TEMPORARY_STATE',
      'RESTORE_QUARANTINE',
      'RETIRE_SESSION',
      'DELETE_LOCAL_MERGED_BRANCH'
    ].sort()
  )
  assert.deepEqual(
    elevated.sort(),
    [
      'ARBITRARY_FILESYSTEM_DELETION',
      'DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS',
      'GIT_PRUNE_GC',
      'PROCESS_TERMINATION',
      'REMOTE_BRANCH_DELETION',
      'REMOVE_DIRTY_WORKTREE'
    ].sort()
  )
})

test('isKnownActionClass rejects an invented class name -- no fuzzy matching', () => {
  assert.equal(isKnownActionClass('DELETE_EVERYTHING'), false)
  assert.equal(isKnownActionClass('RETIRE_SESSION'), true)
})

test('actionClassTier returns null for an unknown class, never a guessed tier', () => {
  assert.equal(actionClassTier('NOT_A_REAL_CLASS'), null)
  assert.equal(actionClassTier('REMOTE_BRANCH_DELETION'), 'ELEVATED')
})

test('isV0Implemented is true only for the 8 classes with a real executor wired', () => {
  assert.equal(V0_IMPLEMENTED_ACTION_CLASSES.length, 8)
  assert.equal(isV0Implemented('RETIRE_SESSION'), true)
  assert.equal(isV0Implemented('DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS'), true)
  assert.equal(isV0Implemented('ARBITRARY_FILESYSTEM_DELETION'), false)
  assert.equal(isV0Implemented('PROCESS_TERMINATION'), false)
  assert.equal(isV0Implemented('REMOTE_BRANCH_DELETION'), false)
  assert.equal(isV0Implemented('GIT_PRUNE_GC'), false)
  assert.equal(isV0Implemented('REMOVE_DIRTY_WORKTREE'), false)
})

test('requiresQuarantineFirst is true exactly for the reversible-by-quarantine classes', () => {
  assert.equal(requiresQuarantineFirst('REMOVE_DISPOSABLE_WORKTREE'), true)
  assert.equal(requiresQuarantineFirst('QUARANTINE_ARTIFACT'), true)
  assert.equal(requiresQuarantineFirst('DELETE_LOCAL_MERGED_BRANCH'), false)
  assert.equal(requiresQuarantineFirst('NOT_A_REAL_CLASS'), false)
})
