// Read-only repository analysis for TSF Project Onboarding. Never mutates
// the target repository: only `git status`/`rev-parse`/`log`/`branch`/
// `remote`/`worktree list`, plus bounded filesystem reads of a small,
// prioritized set of files. Large/generated/vendor directories are never
// walked recursively — discovery is bounded by an explicit allowlist plus
// a depth/size-capped scan, mirroring the "do not recursively consume
// massive generated/vendor directories" requirement.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 10000
const EXCERPT_BYTES = 4000
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.turbo',
  '.cache',
  'target'
])
const BOUNDED_SCAN_LIMIT = 3000

function slash(value) {
  return String(value || '').replaceAll('\\', '/')
}

function sanitizeRemoteUrl(value) {
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
    }
    return parsed.toString()
  } catch {
    return String(value).replace(/^[^@\s/]+@(?=[^:]+:)/, '')
  }
}

async function git(root, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await exec(
      'git',
      ['-c', `safe.directory=${slash(root)}`, '-C', root, ...args],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
    )
    return stdout.trim()
  } catch (error) {
    if (allowFailure) {
      return null
    }
    const detail = String(error?.stderr || error?.message || 'git command failed')
      .trim()
      .split(/\r?\n/)[0]
    throw Object.assign(new Error(detail), { code: 'GIT_COMMAND_FAILED', args })
  }
}

function parsePorcelainV2(text) {
  const output = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: []
  }
  for (const line of String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)) {
    if (line.startsWith('# branch.head ')) {
      output.branch = line.slice(14).trim()
      output.detached = output.branch === '(detached)'
    } else if (line.startsWith('# branch.upstream ')) {
      output.upstream = line.slice(18).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+)\s+-(\d+)/)
      if (match) {
        output.ahead = Number(match[1])
        output.behind = Number(match[2])
      }
    } else if (line.startsWith('? ')) {
      output.untracked.push(line.slice(2))
    } else if (/^[12u] /.test(line)) {
      const kind = line[0]
      const fields = line.split(' ')
      const xy = fields[1] || '..'
      const file =
        kind === '1'
          ? fields.slice(8).join(' ')
          : kind === '2'
            ? fields.slice(9).join(' ').split('\t')[0]
            : fields.slice(10).join(' ')
      if (kind === 'u' || xy.includes('U')) {
        output.conflicted.push(file)
      }
      if (xy[0] && xy[0] !== '.') {
        output.staged.push(file)
      }
      if (xy[1] && xy[1] !== '.') {
        output.unstaged.push(file)
      }
    }
  }
  for (const key of ['staged', 'unstaged', 'untracked', 'conflicted']) {
    output[key] = [...new Set(output[key])].sort()
  }
  return output
}

function parseWorktrees(text) {
  return String(text || '')
    .split(/\r?\n\r?\n/)
    .map((block) =>
      Object.fromEntries(
        block
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const index = line.indexOf(' ')
            return index === -1 ? [line, true] : [line.slice(0, index), line.slice(index + 1)]
          })
      )
    )
    .filter((item) => item.worktree)
}

function parseRemotes(text) {
  const rows = []
  for (const line of String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (match) {
      rows.push({ name: match[1], url: sanitizeRemoteUrl(match[2]), direction: match[3] })
    }
  }
  const byName = new Map()
  for (const row of rows) {
    if (!byName.has(row.name)) {
      byName.set(row.name, row)
    }
  }
  return [...byName.values()]
}

async function gitOperationSentinels(gitDir) {
  const sentinels = []
  const checks = [
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect']
  ]
  for (const [name, kind] of checks) {
    if (existsSync(path.join(gitDir, name))) {
      sentinels.push(kind)
    }
  }
  return [...new Set(sentinels)]
}

