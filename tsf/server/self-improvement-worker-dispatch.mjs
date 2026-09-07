// Native Self-Improvement Loop V1, Phase 4: the REAL, bounded worker
// dispatch. Every real side effect (resource admission, worktree creation,
// process spawn) is dependency-injected so tests can prove the real logic
// with fakes -- no real Codex/Claude process is ever spawned by this
// program's own automated test suite (that's a later wave's job).
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { classifyDispatchAdmission } from '../domain/resource-pressure-governor.mjs'
import { buildWorkerPrompt } from '../domain/self-improvement-worker-prompt.mjs'
import { resolveRole } from '../domain/routing.mjs'
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'
import { createIsolatedRepairWorktree, snapshotSiblingWorktreeStatuses } from './self-improvement-worktree.mjs'
import providerRoleMappings from '../routing/provider-role-mappings.v1.json' with { type: 'json' }
import launchProfiles from '../providers/launch-profiles.v1.json' with { type: 'json' }

// Same admission category planner-session-lifecycle.mjs already gates
// mission start on (Finding F1's own established pattern, REUSE_DIRECTLY,
// not a second admission category) -- a repair worker dispatch IS exactly
// this kind of heavyweight dispatch.
const ADMISSION_FIELD = 'newHeavyweightWorkerDispatch'

const SAFE_PROVIDER_LAUNCH_SCRIPT = resolve(import.meta.dirname, '..', 'providers', 'safe-provider-launch.mjs')

// safe-provider-launch.mjs's own launch-profile `command` template
// literally spells out `--provider <codex|claude>` -- read from the SAME
// source of truth (the profile's own command string) rather than a second,
// independently-maintained profileId -> providerFlag table that could
// silently drift from it.
function providerFlagFromProfile(profile) {
  const match = profile.command.match(/--provider\s+(\S+)/)
  if (!match) { throw new Error(`launch profile command has no --provider flag: ${profile.command}`) }
  return match[1]
}

// The one place a bounded, non-interactive prompt is fed to
// safe-provider-launch.mjs's providerArguments -- codex's `exec` and
// claude's `-p` are each provider's own real non-interactive/print mode.
// safe-provider-launch.mjs has no separate stdin/prompt-file channel (it
// is built for an interactive terminal session), so the prompt travels as
// the final CLI argument, exactly like every other providerArguments use
// documented in launch-profiles.v1.json.
function providerArgumentsFor(providerFlag, prompt) {
  return providerFlag === 'codex' ? ['exec', prompt] : ['-p', prompt]
}

const DEFAULT_WORKER_TIMEOUT_MS = 20 * 60 * 1000

// Real default: spawns safe-provider-launch.mjs itself as a child, piped
// (not inherited) on ITS OWN stdio so the real provider process's output
// -- which safe-provider-launch.mjs launches with stdio:'inherit',
// cascading to whatever this process's own stdio is -- becomes capturable
// here rather than lost to the terminal. Never called in this program's
// own test suite; every test injects a fake `deps.spawnProviderProcess`.
function realSpawnProviderProcess({ provider, workspace, providerArguments, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [SAFE_PROVIDER_LAUNCH_SCRIPT, '--provider', provider, '--workspace', workspace, '--', ...providerArguments],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ exitCode: timedOut ? null : code, stdout, stderr, timedOut })
    })
  })
}

// The real bounded dispatch: resource-admission-gated, isolated-worktree-
// scoped, prompt built ENTIRELY from the finding's own structured fields
// (self-improvement-worker-prompt.mjs) -- never free-form. Returns the
// shape planner-session-lifecycle.mjs's dispatchWorkerForTask expects
// ({ workerId, providerId, agentId, ... }) plus the worktree facts the
// verifier/adoption steps need.
export async function dispatchRepairWorker({ finding, envelope, missionId, attemptNumber, canonicalRepoPath, clock = () => new Date(), deps = {} }) {
  const readHostMemory = deps.collectHostMemoryEvidence ?? collectHostMemoryEvidence
  const admission = (deps.classifyDispatchAdmission ?? classifyDispatchAdmission)(readHostMemory(), ADMISSION_FIELD)
  if (!admission.admitted) {
    const error = new Error(`repair worker dispatch blocked by Resource Pressure Governor (tier ${admission.tier}): ${admission.reason}`)
    error.code = 'TSF_SELF_IMPROVEMENT_DISPATCH_BLOCKED_BY_RESOURCE_PRESSURE'
    error.tier = admission.tier
    throw error
  }

  const resolve_ = deps.resolveRole ?? resolveRole
  const mappings = deps.providerRoleMappings ?? providerRoleMappings
  const profiles = deps.launchProfiles ?? launchProfiles
  const workerRole = resolve_({ role: 'WORKER_BALANCED', mappings, profiles })
  const profile = profiles.profiles[workerRole.requested.profileId]
  const providerFlag = providerFlagFromProfile(profile)

  const createWorktree = deps.createIsolatedRepairWorktree ?? createIsolatedRepairWorktree
  // `:` is a real, hard git-ref-name violation -- missionId's own
  // `mission:selfimprove:<hash>` shape contains one, so it is NEVER used
  // raw in a branch name (git checkout -b would fail on every real
  // dispatch otherwise, reproduced and fixed here).
  const sanitizedMissionId = missionId.replace(/[:/]/g, '-')
  const branch = `tsf/self-improve/${sanitizedMissionId}/attempt-${attemptNumber}`
  const worktreePath = deps.deriveWorktreePath
    ? deps.deriveWorktreePath({ missionId, attemptNumber })
    : resolve(canonicalRepoPath, '..', `${sanitizedMissionId}-attempt-${attemptNumber}`)
  const worktree = await createWorktree({ canonicalRepoPath, worktreePath, branch })

  // SECURITY (Phase 8 adversarial review, scenario 11): snapshot every
  // OTHER real worktree of this repo (e.g. dataset-research-engine-v0)
  // BEFORE the worker process ever runs, so the verifier can later detect a
  // worker that reached outside its own isolated worktree via an ordinary
  // relative path -- something git-diff on THIS worktree alone can never
  // see. See self-improvement-worktree.mjs's snapshotSiblingWorktreeStatuses.
  const snapshotSiblings = deps.snapshotSiblingWorktreeStatuses ?? snapshotSiblingWorktreeStatuses
  const siblingStatusesBefore = await snapshotSiblings(canonicalRepoPath, [canonicalRepoPath, worktree.worktreePath])

  const prompt = buildWorkerPrompt(finding, envelope)
  const spawnProcess = deps.spawnProviderProcess ?? realSpawnProviderProcess
  const result = await spawnProcess({
    provider: providerFlag,
    workspace: worktree.worktreePath,
    providerArguments: providerArgumentsFor(providerFlag, prompt),
    timeoutMs: deps.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS
  })

  return {
    workerId: `worker:${missionId}:attempt-${attemptNumber}:${clock().getTime()}`,
    providerId: workerRole.requested.providerId,
    agentId: workerRole.requested.agentId,
    worktreePath: worktree.worktreePath,
    branch: worktree.branch,
    baseSha: worktree.baseSha,
    siblingStatusesBefore,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr
  }
}
