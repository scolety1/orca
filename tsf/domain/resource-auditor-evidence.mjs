// Pure evidence-shaping for the Resource Auditor. No I/O -- this is the
// documented TSF-layer integration seam: `mapOrcaWorkspaceCleanupCandidateToEvidence`
// is where a real Orca `workspaceCleanup:scan` result (git identity,
// main-worktree/pinned/folder-repo flags, PTY-liveness blockers -- Orca's
// own, already-tested evidence) becomes the resource-auditor evidence
// shape classifyWorkspaceResource() consumes. TSF adds RAM/CPU/session and
// TSF-mission evidence on top rather than re-implementing Orca's PTY/git
// tracking (see docs/tsf/TSF_RESOURCE_AUDITOR_V0.md).
const BYTE_UNITS = { B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 }

// Parses one `git count-objects -vH` byte-size value, e.g. "26.35 GiB" or
// "0 bytes", into an exact byte count. Returns null (not 0) for anything
// unparseable -- an unparsed size must never silently read as zero bytes.
export function parseGitCountObjectsSize(text) {
  if (typeof text !== 'string') {
    return null
  }
  const trimmed = text.trim()
  if (/^0\s*bytes?$/i.test(trimmed)) {
    return 0
  }
  const match = trimmed.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)$/i)
  if (!match) {
    return null
  }
  const unit = BYTE_UNITS[match[2].toUpperCase()]
  if (!unit) {
    return null
  }
  return Math.round(Number.parseFloat(match[1]) * unit)
}

// Parses the raw stdout of `git count-objects -vH` into its exact named
// fields, verbatim (both the original string and a parsed byte count for
// each size field). Never interprets, labels, or judges the result --
// that is deliberately left to classifyGitObjectStoreDiskUsage.
export function parseGitCountObjectsVerbose(stdout) {
  const fields = {}
  for (const line of String(stdout ?? '').split('\n')) {
    const match = line.match(/^([a-z-]+):\s*(.+)$/i)
    if (!match) {
      continue
    }
    const [, key, rawValue] = match
    fields[key] = rawValue.trim()
  }
  return {
    count: fields.count ? Number.parseInt(fields.count, 10) : null,
    size: fields.size ?? null,
    sizeBytes: parseGitCountObjectsSize(fields.size),
    inPack: fields['in-pack'] ? Number.parseInt(fields['in-pack'], 10) : null,
    packs: fields.packs ? Number.parseInt(fields.packs, 10) : null,
    sizePack: fields['size-pack'] ?? null,
    sizePackBytes: parseGitCountObjectsSize(fields['size-pack']),
    prunePackable: fields['prune-packable'] ? Number.parseInt(fields['prune-packable'], 10) : null,
    garbage: fields.garbage ? Number.parseInt(fields.garbage, 10) : null,
    sizeGarbage: fields['size-garbage'] ?? null,
    sizeGarbageBytes: parseGitCountObjectsSize(fields['size-garbage'])
  }
}

// Deliberately conservative: `size-garbage` is loose/unreachable objects at
// scan time, not a verified-safe-to-delete number. Without independent
// reachability verification (nothing in any branch, tag, reflog, stash, or
// in-flight operation still needs those objects) this must never be
// reported as "reclaimable" or "garbage" in a user-facing sense, and V0
// runs no `git gc`/`git prune`/mutation of any kind to find out.
export function classifyGitObjectStoreDiskUsage(fields, meta = {}) {
  return {
    schemaVersion: 'TSF_DISK_USAGE_GIT_OBJECT_STORE_V1',
    classification: 'DISK_USAGE_UNKNOWN_RECLAIMABLE',
    command: meta.command ?? 'git count-objects -vH',
    observedAt: meta.observedAt ?? null,
    worktreePath: meta.worktreePath ?? null,
    fields,
    reachabilityVerified: false,
    note: 'size-garbage is unreachable/loose objects observed at scan time. No reachability check (branches, tags, reflog, stashes, in-flight operations) was run, and no git gc/prune/mutation was executed. This number must not be presented as reclaimable disk space.'
  }
}

// Real, observed CPU activity during a sample window -- reported as its own
// fact, separate from ownership/mission state. A process being CPU-active
// (or not) during a short sample is not evidence of who owns it or whether
// it is safe to close; classifyWorkspaceResource never reads this field.
export function buildProcessOwnershipEvidence({
  pid = null,
  startTime = null,
  matchedSessionId = null,
  cpuPercentSample = null,
  sampleWindowMs = null,
  workingSetBytes = null,
  privateBytes = null,
  observedAt = null
} = {}) {
  return {
    pid,
    pidStartTime: startTime,
    matchedSessionId,
    ownershipVerified: matchedSessionId !== null && matchedSessionId !== undefined,
    cpuActivityObservedDuringSample:
      typeof cpuPercentSample === 'number' ? cpuPercentSample > 0 : null,
    cpuPercentSample,
    sampleWindowMs,
    workingSetBytesApprox: workingSetBytes,
    privateBytesApprox: privateBytes,
    observedAt
  }
}

