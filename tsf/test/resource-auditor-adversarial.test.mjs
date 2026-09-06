// Adversarial fixture matrix for the Orca Resource Auditor V0 classifier.
// Every fixture here is synthetic -- none of it touches a real worktree,
// and the "canonical NWR incident" fixture models the reported hazard
// (C:\NWR\Niners-War-Room appearing in a safety-filtered cleanup inventory)
// entirely in code, per the mission's explicit instruction not to modify or
// experimentally remove the real NWR workspace.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyWorkspaceResource,
  isRowSelectable,
  isBulkSelectable,
  isAdmittedToDestructiveConfirmation,
  passesFinalRemovalSafetyBoundary
} from '../domain/resource-auditor.mjs'
import {
  resolvePathIdentity,
  pathContainsRegisteredWorktree
} from '../domain/resource-auditor-evidence.mjs'

const NOW = () => new Date('2026-09-04T15:00:00.000Z')

function safeBase(overrides = {}) {
  return {
    resourceId: 'ws-adv',
    host: 'local',
    path: 'C:/worktrees/adv',
    repoRoot: 'C:/TSF_ORCA',
    isMainWorktree: false,
    isFolderRepo: false,
    isPinned: false,
    isLocked: false,
    branch: 'feature/adv',
    head: 'cafef00d',
    git: {
      checkedAt: '2026-09-04T14:58:00.000Z',
      clean: true,
      conflicted: [],
      activeGitOperation: null,
      stashCount: 0,
      submodulesDirty: false,
      hasUpstream: true,
      upstreamAhead: 0,
      upstreamBehind: 0,
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
      expectedPath: 'C:/worktrees/adv',
      resolvedPath: 'C:/worktrees/adv',
      matchesExpected: true,
      containsOtherRegisteredWorktree: false
    },
    inactivity: { thresholdMet: true, idleSinceMs: 60 * 24 * 60 * 60 * 1000 },
    resourceUsage: {},
    evidenceObservedAt: '2026-09-04T14:59:30.000Z',
    evidenceTtlMs: 5 * 60 * 1000,
    ...overrides
  }
}

// 1. Canonical main workspace -- the reported NWR incident, modeled
// synthetically. A workspace that looks disposable on every OTHER axis
// (clean, no unpushed commits, long-idle) but is the repo's main worktree
// must still land PROTECTED, never DISPOSABLE_CANDIDATE.
test('[canonical-main] the canonical/main workspace stays PROTECTED even when every other signal looks safe (synthetic NWR-incident model)', () => {
  const evidence = safeBase({
    resourceId: 'nwr-main-synthetic',
    path: 'C:/NWR-SYNTHETIC-FIXTURE/Niners-War-Room-Fixture',
    isMainWorktree: true,
    inactivity: { thresholdMet: true, idleSinceMs: 90 * 24 * 60 * 60 * 1000 }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'MAIN_WORKTREE'))
})

// 2. Nested path masquerading as a worktree.
test('[nested-masquerade] a path nested inside another registered worktree is PROTECTED', () => {
  const containment = pathContainsRegisteredWorktree('C:/worktrees/parent', [
    'C:/worktrees/parent/nested-fake-worktree'
  ])
  assert.equal(containment, true)
  const evidence = safeBase({
    pathIdentity: {
      expectedPath: 'C:/worktrees/parent',
      resolvedPath: 'C:/worktrees/parent',
      matchesExpected: true,
      containsOtherRegisteredWorktree: containment
    }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'CONTAINS_REGISTERED_WORKTREE'))
})

// 3. Case-different Windows path -- must resolve as a MATCH (not a
// spurious UNEXPECTED_PATH_IDENTITY block) on a case-insensitive filesystem.
test('[case-insensitive] a case-different Windows path still resolves as the expected identity', () => {
  const identity = resolvePathIdentity('C:/Worktrees/Feature-X', 'c:/worktrees/feature-x')
  assert.equal(identity.matchesExpected, true)
  const evidence = safeBase({ pathIdentity: { ...evidencePathIdentity(identity) } })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.notEqual(result.classification, 'PROTECTED')
})

