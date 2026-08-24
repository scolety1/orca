// TSF Health Repair Center V1 — I/O layer. Gathers real evidence (stored
// analyses, live command execution) for domain/health-repair.mjs's pure
// classification, and carries out AUTO_REPAIR_SAFE actions. Never fixes
// source code itself — a GOVERNED_REPAIR_MISSION cause gets a real mission
// spec (prepareRepairMission) for an isolated worker to act on, exactly
// like any other Keep Going mission; this module never edits repo files.
import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  diagnoseProjectHealth,
  overallRepairClass,
  isReadyForWork,
  HEALTH_CAUSES
} from '../domain/health-repair.mjs'
import {
  analyzeRepository,
  refreshOrcaRegistrationStatus,
  resolveReconciliation
} from './onboarding.mjs'

// Read-only, fast: reasons over each Known Project's already-stored
// lastAnalysis, never touches a repo or the live planner. `baseline` is
// deliberately NOT gathered here — running real commands for the whole
// fleet on every scan would make "Scan Fleet Health" slow and invasive;
// baseline verification is its own bounded, per-project, opt-in action
// (runBaselineVerification below), matching the product's own "Recheck"
// affordance rather than a blanket background job.
export function scanFleetHealth(opState) {
  const projects = opState.onboardedProjects ?? {}
  const portfolio = opState.portfolio ?? { activeFleet: [], workSet: [] }
  return Object.entries(projects).map(([projectId, record]) => {
    const membership = {
      activeFleet: (portfolio.activeFleet ?? []).includes(projectId),
      workSet: (portfolio.workSet ?? []).includes(projectId)
    }
    const causes = diagnoseProjectHealth({ analysis: record.lastAnalysis, membership })
    return {
      projectId,
      displayName: record.lastAnalysis?.displayName ?? projectId,
      repoPath: record.repoPath,
      causes,
      repairClass: overallRepairClass(causes),
      readyForWork: isReadyForWork(causes)
    }
  })
}

function timeoutMs() {
  return Number(process.env.TSF_HEALTH_REPAIR_TIMEOUT_MS) || 120000
}

// Real cross-platform defect found and fixed here (regression-tested):
// `shell: true` runs the command through an intermediate shell (cmd.exe on
// Windows), so a plain `child.kill('SIGTERM')` on timeout only signals that
// shell, not the real process tree underneath it — a genuinely hung command
// kept running to its own natural end regardless of the configured timeout,
// so the "bounded" wait was not actually bounded on Windows. `taskkill /T
// /F` kills the whole tree by pid; POSIX kill() already works correctly.
function killProcessTree(pid) {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => {})
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already exited — nothing to kill.
    }
  }
}

// Real V1 stabilization finding, reproduced against NWR's real repo:
// pytest/ruff exist only inside its .venv, not on the system PATH -- a
// bare `pytest`/`ruff check .` command spawned with shell:true resolves
// against the shell's own inherited PATH, not an unactivated venv, so it
// would SPAWN_ERROR ("not recognized") even though both tools are really
// installed. This is repoPath's OWN filesystem layout (a trusted,
// TSF-computed path, not repo-CONTENT), so it is safe to use directly --
// unlike a package.json script name, nothing here is repo-controlled text
// reaching a shell string. Prepending the venv's own bin directory to the
// child's PATH (never touching the command string itself) resolves this
// without needing any path interpolation into SAFE_COMMAND_LINE's shape
// at all. Absent for any repo without a real .venv/venv -- a no-op.
function venvBinDir(repoPath) {
  for (const venvName of ['.venv', 'venv']) {
    const bin = path.join(repoPath, venvName, process.platform === 'win32' ? 'Scripts' : 'bin')
    const python = path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python')
    if (existsSync(python)) {
      return bin
    }
  }
  return null
}

// Runs one real shell command with a bounded timeout, in repoPath, never
// touching source files itself — the command being run may (build/test
// output, a lockfile) but this function's own job is only to observe the
// real exit code, honestly, never to interpret or patch it.
function runCommand(command, cwd, timeoutOverrideMs) {
  return new Promise((resolve) => {
    let child
    try {
      const venvBin = venvBinDir(cwd)
      const env = venvBin
        ? { ...process.env, PATH: `${venvBin}${path.delimiter}${process.env.PATH}` }
        : process.env
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env
      })
    } catch (error) {
      resolve({ status: 'UNKNOWN', reason: 'SPAWN_ERROR', detail: error.message })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) {
        killProcessTree(child.pid)
      }
    }, timeoutOverrideMs ?? timeoutMs())
    child.stdout?.on('data', (chunk) => (stdout += chunk))
    child.stderr?.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ status: 'UNKNOWN', reason: 'SPAWN_ERROR', detail: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({
          status: 'UNKNOWN',
          reason: 'TIMEOUT',
          detail: `no exit within the configured timeout`
        })
        return
      }
      resolve({
        status: code === 0 ? 'PASS' : 'FAIL',
        exitCode: code,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000)
      })
    })
  })
}