// A running process/session with a known owner (matchedSessionId set, or an
// explicit ownership evidence input) stays PROTECTED until that owner, or
// governed TSF mission state, explicitly releases it -- CPU idleness during
// a short sample never demotes that on its own. This helper only ever
// widens (never narrows) an explicit ownerReleased=true input into the
// classifier's ownership fields; it does not infer release from silence.
export function ownershipFromKnownOwner(
  processEvidence,
  { ownerReleased = false, tsfMissionRef = null } = {}
) {
  const knownOwner = Boolean(processEvidence?.matchedSessionId)
  return {
    activeWorkspace: knownOwner ? !ownerReleased : null,
    activeAgent: knownOwner ? !ownerReleased : null,
    runningTerminal: null,
    pid: processEvidence?.pid ?? null,
    pidStartTime: processEvidence?.pidStartTime ?? null,
    matchedSessionId: processEvidence?.matchedSessionId ?? null,
    editorDirtyBuffer: null,
    volatileLocalContext: null,
    tsfMissionRef
  }
}

// Windows path-identity helpers: case-insensitive comparison and
// parent/child containment, normalized on forward slashes. Pure string
// comparison only -- does NOT itself resolve junctions/reparse points or
// symlinks. Real junction/reparse resolution IS possible without any
// Orca-core change (Node's fs.realpath follows them natively on Windows)
// and lives in the one place that needs real I/O:
// server/resource-auditor-path-identity.mjs. Its resolved real paths are
// what should be passed here as `resolvedPath`/`registeredPaths` for this
// comparison to be meaningful against an alias, not just a literal string.
export function resolvePathIdentity(expectedPath, resolvedPath, { caseInsensitiveFs = true } = {}) {
  if (!expectedPath || !resolvedPath) {
    return { matchesExpected: null, normalizedExpected: null, normalizedResolved: null }
  }
  const normalize = (value) => String(value).replaceAll('\\', '/').replace(/\/+$/, '')
  const a = normalize(expectedPath)
  const b = normalize(resolvedPath)
  const matches = caseInsensitiveFs ? a.toLowerCase() === b.toLowerCase() : a === b
  return { matchesExpected: matches, normalizedExpected: a, normalizedResolved: b }
}

// True if `candidatePath` recursively contains any OTHER registered
// worktree path -- deleting it would silently take that other, still-live
// worktree with it. Returns null (unknown) rather than false when there is
// nothing to compare against.
export function pathContainsRegisteredWorktree(
  candidatePath,
  registeredPaths,
  { caseInsensitiveFs = true } = {}
) {
  if (!candidatePath || !Array.isArray(registeredPaths)) {
    return null
  }
  const normalize = (value) => String(value).replaceAll('\\', '/').replace(/\/+$/, '')
  const candidate = normalize(candidatePath)
  const candidateKey = caseInsensitiveFs ? candidate.toLowerCase() : candidate
  return registeredPaths.some((other) => {
    const otherNormalized = normalize(other)
    const otherKey = caseInsensitiveFs ? otherNormalized.toLowerCase() : otherNormalized
    return otherKey !== candidateKey && otherKey.startsWith(`${candidateKey}/`)
  })
}

