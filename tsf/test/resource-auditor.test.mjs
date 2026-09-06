import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyWorkspaceResource,
  buildResourceAuditDryRunPlan,
  buildResourcePressureRecommendations,
  RESOURCE_CLASSIFICATIONS,
  EVIDENCE_PROVENANCE_SOURCES,
  isProductionTrustedProvenance,
  applyProductionTrustBoundary,
  isRowSelectable,
  isBulkSelectable,
  isAdmittedToDestructiveConfirmation,
  passesFinalRemovalSafetyBoundary
} from '../domain/resource-auditor.mjs'
import {
  parseGitCountObjectsSize,
  parseGitCountObjectsVerbose,
  classifyGitObjectStoreDiskUsage,
  buildProcessOwnershipEvidence,
  mapOrcaWorkspaceCleanupCandidateToEvidence,
  isPathWithinRegisteredRoots,
  trustedRegistryRootsFromOperatorState
} from '../domain/resource-auditor-evidence.mjs'

const NOW = () => new Date('2026-09-04T15:00:00.000Z')

// A fully clean, fully-verified, genuinely inactive workspace -- every
// field explicitly known and safe. This is the ONLY shape in this file that
// should reach DISPOSABLE_CANDIDATE; every other test perturbs exactly one
// field off of this baseline.
function safeEvidence(overrides = {}) {
  return {
    resourceId: 'ws-1',
    host: 'local',
    path: 'C:/worktrees/old-feature',
    repoRoot: 'C:/TSF_ORCA',
    isMainWorktree: false,
    isFolderRepo: false,
    isPinned: false,
    isLocked: false,
    branch: 'feature/old',
    head: 'abc123',
    git: {
      checkedAt: '2026-09-04T14:58:00.000Z',
      clean: true,
      conflicted: [],
      activeGitOperation: null,
      stashCount: 0,
      submodulesDirty: false,
      hasUpstream: true,
      upstreamAhead: 0,
      upstreamBehind: 3,
      unpushedLocalCommits: null
    },
    ownership: {
      activeWorkspace: false,
      activeAgent: false,
      runningTerminal: false,
      pid: null,
      pidStartTime: null,
      matchedSessionId: null,
      editorDirtyBuffer: false,
      volatileLocalContext: false,
      tsfMissionRef: null
    },
    pathIdentity: {
      expectedPath: 'C:/worktrees/old-feature',
      resolvedPath: 'C:/worktrees/old-feature',
      matchesExpected: true,
      containsOtherRegisteredWorktree: false
    },
    inactivity: { thresholdMet: true, idleSinceMs: 40 * 24 * 60 * 60 * 1000 },
    resourceUsage: {},
    evidenceObservedAt: '2026-09-04T14:59:30.000Z',
    evidenceTtlMs: 5 * 60 * 1000,
    ...overrides
  }
}

test('a fully clean, fully verified, inactive workspace is DISPOSABLE_CANDIDATE', () => {
  const result = classifyWorkspaceResource(safeEvidence(), NOW)
  assert.equal(result.classification, 'DISPOSABLE_CANDIDATE')
  assert.equal(result.blockers.length, 0)
})

test('the same evidence without the inactivity threshold met stays REVIEW, never DISPOSABLE_CANDIDATE', () => {
  const result = classifyWorkspaceResource(
    safeEvidence({ inactivity: { thresholdMet: false, idleSinceMs: 1000 } }),
    NOW
  )
  assert.equal(result.classification, 'REVIEW')
})

test('unknown inactivity threshold also stays REVIEW, not DISPOSABLE_CANDIDATE', () => {
  const result = classifyWorkspaceResource(
    safeEvidence({ inactivity: { thresholdMet: null, idleSinceMs: null } }),
    NOW
  )
  assert.equal(result.classification, 'REVIEW')
})

test('RESOURCE_CLASSIFICATIONS is exactly the four fail-closed states', () => {
  assert.deepEqual(RESOURCE_CLASSIFICATIONS, [
    'PROTECTED',
    'UNKNOWN',
    'REVIEW',
    'DISPOSABLE_CANDIDATE'
  ])
})