// 4. Junction/reparse-point alias -- documented limitation, not silently
// assumed safe: without a caller-supplied resolvedPath that differs from
// the junction target, this must fail closed to UNKNOWN, not DISPOSABLE.
test('[junction-alias] an unresolved junction/reparse alias fails closed to UNKNOWN (documented V0 limitation)', () => {
  const evidence = safeBase({
    pathIdentity: {
      expectedPath: 'C:/worktrees/real-target',
      resolvedPath: null, // V0 has no junction-target resolver; caller could not supply one
      matchesExpected: null
    }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'UNKNOWN')
  assert.ok(result.blockers.some((b) => b.code === 'PATH_IDENTITY_UNKNOWN'))
})

// 5. Clean tree + unpushed commit.
test('[clean-but-unpushed] a clean working tree with an unpushed commit is PROTECTED', () => {
  const evidence = safeBase({ git: { ...safeBase().git, clean: true, upstreamAhead: 1 } })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'UNPUSHED_COMMITS'))
})

// 6. Dirty tree.
test('[dirty-tree] a dirty working tree is PROTECTED', () => {
  const evidence = safeBase({ git: { ...safeBase().git, clean: false } })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'PROTECTED')
})

// 7. Ignored private local-only data -- git status alone (`clean: true`
// from a porcelain scan that only sees tracked/untracked, not ignored
// files) is not sufficient; a caller who knows ignored data exists must
// surface it as a git-operation-shaped hazard, not silently pass.
test('[ignored-private-data] known ignored local-only data is carried as an explicit hazard, not silently cleared by git clean=true', () => {
  const evidence = safeBase({
    git: { ...safeBase().git, clean: true, activeGitOperation: null },
    ownership: { ...safeBase().ownership, volatileLocalContext: true }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'VOLATILE_LOCAL_CONTEXT'))
})

// 8. Stash present.
test('[stash] a present stash is PROTECTED', () => {
  const evidence = safeBase({ git: { ...safeBase().git, stashCount: 1 } })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'PROTECTED')
})

// 9. In-progress Git operation.
test('[git-op-in-progress] an in-progress rebase/merge/cherry-pick/bisect is PROTECTED', () => {
  for (const kind of ['rebase', 'merge', 'cherry-pick', 'bisect']) {
    const evidence = safeBase({ git: { ...safeBase().git, activeGitOperation: kind } })
    assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'PROTECTED', kind)
  }
})

// 10. Unknown remote state.
test('[unknown-remote] unknown upstream/remote reachability is UNKNOWN', () => {
  const evidence = safeBase({ git: { ...safeBase().git, hasUpstream: null } })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'UNKNOWN')
})

// 11. Git-status failure.
test('[git-status-failure] a failed/unavailable git status is UNKNOWN', () => {
  const evidence = safeBase({ git: { checkedAt: null } })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'UNKNOWN')
})

// 12/13. Pinned, locked.
test('[pinned] pinned is PROTECTED', () => {
  assert.equal(
    classifyWorkspaceResource(safeBase({ isPinned: true }), NOW).classification,
    'PROTECTED'
  )
})
test('[locked] locked is PROTECTED', () => {
  assert.equal(
    classifyWorkspaceResource(safeBase({ isLocked: true }), NOW).classification,
    'PROTECTED'
  )
})

// 14. Active agent.
test('[active-agent] an active agent is PROTECTED', () => {
  const evidence = safeBase({ ownership: { ...safeBase().ownership, activeAgent: true } })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'PROTECTED')
})

// 15. Live terminal.
test('[live-terminal] a confirmed-live terminal is PROTECTED', () => {
  const evidence = safeBase({ ownership: { ...safeBase().ownership, runningTerminal: true } })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'PROTECTED')
})