// A registered workspace/resource ID or a known repository root is
// preferred authority; this is the fallback path-based check the git-
// object-store route uses when only a raw path is available. `rootPaths`
// must already be real, resolved paths (server's job); this function does
// pure string comparison only. Returns false (not null) on an empty/absent
// registry -- REJECT everything when there is nothing to check against,
// never "allow by default".
export function isPathWithinRegisteredRoots(
  candidateRealPath,
  rootRealPaths,
  { caseInsensitiveFs = true } = {}
) {
  if (!candidateRealPath || !Array.isArray(rootRealPaths) || rootRealPaths.length === 0) {
    return false
  }
  const normalize = (value) => String(value).replaceAll('\\', '/').replace(/\/+$/, '')
  const candidate = normalize(candidateRealPath)
  const candidateKey = caseInsensitiveFs ? candidate.toLowerCase() : candidate
  return rootRealPaths.some((root) => {
    const rootNormalized = normalize(root)
    const rootKey = caseInsensitiveFs ? rootNormalized.toLowerCase() : rootNormalized
    return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}/`)
  })
}

// TSF's real, already-existing "trusted workspace registry": the repoPath
// of every onboarded project (tsf/server/onboarding.mjs's
// opState.onboardedProjects). Deliberately does not fabricate a new
// registry concept -- this is the one TSF already has and actually trusts
// elsewhere (health-repair.mjs's baseline commands run against these same
// repoPaths). Empty when nothing is onboarded yet -- fails closed to "allow
// nothing" rather than defaulting open.
export function trustedRegistryRootsFromOperatorState(opState) {
  const records = Object.values(opState?.onboardedProjects ?? {})
  return records
    .map((record) => record?.repoPath)
    .filter((repoPath) => typeof repoPath === 'string' && repoPath.length > 0)
}

// The documented Orca-core -> TSF integration seam. `candidate` is a real
// Orca `WorkspaceCleanupCandidate` (src/shared/workspace-cleanup.ts) as
// returned by `workspaceCleanup:scan` -- its blockers array is Orca's own,
// already-tested main-worktree/folder-repo/pinned/git-evidence/PTY-liveness
// evidence. `extra` supplies everything Orca's cleanup feature does not
// carry (per the reconciliation: locked state, active-workspace/live-agent/
// terminal-liveness booleans, editor/volatile-context, TSF mission refs,
// path-identity verification, resource usage, inactivity ranking).
export function mapOrcaWorkspaceCleanupCandidateToEvidence(candidate, extra = {}) {
  const blockers = new Set(candidate?.blockers ?? [])
  const has = (code) => blockers.has(code)

  return {
    resourceId: extra.resourceId ?? candidate?.worktreeId ?? null,
    host: extra.host ?? 'local',
    path: candidate?.path ?? extra.path ?? null,
    repoRoot: extra.repoRoot ?? null,
    isMainWorktree: candidate?.worktree?.isMainWorktree ?? (has('main-worktree') ? true : null),
    isFolderRepo: has('folder-repo') ? true : (extra.isFolderRepo ?? null),
    isPinned: candidate?.worktree?.isPinned ?? (has('pinned') ? true : null),
    // Orca's workspace-cleanup layer has no "locked" concept at all (per
    // reconciliation) -- always caller-supplied, defaulting to unknown.
    isLocked: extra.isLocked ?? null,
    branch: candidate?.worktree?.branch ?? null,
    head: candidate?.worktree?.head ?? null,
    git: {
      checkedAt: candidate?.git?.checkedAt ?? extra.gitCheckedAt ?? null,
      clean: candidate?.git?.clean ?? null,
      conflicted: extra.conflicted ?? null,
      activeGitOperation: extra.activeGitOperation ?? null,
      stashCount: extra.stashCount ?? null,
      submodulesDirty: extra.submodulesDirty ?? null,
      hasUpstream:
        candidate?.git?.upstreamAhead !== null && candidate?.git?.upstreamAhead !== undefined
          ? true
          : has('unknown-base')
            ? false
            : (extra.hasUpstream ?? null),
      upstreamAhead: candidate?.git?.upstreamAhead ?? null,
      upstreamBehind: candidate?.git?.upstreamBehind ?? null,
      unpushedLocalCommits: extra.unpushedLocalCommits ?? null
    },
    ownership: {
      activeWorkspace: has('active-workspace') ? true : (extra.activeWorkspace ?? null),
      activeAgent: has('live-agent') ? true : (extra.activeAgent ?? null),
      runningTerminal: has('running-terminal')
        ? true
        : has('terminal-liveness-unknown')
          ? null
          : (extra.runningTerminal ?? null),
      pid: extra.pid ?? null,
      pidStartTime: extra.pidStartTime ?? null,
      matchedSessionId: extra.matchedSessionId ?? null,
      editorDirtyBuffer: has('dirty-editor-buffer') ? true : (extra.editorDirtyBuffer ?? null),
      volatileLocalContext: has('volatile-local-context')
        ? true
        : (extra.volatileLocalContext ?? null),
      tsfMissionRef: extra.tsfMissionRef ?? null
    },
    pathIdentity: {
      expectedPath: extra.expectedPath ?? candidate?.path ?? null,
      resolvedPath: extra.resolvedPath ?? candidate?.path ?? null,
      matchesExpected: extra.pathIdentityVerified ?? null,
      containsOtherRegisteredWorktree: extra.containsOtherRegisteredWorktree ?? null
    },
    connectivity: has('ssh-disconnected') ? { sshReachable: false } : extra.connectivity,
    inactivity: extra.inactivity ?? { thresholdMet: null, idleSinceMs: null },
    resourceUsage: extra.resourceUsage ?? {},
    evidenceObservedAt: extra.evidenceObservedAt ?? candidate?.scannedAt ?? null,
    evidenceTtlMs: extra.evidenceTtlMs ?? 5 * 60 * 1000,
    // Provenance is caller-declared here on purpose -- this mapper itself
    // has no way to verify how `candidate`/`extra` were actually obtained.
    // The one place that verifies rather than trusts a provenance claim is
    // resource-auditor-http-routes.mjs's /classify handler, which
    // overwrites this with CALLER_SUPPLIED unconditionally for anything
    // arriving over the HTTP API.
    provenance: extra.provenance ?? { source: 'UNKNOWN' }
  }
}