const HARD_BLOCKER_CASES = [
  ['main worktree', { isMainWorktree: true }, 'MAIN_WORKTREE'],
  ['folder project root', { isFolderRepo: true }, 'FOLDER_ROOT'],
  ['pinned', { isPinned: true }, 'PINNED'],
  ['locked', { isLocked: true }, 'LOCKED'],
  [
    'unexpected path identity',
    { pathIdentity: { matchesExpected: false } },
    'UNEXPECTED_PATH_IDENTITY'
  ],
  [
    'nested inside another registered worktree',
    { pathIdentity: { matchesExpected: true, containsOtherRegisteredWorktree: true } },
    'CONTAINS_REGISTERED_WORKTREE'
  ],
  [
    'active git operation',
    { git: { ...safeEvidence().git, activeGitOperation: 'rebase' } },
    'ACTIVE_GIT_OPERATION'
  ],
  ['uncommitted changes', { git: { ...safeEvidence().git, clean: false } }, 'UNCOMMITTED_CHANGES'],
  ['conflicted files', { git: { ...safeEvidence().git, conflicted: ['a.ts'] } }, 'GIT_CONFLICTED'],
  ['stash present', { git: { ...safeEvidence().git, stashCount: 2 } }, 'STASH_PRESENT'],
  ['dirty submodule', { git: { ...safeEvidence().git, submodulesDirty: true } }, 'SUBMODULE_DIRTY'],
  [
    'unpushed commits (with upstream)',
    { git: { ...safeEvidence().git, upstreamAhead: 4 } },
    'UNPUSHED_COMMITS'
  ],
  [
    'unpushed commits (no upstream)',
    { git: { ...safeEvidence().git, hasUpstream: false, unpushedLocalCommits: 1 } },
    'UNPUSHED_COMMITS'
  ],
  [
    'active workspace',
    { ownership: { ...safeEvidence().ownership, activeWorkspace: true } },
    'ACTIVE_WORKSPACE'
  ],
  [
    'active agent',
    { ownership: { ...safeEvidence().ownership, activeAgent: true } },
    'ACTIVE_AGENT'
  ],
  [
    'running terminal',
    { ownership: { ...safeEvidence().ownership, runningTerminal: true } },
    'RUNNING_TERMINAL'
  ],
  [
    'dirty editor buffer',
    { ownership: { ...safeEvidence().ownership, editorDirtyBuffer: true } },
    'DIRTY_EDITOR_BUFFER'
  ],
  [
    'volatile local context',
    { ownership: { ...safeEvidence().ownership, volatileLocalContext: true } },
    'VOLATILE_LOCAL_CONTEXT'
  ],
  [
    'active TSF mission reference',
    { ownership: { ...safeEvidence().ownership, tsfMissionRef: 'run-42' } },
    'ACTIVE_TSF_MISSION_REFERENCE'
  ],
  ['SSH disconnected', { connectivity: { sshReachable: false } }, 'SSH_DISCONNECTED'],
  [
    'unexpected git common-directory identity',
    { pathIdentity: { ...safeEvidence().pathIdentity, gitCommonDirMatches: false } },
    'UNEXPECTED_GIT_COMMON_DIR'
  ]
]

for (const [label, overrides, expectedBlockerCode] of HARD_BLOCKER_CASES) {
  test(`hard blocker overrides an otherwise-safe candidate: ${label}`, () => {
    const result = classifyWorkspaceResource(safeEvidence(overrides), NOW)
    assert.equal(result.classification, 'PROTECTED')
    assert.ok(
      result.blockers.some((b) => b.code === expectedBlockerCode),
      `expected blocker ${expectedBlockerCode}, got ${JSON.stringify(result.blockers)}`
    )
  })
}

