// Real git plumbing for the Safe Update Manager: what commit is TSF's own
// source actually at, is a candidate a genuine fast-forward ancestor, is
// the working tree clean. Every command here (`rev-parse`, `merge-base
// --is-ancestor`, `status --porcelain`, `merge --ff-only`) has existed
// since long before Git 2.25 (this repo's documented baseline, see
// docs/reference/git-compatibility.md) -- no capability probing/fallback
// is needed for any of them, unlike a newer feature such as `merge-tree`.
// Spawn conventions (no shell, bounded timeout, honest failure reasons)
// mirror adapters/orca-cli-bridge.mjs's own established pattern rather
// than importing Orca core's TypeScript GitCapabilityCache, which this
// plain-Node plugin process cannot reach anyway.
import { spawn } from 'node:child_process'

function timeoutMs() {
  return Number(process.env.TSF_GIT_TIMEOUT_MS) || 10000
}

function runGit(args, cwd) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      return resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs())
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: 'SPAWN_ERROR', detail: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        return resolve({ ok: false, reason: 'TIMEOUT', detail: `git ${args[0]} timed out` })
      }
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

// The exact commit TSF's own source is at, in `cwd` (a real worktree path).
export async function getCurrentCommit(cwd) {
  const result = await runGit(['rev-parse', 'HEAD'], cwd)
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason ?? 'GIT_ERROR',
      detail: result.stderr ?? result.detail
    }
  }
  return { ok: true, commit: result.stdout }
}

// The real tree hash of just the `tsf/` subtree at a given ref -- answers
// "accepted tsf/main HEAD/tree" (spec Phase 1) more precisely than the
// whole-repo commit alone, since Orca core's own delta must stay 0 and this
// scopes identity to exactly what TSF itself owns.
export async function getSubtreeHash(cwd, ref, subpath) {
  const result = await runGit(['rev-parse', `${ref}:${subpath}`], cwd)
  if (!result.ok) {
    return { ok: false, reason: 'GIT_ERROR', detail: result.stderr }
  }
  return { ok: true, treeHash: result.stdout }
}

export async function isCleanWorkingTree(cwd) {
  const result = await runGit(['status', '--porcelain'], cwd)
  if (!result.ok) {
    return { ok: false, reason: 'GIT_ERROR', detail: result.stderr }
  }
  return { ok: true, clean: result.stdout.length === 0 }
}

// True only when `ancestorRef` is a real, literal ancestor of `ref` -- the
// exact check a fast-forward-only merge needs before it can ever be safe.
export async function isAncestor(cwd, ancestorRef, ref) {
  const result = await runGit(['merge-base', '--is-ancestor', ancestorRef, ref], cwd)
  // git's own convention: exit 0 = true, exit 1 = false (a real, valid
  // negative answer, not a failure) -- exit >1 or a spawn error is an
  // actual error this function must not silently treat as "false".
  if (result.ok) {
    return { ok: true, isAncestor: true }
  }
  if (result.code === 1) {
    return { ok: true, isAncestor: false }
  }
  return { ok: false, reason: result.reason ?? 'GIT_ERROR', detail: result.stderr ?? result.detail }
}

// Fast-forward-only merge, never a real merge commit or rebase -- refuses
// outright (real git exit failure) if `ref` is not a genuine descendant of
// the current HEAD. Never forces, never resets through drift -- this either
// truly fast-forwards or does nothing.
export async function ffOnlyMerge(cwd, ref) {
  const result = await runGit(['merge', '--ff-only', ref], cwd)
  if (!result.ok) {
    return { ok: false, reason: 'FF_ONLY_MERGE_REFUSED', detail: result.stderr ?? result.detail }
  }
  return { ok: true, detail: result.stdout }
}

// Restores `cwd`'s HEAD to `commit` exactly -- used only for a governed
// rollback to a previously-recorded, known-good accepted commit, never an
// arbitrary reset. `--hard` is intentional here (the one legitimate use:
// undoing a just-adopted, now-failing candidate back to the exact prior
// state) -- callers must have independently verified `commit` is the real
// previously-recorded HEAD, this function does not re-derive that itself.
export async function resetHardTo(cwd, commit) {
  const result = await runGit(['reset', '--hard', commit], cwd)
  if (!result.ok) {
    return { ok: false, reason: 'GIT_ERROR', detail: result.stderr ?? result.detail }
  }
  return { ok: true }
}
