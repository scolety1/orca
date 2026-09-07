// Real canonical-repo-state reader for the planner checkpoint (2A/2C).
// `git rev-parse HEAD`/`--abbrev-ref HEAD` are baseline-safe on Git 2.25+
// (docs/reference/git-compatibility.md's floor) -- no capability probing
// needed. execFileSync (array args, no shell) so this is safe on every
// platform Orca targets. Returns null (never throws, never fabricates) when
// `cwd` is not a real git checkout -- callers must treat null as "cannot
// verify", per this program's "fail honest on missing/ambiguous state" rule.
import { execFileSync } from 'node:child_process'

export function observeCanonicalRepoState(cwd) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
    return { branch, sha, worktreePath: cwd }
  } catch {
    return null
  }
}