const UNKNOWN_CASES = [
  ['stale evidence', { evidenceObservedAt: '2026-09-04T14:00:00.000Z' }, 'EVIDENCE_STALE'],
  ['no evidence timestamp at all', { evidenceObservedAt: null }, 'EVIDENCE_STALE'],
  ['unknown main-worktree state', { isMainWorktree: null }, 'MAIN_WORKTREE_UNKNOWN'],
  ['unknown path identity', { pathIdentity: { matchesExpected: null } }, 'PATH_IDENTITY_UNKNOWN'],
  ['git status never checked', { git: { checkedAt: null } }, 'GIT_STATUS_UNAVAILABLE'],
  ['git clean state unknown', { git: { ...safeEvidence().git, clean: null } }, 'GIT_CLEAN_UNKNOWN'],
  [
    'stash state unknown',
    { git: { ...safeEvidence().git, stashCount: null } },
    'STASH_STATE_UNKNOWN'
  ],
  [
    'commit reachability unverified (upstream present, ahead count missing)',
    { git: { ...safeEvidence().git, upstreamAhead: null } },
    'COMMIT_REACHABILITY_UNVERIFIED'
  ],
  [
    'commit reachability unverified (no upstream, local-commit count missing)',
    { git: { ...safeEvidence().git, hasUpstream: false, unpushedLocalCommits: null } },
    'COMMIT_REACHABILITY_UNVERIFIED'
  ],
  [
    'commit reachability unverified (hasUpstream itself unknown)',
    { git: { ...safeEvidence().git, hasUpstream: null } },
    'COMMIT_REACHABILITY_UNVERIFIED'
  ],
  [
    'terminal liveness unknown',
    { ownership: { ...safeEvidence().ownership, runningTerminal: null } },
    'TERMINAL_LIVENESS_UNKNOWN'
  ],
  [
    'unknown process owner (PID present, no matched session)',
    { ownership: { ...safeEvidence().ownership, pid: 4242, matchedSessionId: null } },
    'PROCESS_OWNERSHIP_UNKNOWN'
  ],
  // Independent-adversarial-review findings: these three fields previously
  // had no "unknown" branch at all -- null was silently read the same as
  // "confirmed safe", reaching DISPOSABLE_CANDIDATE with zero blockers.
  [
    'nested-worktree containment unknown (registry check incomplete/failed)',
    {
      git: safeEvidence().git,
      pathIdentity: { ...safeEvidence().pathIdentity, containsOtherRegisteredWorktree: null }
    },
    'CONTAINS_REGISTERED_WORKTREE_UNKNOWN'
  ],
  [
    'conflicted-file status never collected',
    { git: { ...safeEvidence().git, conflicted: null } },
    'GIT_CONFLICTED_UNKNOWN'
  ],
  [
    'SSH reachability ambiguous (probe present but inconclusive)',
    { connectivity: { sshReachable: null } },
    'SSH_REACHABILITY_UNKNOWN'
  ],
  [
    'git common-directory identity checked but unresolvable',
    { pathIdentity: { ...safeEvidence().pathIdentity, gitCommonDirMatches: null } },
    'GIT_COMMON_DIR_UNKNOWN'
  ]
]

test('git common-directory identity is not checked at all when the field is entirely absent (not applicable, not unknown)', () => {
  const evidence = safeEvidence()
  assert.equal('gitCommonDirMatches' in evidence.pathIdentity, false)
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'DISPOSABLE_CANDIDATE')
})

for (const [label, overrides, expectedBlockerCode] of UNKNOWN_CASES) {
  test(`missing/unverifiable evidence fails closed to UNKNOWN, never DISPOSABLE_CANDIDATE: ${label}`, () => {
    const result = classifyWorkspaceResource(safeEvidence(overrides), NOW)
    assert.equal(result.classification, 'UNKNOWN')
    assert.ok(
      result.blockers.some((b) => b.code === expectedBlockerCode),
      `expected blocker ${expectedBlockerCode}, got ${JSON.stringify(result.blockers)}`
    )
  })
}

test('connectivity being entirely absent (non-SSH-backed resource) is not-applicable, not UNKNOWN', () => {
  const evidence = safeEvidence()
  assert.equal('connectivity' in evidence, false)
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'DISPOSABLE_CANDIDATE')
})

