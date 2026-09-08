// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part C: pure
// decision function coverage -- mission's own required scenarios.
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCanonicalBaseRef } from '../domain/project-canonical-base.mjs'

test('a main-based repo resolves via the standard default', () => {
  const result = resolveCanonicalBaseRef({
    explicitConfiguredRef: null,
    repoDefaultBranch: 'main',
    repoHasStandardDefault: true
  })
  assert.deepEqual(result, { resolved: true, ref: 'main', source: 'REPO_STANDARD_DEFAULT' })
})

test('a master-based repo resolves via the standard default', () => {
  const result = resolveCanonicalBaseRef({
    explicitConfiguredRef: null,
    repoDefaultBranch: 'master',
    repoHasStandardDefault: true
  })
  assert.deepEqual(result, { resolved: true, ref: 'master', source: 'REPO_STANDARD_DEFAULT' })
})

test('an explicit-base-configured repo: explicit wins even when a standard default also exists', () => {
  const result = resolveCanonicalBaseRef({
    explicitConfiguredRef: 'release/2026',
    repoDefaultBranch: 'main',
    repoHasStandardDefault: true
  })
  assert.deepEqual(result, { resolved: true, ref: 'release/2026', source: 'EXPLICIT_CONFIGURED' })
})

test('a repo with genuinely no standard default and no explicit config fails closed, never a lexical guess', () => {
  const result = resolveCanonicalBaseRef({
    explicitConfiguredRef: null,
    repoDefaultBranch: 'work/some-feature',
    repoHasStandardDefault: false
  })
  assert.equal(result.resolved, false)
  assert.equal(result.reason, 'NO_RESOLVABLE_CANONICAL_BASE')
})

test('a non-standard repoDefaultBranch value is never trusted even if repoHasStandardDefault were mistakenly true', () => {
  const result = resolveCanonicalBaseRef({
    explicitConfiguredRef: null,
    repoDefaultBranch: 'work/foo',
    repoHasStandardDefault: true
  })
  assert.equal(result.resolved, false)
  assert.equal(result.reason, 'NO_RESOLVABLE_CANONICAL_BASE')
})
