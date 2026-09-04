import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cascadedFromWorkSet } from './membership-tier-copy.ts'

test('cascadedFromWorkSet: a project removed from Active Fleet that was also in the Work Set is reported', () => {
  assert.deepEqual(cascadedFromWorkSet(['a', 'b'], ['b']), ['b'])
})

test('cascadedFromWorkSet: a project removed from Active Fleet that was never in the Work Set is not reported', () => {
  assert.deepEqual(cascadedFromWorkSet(['a'], ['b']), [])
})

test('cascadedFromWorkSet: a Work Set project skipped by the removal (not in applied) is not reported', () => {
  // e.g. skipped by the server for an unrelated reason -- applied is the
  // real source of truth, not the pre-action selection.
  assert.deepEqual(cascadedFromWorkSet([], ['a']), [])
})

test('cascadedFromWorkSet: empty inputs cascade nothing', () => {
  assert.deepEqual(cascadedFromWorkSet([], []), [])
})