test('a hard blocker always outranks an UNKNOWN also present (PROTECTED wins, not UNKNOWN)', () => {
  const result = classifyWorkspaceResource(
    safeEvidence({ isMainWorktree: true, git: { checkedAt: null } }),
    NOW
  )
  assert.equal(result.classification, 'PROTECTED')
})

test('age/size/branch-name-shaped signals never appear as blockers and cannot promote to DISPOSABLE_CANDIDATE on their own', () => {
  // Old, big, oddly-named, but NOT yet proven inactive by the classifier's
  // own inactivity gate -- must stay REVIEW even though every other field
  // is safe.
  const result = classifyWorkspaceResource(
    safeEvidence({
      branch: 'temp-DELETE-ME-old-2019',
      resourceUsage: { workspaceBytesApprox: 50 * 1024 ** 3 },
      inactivity: { thresholdMet: false, idleSinceMs: 1000 }
    }),
    NOW
  )
  assert.equal(result.classification, 'REVIEW')
})

test('dry-run plan never authorizes execution and never claims a guaranteed reclaim', () => {
  const evidence = safeEvidence()
  const classification = classifyWorkspaceResource(evidence, NOW)
  const plan = buildResourceAuditDryRunPlan(evidence, classification, NOW)
  assert.equal(plan.executionAuthorized, false)
  assert.equal(plan.confirmationToken, null)
  assert.equal(plan.expectedBenefit.guaranteedReclaim, false)
  assert.equal(plan.authority, 'ADVISORY_ONLY')
  assert.ok(plan.snapshotHash)
  assert.equal(plan.classification, 'DISPOSABLE_CANDIDATE')
  assert.notEqual(plan.recommendedAction, undefined)
  assert.ok(!/delete|remove|prune|kill/i.test(plan.recommendedAction))
})

test('dry-run plan for a PROTECTED resource recommends NO_ACTION', () => {
  const evidence = safeEvidence({ isMainWorktree: true })
  const classification = classifyWorkspaceResource(evidence, NOW)
  const plan = buildResourceAuditDryRunPlan(evidence, classification, NOW)
  assert.equal(plan.recommendedAction, 'NO_ACTION')
})

test('buildResourcePressureRecommendations separates RAM/disk/CPU without upgrading classifications', () => {
  const evidence = safeEvidence({
    resourceUsage: {
      processWorkingSetBytesApprox: 200 * 1024 * 1024,
      workspaceBytesApprox: 1024 ** 3,
      cpuPercentSample: 12,
      sampleWindowMs: 4000
    }
  })
  const classification = classifyWorkspaceResource(evidence, NOW)
  const plan = buildResourceAuditDryRunPlan(evidence, classification, NOW)
  const grouped = buildResourcePressureRecommendations([plan])
  assert.equal(grouped.ram.length, 1)
  assert.equal(grouped.disk.length, 1)
  assert.equal(grouped.cpu.length, 1)
  assert.equal(grouped.ram[0].guaranteedReclaim, false)
})

// --- resource-auditor-evidence.mjs ---

test('parseGitCountObjectsSize parses exact byte counts and refuses to guess', () => {
  assert.equal(parseGitCountObjectsSize('26.35 GiB'), Math.round(26.35 * 1024 ** 3))
  assert.equal(parseGitCountObjectsSize('246.35 MiB'), Math.round(246.35 * 1024 ** 2))
  assert.equal(parseGitCountObjectsSize('0 bytes'), 0)
  assert.equal(parseGitCountObjectsSize('not a size'), null)
  assert.equal(parseGitCountObjectsSize(undefined), null)
})

test('parseGitCountObjectsVerbose preserves every field verbatim plus a parsed byte count', () => {
  const stdout = [
    'count: 12',
    'size: 85.18 MiB',
    'in-pack: 456789',
    'packs: 3',
    'size-pack: 246.35 MiB',
    'prune-packable: 0',
    'garbage: 7',
    'size-garbage: 26.35 GiB',
    ''
  ].join('\n')
  const fields = parseGitCountObjectsVerbose(stdout)
  assert.equal(fields.count, 12)
  assert.equal(fields.size, '85.18 MiB')
  assert.equal(fields.sizeGarbage, '26.35 GiB')
  assert.equal(fields.sizeGarbageBytes, Math.round(26.35 * 1024 ** 3))
  assert.equal(fields.garbage, 7)
})

