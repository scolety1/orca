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

// Real V1 stabilization finding, reproduced directly: WorldForge's own
// real package.json is 19.5KB -- the generic 4000-byte excerpt (sized for
// prose docs like README/ARCHITECTURE) truncated it mid-string, so
// JSON.parse threw and discoverCommandGuidance silently fell back to "no
// scripts found" even though a real, well-formed `test`/`typecheck`/
// `build` script existed the whole time. package.json's own `scripts`
// block is load-bearing content this discovery actually parses, not
// prose to preview -- a real manifest is reliably small enough that
// reading the whole file, bounded generously against a pathological
// outlier rather than a prose-sized window, is safe and correct.
const PACKAGE_JSON_MAX_BYTES = 262144 // 256 KiB

async function readExcerpt(file, maxBytes = EXCERPT_BYTES) {
  try {
    const buffer = await readFile(file)
    return {
      text: buffer.subarray(0, maxBytes).toString('utf8'),
      truncated: buffer.length > maxBytes,
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
    const excerpt = await readExcerpt(
      full,
      candidate.name === 'package.json' ? PACKAGE_JSON_MAX_BYTES : EXCERPT_BYTES
    )
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

// Real V1 stabilization finding: package-manager detection used to check
// only JS lockfiles, defaulting anything else to the single string
// 'UNKNOWN' -- and DEPENDENCY_HEALTH's own repair action then defaulted
// THAT to `npm install` (see health-repair.mjs), which really ran `npm
// install` inside real non-npm repos (NWR, route-reader) and left a stray
// package-lock.json behind. Detection now distinguishes a genuinely
// ambiguous JS project (has package.json, no lockfile signal -- 'UNKNOWN',
// still real risk of a wrong guess) from a real non-JS ecosystem ('python'/
// 'cargo'/'go', where `npm install` was never applicable in the first
// place) from no package manager at all ('none') -- each name is a real,
// distinguishable fact, not a synonym for "don't know."
function detectPackageManager(root, pkg) {
  // Corepack's own `packageManager` field (e.g. "pnpm@8.15.0") is the most
  // authoritative signal when a project declares it -- trust it over
  // inferring from whichever lockfile happens to be present.
  const declared =
    typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0].trim() : null
  if (declared && ['npm', 'yarn', 'pnpm', 'bun'].includes(declared)) {
    return declared
  }
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }
  if (existsSync(path.join(root, 'yarn.lock'))) {
    return 'yarn'
  }
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) {
    return 'bun'
  }
  if (existsSync(path.join(root, 'package-lock.json'))) {
    return 'npm'
  }
  if (existsSync(path.join(root, 'package.json'))) {
    // A real JS project with no lockfile evidence -- genuinely ambiguous,
    // never safe to guess an install command for.
    return 'UNKNOWN'
  }
  if (
    existsSync(path.join(root, 'pyproject.toml')) ||
    existsSync(path.join(root, 'requirements.txt')) ||
    existsSync(path.join(root, 'Pipfile'))
  ) {
    return 'python'
  }
  if (existsSync(path.join(root, 'Cargo.toml'))) {
    return 'cargo'
  }
  if (existsSync(path.join(root, 'go.mod'))) {
    return 'go'
  }
  return 'none'
}

// 'UNKNOWN' deliberately stays out of this set: it means a real package.json
// exists with no lockfile signal, so node_modules is still a real,
// meaningful fact to check even though the manager itself is ambiguous.
const NON_JS_MANAGERS = new Set(['python', 'cargo', 'go', 'none'])

