// Fleet Dispatch Readiness + Explicit Command Adoption V1, Part E: confirms
// registerOrcaRepo (adapters/orca-cli-bridge.mjs) is real and callable, and
// proves the intended real usage -- a NOT_REGISTERED repo really gets added,
// an already-REGISTERED repo is a real idempotent no-op, and a genuine CLI
// error is surfaced honestly. Against the SAME stub CLI other bridge tests
// already use (test/fixtures/stub-orca-cli.mjs) -- never the real Orca CLI,
// never a real registration call against C:\Dev\easylifehq.github.io or any
// other real repo. Real EasyLife registration is a later, separate,
// coordinator-supervised wave, not this one.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

process.env.TSF_ORCA_CLI_COMMAND = path.join(import.meta.dirname, 'fixtures', 'stub-orca-cli.mjs')
process.env.STUB_ORCA_MODE = 'success'

const { findRegisteredOrcaRepo, registerOrcaRepo } = await import('../adapters/orca-cli-bridge.mjs')

test.afterEach(() => {
  delete process.env.STUB_ORCA_REPOS
})

test('findRegisteredOrcaRepo: a repo not present in `orca repo list` is honestly NOT_REGISTERED', async () => {
  process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'repo-a', path: 'C:/some/other/repo' }])
  const result = await findRegisteredOrcaRepo('C:/fixture/not-registered-repo')
  assert.equal(result.ok, true)
  assert.equal(result.registered, false)
  assert.equal(result.status, 'NOT_REGISTERED')
})

test('registerOrcaRepo: a real, callable registration -- a NOT_REGISTERED repo genuinely gets added via `orca repo add`', async () => {
  process.env.STUB_ORCA_REPOS = JSON.stringify([])
  const result = await registerOrcaRepo('C:/fixture/newly-registered-repo')
  assert.equal(result.ok, true)
  assert.equal(result.alreadyRegistered, false)
  assert.equal(result.repo.path, 'C:/fixture/newly-registered-repo')
  assert.equal(result.repo.id, 'stub-new-repo-id')
})

test('registerOrcaRepo: idempotent -- an ALREADY-registered repo is a real no-op, never a duplicate `repo add`', async () => {
  const target = 'C:/fixture/already-registered-repo'
  process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'existing-repo-id', path: target }])
  const result = await registerOrcaRepo(target)
  assert.equal(result.ok, true)
  assert.equal(result.alreadyRegistered, true)
  assert.equal(result.repo.id, 'existing-repo-id')
})

test('registerOrcaRepo: a genuine CLI error surfaces honestly, never a fabricated success', async () => {
  process.env.STUB_ORCA_MODE = 'error'
  const result = await registerOrcaRepo('C:/fixture/whatever')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'CLI_ERROR')
  process.env.STUB_ORCA_MODE = 'success'
})

test('findRegisteredOrcaRepo: Windows path-variant normalization -- a slash/case-differing real path is still recognized as the same repo', async () => {
  process.env.STUB_ORCA_REPOS = JSON.stringify([{ id: 'repo-b', path: 'C:\\Fixture\\Case-Repo' }])
  const result = await findRegisteredOrcaRepo('c:/fixture/case-repo')
  assert.equal(result.ok, true)
  assert.equal(result.registered, true)
  assert.equal(result.repo.id, 'repo-b')
})