test('classifyGitObjectStoreDiskUsage never labels size-garbage as reclaimable and records the exact command', () => {
  const fields = parseGitCountObjectsVerbose('size-garbage: 26.35 GiB\n')
  const result = classifyGitObjectStoreDiskUsage(fields, {
    observedAt: '2026-09-04T15:00:00.000Z',
    worktreePath: 'C:/TSF_ORCA'
  })
  assert.equal(result.classification, 'DISK_USAGE_UNKNOWN_RECLAIMABLE')
  assert.equal(result.reachabilityVerified, false)
  assert.equal(result.command, 'git count-objects -vH')
  assert.ok(!/reclaimable|garbage can be/i.test(result.note) || /must not/i.test(result.note))
  assert.match(result.note, /must not be presented as reclaimable/i)
})

test('buildProcessOwnershipEvidence reports observed CPU activity separately from ownership, never as proof of closeability', () => {
  const evidence = buildProcessOwnershipEvidence({
    pid: 29020,
    matchedSessionId: 'tsf-operator-stabilization-v1-63',
    cpuPercentSample: 0,
    sampleWindowMs: 4000
  })
  assert.equal(evidence.cpuActivityObservedDuringSample, false)
  assert.equal(evidence.ownershipVerified, true)
  // No field on this shape claims "closeable" or "safe" -- the classifier
  // alone (via ownership.activeAgent/activeWorkspace, not CPU) decides that.
  assert.equal('closeable' in evidence, false)
  assert.equal('safeToClose' in evidence, false)
})

test('a known owner with no explicit release stays a hard blocker regardless of CPU idleness (PID 29020 correction)', () => {
  // Models the real correction: a running process with a known owner
  // (tsf-operator-stabilization-v1's pilot server) is PROTECTED until that
  // owner or governed mission state explicitly releases it -- CPU-idle
  // during a sample never demotes it on its own.
  const evidence = safeEvidence({
    ownership: {
      activeWorkspace: true,
      activeAgent: true,
      runningTerminal: null,
      pid: 29020,
      pidStartTime: '2026-09-03T20:16:35.000Z',
      matchedSessionId: 'tsf-operator-stabilization-v1-63',
      editorDirtyBuffer: false,
      volatileLocalContext: false,
      tsfMissionRef: null
    }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'ACTIVE_WORKSPACE' || b.code === 'ACTIVE_AGENT'))
})

test("mapOrcaWorkspaceCleanupCandidateToEvidence carries Orca's own main-worktree blocker through unchanged", () => {
  const candidate = {
    worktreeId: 'wt-1',
    path: 'C:/TSF_ORCA',
    scannedAt: '2026-09-04T14:59:00.000Z',
    worktree: { isMainWorktree: true, isPinned: false, branch: 'main', head: 'deadbeef' },
    blockers: ['main-worktree'],
    git: { clean: null, checkedAt: null, upstreamAhead: null, upstreamBehind: null }
  }
  const evidence = mapOrcaWorkspaceCleanupCandidateToEvidence(candidate, {
    evidenceObservedAt: '2026-09-04T14:59:30.000Z'
  })
  assert.equal(evidence.isMainWorktree, true)
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'MAIN_WORKTREE'))
})

// --- Evidence provenance / production trust boundary ---

test('EVIDENCE_PROVENANCE_SOURCES enumerates exactly the five required sources', () => {
  assert.deepEqual(EVIDENCE_PROVENANCE_SOURCES, [
    'TRUSTED_LOCAL_COLLECTOR',
    'ORCA_NATIVE_SCAN',
    'CALLER_SUPPLIED',
    'SYNTHETIC_TEST',
    'UNKNOWN'
  ])
})

