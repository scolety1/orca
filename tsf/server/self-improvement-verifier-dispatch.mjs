// Native Self-Improvement Loop V1, Phase 5: the REAL, independent verifier.
// Gathers real evidence (git diff, a targeted `node --test` run, the
// finding's own reproduction command re-executed against the candidate
// worktree) and hands it to the pure verdict composer
// (domain/self-improvement-verifier-checks.mjs). Every side effect is
// dependency-injected -- no real Codex/Claude process, and no real git
// call outside a genuinely isolated worktree, is ever exercised by this
// program's own test suite.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import {
  buildVerifierVerdict,
  checkAuthorityEnvelopeRespected,
  checkDuplicateArchitectureHeuristic,
  checkForbiddenSurfaceTouched,
  checkSiblingWorktreesUntouched,
  checkVerifierIndependence
} from '../domain/self-improvement-verifier-checks.mjs'
import { resolveIndependentVerifierRole } from '../domain/self-improvement-provider-independence.mjs'
import { resolveRole } from '../domain/routing.mjs'
import { listAddedFiles, listCanonicalFileBasenames, listChangedFiles, snapshotSiblingWorktreeStatuses } from './self-improvement-worktree.mjs'
import providerRoleMappings from '../routing/provider-role-mappings.v1.json' with { type: 'json' }
import launchProfiles from '../providers/launch-profiles.v1.json' with { type: 'json' }

const TEST_TIMEOUT_MS = 5 * 60 * 1000

// A finding's `reproduction` is deliberately detector-shaped/free-form
// (self-improvement-finding.mjs) -- the ONE mechanical convention this
// verifier understands is an explicit `command` string. Anything else is
// honestly reported as not mechanically checkable rather than guessed at
// (fail-closed, matches this program's own "unknown must never be coerced
// into a safe-looking default" rule).
export function resolveMechanicalCommand(reproduction) {
  return typeof reproduction?.command === 'string' && reproduction.command.trim() ? reproduction.command.trim() : null
}

// `shell: true` (a single command STRING, not an argv array) -- Node's own
// documented cross-platform shell-string execution (/bin/sh -c on POSIX,
// ComSpec/cmd.exe on Windows). A manual `cmd.exe /d /s /c <string>`
// invocation was tried first and found to mis-escape a command that itself
// contains double-quoted arguments (e.g. `node --test "tsf/test/x.mjs"` or
// `node -e "process.exit(1)"`) -- /S's own quote-stripping rule rewrites
// the inner quotes, silently truncating the real command to something that
// exits 0 regardless of the real script's outcome. `shell: true` avoids
// building that command line by hand entirely and was verified to
// propagate a real non-zero exit code correctly with nested quotes.
// Real, reproduced gap: when the reproduction/regression command is
// itself `node --test ...` (this program's own convention), and the
// PROCESS RUNNING THIS VERIFIER is itself under `node --test` (as this
// program's own test suite always is, and potentially a real deployment
// supervised by a test/CI runner), the child inherits NODE_TEST_CONTEXT
// from process.env and Node's OWN test runner silently SKIPS the nested
// run as a detected recursion, exiting 0 regardless of the real target
// test's outcome -- reproduced live: a genuinely failing regression test
// was reported as a false PASS until this fix. Stripped unconditionally,
// not just in tests, since a real production TSF process running under a
// supervisor that itself set NODE_TEST_CONTEXT would hit the identical
// silent-skip bug.
function childEnvWithoutTestRecursionGuard() {
  const { NODE_TEST_CONTEXT: _1, NODE_TEST_WORKER_ID: _2, ...rest } = process.env
  return rest
}