// Read-only Git snapshot: identity, branch/HEAD/tree, clean/dirty state,
// staged/unstaged/untracked, active-operation sentinels, sanitized remotes,
// worktrees, recent commits, important local branches.
export async function snapshotRepository(repoPath) {
  const root = path.resolve(repoPath)
  if (!existsSync(root)) {
    return { ok: false, reason: 'REPOSITORY_UNAVAILABLE', detail: `path does not exist: ${root}` }
  }
  let topLevel
  try {
    topLevel = await git(root, ['rev-parse', '--show-toplevel'])
  } catch (error) {
    return { ok: false, reason: 'NOT_A_GIT_REPOSITORY', detail: error.message }
  }
  const canonicalTop = path.resolve(topLevel)
  const [
    head,
    tree,
    statusText,
    gitDir,
    remoteText,
    worktreeText,
    recentLogText,
    branchText,
    commitCountText,
    trackedFilesText
  ] = await Promise.all([
    git(canonicalTop, ['rev-parse', 'HEAD'], { allowFailure: true }),
    git(canonicalTop, ['rev-parse', 'HEAD^{tree}'], { allowFailure: true }),
    git(canonicalTop, [
      '-c',
      'core.quotepath=false',
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all'
    ]),
    git(canonicalTop, ['rev-parse', '--absolute-git-dir']),
    git(canonicalTop, ['remote', '-v'], { allowFailure: true }),
    git(canonicalTop, ['worktree', 'list', '--porcelain'], { allowFailure: true }),
    git(canonicalTop, ['log', '-10', '--pretty=format:%H|%h|%ad|%an|%s', '--date=iso-strict'], {
      allowFailure: true
    }),
    git(
      canonicalTop,
      [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=%(refname:short)|%(committerdate:iso-strict)',
        'refs/heads',
        '--count=15'
      ],
      { allowFailure: true }
    ),
    git(canonicalTop, ['rev-list', '--count', 'HEAD'], { allowFailure: true }),
    // Full tracked-file path list (names only, git ls-files is cheap even for
    // large repos) — needed so sensitive-path detection sees files already
    // committed and clean, not just today's dirty diff.
    git(canonicalTop, ['-c', 'core.quotepath=false', 'ls-files'], { allowFailure: true })
  ])
  const parsed = parsePorcelainV2(statusText)
  const sentinels = await gitOperationSentinels(gitDir)
  const recentCommits = (recentLogText || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, short, date, author, ...rest] = line.split('|')
      return { sha, short, date, author, subject: rest.join('|') }
    })
  const localBranches = (branchText || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, date] = line.split('|')
      return { name, lastCommitAt: date }
    })

  return {
    ok: true,
    root: canonicalTop,
    gitDir,
    head: head || null,
    tree: tree || null,
    branch: parsed.branch,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    dirty: !!(
      parsed.staged.length ||
      parsed.unstaged.length ||
      parsed.untracked.length ||
      parsed.conflicted.length
    ),
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    conflicted: parsed.conflicted,
    stagedCount: parsed.staged.length,
    unstagedCount: parsed.unstaged.length,
    untrackedCount: parsed.untracked.length,
    activeGitOperation: sentinels.length > 0,
    activeGitOperationKind: sentinels[0] ?? null,
    operationSentinels: sentinels,
    remotes: parseRemotes(remoteText),
    worktrees: parseWorktrees(worktreeText),
    recentCommits,
    localBranches,
    commitCount: Number.isFinite(Number(commitCountText)) ? Number(commitCountText) : null,
    trackedFiles: (trackedFilesText || '').split(/\r?\n/).filter(Boolean)
  }
}

const PRIORITY_FILES = [
  { name: 'README.md', kind: 'README' },
  { name: 'README.txt', kind: 'README' },
  { name: 'README', kind: 'README' },
  { name: 'AGENTS.md', kind: 'AGENTS' },
  { name: 'CLAUDE.md', kind: 'CLAUDE' },
  { name: 'package.json', kind: 'PACKAGE_MANIFEST' },
  { name: 'pyproject.toml', kind: 'PACKAGE_MANIFEST' },
  { name: 'Cargo.toml', kind: 'PACKAGE_MANIFEST' },
  { name: 'go.mod', kind: 'PACKAGE_MANIFEST' },
  { name: 'ARCHITECTURE.md', kind: 'ARCHITECTURE' },
  { name: 'DESIGN.md', kind: 'ARCHITECTURE' },
  { name: 'ROADMAP.md', kind: 'ROADMAP' },
  { name: 'TODO.md', kind: 'ROADMAP' },
  { name: 'CHANGELOG.md', kind: 'ROADMAP' },
  { name: '.env.example', kind: 'DEPLOYMENT_CONFIG' },
  { name: 'docker-compose.yml', kind: 'DEPLOYMENT_CONFIG' },
  { name: 'Dockerfile', kind: 'DEPLOYMENT_CONFIG' },
  { name: 'vercel.json', kind: 'DEPLOYMENT_CONFIG' },
  { name: 'netlify.toml', kind: 'DEPLOYMENT_CONFIG' }
]

async function readExcerpt(file) {
  try {
    const buffer = await readFile(file)
    return {
      text: buffer.subarray(0, EXCERPT_BYTES).toString('utf8'),
      truncated: buffer.length > EXCERPT_BYTES,
      bytes: buffer.length
    }
  } catch {
    return null
  }
}