test('isProductionTrustedProvenance is true only for TRUSTED_LOCAL_COLLECTOR and ORCA_NATIVE_SCAN', () => {
  assert.equal(isProductionTrustedProvenance('TRUSTED_LOCAL_COLLECTOR'), true)
  assert.equal(isProductionTrustedProvenance('ORCA_NATIVE_SCAN'), true)
  assert.equal(isProductionTrustedProvenance('CALLER_SUPPLIED'), false)
  assert.equal(isProductionTrustedProvenance('SYNTHETIC_TEST'), false)
  assert.equal(isProductionTrustedProvenance('UNKNOWN'), false)
  assert.equal(isProductionTrustedProvenance(undefined), false)
})

test('applyProductionTrustBoundary demotes a DISPOSABLE_CANDIDATE from an untrusted source to REVIEW', () => {
  const evidence = safeEvidence({ provenance: { source: 'CALLER_SUPPLIED' } })
  const raw = classifyWorkspaceResource(evidence, NOW)
  assert.equal(raw.classification, 'DISPOSABLE_CANDIDATE')
  const bounded = applyProductionTrustBoundary(raw, evidence)
  assert.equal(bounded.classification, 'REVIEW')
  assert.equal(bounded.productionTrustCeilingApplied, true)
  assert.ok(bounded.blockers.some((b) => b.code === 'EVIDENCE_PROVENANCE_NOT_PRODUCTION_TRUSTED'))
})

test('applyProductionTrustBoundary lets a trusted-provenance DISPOSABLE_CANDIDATE through unchanged', () => {
  const evidence = safeEvidence({ provenance: { source: 'TRUSTED_LOCAL_COLLECTOR' } })
  const raw = classifyWorkspaceResource(evidence, NOW)
  const bounded = applyProductionTrustBoundary(raw, evidence)
  assert.equal(bounded.classification, 'DISPOSABLE_CANDIDATE')
  assert.equal(bounded.productionTrustCeilingApplied, false)
})

test('applyProductionTrustBoundary demotes evidence with NO provenance field at all (default fail-closed)', () => {
  const evidence = safeEvidence()
  assert.equal('provenance' in evidence, false)
  const raw = classifyWorkspaceResource(evidence, NOW)
  const bounded = applyProductionTrustBoundary(raw, evidence)
  assert.equal(bounded.classification, 'REVIEW')
})

test('applyProductionTrustBoundary never RAISES an already-unsafe classification -- it only ever demotes an all-clear', () => {
  const evidence = safeEvidence({ isMainWorktree: true, provenance: { source: 'CALLER_SUPPLIED' } })
  const raw = classifyWorkspaceResource(evidence, NOW)
  assert.equal(raw.classification, 'PROTECTED')
  const bounded = applyProductionTrustBoundary(raw, evidence)
  assert.equal(bounded.classification, 'PROTECTED')
  assert.equal(bounded.productionTrustCeilingApplied, false)
})

test('dry-run plan explains evidence provenance, trust level, freshness, and observed-vs-asserted checks', () => {
  const evidence = safeEvidence({
    provenance: {
      source: 'TRUSTED_LOCAL_COLLECTOR',
      collectedAt: '2026-09-04T14:59:00.000Z',
      directlyObservedChecks: ['GIT_STATUS'],
      assertedChecks: ['ACTIVE_AGENT']
    }
  })
  const classification = classifyWorkspaceResource(evidence, NOW)
  const plan = buildResourceAuditDryRunPlan(evidence, classification, NOW)
  assert.equal(plan.evidenceProvenance.source, 'TRUSTED_LOCAL_COLLECTOR')
  assert.equal(plan.evidenceProvenance.productionTrusted, true)
  assert.equal(plan.evidenceProvenance.fresh, true)
  assert.deepEqual(plan.evidenceProvenance.directlyObservedChecks, ['GIT_STATUS'])
  assert.deepEqual(plan.evidenceProvenance.assertedChecks, ['ACTIVE_AGENT'])
})

// --- Trusted workspace registry (pure helpers) ---

