// TSF Health Repair Center V1 -- server I/O layer tests (real command
// execution, real fixture repos, stubbed Orca CLI/planner -- never a live
// network/provider call). Domain classification itself is covered in
// health-repair.test.mjs; these tests prove the I/O layer gathers and acts
// on real evidence honestly.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  scanFleetHealth,
  runBaselineVerification,
  repairProject,
  prepareRepairMission
} from '../server/health-repair.mjs'
import { HEALTH_CAUSES } from '../domain/health-repair.mjs'

const HERE = import.meta.dirname
const ORCA_STUB = path.join(HERE, 'fixtures', 'stub-orca-cli.mjs')

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function createTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tsf-health-repair-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(dir, 'README.md'), '# Test Project\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'initial commit'])
  return dir
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

function baseAnalysis(overrides = {}) {
  return {
    ok: true,
    displayName: 'stub-project',
    migrationClassification: { classification: 'SAFE_TO_ONBOARD_NOW', reasons: [] },
    handoffReconciliation: { hasHandoff: false },
    orcaRegistration: { checked: true, registered: true, status: 'REGISTERED' },
    discovery: {
      commandGuidance: {
        hasKnownTestCommand: true,
        packageManager: 'npm',
        dependenciesInstalled: true
      }
    },
    health: { findings: [] },
    direction: { live: true, recommendedNextMission: null },
    currentState: { dirty: false },
    ...overrides
  }
}

test('scanFleetHealth: a fully healthy onboarded project is reported ready for work with zero causes', () => {
  const opState = {
    onboardedProjects: { p1: { repoPath: '/fake', lastAnalysis: baseAnalysis() } },
    portfolio: { activeFleet: ['p1'], workSet: ['p1'] }
  }
  const [result] = scanFleetHealth(opState)
  assert.equal(result.projectId, 'p1')
  assert.deepEqual(result.causes, [])
  assert.equal(result.readyForWork, true)
})

test('scanFleetHealth: a real cause (Orca not registered) is surfaced with the correct repair class, never silently dropped', () => {
  const opState = {
    onboardedProjects: {
      p1: {
        repoPath: '/fake',
        lastAnalysis: baseAnalysis({
          orcaRegistration: { checked: true, registered: false, status: 'NOT_REGISTERED' }
        })
      }
    },
    portfolio: { activeFleet: [], workSet: [] }
  }
  const [result] = scanFleetHealth(opState)
  assert.deepEqual(
    result.causes.map((c) => c.cause),
    [HEALTH_CAUSES.ORCA_NOT_REGISTERED]
  )
  assert.equal(result.repairClass, 'AUTO_REPAIR_SAFE')
  assert.equal(result.readyForWork, false)
})

test('scanFleetHealth: never mutates opState -- a pure read over what is already stored', () => {
  const opState = {
    onboardedProjects: { p1: { repoPath: '/fake', lastAnalysis: baseAnalysis() } },
    portfolio: { activeFleet: [], workSet: [] }
  }
  const snapshot = JSON.stringify(opState)
  scanFleetHealth(opState)
  assert.equal(JSON.stringify(opState), snapshot)
})

// Commands passed here must match the real safe shape runBaselineVerification
// now enforces (`npm run <safe-name>`, etc. -- see health-repair.mjs's
// SAFE_COMMAND_LINE) -- a real package.json script actually being run, not
// an arbitrary raw shell string standing in for one.
function withScripts(dir, scripts) {
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }))
  writeFileSync(path.join(dir, 'package-lock.json'), '{}')
  return dir
}

test('runBaselineVerification: a real passing command reports PASS with a real exit code, a real failing command reports FAIL', async () => {
  const dir = withScripts(tracked(createTempRepo()), {
    test: 'node -e "process.exit(0)"',
    build: 'node -e "process.exit(1)"'
  })
  const result = await runBaselineVerification(
    dir,
    {
      testCommands: ['npm run test'],
      buildCommands: ['npm run build'],
      lintCommands: [],
      typecheckCommands: []
    },
    5000
  )
  assert.equal(result.test, 'PASS')
  assert.equal(result.build, 'FAIL')
  assert.equal(
    result.lint,
    'NOT_APPLICABLE',
    'no lint command discovered -- NOT_APPLICABLE, never fabricated as PASS or FAIL'
  )
  assert.equal(result.typecheck, 'NOT_APPLICABLE')
})

