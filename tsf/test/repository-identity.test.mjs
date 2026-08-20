import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepositoryIdentity } from '../server/repository-identity.mjs'

const SHA_PATTERN = /^[0-9a-f]{40}$/

test('resolves the real repository identity for this actual repo -- a genuine read-only proof, not a fabricated shape', async () => {
  const result = await resolveRepositoryIdentity(process.cwd())
  assert.equal(result.ok, true)
  assert.match(result.identity.head, SHA_PATTERN)
  assert.match(result.identity.tree, SHA_PATTERN)
  assert.ok(result.identity.root.length > 0)
  assert.ok(result.identity.branch.length > 0)
})

test('a nonexistent path fails honestly rather than fabricating an identity', async () => {
  const result = await resolveRepositoryIdentity('C:/definitely-not-a-real-path-xyz-987654321')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'REPOSITORY_UNAVAILABLE')
})

test('a real directory that is not a git repository fails honestly', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-repo-identity-test-'))
  try {
    const result = await resolveRepositoryIdentity(dir)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'NOT_A_GIT_REPOSITORY')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty/undefined path is rejected the same as a nonexistent one', async () => {
  const result = await resolveRepositoryIdentity(undefined)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'REPOSITORY_UNAVAILABLE')
})