// Bounded, allowlist-first discovery: known high-value filenames at the
// repo root plus a shallow, size-capped scan for docs/ and review-packet
// style directories. Never recurses into SKIP_DIRS.
export async function discoverProjectFiles(root) {
  const found = []
  for (const candidate of PRIORITY_FILES) {
    const full = path.join(root, candidate.name)
    if (!existsSync(full)) {
      continue
    }
    const excerpt = await readExcerpt(full)
    if (excerpt) {
      found.push({ relativePath: candidate.name, kind: candidate.kind, ...excerpt })
    }
  }

  // Shallow bounded scan (depth <= 2) for docs/, .github/workflows, and any
  // top-level "review packet"/handoff-style directory — evidence, not full
  // ingestion: names and a capped file count only, no content read here.
  const extraDirs = []
  let scanned = 0
  const queue = [{ dir: root, depth: 0 }]
  while (queue.length && scanned < BOUNDED_SCAN_LIMIT) {
    const { dir, depth } = queue.shift()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      scanned += 1
      if (scanned >= BOUNDED_SCAN_LIMIT) {
        break
      }
      if (entry.name.startsWith('.') && !['.github', '.env.example'].includes(entry.name)) {
        continue
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue
        }
        if (depth === 0 && /^(docs?|\.github|review|handoff|packets?)$/i.test(entry.name)) {
          const full = path.join(dir, entry.name)
          let fileCount = 0
          try {
            fileCount = readdirSync(full).length
          } catch {
            fileCount = 0
          }
          extraDirs.push({ relativePath: slash(path.relative(root, full)), fileCount })
          if (depth < 1) {
            queue.push({ dir: full, depth: depth + 1 })
          }
        }
        continue
      }
    }
  }

  return {
    priorityFiles: found,
    discoveredDirectories: extraDirs,
    scanTruncated: scanned >= BOUNDED_SCAN_LIMIT
  }
}

function parsePackageJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Command guidance: package manager + test/build/dev scripts, discovered
// only — never executed here.
export function discoverCommandGuidance(root, packageJsonExcerptText) {
  const manager = existsSync(path.join(root, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(path.join(root, 'yarn.lock'))
      ? 'yarn'
      : existsSync(path.join(root, 'package-lock.json'))
        ? 'npm'
        : 'UNKNOWN'
  const runner =
    manager === 'yarn'
      ? 'yarn'
      : manager === 'pnpm'
        ? 'pnpm run'
        : manager === 'npm'
          ? 'npm run'
          : null
  const pkg = packageJsonExcerptText ? parsePackageJson(packageJsonExcerptText) : null
  const scripts = pkg?.scripts ?? {}
  const commandsFor = (pattern) =>
    Object.keys(scripts)
      .filter((name) => pattern.test(name))
      .map((name) => (runner ? `${runner} ${name}` : `UNKNOWN run ${name}`))
  return {
    packageManager: manager,
    dependenciesInstalled: existsSync(path.join(root, 'node_modules')),
    testCommands: commandsFor(/^(test|check)(:|$)/),
    buildCommands: commandsFor(/^build(:|$)/),
    lintCommands: commandsFor(/^lint(:|$)/),
    typecheckCommands: commandsFor(/^typecheck(:|$)/),
    devCommands: commandsFor(/^(dev|start|preview)(:|$)/),
    declaredScripts: scripts,
    hasKnownTestCommand: Object.keys(scripts).some((name) => /^(test|check)(:|$)/.test(name))
  }
}

// Bounded scan for large untracked directories — never deletes/ignores
// anything, purely a risk signal (matches the "do not recursively consume
// massive generated/vendor directories" requirement: this is capped and
// only looks at top-level untracked entries, not a full tree walk).
export function boundedUntrackedDirectorySizes(root, untrackedPaths, limit = 40) {
  const flagged = []
  const grouped = new Map()
  for (const candidate of untrackedPaths) {
    const top = slash(candidate).split('/')[0]
    grouped.set(top, (grouped.get(top) ?? 0) + 1)
  }
  for (const [top, count] of grouped) {
    if (count < 200) {
      continue
    }
    flagged.push({ path: top, entryCount: count, source: 'UNTRACKED_PATH_COUNT' })
  }
  let checked = 0
  for (const candidate of untrackedPaths) {
    if (checked >= limit) {
      break
    }
    const target = path.join(root, candidate)
    try {
      const stat = statSync(target)
      if (stat.isDirectory() && !flagged.some((item) => item.path === candidate)) {
        checked += 1
        const size = boundedDirectorySize(target)
        if (size.files >= 500 || size.bytes >= 50 * 1024 * 1024 || size.truncated) {
          flagged.push({ path: candidate, ...size, source: 'BOUNDED_DIRECTORY_SCAN' })
        }
      }
    } catch {
      /* inaccessible — skip, not a finding */
    }
  }
  return flagged
}

function boundedDirectorySize(root, limit = 2500) {
  let files = 0
  let bytes = 0
  let truncated = false
  const queue = [root]
  while (queue.length && files < limit) {
    const current = queue.shift()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === '.git') {
        continue
      }
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
      } else {
        files += 1
        try {
          bytes += statSync(full).size
        } catch {
          /* ignore */
        }
      }
      if (files >= limit) {
        truncated = true
        break
      }
    }
  }
  return { files, bytes, truncated }
}
