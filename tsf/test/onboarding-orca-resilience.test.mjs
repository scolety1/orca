// Real M7-migration-finding regressions for Orca registration lookup and
// live-planner direction retry resilience — split out of onboarding.test.mjs
// to stay under the repo's max-lines lint cap.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  analyzeRepository,
  refreshOrcaRegistrationStatus,
  retryDirectionAnalysis
} from '../server/onboarding.mjs'
import { findRegisteredOrcaRepo } from '../adapters/orca-cli-bridge.mjs'

const HERE = import.meta.dirname
const PLANNER_STUB = path.join(HERE, 'fixtures', 'stub-planner-cli.mjs')
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')
const NONEXISTENT = path.join(HERE, 'fixtures', 'does-not-exist-binary')

// Finding F1: forces HEALTHY host memory for every test in this file except
// the ones below that deliberately override deps.collectHostMemoryEvidence
// (which takes precedence) -- mirrors chat-dispatch-bridge.test.mjs's own
// convention, keeping this file's other assertions immune to a genuinely
// shared, loaded host.
process.env.TSF_RESOURCE_PRESSURE_TEST_TOTAL_BYTES = String(16 * 1024 ** 3)
process.env.TSF_RESOURCE_PRESSURE_TEST_FREE_BYTES = String(8 * 1024 ** 3)

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-orca-resilience-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# Test Project\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial commit'])
  return dir
}

async function withEnv(vars, fn) {
  const prior = {}
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key]
  }
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (prior[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prior[key]
      }
    }
  }
}

const BASE_ENV = {
  TSF_PLANNER_CLAUDE_COMMAND: PLANNER_STUB,
  TSF_PLANNER_CODEX_COMMAND: NONEXISTENT,
  STUB_MODE: 'success',
  TSF_ORCA_CLI_COMMAND: ORCA_STUB,
  STUB_ORCA_MODE: 'success',
  STUB_ORCA_REPOS: '[]'
}

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tracked(dir) {
  tempDirs.push(dir)
  return dir
}

test('findRegisteredOrcaRepo: case-normalized path variants resolve to the same real repo, not a duplicate', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success' }, async () => {
    const dir = tracked(mkdtempSync(path.join(tmpdir(), 'tsf-dedupe-')))
    await withEnv(
      {
        STUB_ORCA_REPOS: JSON.stringify([
          { id: 'x', path: dir.toUpperCase(), displayName: 'x', kind: 'git' }
        ])
      },
      async () => {
        const result = await findRegisteredOrcaRepo(dir)
        assert.equal(result.ok, true)
        assert.equal(
          result.registered,
          true,
          'an uppercase/lowercase path variant of the same real directory must match, not register a duplicate'
        )
      }
    )
  })
})

test('findRegisteredOrcaRepo: Windows 8.3 short-name path variants resolve to the same real repo (regression for realpathSync.native)', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success' }, async () => {
    const dir = tracked(mkdtempSync(path.join(tmpdir(), 'tsf-dedupe83-')))
    const longForm = realpathSync.native(dir)
    if (longForm === dir) {
      return // this machine's tmpdir() isn't 8.3-short-form here; the case-normalization test above still covers the mechanism
    }
    await withEnv(
      {
        STUB_ORCA_REPOS: JSON.stringify([
          { id: 'x', path: longForm, displayName: 'x', kind: 'git' }
        ])
      },
      async () => {
        const result = await findRegisteredOrcaRepo(dir) // query with the short form
        assert.equal(result.ok, true)
        assert.equal(
          result.registered,
          true,
          '8.3 short-name and long-name forms of the same real directory must match, not register a duplicate'
        )
      }
    )
  })
})

// --- Defect 3 (M7 real-migration finding): Orca status resilience ---
// Real Route Reader onboarding report: "Orca: unknown (Orca unreachable)"
// even though TSF itself is hosted inside a genuinely-running Orca. A single
// transient `orca repo list` failure must not collapse into the same
// "unavailable" shown when Orca genuinely isn't installed at all.