// Defense in depth (independent-review finding, confirmed with a live
// exploit): repo-inspector.mjs's discoverCommandGuidance now excludes an
// unsafe script name at the source, but this function must never assume
// every commandGuidance it is ever handed came from that one trusted path
// -- a command string is only ever spawned here if it matches exactly the
// shape discovery is documented to produce (`<runner> <safe-name>` or
// `UNKNOWN run <safe-name>`), never a raw string accepted on faith.
// The two Python alternatives are fixed literal strings discovery ever
// produces (see detectPythonCommands in repo-inspector.mjs) -- unlike a JS
// script name, nothing repo-controlled is interpolated into either one, so
// listing them by exact value carries the same safety guarantee as the
// npm/yarn/pnpm shape above.
const SAFE_COMMAND_LINE =
  /^(?:npm run|yarn|pnpm run|UNKNOWN run) [A-Za-z0-9][A-Za-z0-9_.:-]*$|^(?:pytest|ruff check \.)$/

// Real baseline verification: actually runs the repo's own discovered
// typecheck/test/build/lint commands (never invented ones) and reports the
// honest result per category — PASS/FAIL from a real exit code, UNKNOWN
// only for a real spawn/timeout failure, NOT_APPLICABLE when discovery
// found no command for that category, or when the command it found does
// not match the safe shape above (treated the same as "none found" —
// never run, never silently coerced into something safe). This is what
// lets Health Repair Center tell a real BUILD_FAILING/TESTS_FAILING apart
// from "no build/test step exists" — the two must never be reported the
// same way.
export async function runBaselineVerification(repoPath, commandGuidance, timeoutOverrideMs) {
  const categories = {
    typecheck: commandGuidance?.typecheckCommands?.[0],
    test: commandGuidance?.testCommands?.[0],
    build: commandGuidance?.buildCommands?.[0],
    lint: commandGuidance?.lintCommands?.[0]
  }
  const result = {}
  for (const [key, command] of Object.entries(categories)) {
    if (!command || !SAFE_COMMAND_LINE.test(command)) {
      result[key] = 'NOT_APPLICABLE'
      continue
    }
    const outcome = await runCommand(command, repoPath, timeoutOverrideMs)
    result[key] = outcome.status
    result[`${key}Detail`] = outcome
  }
  return result
}

// Applies ONE AUTO_REPAIR_SAFE cause's real repair action, in-process,
// never touching source files. Returns a fresh analysis so the caller can
// persist it and recompute causes — repairing never claims success on its
// own say-so, the caller must re-diagnose from the fresh result.
const INSTALL_COMMAND_BY_MANAGER = Object.freeze({
  npm: 'npm install',
  yarn: 'yarn install',
  pnpm: 'pnpm install',
  bun: 'bun install'
})