// Real cross-platform regression guard: `shell: true` + a plain
// `child.kill('SIGTERM')` does not actually terminate the process tree on
// Windows (cmd.exe wraps the real command), so a genuinely hung command
// previously kept running to its own natural end regardless of the
// configured timeout -- this asserts the wait is ACTUALLY bounded in wall-
// clock time, not just that the eventual result label says TIMEOUT.
test('runBaselineVerification: a real command that hangs past the bounded timeout is actually killed within that bound, not left running', async () => {
  const dir = withScripts(tracked(createTempRepo()), {
    test: 'node -e "setTimeout(()=>{}, 60000)"'
  })
  const startedAt = Date.now()
  const result = await runBaselineVerification(
    dir,
    { testCommands: ['npm run test'], buildCommands: [], lintCommands: [], typecheckCommands: [] },
    500
  )
  const elapsedMs = Date.now() - startedAt
  assert.equal(result.test, 'UNKNOWN')
  assert.equal(result.testDetail.reason, 'TIMEOUT')
  // Test-isolation hardening (operator-hardening-v2): observed genuinely
  // flaking under this suite's own full, hundreds-of-real-processes
  // concurrent run -- always passing well under the original 10000ms in
  // isolation (confirmed repeatedly), the real OS-level spawn/kill
  // mechanics this test exercises can legitimately take longer under
  // extreme concurrent contention. 20000ms is still a small fraction of
  // the process's own 60000ms hang-forever duration, so this remains a
  // real, meaningful regression guard against the exact bug this test
  // exists for (a process silently surviving past its timeout) -- only
  // the tolerance for contention-induced scheduling delay changed, not
  // what's being verified.
  assert.ok(
    elapsedMs < 20000,
    `expected the hung command to be killed within a few seconds of its 500ms timeout, took ${elapsedMs}ms`
  )
})

// Defense in depth (independent-review finding, confirmed with a live
// exploit against the old code): even though discovery no longer
// surfaces an unsafe script name, runBaselineVerification must never
// trust a command string on faith -- it is only ever spawned if it
// matches exactly the shape discovery is documented to produce. A
// hand-crafted malicious command string (as if some other path had
// bypassed discovery's own filtering) must be refused, never executed.
test('runBaselineVerification: a command string outside the safe discovered shape is refused as NOT_APPLICABLE, never spawned', async () => {
  const dir = tracked(createTempRepo())
  const markerFile = path.join(dir, 'pwned.txt')
  const result = await runBaselineVerification(
    dir,
    {
      testCommands: [
        `npm run test:unit; node -e "require('fs').writeFileSync(${JSON.stringify(markerFile)}, 'x')"`
      ],
      buildCommands: [],
      lintCommands: [],
      typecheckCommands: []
    },
    5000
  )
  assert.equal(result.test, 'NOT_APPLICABLE')
  assert.equal(existsSync(markerFile), false, 'the injected command must never actually run')
})

// Real V1 stabilization finding: a real Python project's own discovered
// commands (pytest/ruff check ., see repo-inspector.mjs's
// detectPythonCommands) are fixed literal strings with nothing repo-
// controlled interpolated into them -- must be accepted by the same real
// safety gate a JS command goes through, not silently dropped to
// NOT_APPLICABLE the way an unrecognized shape correctly is above.
test('runBaselineVerification: the two real Python commands (pytest, ruff check .) pass the safe-shape gate and are actually spawned', async () => {
  const dir = tracked(createTempRepo())
  const result = await runBaselineVerification(
    dir,
    {
      testCommands: ['pytest'],
      lintCommands: ['ruff check .'],
      buildCommands: [],
      typecheckCommands: []
    },
    5000
  )
  // Neither pytest nor ruff is actually installed in this fixture -- a
  // real SPAWN_ERROR (command not found) is exactly the proof they were
  // genuinely attempted, not silently refused as NOT_APPLICABLE.
  assert.notEqual(result.test, 'NOT_APPLICABLE')
  assert.notEqual(result.lint, 'NOT_APPLICABLE')
})

