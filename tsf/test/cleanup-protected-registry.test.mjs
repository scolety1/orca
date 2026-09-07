import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyProtectedRegistry,
  isCanonicalProtectedBranch,
  isProtectedBranch,
  isProtectedPath,
  mergeProtectedRegistry
} from '../domain/cleanup-protected-registry.mjs'

test('canonical branch names are always protected, regardless of registry content', () => {
  assert.equal(isCanonicalProtectedBranch('main'), true)
  assert.equal(isCanonicalProtectedBranch('tsf/main'), true)
  assert.equal(isCanonicalProtectedBranch('master'), true)
  assert.equal(isCanonicalProtectedBranch('feature/x'), false)
  assert.equal(isCanonicalProtectedBranch(null), false)
})

test('isProtectedBranch checks canonical names first, then the registry', () => {
  const registry = { paths: [], branches: ['tsf/feature/nwr-historical-preservation'] }
  assert.equal(isProtectedBranch('main', registry), true)
  assert.equal(isProtectedBranch('tsf/feature/nwr-historical-preservation', registry), true)
  assert.equal(isProtectedBranch('tsf/feature/some-disposable-branch', registry), false)
})

test('isProtectedPath: exact match and nested containment both protect; a sibling with a shared prefix does not', () => {
  const registry = { paths: ['C:/NWR'], branches: [] }
  assert.equal(isProtectedPath('C:/NWR', registry), true)
  assert.equal(isProtectedPath('C:/NWR/Niners-War-Room', registry), true)
  assert.equal(isProtectedPath('C:/NWR_HISTORICAL_DATA', registry, { caseInsensitiveFs: false }), false, 'prefix-collision sibling must not match')
})

test('isProtectedPath is case-insensitive on Windows-shaped comparisons by default', () => {
  const registry = { paths: ['C:/TSF_ORCA'], branches: [] }
  assert.equal(isProtectedPath('c:/tsf_orca/some/nested/path', registry, { caseInsensitiveFs: true }), true)
})

test('isProtectedPath fails closed to false (not true) on an empty registry -- absence of protection is not silently assumed to BE protection, the caller must still evaluate other checks', () => {
  assert.equal(isProtectedPath('C:/anything', emptyProtectedRegistry()), false)
  assert.equal(isProtectedPath(null, { paths: ['C:/x'], branches: [] }), false)
})

test('mergeProtectedRegistry is additive-only -- neither side can drop an entry the other already had', () => {
  const a = { paths: ['C:/A'], branches: ['branch-a'] }
  const b = { paths: ['C:/B'], branches: ['branch-b'] }
  const merged = mergeProtectedRegistry(a, b)
  assert.deepEqual(merged.paths.sort(), ['C:/A', 'C:/B'])
  assert.deepEqual(merged.branches.sort(), ['branch-a', 'branch-b'])
})

test('mergeProtectedRegistry with an undefined/empty caller-supplied side still keeps the defaults intact', () => {
  const defaults = { paths: ['C:/TSF_ORCA', 'C:/NWR'], branches: [] }
  const merged = mergeProtectedRegistry(defaults, undefined)
  assert.deepEqual(merged.paths.sort(), ['C:/NWR', 'C:/TSF_ORCA'])
})