export async function repairProject({
  repoPath,
  cause: causeCode,
  packageManager,
  handoffTextExcerpt
}) {
  switch (causeCode) {
    case HEALTH_CAUSES.ORCA_NOT_REGISTERED:
    case HEALTH_CAUSES.ORCA_TEMPORARILY_UNAVAILABLE: {
      const result = await refreshOrcaRegistrationStatus(repoPath)
      return {
        ok: true,
        action: 'REFRESH_ORCA_REGISTRATION',
        orcaRegistration: result.orcaRegistration
      }
    }
    case HEALTH_CAUSES.HANDOFF_RECONCILIATION_REQUIRED: {
      // The only resolution mode a repair may pick unattended: it never
      // overrides real Git truth (current-state facts always win
      // regardless of resolution — see reconcileHandoff), it only clears
      // the block, and the raw discrepancy is preserved as history either
      // way. KEEP_UNRESOLVED and USE_HANDOFF both stay operator-only.
      // Needs the record's own stored handoffTextExcerpt to re-derive the
      // same discrepancy against — without it there is nothing real to
      // resolve, and this honestly reports that rather than fabricating a
      // resolution against a handoff that was never actually re-supplied.
      if (!handoffTextExcerpt) {
        return {
          ok: false,
          action: 'RESOLVE_HANDOFF_USE_LIVE_REPO',
          reason: 'NO_HANDOFF_TEXT_ON_RECORD',
          detail: 'No stored handoff text excerpt is available to re-reconcile against.'
        }
      }
      const result = await resolveReconciliation({
        repoPath,
        handoffText: handoffTextExcerpt,
        resolution: { mode: 'USE_LIVE_REPO_FOR_CURRENT_STATE' }
      })
      return { ok: result.ok, action: 'RESOLVE_HANDOFF_USE_LIVE_REPO', result }
    }
    case HEALTH_CAUSES.DEPENDENCY_HEALTH: {
      // Real safety bug found and fixed here: this used to default to
      // `npm install` whenever packageManager wasn't recognized -- which
      // really ran `npm install` inside real non-npm repos (NWR, route-
      // reader had no lockfile/were non-JS) and left a stray
      // package-lock.json in their real working trees. Never guesses now:
      // an install command only runs for a manager repo-inspector.mjs
      // actually has real command-line evidence for (npm/yarn/pnpm/bun,
      // via a lockfile or a declared `packageManager` field). Everything
      // else -- 'UNKNOWN' (ambiguous JS project), 'python'/'cargo'/'go'
      // (a real, different ecosystem), 'none' -- stays read-only/
      // diagnostic: no command is spawned, no file is written.
      const installCommand = INSTALL_COMMAND_BY_MANAGER[packageManager]
      if (!installCommand) {
        return {
          ok: false,
          action: 'PACKAGE_MANAGER_UNKNOWN',
          reason: `Cannot determine a safe install command -- packageManager is "${packageManager ?? 'unknown'}", not one of npm/yarn/pnpm/bun. Refusing to guess rather than defaulting to npm install.`
        }
      }
      const outcome = await runCommand(installCommand, repoPath)
      return { ok: outcome.status === 'PASS', action: 'INSTALL_DEPENDENCIES', outcome }
    }
    case HEALTH_CAUSES.PLANNER_UNAVAILABLE:
    case HEALTH_CAUSES.BASELINE_UNKNOWN:
    case HEALTH_CAUSES.STALE_PROJECT_STATE:
    case HEALTH_CAUSES.INCOMPLETE_ANALYSIS: {
      const fresh = await analyzeRepository({ repoPath, handoffText: '' })
      return { ok: fresh.ok, action: 'REFRESH_ANALYSIS', analysis: fresh }
    }
    default:
      return { ok: false, action: 'NONE', reason: `${causeCode} is not an AUTO_REPAIR_SAFE cause` }
  }
}

// Builds a real, evidence-grounded Keep Going mission spec for a
// GOVERNED_REPAIR_MISSION cause — the same shape createOvernightRun
// expects, scoped tightly to the one failing category, verification-first,
// never claiming the fix in advance. Returns the spec only; dispatching it
// (creating the isolated worktree, starting the run) is a separate,
// explicit action, same as any other mission.
export function prepareRepairMission({ displayName, repoPath, cause: diagnosis }) {
  const command = diagnosis.evidence?.command ?? diagnosis.cause.toLowerCase()
  return {
    projectDisplayName: displayName,
    repoPath,
    originalGoal:
      `Repair the real, currently-failing \`${command}\` baseline check in ${displayName}. ` +
      `Real evidence: ${diagnosis.summary} Reproduce the failure first, make the minimal ` +
      `change needed to get a genuinely passing result (never delete/skip/weaken the failing ` +
      `check to fake a pass), and record the real command output as evidence.`,
    acceptanceCriteria: [
      `\`${command}\` actually passes, verified by running it and recording the real exit code/output`,
      'The fix is the minimal change needed — no unrelated refactors or new functionality',
      'The previously-failing check was not deleted, skipped, or weakened to force a pass'
    ],
    usageMode: 'MAXIMUM',
    constraints: [
      'No push, merge to a protected/shared branch, deploy, or publication',
      'No credentials, payment, or paid services',
      'No destructive Git operations',
      'Local commits only, on an isolated branch',
      'Stop at READY_FOR_ADOPTION; do not self-adopt into any protected branch'
    ],
    stopConditions: [
      'The real root cause is a product/architecture decision, not a bounded code fix',
      'Fixing this would require touching a different, unrelated failing category'
    ]
  }
}
