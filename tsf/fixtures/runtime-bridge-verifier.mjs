import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function option(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] ?? null
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

const sessionId = option('--session')
const artifactDir = resolve(option('--artifacts') ?? './tsf/fixtures/runtime-bridge-v1')
if (!sessionId) throw new Error('--session is required')

const plan = JSON.parse(readFileSync(resolve(artifactDir, 'plan-capsule.json'), 'utf8'))
const result = JSON.parse(readFileSync(resolve(artifactDir, 'result-capsule.json'), 'utf8'))
const worktree = resolve(plan.repository.worktree)
const stableRoot = resolve(plan.repository.root)
const head = git(worktree, 'rev-parse', 'HEAD')
const tree = git(worktree, 'rev-parse', 'HEAD^{tree}')
const stableHead = git(stableRoot, 'rev-parse', 'main')
const stableTree = git(stableRoot, 'rev-parse', 'main^{tree}')
const topLevel = resolve(git(worktree, 'rev-parse', '--show-toplevel'))
const gitDir = resolve(worktree, git(worktree, 'rev-parse', '--git-dir'))
const commonDir = resolve(worktree, git(worktree, 'rev-parse', '--git-common-dir'))
const changedFiles = git(worktree, 'diff', '--name-only', `${plan.repository.head}..HEAD`)
  .split(/\r?\n/)
  .filter(Boolean)
  .sort()
const expectedFiles = [...result.filesChanged].sort()
const status = git(worktree, 'status', '--porcelain')
const source = readFileSync(resolve(worktree, 'src/greeting.js'), 'utf8')
const testSource = readFileSync(resolve(worktree, 'test/greeting.test.js'), 'utf8')
const test = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd test'], {
  cwd: worktree,
  encoding: 'utf8',
  windowsHide: true,
  shell: false
})

const checks = [
  { id: 'CANDIDATE_HEAD_MATCHES_CAPSULE', pass: head === result.repository.head, observed: head },
  { id: 'CANDIDATE_TREE_MATCHES_CAPSULE', pass: tree === result.repository.tree, observed: tree },
  { id: 'STABLE_HEAD_UNCHANGED', pass: stableHead === plan.repository.head, observed: stableHead },
  { id: 'STABLE_TREE_UNCHANGED', pass: stableTree === plan.repository.tree, observed: stableTree },
  { id: 'EXACT_WORKTREE_ROOT', pass: topLevel.toLowerCase() === worktree.toLowerCase(), observed: topLevel },
  { id: 'ISOLATED_LINKED_WORKTREE', pass: gitDir.toLowerCase() !== commonDir.toLowerCase(), observed: gitDir },
  { id: 'WORKTREE_CLEAN', pass: status === '', observed: status },
  { id: 'ONLY_ALLOWED_FILES_CHANGED', pass: JSON.stringify(changedFiles) === JSON.stringify(expectedFiles), observed: changedFiles },
  { id: 'SOURCE_VALUE_EXACT', pass: source.includes("return 'Orca native runtime bridge verified.'"), observed: source.trim() },
  { id: 'TEST_ASSERTION_EXACT', pass: testSource.includes("assert.equal(bridgeGreeting(), 'Orca native runtime bridge verified.')"), observed: testSource.trim() },
  {
    id: 'INDEPENDENT_TEST_PASS',
    pass: test.status === 0 && !test.error,
    observed: {
      exitCode: test.status,
      error: test.error?.message ?? null,
      stdoutTail: (test.stdout ?? '').trim().split(/\r?\n/).slice(-8)
    }
  }
]

const verifier = {
  schemaVersion: 'TSF_VERIFIER_RESULT_V1',
  verdict: checks.every((check) => check.pass) ? 'GREEN' : 'RED',
  verifierIdentity: {
    role: 'VERIFIER_INDEPENDENT',
    providerId: 'tsf-local',
    agentId: 'deterministic-node-verifier',
    modelObserved: null,
    orcaSessionId: sessionId
  },
  evidence: checks,
  verifiedResult: {
    missionId: result.missionId,
    workerSessionId: result.workerIdentity.orcaSessionId,
    head,
    tree,
    filesChanged: changedFiles,
    testCommand: 'npm test',
    testExitCode: test.status
  },
  blockers: checks.filter((check) => !check.pass).map((check) => check.id),
  verifiedAt: new Date().toISOString()
}

writeFileSync(resolve(artifactDir, 'verifier-result.json'), `${JSON.stringify(verifier, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(verifier, null, 2))
process.exitCode = verifier.verdict === 'GREEN' ? 0 : 1
