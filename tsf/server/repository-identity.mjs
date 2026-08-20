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