test('findRegisteredOrcaRepo: a transient timeout recovers via one bounded retry, reported as REGISTERED', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-orca-flaky-'))
  const counterFile = path.join(dir, 'flaky-counter')
  const repoDir = createTempRepo()
  tracked(repoDir)
  try {
    await withEnv(
      {
        TSF_ORCA_CLI_COMMAND: ORCA_STUB,
        STUB_ORCA_MODE: 'flaky-then-success',
        STUB_ORCA_FLAKY_COUNTER_FILE: counterFile,
        STUB_ORCA_REPOS: JSON.stringify([{ id: 'r1', path: repoDir, displayName: 'r1' }]),
        TSF_ORCA_CLI_TIMEOUT_MS: '300'
      },
      async () => {
        const result = await findRegisteredOrcaRepo(repoDir)
        assert.equal(result.ok, true)
        assert.equal(result.registered, true)
        assert.equal(result.status, 'REGISTERED')
      }
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('findRegisteredOrcaRepo: a persistent failure is reported as ORCA_TEMPORARILY_UNAVAILABLE, not silently retried forever', async () => {
  await withEnv(
    { TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'error', TSF_ORCA_CLI_TIMEOUT_MS: '300' },
    async () => {
      const result = await findRegisteredOrcaRepo('/tmp/whatever')
      assert.equal(result.ok, false)
      assert.equal(result.status, 'ORCA_TEMPORARILY_UNAVAILABLE')
    }
  )
})

// Note: reaching CLI_UNAVAILABLE (-> status ORCA_UNKNOWN) specifically
// requires resolveEntry() to find no candidate at all; candidateEntries()'s
// final fallback candidate ({ command: 'orca' }) is unconditionally accepted
// by resolveEntry()'s own `candidate.command === 'orca'` check regardless of
// whether it actually exists on PATH, so a bad/missing binary is always
// reported via a real spawn attempt (SPAWN_ERROR -> ORCA_TEMPORARILY_UNAVAILABLE)
// rather than CLI_UNAVAILABLE in practice — pre-existing resolveEntry
// behavior, out of scope for this fix. The mapping itself is still correct
// and exercised by the SPAWN_ERROR case below.
test('findRegisteredOrcaRepo: a missing/unresolvable CLI binary never fabricates a registered result', async () => {
  await withEnv({ TSF_ORCA_CLI_COMMAND: NONEXISTENT }, async () => {
    const result = await findRegisteredOrcaRepo('/tmp/whatever')
    assert.equal(result.ok, false)
    assert.equal(result.registered, undefined)
    assert.ok(['ORCA_TEMPORARILY_UNAVAILABLE', 'ORCA_UNKNOWN'].includes(result.status))
  })
})

test('findRegisteredOrcaRepo: a genuinely not-registered repo is reported as NOT_REGISTERED, distinct from any unavailable status', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv(
    { TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success', STUB_ORCA_REPOS: '[]' },
    async () => {
      const result = await findRegisteredOrcaRepo(repoDir)
      assert.equal(result.ok, true)
      assert.equal(result.registered, false)
      assert.equal(result.status, 'NOT_REGISTERED')
    }
  )
})

test('refreshOrcaRegistrationStatus: re-checks Orca registration alone, without re-running discovery/health/migration/the planner', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv(
    {
      TSF_ORCA_CLI_COMMAND: ORCA_STUB,
      STUB_ORCA_MODE: 'success',
      STUB_ORCA_REPOS: JSON.stringify([{ id: 'r1', path: repoDir, displayName: 'r1' }])
    },
    async () => {
      const result = await refreshOrcaRegistrationStatus(repoDir)
      assert.equal(result.ok, true)
      assert.equal(result.orcaRegistration.registered, true)
      assert.equal(result.orcaRegistration.status, 'REGISTERED')
      // Only the orca registration shape — no repository/health/migration/direction facts.
      assert.deepEqual(Object.keys(result).sort(), ['ok', 'orcaRegistration'])
    }
  )
})

test('analyzeRepository: a transient Orca hiccup never changes Health or migration classification', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  const healthyRun = await withEnv(
    {
      ...BASE_ENV,
      TSF_ORCA_CLI_COMMAND: ORCA_STUB,
      STUB_ORCA_MODE: 'success',
      STUB_ORCA_REPOS: '[]'
    },
    () => analyzeRepository({ repoPath: repoDir })
  )
  const orcaDownRun = await withEnv(
    {
      ...BASE_ENV,
      TSF_ORCA_CLI_COMMAND: ORCA_STUB,
      STUB_ORCA_MODE: 'error',
      TSF_ORCA_CLI_TIMEOUT_MS: '300'
    },
    () => analyzeRepository({ repoPath: repoDir })
  )
  assert.equal(orcaDownRun.ok, true)
  // Health and migration classification come from Git/filesystem facts
  // alone, computed before the Orca check is ever awaited — a transient
  // Orca outage must produce identical results for both (aside from the
  // observedAt timestamp, which naturally differs between the two calls).
  assert.deepEqual(
    { ...orcaDownRun.health, observedAt: null },
    { ...healthyRun.health, observedAt: null }
  )
  assert.deepEqual(orcaDownRun.migrationClassification, healthyRun.migrationClassification)
  assert.equal(orcaDownRun.orcaRegistration.checked, false)
  assert.equal(orcaDownRun.orcaRegistration.status, 'ORCA_TEMPORARILY_UNAVAILABLE')
  assert.notEqual(orcaDownRun.orcaRegistration.status, healthyRun.orcaRegistration.status)
})

// --- Defect 4 (M7 real-migration finding): retryDirectionAnalysis re-runs ---
// only the live planner call, never re-persisting or re-checking Orca.

test('retryDirectionAnalysis: re-runs only the planner call against freshly-read repo facts', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv(BASE_ENV, async () => {
    const result = await retryDirectionAnalysis({ repoPath: repoDir })
    assert.equal(result.ok, true)
    assert.equal(result.direction.live, true)
    assert.deepEqual(Object.keys(result).sort(), ['direction', 'ok'])
  })
})

