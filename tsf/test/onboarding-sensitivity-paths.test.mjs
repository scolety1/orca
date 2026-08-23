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

// Round 2 (independent adversarial review, RED): "safe" as a bare marker
// word exempted real credential-shaped filenames with no actual tooling
// behavior. A file that pairs "secret" with "safe" but carries none of the
// real tooling verbs (scan/gate/audit/lint/verify) must stay SENSITIVE —
// a conservative residual false positive is acceptable; a real bypass is
// not. This is the one real-evidence path from round 1 that is no longer
// exempted.
test('classifyMigration: a bare "safe"-named file with no real tooling verb stays SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: ['live/secret-safe-logger.mjs', 'src/index.js'],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
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

// Round 2 (independent adversarial review, RED): the vendored-path
// exclusion originally fired on any file inside node_modules/.venv/vendor
// regardless of its own name, and "vendor" itself is ambiguous (a
// project's own third-party-*service* credentials, e.g.
// vendor/stripe/credentials.json, are not a vendored *dependency*). It now
// requires the file's own module-name token to be EXACTLY
// secret(s)/credential(s) -- the real vendored-package shape -- so a
// compound-named file living in the same directories, including the exact
// accidental-commit scenario this system exists to catch, still SENSITIVE.
test('classifyMigration: a compound-named secret file inside node_modules/.venv is still SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [
      '.venv/local-project-secrets.txt',
      'node_modules/.cache/build-credentials.json',
      'src/index.js'
    ],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
  assert.ok(result.evidence.sensitivePaths.includes('.venv/local-project-secrets.txt'))
  assert.ok(result.evidence.sensitivePaths.includes('node_modules/.cache/build-credentials.json'))
})

// "vendor" was removed from the vendored-directory marker outright (round
// 2) -- it is not a package-manager-owned directory name the way
// node_modules/.venv/site-packages are, so a project's own vendor
// integration credentials must never be exempted by it.
test('classifyMigration: a real credential file under a "vendor" directory is still SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [
      'vendor/stripe/credentials.json',
      'vendor/my-real-secrets.json',
      'src/index.js'
    ],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
  assert.ok(result.evidence.sensitivePaths.includes('vendor/stripe/credentials.json'))
  assert.ok(result.evidence.sensitivePaths.includes('vendor/my-real-secrets.json'))
})

// The standalone .pyc/.pyo carve-out was removed outright (round 2) -- it
// exempted a compiled-artifact-NAMED file anywhere in the repo, not just
// inside a real vendored dependency directory.
test('classifyMigration: a .pyc file outside a vendored directory is still SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: ['leaked-credentials.pyc', 'src/index.js'],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
})

// The standalone .test./.spec. carve-out was removed outright (round 2) --
// it exempted a real hardcoded-credentials test fixture on filename shape
// alone, with no actual tooling-verb marker present.
test('classifyMigration: a *.test.js file with no real tooling verb stays SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: ['credentials.test.js', 'src/index.js'],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
})

// Round 3 (independent adversarial review, RED): the SAME flaw round 2
// fixed for "safe" applied identically to audit/gate/lint/verify -- a
// human-facing data export can pair any of those words with "credential"/
// "secret" with no tooling behavior. Now requires the marker word to sit
// directly hyphen/underscore-adjacent to the secret/credential word AND
// the file to carry a source/script extension, never a data/export one.
test('classifyMigration: a data export merely pairing a tooling word with "credential"/"secret" stays SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [
      'exports/credentials-audit-export.json',
      'exports/credential-gate-export.json',
      'exports/identity-verify-credentials.json',
      'exports/secret-lint-report.json',
      'src/index.js'
    ],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
  assert.equal(result.evidence.sensitivePaths.length, 4)
})

// Round 3 (independent adversarial review, RED): the module-token check
// stripped only the FIRST dot-segment, so a multi-part data filename could
// fake an exact module-name match (secret.config.json, credentials.backup.
// pem). Now also requires the file's own real extension to be a source/
// bytecode one -- never a data/config/credential-storage format.
test('classifyMigration: a multi-part data filename faking an exact module-name match stays SENSITIVE', () => {
  const result = classifyMigration({
    gitRepositoryFound: true,
    repositoryUnavailable: false,
    trackedAndUntrackedPaths: [
      'node_modules/pkg/secret.config.json',
      '.venv/credentials.backup.pem',
      'src/index.js'
    ],
    dirty: false,
    discoveryConfidence: 'HIGH',
    activeGitOperation: false,
    handoffConflict: false
  })
  assert.equal(result.classification, 'SENSITIVE')
  assert.ok(result.evidence.sensitivePaths.includes('node_modules/pkg/secret.config.json'))
  assert.ok(result.evidence.sensitivePaths.includes('.venv/credentials.backup.pem'))
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