// 16. Stale terminal evidence -- liveness was checked once, long enough ago
// that the whole evidence bundle is stale; must not be trusted as current.
test('[stale-terminal-evidence] stale overall evidence (including a once-checked terminal) fails closed to UNKNOWN', () => {
  const evidence = safeBase({
    ownership: { ...safeBase().ownership, runningTerminal: false },
    evidenceObservedAt: '2026-09-04T14:00:00.000Z' // >5min TTL before NOW
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'UNKNOWN')
  assert.ok(result.blockers.some((b) => b.code === 'EVIDENCE_STALE'))
})

// 17. PID reuse / start-time mismatch -- a matched session exists, but its
// recorded start time doesn't match the live process's start time, so the
// "match" itself is not trustworthy. Modeled as ownership unmatched
// (matchedSessionId cleared) rather than trusting a stale match.
test('[pid-reuse] a PID whose recorded start time no longer matches the live process is treated as an unmatched/unknown owner', () => {
  const recordedStartTime = '2026-09-01T10:00:00.000Z'
  const liveStartTime = '2026-09-04T13:00:00.000Z' // different process now holds this PID
  const matchedSessionId = recordedStartTime === liveStartTime ? 'session-x' : null
  const evidence = safeBase({
    ownership: {
      ...safeBase().ownership,
      pid: 4242,
      pidStartTime: liveStartTime,
      matchedSessionId
    }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'UNKNOWN')
  assert.ok(result.blockers.some((b) => b.code === 'PROCESS_OWNERSHIP_UNKNOWN'))
})

// 18. Unknown process owner.
test('[unknown-process-owner] a live PID with no matched session is UNKNOWN', () => {
  const evidence = safeBase({
    ownership: { ...safeBase().ownership, pid: 9999, matchedSessionId: null }
  })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'UNKNOWN')
})

// 19. Active TSF mission reference.
test('[active-mission-ref] an active TSF mission reference is PROTECTED regardless of everything else', () => {
  const evidence = safeBase({
    ownership: { ...safeBase().ownership, tsfMissionRef: 'keep-going-run-77' }
  })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'PROTECTED')
})

// 20. Old but otherwise safe worktree -- age alone completes the picture,
// nothing overrides.
test('[old-but-safe] an old, fully-verified-safe worktree past the inactivity threshold is DISPOSABLE_CANDIDATE', () => {
  const evidence = safeBase({
    inactivity: { thresholdMet: true, idleSinceMs: 180 * 24 * 60 * 60 * 1000 }
  })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'DISPOSABLE_CANDIDATE')
})

// 21. Huge but protected worktree -- size never overrides a real blocker.
test('[huge-but-protected] disk size never overrides a hard blocker', () => {
  const evidence = safeBase({
    isPinned: true,
    resourceUsage: { workspaceBytesApprox: 200 * 1024 ** 3 }
  })
  assert.equal(classifyWorkspaceResource(evidence, NOW).classification, 'PROTECTED')
})

// 22. Contradictory evidence -- git says clean, but a stash exists (the two
// evidence collectors disagree). The classifier does not attempt to
// reconcile; each signal is checked independently, so the stash blocker
// still fires regardless of what "clean" reports.
test('[contradictory-evidence] independently-collected evidence that disagrees still fails closed via whichever signal is unsafe', () => {
  const evidence = safeBase({ git: { ...safeBase().git, clean: true, stashCount: 3 } })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'STASH_PRESENT'))
})

// 23. Evidence changing between scan and dry-run generation -- classify
// twice against two different evidence snapshots for the SAME resourceId;
// the second (fresher, now-unsafe) snapshot must win, and the dry-run plan
// built from stale evidence must carry the OLD evidence's own timestamp,
// never silently adopt fresher facts it was not given.
test('[evidence-drift] a resource reclassified between scan-time and dry-run-time reflects the evidence it was actually given, not stale memory', () => {
  const scanTimeEvidence = safeBase({ evidenceObservedAt: '2026-09-04T14:59:00.000Z' })
  const dryRunTimeEvidence = safeBase({
    git: { ...safeBase().git, clean: false }, // a real edit landed in between
    evidenceObservedAt: '2026-09-04T14:59:50.000Z'
  })
  const scanResult = classifyWorkspaceResource(scanTimeEvidence, NOW)
  const dryRunResult = classifyWorkspaceResource(dryRunTimeEvidence, NOW)
  assert.equal(scanResult.classification, 'DISPOSABLE_CANDIDATE')
  assert.equal(dryRunResult.classification, 'PROTECTED')
})

// 24. Canonical-main alias -- a case-different path alias of the SAME
// canonical main worktree must still resolve as a path-identity match
// (not spuriously flagged UNEXPECTED_PATH_IDENTITY) while isMainWorktree
// still independently forces PROTECTED. The two checks are deliberately
// unrelated: an alias being "the same place" never excuses it from being
// the main worktree.
test('[canonical-main-alias] a case-different alias of the canonical main workspace is still PROTECTED via MAIN_WORKTREE, not bypassed by a path match', () => {
  const identity = resolvePathIdentity(
    'C:/NWR-SYNTHETIC-FIXTURE/Niners-War-Room-Fixture',
    'c:/nwr-synthetic-fixture/niners-war-room-fixture'
  )
  assert.equal(identity.matchesExpected, true)
  const evidence = safeBase({
    isMainWorktree: true,
    pathIdentity: { ...evidencePathIdentity(identity), containsOtherRegisteredWorktree: false }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'MAIN_WORKTREE'))
  // Confirms the path check itself passed cleanly -- the block came from
  // isMainWorktree, not from a false path-identity alarm.
  assert.ok(!result.blockers.some((b) => b.code === 'UNEXPECTED_PATH_IDENTITY'))
})

