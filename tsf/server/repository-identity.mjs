// M3: resolves the REAL, current repository binding (root/worktree/branch/
// head/tree) for a given worktree path -- read-only (`rev-parse`/
// `branch --show-current` only). Deliberately narrower than
// tsf/server/repo-inspector.mjs's snapshotRepository (onboarding's full
// analysis: status, remotes, worktree list, commit history, tracked
// files) -- the chat dispatch bridge only ever needs the exact identity
// binding a plan capsule's `repository` field requires, not a full repo
// scan, and this runs on every chat dispatch, not once at onboarding time.
//
// This is what makes chat-dispatch-bridge.mjs's plan capsule trustworthy:
// a zero-tool planner call has no way to know the real exact HEAD/tree, so
// the server resolves it itself, fresh, right before dispatch -- never
// trusting a client-supplied value.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 10000

function slash(value) {
  return String(value || '').replaceAll('\\', '/')
}

async function git(root, args) {
  const { stdout } = await exec(
    'git',
    ['-c', `safe.directory=${slash(root)}`, '-C', root, ...args],
    {
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    }
  )
  return stdout.trim()
}

// Returns { ok: true, identity: {root, worktree, branch, head, tree} } or
// { ok: false, reason, detail } -- never throws, matching this codebase's
// established honest-failure convention for anything that can fail on
// real filesystem/process state.
export async function resolveRepositoryIdentity(worktreePath) {
  const worktree = path.resolve(String(worktreePath ?? ''))
  if (!worktreePath || !existsSync(worktree)) {
    return {
      ok: false,
      reason: 'REPOSITORY_UNAVAILABLE',
      detail: `path does not exist: ${worktree}`
    }
  }
  let root
  try {
    root = await git(worktree, ['rev-parse', '--show-toplevel'])
  } catch (error) {
    return { ok: false, reason: 'NOT_A_GIT_REPOSITORY', detail: error.message }
  }
  try {
    const [head, tree, branch] = await Promise.all([
      git(worktree, ['rev-parse', 'HEAD']),
      git(worktree, ['rev-parse', 'HEAD^{tree}']),
      git(worktree, ['branch', '--show-current'])
    ])
    return {
      ok: true,
      identity: { root: path.resolve(root), worktree, branch: branch || 'HEAD', head, tree }
    }
  } catch (error) {
    return { ok: false, reason: 'GIT_COMMAND_FAILED', detail: error.message }
  }
}

// Part C (canonical base-ref resolution): a real, minimal git probe for
// "does this repo have a standard main/master default" -- reuses this
// module's own git() helper rather than inventing a third git-invocation
// path (adapters/git-identity.mjs is the other real one; that one is scoped
// to TSF's own canonical repo governance and deliberately not imported by
// this general-purpose module). Checks local branches only (never remote
// tracking refs, which may not exist for an offline/local-only repo) --
// `git branch --list` never throws for a missing branch, so both outcomes
// are read from one honest local-ref inspection, never a symbolic-ref guess
// that could point at a branch that doesn't actually exist locally.
export async function detectRepoDefaultBranch(root) {
  if (!root || !existsSync(root)) {
    return { ok: false, reason: 'REPOSITORY_UNAVAILABLE', detail: `path does not exist: ${root}` }
  }
  try {
    const branches = (await git(root, ['branch', '--list', 'main', 'master']))
      .split('\n')
      .map((line) => line.replace(/^\*?\s*/, '').trim())
      .filter(Boolean)
    if (branches.includes('main')) {
      return { ok: true, hasStandardDefault: true, defaultBranch: 'main' }
    }
    if (branches.includes('master')) {
      return { ok: true, hasStandardDefault: true, defaultBranch: 'master' }
    }
    return { ok: true, hasStandardDefault: false, defaultBranch: null }
  } catch (error) {
    return { ok: false, reason: 'GIT_COMMAND_FAILED', detail: error.message }
  }
}

// Real, narrow existence check for an arbitrary branch ref -- used by
// project-canonical-base-resolver.mjs to catch a stale explicit
// configuration (one that points at a branch no longer present locally)
// rather than assuming it is still valid.
export async function branchExistsLocally(root, ref) {
  if (!root || !existsSync(root)) {
    return { ok: false, reason: 'REPOSITORY_UNAVAILABLE', detail: `path does not exist: ${root}` }
  }
  try {
    const branches = (await git(root, ['branch', '--list', ref]))
      .split('\n')
      .map((line) => line.replace(/^\*?\s*/, '').trim())
      .filter(Boolean)
    return { ok: true, exists: branches.includes(ref) }
  } catch (error) {
    return { ok: false, reason: 'GIT_COMMAND_FAILED', detail: error.message }
  }
}
