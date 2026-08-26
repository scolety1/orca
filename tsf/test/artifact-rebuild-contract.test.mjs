import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyArtifactRebuildNeeds } from '../domain/artifact-rebuild-contract.mjs'

test('a UI-only source change requires a rebuild, not a backend restart', () => {
  const result = classifyArtifactRebuildNeeds(['tsf/ui/src/pages/CommandPage.tsx'])
  assert.equal(result.needsUiRebuild, true)
  assert.equal(result.needsBackendRestart, false)
  assert.equal(result.docsOrTestsOnly, false)
})

test('a backend/server change requires a restart, not a UI rebuild', () => {
  const result = classifyArtifactRebuildNeeds(['tsf/server/http-server.mjs'])
  assert.equal(result.needsUiRebuild, false)
  assert.equal(result.needsBackendRestart, true)
})

test('a domain/adapters change requires a restart, same as server/', () => {
  const result = classifyArtifactRebuildNeeds([
    'tsf/domain/keep-going.mjs',
    'tsf/adapters/orca-cli-bridge.mjs'
  ])
  assert.equal(result.needsBackendRestart, true)
  assert.equal(result.needsUiRebuild, false)
})

test('docs/tests-only changes need neither -- no unnecessary restart', () => {
  const result = classifyArtifactRebuildNeeds(['tsf/test/http-command.test.mjs', 'tsf/docs/M15.md'])
  assert.equal(result.needsUiRebuild, false)
  assert.equal(result.needsBackendRestart, false)
  assert.equal(result.docsOrTestsOnly, true)
})

test('a mixed changeset requires both, and an empty changeset is honestly neither', () => {
  const mixed = classifyArtifactRebuildNeeds(['tsf/ui/src/App.tsx', 'tsf/server/http-server.mjs'])
  assert.equal(mixed.needsUiRebuild, true)
  assert.equal(mixed.needsBackendRestart, true)

  const empty = classifyArtifactRebuildNeeds([])
  assert.equal(empty.needsUiRebuild, false)
  assert.equal(empty.needsBackendRestart, false)
  assert.equal(
    empty.docsOrTestsOnly,
    false,
    'an empty changeset is not the same claim as "docs/tests only"'
  )
})

test('an unrecognized path is never silently treated as inert -- it is flagged and conservatively requires both', () => {
  const result = classifyArtifactRebuildNeeds(['tsf/some-new-directory/thing.mjs'])
  assert.equal(result.needsUiRebuild, true)
  assert.equal(result.needsBackendRestart, true)
  assert.deepEqual(result.unclassified, ['tsf/some-new-directory/thing.mjs'])
})