// 25. Unexpected root via git-common-dir mismatch -- a candidate whose real
// git-common-dir does not match the repository it claims to belong to.
test('[unexpected-root] a git-common-dir identity mismatch is PROTECTED regardless of everything else looking safe', () => {
  const evidence = safeBase({
    pathIdentity: {
      ...safeBase().pathIdentity,
      gitCommonDirMatches: false,
      observedGitCommonDir: 'C:/some-other-repo/.git'
    }
  })
  const result = classifyWorkspaceResource(evidence, NOW)
  assert.equal(result.classification, 'PROTECTED')
  assert.ok(result.blockers.some((b) => b.code === 'UNEXPECTED_GIT_COMMON_DIR'))
})

// 26. Full canonical-NWR contract proof, synthetic fixtures only -- the
// four layers required by the mission: visible (a row was built and
// classified at all), not row-selectable, not bulk-selectable, not
// admitted to destructive confirmation, and independently rejected again
// at the final removal-safety boundary. C:\NWR\Niners-War-Room itself is
// never touched -- this is a fixture, per the mission's explicit
// instruction.
test('[nwr-contract] the full four-layer proof: visible, not selectable, not bulk-selectable, not confirmable, rejected at the final boundary', () => {
  const evidence = safeBase({
    resourceId: 'nwr-contract-synthetic-main',
    path: 'C:/NWR-SYNTHETIC-FIXTURE/Niners-War-Room-Fixture',
    isMainWorktree: true,
    // Every OTHER signal deliberately looks maximally safe, to prove
    // main-worktree status alone is what blocks every layer.
    git: { ...safeBase().git, clean: true, upstreamAhead: 0 },
    ownership: { ...safeBase().ownership },
    inactivity: { thresholdMet: true, idleSinceMs: 365 * 24 * 60 * 60 * 1000 }
  })
  const classification = classifyWorkspaceResource(evidence, NOW)

  // Layer 1: visible -- a real classification result was produced (a row
  // would be built and shown), not silently omitted.
  assert.ok(
    classification,
    'a classification/row must exist -- visibility is not itself the safety boundary'
  )
  assert.equal(classification.classification, 'PROTECTED')

  // Layer 2: not row-selectable.
  assert.equal(isRowSelectable(classification), false)

  // Layer 3: not bulk-selectable.
  assert.equal(isBulkSelectable(classification), false)

  // Layer 4: not admitted to destructive confirmation.
  assert.equal(isAdmittedToDestructiveConfirmation(classification), false)

  // Layer 5 (the independent, non-shared execution-time guard): rejected
  // again at the final removal-safety boundary.
  assert.equal(passesFinalRemovalSafetyBoundary(evidence, classification), false)
})

// Control case: prove the four layers are not simply hardcoded false --
// a genuinely non-main, fully-safe fixture passes every layer.
test('[nwr-contract] control: a genuinely non-main, fully-safe fixture passes all five layers', () => {
  const evidence = safeBase({
    inactivity: { thresholdMet: true, idleSinceMs: 365 * 24 * 60 * 60 * 1000 }
  })
  const classification = classifyWorkspaceResource(evidence, NOW)
  assert.equal(classification.classification, 'DISPOSABLE_CANDIDATE')
  assert.equal(isRowSelectable(classification), true)
  assert.equal(isBulkSelectable(classification), true)
  assert.equal(isAdmittedToDestructiveConfirmation(classification), true)
  assert.equal(passesFinalRemovalSafetyBoundary(evidence, classification), true)
})

function evidencePathIdentity(identity) {
  return {
    expectedPath: identity.normalizedExpected,
    resolvedPath: identity.normalizedResolved,
    matchesExpected: identity.matchesExpected,
    containsOtherRegisteredWorktree: false
  }
}
