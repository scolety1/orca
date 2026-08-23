// classifyMigration's PATH-based SENSITIVE detection -- split out of
// onboarding.test.mjs to stay under the repo's max-lines lint cap.
// Prose-based sensitivity signals (negation/future-marker clause scoping)
// stay in onboarding.test.mjs.
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyMigration } from '../domain/onboarding.mjs'

test('classifyMigration: sensitive paths force SENSITIVE regardless of cleanliness', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: ['.env', 'src/index.js'],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
})

// Real V1 stabilization finding (fleet-wide false positive, found refreshing
// real Known Projects): a committed `.env.example`/`.env.sample` template
// (placeholder values, the recommended safe convention) was flagged
// identically to a real `.env` file, wrongly forcing SENSITIVE. A real
// `.env` variant (bare, or a real environment like `.env.local`/
// `.env.production`) must still force SENSITIVE.
test('classifyMigration: a committed .env.example/.env.sample template is not itself SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: ['app/.env.example', '.env.sample', 'src/index.js'],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.notEqual(result.classification, 'SENSITIVE')
})

test('classifyMigration: a real .env variant (bare, .local, .production) still forces SENSITIVE', () => {
  for (const envPath of ['.env', '.env.local', '.env.production']) {
    const result = classifyMigration({
      gitRepositoryFound: true,
      repositoryUnavailable: false,
      trackedAndUntrackedPaths: [envPath, 'src/index.js'],
      dirty: false,
      discoveryConfidence: 'HIGH',
      activeGitOperation: false,
      handoffConflict: false
    })
    assert.equal(result.classification, 'SENSITIVE', `${envPath} must still be SENSITIVE`)
  }
})

// Real V1 stabilization finding (fleet-wide, found refreshing real Known
// Projects): `.*\bcredentials?\b.*` / `.*\bsecrets?\b.*` match the word
// ANYWHERE in a path, firing on a project's own security-tooling
// filenames and on vendored third-party dependency internals -- these are
// the exact real paths observed in real fleet evidence tonight.
test("classifyMigration: a project's own security-tooling/test filenames are not themselves SENSITIVE", () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [
      'scripts/secret-scan.mjs',
      'live/secret-safe-logger.mjs',
      'tests/secret-scan-private-exclusion.test.mjs',
      'tests/verify-rotate-credential-gate.test.mjs',
      'src/index.js'
    ],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.notEqual(result.classification, 'SENSITIVE')
})

test('classifyMigration: vendored third-party dependency internals are not themselves SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [
      '.codex-cfbd-test-deps/pydantic_settings/sources/providers/secrets.py',
      '.codex-cfbd-test-deps/streamlit/runtime/credentials.py',
      '.pycache-cfbd-admission/Users/codex-agent/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/Lib/secrets.cpython-312.pyc',
      'node_modules/some-package/lib/credentials.js',
      '.venv/Lib/site-packages/streamlit/runtime/secrets.cpython-314.pyc',
      'src/index.js'
    ],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.notEqual(result.classification, 'SENSITIVE')
})

test('classifyMigration: real secret-like files are still SENSITIVE -- the narrowing never weakens genuine detection', () => {
  const genuinelySensitive = [
    'secrets.json',
    '.aws/credentials',
    'config/my-secret-key.pem',
    'id_rsa',
    'id_ed25519',
    // A plain, non-vendored, non-tooling credentials file -- no scan/gate/
    // audit/lint/verify/safe marker, no vendor path, not a test file.
    'config/credentials.yml'
  ]
  for (const p of genuinelySensitive) {
    const result = classifyMigration({
      gitRepositoryFound: true,
      repositoryUnavailable: false,
      trackedAndUntrackedPaths: [p, 'src/index.js'],
      dirty: false,
      discoveryConfidence: 'HIGH',
      activeGitOperation: false,
      handoffConflict: false
    })
    assert.equal(result.classification, 'SENSITIVE', `${p} must still be SENSITIVE`)
  }
})

// Adversarial: a security-tooling-shaped name mixed in with a genuinely
// unrelated real secret must not let the real one slip through -- the
// exclusion is per-path, not per-project.
test('classifyMigration: a real secret alongside an excluded tooling filename in the SAME project is still SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: ['scripts/secret-scan.mjs', '.aws/credentials', 'src/index.js'],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
  assert.ok(
    result.evidence.sensitivePaths.includes('.aws/credentials'),
    'the real secret must still be named as evidence even though a sibling tooling file was excluded'
  )
})