test('retryDirectionAnalysis: a persistent planner failure is an honest fallback, never a fabricated mission', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv({ ...BASE_ENV, STUB_MODE: 'provider-error' }, async () => {
    const result = await retryDirectionAnalysis({ repoPath: repoDir })
    assert.equal(result.ok, true)
    assert.equal(result.direction.live, false)
    assert.equal(result.direction.recommendedNextMission, null)
  })
})

// Finding F1: retryDirectionAnalysis was one of 5 real invokeLiveStructuredAnalysis
// call sites never consulting the Resource Pressure Governor before spawning
// a heavyweight LLM-CLI child process.
test('retryDirectionAnalysis: CRITICAL host memory refuses the planner spawn honestly -- degrades direction, never throws', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  let gateConsulted = false
  await withEnv(BASE_ENV, async () => {
    const result = await retryDirectionAnalysis({
      repoPath: repoDir,
      deps: {
        collectHostMemoryEvidence: () => {
          gateConsulted = true
          return { availableBytes: 2 * 1024 ** 3 } // 2 GB free -> CRITICAL
        }
      }
    })
    assert.equal(result.ok, true, 'the read-only call itself never fails -- only direction degrades')
    assert.equal(result.direction.live, false)
    assert.equal(result.direction.unavailableReason, 'RESOURCE_PRESSURE_REFUSED')
    assert.equal(result.direction.recommendedNextMission, null)
  })
  assert.equal(gateConsulted, true, 'the governor gate was actually consulted, not bypassed')
})

test('retryDirectionAnalysis: HEALTHY host memory still dispatches the real planner call normally', async () => {
  const repoDir = createTempRepo()
  tracked(repoDir)
  await withEnv(BASE_ENV, async () => {
    const result = await retryDirectionAnalysis({
      repoPath: repoDir,
      deps: { collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) } // 8 GB free -> HEALTHY
    })
    assert.equal(result.ok, true)
    assert.equal(result.direction.live, true)
  })
})