// Real V1 stabilization finding: discovery had NO Python support at all --
// a real Python project (NWR) always read hasKnownTestCommand: false
// (BASELINE_UNKNOWN) regardless of how confidently its manager was
// detected, since only package.json `scripts` were ever inspected. These
// two commands are fixed literal strings, never built from repo-controlled
// content (unlike a JS script NAME, nothing here is interpolated) --
// existence-only evidence from real, standard Python tooling config
// sections decides whether each is even offered, never invented.
function detectPythonCommands(pyprojectText) {
  const text = pyprojectText ?? ''
  const hasPytest = /\[tool\.pytest\b/.test(text)
  const hasRuff = /\[tool\.ruff\b/.test(text)
  return {
    testCommands: hasPytest ? ['pytest'] : [],
    lintCommands: hasRuff ? ['ruff check .'] : []
  }
}

// Command guidance: package manager + test/build/dev scripts, discovered
// only — never executed here.
export function discoverCommandGuidance(root, packageJsonExcerptText, pyprojectExcerptText) {
  const pkg = packageJsonExcerptText ? parsePackageJson(packageJsonExcerptText) : null
  const manager = detectPackageManager(root, pkg)
  const runner =
    manager === 'yarn'
      ? 'yarn'
      : manager === 'pnpm'
        ? 'pnpm run'
        : manager === 'npm'
          ? 'npm run'
          : manager === 'bun'
            ? 'bun run'
            : null
  const scripts = pkg?.scripts ?? {}
  // Real vulnerability found via independent review, confirmed with a live
  // exploit: a package.json script NAME (not its body) is repo-controlled
  // content, and only the PREFIX was validated by the category regexes
  // below (`/^test(:|$)/` matches `test:$(evil)` just as happily as
  // `test:unit`). Every downstream consumer of *Commands builds a shell
  // command line by string-concatenating this name -- health-repair.mjs's
  // real command execution included -- so an unsafe name became a real
  // shell-injection RCE the moment anything actually ran it. Gating here,
  // at discovery, protects every current and future consumer at once,
  // rather than trusting each call site to re-validate. A script name
  // outside this safe set is simply excluded from discovery, not
  // "fixed up" -- it was very likely never a real, human-authored script
  // name to begin with.
  const isSafeScriptName = (name) => /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(name)
  // Real V1 stabilization finding, reproduced against WorldForge's own
  // real package.json: every caller of *Commands only ever uses index [0]
  // as THE baseline gate (runBaselineVerification) -- but Object.keys()
  // preserves package.json's own declaration order, not any notion of
  // "which script is the actual comprehensive check." WorldForge declares
  // `test:player-action-router-v1` (one narrow suite) before its own bare
  // `test` script (the real, comprehensive `npm test` entry point, the
  // universal JS-ecosystem convention for "the tests"), so index [0] was
  // a narrow suite, not the real gate. The bare category name --
  // `test`/`build`/`typecheck`/`lint`, with no `:suffix` -- is sorted
  // first when present; everything else keeps its original relative
  // order after it.
  const isBareCategoryName = (name, category) => name === category
  const commandsFor = (pattern, category) =>
    Object.keys(scripts)
      .filter((name) => pattern.test(name) && isSafeScriptName(name))
      .sort(
        (a, b) => Number(isBareCategoryName(b, category)) - Number(isBareCategoryName(a, category))
      )
      .map((name) => (runner ? `${runner} ${name}` : `UNKNOWN run ${name}`))
  const python = manager === 'python' ? detectPythonCommands(pyprojectExcerptText) : null
  const testCommands = python?.testCommands.length
    ? python.testCommands
    : commandsFor(/^(test|check)(:|$)/, 'test')
  const lintCommands = python?.lintCommands.length
    ? python.lintCommands
    : commandsFor(/^lint(:|$)/, 'lint')
  return {
    packageManager: manager,
    // node_modules is a real, meaningful "dependencies installed?" signal
    // only for a JS project -- for a real non-JS ecosystem ('python'/
    // 'cargo'/'go') or no manager at all ('none'), node_modules will
    // never exist and previously always read as `false`, which fired a
    // DEPENDENCY_HEALTH cause on every such project regardless of its
    // actual state -- honestly `true` (not applicable) for those instead.
    dependenciesInstalled: NON_JS_MANAGERS.has(manager)
      ? true
      : existsSync(path.join(root, 'node_modules')),
    testCommands,
    buildCommands: commandsFor(/^build(:|$)/, 'build'),
    lintCommands,
    typecheckCommands: commandsFor(/^typecheck(:|$)/, 'typecheck'),
    devCommands: commandsFor(/^(dev|start|preview)(:|$)/, 'dev'),
    declaredScripts: scripts,
    hasKnownTestCommand: testCommands.length > 0
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