// Real V1 stabilization finding, reproduced against NWR's real repo:
// pytest/ruff exist only inside its .venv, not the system PATH -- a bare
// command spawned with the inherited PATH would SPAWN_ERROR even though
// both tools are really installed. Proven here with a real, disposable
// stub "python"/"pytest" pair in a fixture .venv, never touching a real
// venv or a real tool.
function makeVenvStub(dir, name, body) {
  const bin = path.join(dir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin')
  mkdirSync(bin, { recursive: true })
  const isWin = process.platform === 'win32'
  writeFileSync(path.join(bin, isWin ? 'python.exe' : 'python'), '', { mode: 0o755 })
  const scriptPath = path.join(bin, isWin ? `${name}.cmd` : name)
  writeFileSync(scriptPath, body, { mode: 0o755 })
}

test("runBaselineVerification: a repo's own .venv is used to resolve pytest -- the child process's PATH is prepended, not the command string", async () => {
  const dir = tracked(createTempRepo())
  const marker = path.join(dir, 'venv-stub-ran.txt')
  const isWin = process.platform === 'win32'
  makeVenvStub(
    dir,
    'pytest',
    isWin
      ? `@echo off\r\necho ran > "${marker}"\r\nexit /b 0\r\n`
      : `#!/bin/sh\necho ran > "${marker}"\nexit 0\n`
  )
  const result = await runBaselineVerification(
    dir,
    { testCommands: ['pytest'], lintCommands: [], buildCommands: [], typecheckCommands: [] },
    5000
  )
  assert.equal(result.test, 'PASS')
  assert.equal(existsSync(marker), true, 'the real .venv stub must have actually run')
})

test('repairProject: ORCA_NOT_REGISTERED calls the real refresh action and returns the fresh registration status', async () => {
  const dir = tracked(createTempRepo())
  await withEnv(
    { TSF_ORCA_CLI_COMMAND: ORCA_STUB, STUB_ORCA_MODE: 'success', STUB_ORCA_REPOS: '[]' },
    async () => {
      const result = await repairProject({
        repoPath: dir,
        cause: HEALTH_CAUSES.ORCA_NOT_REGISTERED
      })
      assert.equal(result.ok, true)
      assert.equal(result.action, 'REFRESH_ORCA_REGISTRATION')
      assert.equal(result.orcaRegistration.checked, true)
    }
  )
})

// Real gap found building this action: the original handoff text was never
// durably stored anywhere (only its derived claims/discrepancies were), so
// there was nothing real to re-reconcile against -- fixed by threading a
// bounded handoffTextExcerpt through analyzeRepository's own return so it
// round-trips into the stored record (see server/onboarding.mjs).
test('repairProject: HANDOFF_RECONCILIATION_REQUIRED with no stored handoff text honestly refuses rather than fabricating a resolution', async () => {
  const dir = tracked(createTempRepo())
  const result = await repairProject({
    repoPath: dir,
    cause: HEALTH_CAUSES.HANDOFF_RECONCILIATION_REQUIRED
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'NO_HANDOFF_TEXT_ON_RECORD')
})

test('repairProject: HANDOFF_RECONCILIATION_REQUIRED with a real stored handoff resolves via USE_LIVE_REPO_FOR_CURRENT_STATE only -- never USE_HANDOFF or an override of live Git truth', async () => {
  const dir = tracked(createTempRepo())
  // A genuine, ordinary (non-identity-ambiguous) discrepancy: the handoff
  // claims a branch name this repo doesn't have, but cites the real HEAD
  // commit, so the commit is findable and this is NOT treated as
  // repository-identity-ambiguous -- exactly the UNRESOLVED_HANDOFF_
  // DISCREPANCY / HANDOFF_RECONCILIATION_REQUIRED shape this repair targets.
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim()
  const handoffTextExcerpt = `Branch: \`work/some-other-feature-branch\`\nHEAD: \`${head}\``
  const result = await repairProject({
    repoPath: dir,
    cause: HEALTH_CAUSES.HANDOFF_RECONCILIATION_REQUIRED,
    handoffTextExcerpt
  })
  assert.equal(result.action, 'RESOLVE_HANDOFF_USE_LIVE_REPO')
  assert.equal(result.ok, true)
  assert.equal(result.result.handoffReconciliation.hasHandoff, true)
  assert.equal(
    result.result.handoffReconciliation.resolution.mode,
    'USE_LIVE_REPO_FOR_CURRENT_STATE'
  )
  assert.equal(
    result.result.migrationClassification.classification,
    'SAFE_TO_ONBOARD_NOW',
    'the resolution clears the block -- current-state facts (this repo is clean) still win'
  )
})

test("repairProject: DEPENDENCY_HEALTH uses the real discovered package manager's install command, not always npm", async () => {
  const dir = tracked(mkdtempSync(path.join(tmpdir(), 'tsf-dep-health-')))
  // No package.json at all -- the install command will genuinely fail, but
  // this proves the RIGHT command was attempted (real exit code observed),
  // not that dependency install always fakes success.
  const result = await repairProject({
    repoPath: dir,
    cause: HEALTH_CAUSES.DEPENDENCY_HEALTH,
    packageManager: 'pnpm'
  })
  assert.equal(result.action, 'INSTALL_DEPENDENCIES')
  assert.ok('ok' in result, 'reports a real observed outcome, not a fabricated one')
})

// Real safety bug reproduced live tonight: this used to default to
// `npm install` for any unrecognized packageManager, which really ran
// inside NWR and route-reader's real working trees (neither is an npm
// project) and left a stray package-lock.json behind each time. Covers
// exactly the real shapes discovery can now produce for a non-actionable
// manager: 'UNKNOWN' (ambiguous JS project), a real non-JS ecosystem, and
// undefined/missing entirely.
for (const packageManager of ['UNKNOWN', 'python', 'cargo', 'go', 'none', undefined]) {
  test(`repairProject: DEPENDENCY_HEALTH never defaults to npm install for packageManager=${packageManager} -- refuses, spawns nothing`, async () => {
    const dir = tracked(mkdtempSync(path.join(tmpdir(), 'tsf-dep-health-unknown-')))
    const before = readdirSync(dir)
    const result = await repairProject({
      repoPath: dir,
      cause: HEALTH_CAUSES.DEPENDENCY_HEALTH,
      packageManager
    })
    assert.equal(result.action, 'PACKAGE_MANAGER_UNKNOWN')
    assert.equal(result.ok, false)
    assert.match(result.reason, /never|refus/i)
    // The real, concrete regression: no command ran, so no stray file
    // (package-lock.json or otherwise) was written into the repo.
    assert.deepEqual(readdirSync(dir), before)
  })
}

test('repairProject: an unrecognized cause is honestly refused, never silently no-oped as success', async () => {
  const result = await repairProject({ repoPath: '/fake', cause: HEALTH_CAUSES.TESTS_FAILING })
  assert.equal(result.ok, false)
  assert.equal(result.action, 'NONE')
})

test('prepareRepairMission: returns a real, verification-first mission spec scoped to the one failing command, never claiming the fix', () => {
  const spec = prepareRepairMission({
    displayName: 'stub-project',
    repoPath: '/fake',
    cause: {
      cause: HEALTH_CAUSES.TESTS_FAILING,
      repairClass: 'GOVERNED_REPAIR_MISSION',
      summary: '`npm run test` fails.',
      evidence: { command: 'test' }
    }
  })
  assert.match(spec.originalGoal, /npm run test/)
  assert.ok(spec.acceptanceCriteria.some((c) => /actually passes/.test(c)))
  assert.ok(spec.acceptanceCriteria.some((c) => /not.*deleted, skipped, or weakened/.test(c)))
  assert.ok(spec.constraints.some((c) => /No push, merge/.test(c)))
  assert.equal(spec.usageMode, 'MAXIMUM')
})