export function runCommand(command, cwd, deps) {
  const run = deps.spawnSync ?? spawnSync
  const env = deps.env ?? childEnvWithoutTestRecursionGuard()
  const result = run(command, { cwd, env, encoding: 'utf8', windowsHide: true, shell: true, timeout: deps.testTimeoutMs ?? TEST_TIMEOUT_MS })
  return { passed: result.status === 0 && !result.error, exitCode: result.status ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// SECURITY: regression targets are resolved from candidateFixScope.filesHint
// (detector-supplied, untrusted text) -- unlike `reproduction.command`
// (a single trusted shell string the detector deliberately authored), a
// LIST of file-path-shaped strings must never be concatenated into a shell
// command line. `node --test "${p}"`-style string-building was found to let
// a crafted hint (e.g. containing an embedded `"` plus a shell metachar)
// break out of its own quoting and run an arbitrary command on the HOST,
// entirely outside the isolated worktree -- reproduced live. Fixed by
// passing each target as its own argv element with `shell` NEVER set, so no
// shell ever parses/interprets the string content.
export function runRegressionTests(targets, cwd, deps) {
  const run = deps.spawnSync ?? spawnSync
  const env = deps.env ?? childEnvWithoutTestRecursionGuard()
  const result = run(process.execPath, ['--test', ...targets], { cwd, env, encoding: 'utf8', windowsHide: true, timeout: deps.testTimeoutMs ?? TEST_TIMEOUT_MS })
  return { passed: result.status === 0 && !result.error, exitCode: result.status ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// SECURITY: candidateFixScope.filesHint is detector-supplied, untrusted text
// (self-improvement-finding.mjs's own comment) -- it must never be trusted
// as a real path without checking it actually stays inside the worktree.
// A hint containing `../` could otherwise point a "regression test" run at
// an arbitrary file elsewhere on disk. Rejected (not silently truncated),
// so a bad hint fails closed to NO_TARGETED_REGRESSION_TEST_RESOLVABLE
// rather than mechanically checking the wrong file.
export function isPathContainedInDirectory(directory, candidate) {
  const base = resolve(directory)
  const target = resolve(directory, candidate)
  return target === base || target.startsWith(`${base}${sep}`)
}

// Targeted-regression discipline (this program's own established
// convention, not the giant suite): prefers explicit *.test.mjs entries
// already named in the finding's own filesHint; otherwise looks for the
// codebase's own real convention of a sibling `tsf/test/<basename>.test.mjs`
// for each non-test changed file. Resolves to nothing (fail-closed, never
// silently "passes") when neither yields a real target.
export function resolveRegressionTestPaths(finding, changedFiles, worktreePath, deps) {
  const exists = deps.existsSync ?? existsSync
  const hinted = (finding.candidateFixScope?.filesHint ?? [])
    .filter((f) => f.endsWith('.test.mjs'))
    .filter((f) => isPathContainedInDirectory(worktreePath, f))
  if (hinted.length > 0) { return hinted }
  const derived = new Set()
  for (const file of changedFiles) {
    if (file.endsWith('.test.mjs')) { derived.add(file); continue }
    const base = file.split('/').pop()?.replace(/\.mjs$/, '')
    if (!base) { continue }
    const candidate = `tsf/test/${base}.test.mjs`
    if (exists(resolve(worktreePath, candidate))) { derived.add(candidate) }
  }
  return [...derived]
}

// The real, independent, mechanical verification. Returns
// { verdict, reasons, detail } -- detail carries every raw check result
// for the durable verifierResult record (planner-session-lifecycle.mjs's
// recordVerifierResult).
export async function runIndependentVerification({ finding, envelope, worktreePath, branch, baseSha, canonicalRepoPath, workerProviderId, siblingStatusesBefore = null, deps = {} }) {
  const resolve_ = deps.resolveRole ?? resolveRole
  const mappings = deps.providerRoleMappings ?? providerRoleMappings
  const profiles = deps.launchProfiles ?? launchProfiles
  const independence = resolveIndependentVerifierRole({ resolveRole: resolve_, mappings, profiles, workerProviderId })
  const independenceCheck = checkVerifierIndependence({ requiredIndependence: independence.requiredIndependence, divergent: independence.divergent })

  const changedFiles = await (deps.listChangedFiles ?? listChangedFiles)(worktreePath, baseSha)
  const addedFiles = await (deps.listAddedFiles ?? listAddedFiles)(worktreePath, baseSha)
  const canonicalBasenames = await (deps.listCanonicalFileBasenames ?? listCanonicalFileBasenames)(canonicalRepoPath)

  const reproCommand = resolveMechanicalCommand(finding.reproduction)
  const reproductionCheck = reproCommand ? runCommand(reproCommand, worktreePath, deps) : { passed: false, exitCode: null, stdout: '', stderr: 'no mechanical reproduction command declared' }

  const regressionTargets = resolveRegressionTestPaths(finding, changedFiles, worktreePath, deps)
  // argv-based (runRegressionTests), never a shell string built from
  // untrusted filesHint entries -- see runRegressionTests's own header.
  const regressionCommand = regressionTargets.length > 0 ? `node --test ${regressionTargets.join(' ')}` : null
  const regressionCheck =
    regressionTargets.length > 0
      ? (deps.runRegressionTests ?? runRegressionTests)(regressionTargets, worktreePath, deps)
      : { passed: false, exitCode: null, stdout: '', stderr: 'no targeted regression test resolvable' }

  const forbiddenSurfaceCheck = checkForbiddenSurfaceTouched(changedFiles, envelope.forbiddenPathPrefixes)
  const scopeCheck = checkAuthorityEnvelopeRespected(changedFiles, envelope.allowedScope)
  const duplicateArchitectureCheck = checkDuplicateArchitectureHeuristic(addedFiles, canonicalBasenames)

  // Scenario 11: only meaningful when a real "before" snapshot was captured
  // at dispatch time (dispatchRepairWorker) -- a caller/test that never
  // wired one (siblingStatusesBefore stays null) skips this check entirely
  // rather than fabricating a before/after comparison with no real before.
  const siblingWorktreeCheck = siblingStatusesBefore
    ? checkSiblingWorktreesUntouched(siblingStatusesBefore, await (deps.snapshotSiblingWorktreeStatuses ?? snapshotSiblingWorktreeStatuses)(canonicalRepoPath, [canonicalRepoPath, worktreePath]))
    : { pass: true, violations: [] }

  const { verdict, reasons } = buildVerifierVerdict({
    reproductionPassed: reproductionCheck.passed,
    regressionTargetResolved: regressionTargets.length > 0,
    regressionTestsPassed: regressionCheck.passed,
    forbiddenSurfaceCheck,
    scopeCheck,
    duplicateArchitectureCheck,
    independenceCheck,
    siblingWorktreeCheck
  })

  return {
    verdict,
    reasons,
    detail: {
      worktreePath,
      branch,
      baseSha,
      changedFiles,
      addedFiles,
      reproductionCheck: { command: reproCommand, ...reproductionCheck },
      regressionCheck: { targets: regressionTargets, command: regressionCommand, ...regressionCheck },
      forbiddenSurfaceCheck,
      scopeCheck,
      duplicateArchitectureCheck,
      siblingWorktreeCheck,
      independence: { resolution: independence.resolution, divergent: independence.divergent, usedFallback: independence.usedFallback, requiredIndependence: independence.requiredIndependence }
    }
  }
}