test('isPathWithinRegisteredRoots rejects everything against an empty registry -- fail closed, not open', () => {
  assert.equal(isPathWithinRegisteredRoots('C:/some/path', []), false)
  assert.equal(isPathWithinRegisteredRoots('C:/some/path', null), false)
})

test('isPathWithinRegisteredRoots matches the root itself and any nested child, case-insensitively', () => {
  const roots = ['C:/Trusted/Repo']
  assert.equal(isPathWithinRegisteredRoots('c:/trusted/repo', roots), true)
  assert.equal(isPathWithinRegisteredRoots('C:/Trusted/Repo/nested/dir', roots), true)
  assert.equal(isPathWithinRegisteredRoots('C:/Untrusted/Other', roots), false)
})

test('isPathWithinRegisteredRoots does not treat a sibling with a matching prefix as contained', () => {
  const roots = ['C:/Trusted/Repo']
  assert.equal(isPathWithinRegisteredRoots('C:/Trusted/RepoEvilTwin', roots), false)
})

test('trustedRegistryRootsFromOperatorState extracts onboarded repoPaths and ignores incomplete records', () => {
  const opState = {
    onboardedProjects: {
      p1: { repoPath: 'C:/repos/p1' },
      p2: { repoPath: '' },
      p3: {},
      p4: { repoPath: 'C:/repos/p4' }
    }
  }
  assert.deepEqual(trustedRegistryRootsFromOperatorState(opState), ['C:/repos/p1', 'C:/repos/p4'])
})

test('trustedRegistryRootsFromOperatorState returns an empty registry when nothing is onboarded', () => {
  assert.deepEqual(trustedRegistryRootsFromOperatorState({}), [])
  assert.deepEqual(trustedRegistryRootsFromOperatorState(undefined), [])
})

// --- Canonical/main-workspace layered contract (unit-level; the full
// synthetic NWR-incident proof lives in resource-auditor-adversarial.test.mjs) ---

test('isRowSelectable/isBulkSelectable/isAdmittedToDestructiveConfirmation are all false for a PROTECTED result', () => {
  const evidence = safeEvidence({ isMainWorktree: true })
  const classification = classifyWorkspaceResource(evidence, NOW)
  assert.equal(isRowSelectable(classification), false)
  assert.equal(isBulkSelectable(classification), false)
  assert.equal(isAdmittedToDestructiveConfirmation(classification), false)
  assert.equal(passesFinalRemovalSafetyBoundary(evidence, classification), false)
})

test('all four layers pass for a genuinely safe DISPOSABLE_CANDIDATE', () => {
  const evidence = safeEvidence()
  const classification = classifyWorkspaceResource(evidence, NOW)
  assert.equal(classification.classification, 'DISPOSABLE_CANDIDATE')
  assert.equal(isRowSelectable(classification), true)
  assert.equal(isBulkSelectable(classification), true)
  assert.equal(isAdmittedToDestructiveConfirmation(classification), true)
  assert.equal(passesFinalRemovalSafetyBoundary(evidence, classification), true)
})

test('passesFinalRemovalSafetyBoundary independently rejects when isMainWorktree evidence is merely missing, even if the classifier landed elsewhere', () => {
  const evidence = safeEvidence({ isMainWorktree: undefined })
  const classification = classifyWorkspaceResource(evidence, NOW)
  assert.equal(passesFinalRemovalSafetyBoundary(evidence, classification), false)
})

test('mapOrcaWorkspaceCleanupCandidateToEvidence maps ssh-disconnected to a real SSH_DISCONNECTED hazard, not silence', () => {
  const candidate = {
    worktreeId: 'wt-2',
    path: '/remote/repo/wt',
    scannedAt: '2026-09-04T14:59:00.000Z',
    worktree: { isMainWorktree: false, isPinned: false },
    blockers: ['ssh-disconnected'],
    git: { clean: null, checkedAt: null }
  }
  const evidence = mapOrcaWorkspaceCleanupCandidateToEvidence(candidate, {
    evidenceObservedAt: '2026-09-04T14:59:30.000Z'
  })
  assert.deepEqual(evidence.connectivity, { sshReachable: false })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
})
