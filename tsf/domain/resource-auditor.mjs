// Orca Resource Auditor V0 -- fail-closed classifier + dry-run plan builder.
// Pure decision logic only; no filesystem/process/git I/O lives here (see
// resource-auditor-evidence.mjs for evidence shaping and
// server/resource-auditor-git-object-store.mjs for the one real I/O call
// this feature makes). V0 recommends only -- nothing in this file, or
// anything that consumes it, ever deletes a worktree, kills a process, runs
// Git GC, or purges a cache. See docs/tsf/TSF_RESOURCE_AUDITOR_V0.md for the
// full design and the reconciliation this was built against.
import { isoNow, canonicalJson, sha256 } from './canonical.mjs'

export const RESOURCE_CLASSIFICATIONS = ['PROTECTED', 'UNKNOWN', 'REVIEW', 'DISPOSABLE_CANDIDATE']

const DEFAULT_EVIDENCE_TTL_MS = 5 * 60 * 1000

function isEvidenceStale(evidence, nowIso) {
  if (!evidence.evidenceObservedAt) {
    return true
  }
  const observed = Date.parse(evidence.evidenceObservedAt)
  if (Number.isNaN(observed)) {
    return true
  }
  const now = Date.parse(nowIso)
  const ttl = evidence.evidenceTtlMs ?? DEFAULT_EVIDENCE_TTL_MS
  return now - observed > ttl
}

// Every blocker is tagged with the tier it forces (never lower than that
// tier, regardless of what else is true) -- this is the fail-closed table:
// a real hazard forces PROTECTED, a missing/unverifiable check forces
// UNKNOWN, and neither can be overridden by age, size, branch name, or any
// other ranking-only signal.
export function classifyWorkspaceResource(evidence, clock) {
  const now = isoNow(clock)
  const blockers = []
  const passedChecks = []
  const block = (code, tier, detail) => blockers.push({ code, tier, detail: detail ?? null })
  const pass = (code) => passedChecks.push(code)

  if (isEvidenceStale(evidence, now)) {
    block('EVIDENCE_STALE', 'UNKNOWN', {
      evidenceObservedAt: evidence.evidenceObservedAt ?? null,
      ttlMs: evidence.evidenceTtlMs ?? DEFAULT_EVIDENCE_TTL_MS
    })
  } else {
    pass('EVIDENCE_FRESH')
  }

  // Identity: canonical/main workspace, folder-project root, pinned, locked
  ternaryCheck(evidence.isMainWorktree, 'MAIN_WORKTREE', block, pass, 'NOT_MAIN_WORKTREE')
  ternaryCheck(evidence.isFolderRepo, 'FOLDER_ROOT', block, pass, 'NOT_FOLDER_ROOT')
  ternaryCheck(evidence.isPinned, 'PINNED', block, pass, 'NOT_PINNED')
  ternaryCheck(evidence.isLocked, 'LOCKED', block, pass, 'NOT_LOCKED')

  // Path identity -- Windows case-insensitivity / junction / nested-worktree
  // masquerade evidence lands here. `matchesExpected` must be explicitly
  // true; anything else (false OR unknown) fails closed.
  const path = evidence.pathIdentity ?? {}
  if (path.matchesExpected === true) {
    pass('PATH_IDENTITY_CONFIRMED')
  } else if (path.matchesExpected === false) {
    block('UNEXPECTED_PATH_IDENTITY', 'PROTECTED', {
      expectedPath: path.expectedPath ?? null,
      resolvedPath: path.resolvedPath ?? null
    })
  } else {
    block('PATH_IDENTITY_UNKNOWN', 'UNKNOWN')
  }
  if (path.containsOtherRegisteredWorktree === true) {
    block('CONTAINS_REGISTERED_WORKTREE', 'PROTECTED', { resolvedPath: path.resolvedPath ?? null })
  } else if (path.containsOtherRegisteredWorktree === false) {
    pass('NOT_CONTAINS_REGISTERED_WORKTREE')
  } else {
    block('CONTAINS_REGISTERED_WORKTREE_UNKNOWN', 'UNKNOWN')
  }
  // Git common-directory identity is optional evidence (not every evidence
  // bundle resolves it) -- only checked when the field is explicitly
  // present, matching the `connectivity` pattern below: absent means "not
  // checked for this resource", not "unknown".
  if (path.gitCommonDirMatches !== undefined) {
    if (path.gitCommonDirMatches === true) {
      pass('GIT_COMMON_DIR_CONFIRMED')
    } else if (path.gitCommonDirMatches === false) {
      block('UNEXPECTED_GIT_COMMON_DIR', 'PROTECTED', {
        observedGitCommonDir: path.observedGitCommonDir ?? null
      })
    } else {
      block('GIT_COMMON_DIR_UNKNOWN', 'UNKNOWN')
    }
  }

  // Git safety. `git clean` alone is never sufficient proof of
  // disposability -- unpushed commits, stashes, dirty submodules, and an
  // in-progress operation are each independently checked.
  const git = evidence.git ?? {}
  if (!git.checkedAt) {
    block('GIT_STATUS_UNAVAILABLE', 'UNKNOWN')
  } else {
    pass('GIT_STATUS_AVAILABLE')
    if (git.activeGitOperation) {
      block('ACTIVE_GIT_OPERATION', 'PROTECTED', { kind: git.activeGitOperation })
    } else {
      pass('NO_ACTIVE_GIT_OPERATION')
    }
    if (git.clean === true) {
      pass('GIT_CLEAN_CONFIRMED')
    } else if (git.clean === false) {
      block('UNCOMMITTED_CHANGES', 'PROTECTED')
    } else {
      block('GIT_CLEAN_UNKNOWN', 'UNKNOWN')
    }
    if (git.conflicted === null || git.conflicted === undefined) {
      block('GIT_CONFLICTED_UNKNOWN', 'UNKNOWN')
    } else if (git.conflicted.length) {
      block('GIT_CONFLICTED', 'PROTECTED', { count: git.conflicted.length })
    } else {
      pass('NO_CONFLICTED_FILES')
    }
    if (git.stashCount === null || git.stashCount === undefined) {
      block('STASH_STATE_UNKNOWN', 'UNKNOWN')
    } else if (git.stashCount > 0) {
      block('STASH_PRESENT', 'PROTECTED', { count: git.stashCount })
    } else {
      pass('NO_STASH')
    }
    ternaryCheck(git.submodulesDirty, 'SUBMODULE_DIRTY', block, pass, 'SUBMODULES_CLEAN')

    // Commit reachability: with an upstream, ahead-count is authoritative.
    // Without one, fall back to local-only-commit detection. Either branch
    // missing its number is COMMIT_REACHABILITY_UNVERIFIED, never assumed 0.
    if (git.hasUpstream === true) {
      if (git.upstreamAhead === null || git.upstreamAhead === undefined) {
        block('COMMIT_REACHABILITY_UNVERIFIED', 'UNKNOWN')
      } else if (git.upstreamAhead > 0) {
        block('UNPUSHED_COMMITS', 'PROTECTED', { upstreamAhead: git.upstreamAhead })
      } else {
        pass('UPSTREAM_REACHABLE_NO_AHEAD')
      }
    } else if (git.hasUpstream === false) {
      if (git.unpushedLocalCommits === null || git.unpushedLocalCommits === undefined) {
        block('COMMIT_REACHABILITY_UNVERIFIED', 'UNKNOWN')
      } else if (git.unpushedLocalCommits > 0) {
        block('UNPUSHED_COMMITS', 'PROTECTED', { unpushedLocalCommits: git.unpushedLocalCommits })
      } else {
        pass('NO_UPSTREAM_NO_LOCAL_COMMITS')
      }
    } else {
      block('COMMIT_REACHABILITY_UNVERIFIED', 'UNKNOWN')
    }
  }

  // Runtime ownership. Unknown process/session ownership fails closed to
  // UNKNOWN, never DISPOSABLE_CANDIDATE.
  const own = evidence.ownership ?? {}
  ternaryCheck(own.activeWorkspace, 'ACTIVE_WORKSPACE', block, pass, 'NOT_ACTIVE_WORKSPACE')
  ternaryCheck(own.activeAgent, 'ACTIVE_AGENT', block, pass, 'NOT_ACTIVE_AGENT')
  ternaryCheck(
    own.runningTerminal,
    'RUNNING_TERMINAL',
    block,
    pass,
    'NO_RUNNING_TERMINAL',
    'TERMINAL_LIVENESS_UNKNOWN'
  )
  if (own.pid !== null && own.pid !== undefined && !own.matchedSessionId) {
    block('PROCESS_OWNERSHIP_UNKNOWN', 'UNKNOWN', { pid: own.pid })
  } else if (own.pid !== null && own.pid !== undefined) {
    pass('PROCESS_OWNERSHIP_VERIFIED')
  }
  ternaryCheck(own.editorDirtyBuffer, 'DIRTY_EDITOR_BUFFER', block, pass, 'NO_DIRTY_EDITOR_BUFFER')
  ternaryCheck(
    own.volatileLocalContext,
    'VOLATILE_LOCAL_CONTEXT',
    block,
    pass,
    'NO_VOLATILE_LOCAL_CONTEXT'
  )
  if (own.tsfMissionRef) {
    block('ACTIVE_TSF_MISSION_REFERENCE', 'PROTECTED', { missionRef: own.tsfMissionRef })
  } else {
    pass('NO_ACTIVE_TSF_MISSION_REFERENCE')
  }

  // Connectivity (SSH-backed worktrees only -- evidence.connectivity being
  // entirely absent means "not SSH-backed", not "unknown", so it is not
  // checked at all). An unreachable host means every live-terminal/PTY
  // check above is unverifiable at the SOURCE, not just absent -- treated
  // as a real hazard (PROTECTED), matching Orca core's own
  // 'ssh-disconnected' convention. An ambiguous/errored probe on a resource
  // we DO know is SSH-backed (sshReachable neither true nor false) must
  // fail closed to UNKNOWN, not silently pass as reachable.
  if (evidence.connectivity) {
    if (evidence.connectivity.sshReachable === false) {
      block('SSH_DISCONNECTED', 'PROTECTED')
    } else if (evidence.connectivity.sshReachable === true) {
      pass('SSH_REACHABLE')
    } else {
      block('SSH_REACHABILITY_UNKNOWN', 'UNKNOWN')
    }
  }

  const hasProtected = blockers.some((b) => b.tier === 'PROTECTED')
  const hasUnknown = blockers.some((b) => b.tier === 'UNKNOWN')
  const inactivityThresholdMet = evidence.inactivity?.thresholdMet === true

  let classification
  if (hasProtected) {
    classification = 'PROTECTED'
  } else if (hasUnknown) {
    classification = 'UNKNOWN'
  } else if (inactivityThresholdMet) {
    classification = 'DISPOSABLE_CANDIDATE'
  } else {
    classification = 'REVIEW'
  }

  return { classification, blockers, passedChecks, evaluatedAt: now }
}

// --- Evidence provenance / production trust boundary ---
//
// classifyWorkspaceResource above is a pure function of evidence FIELDS --
// it has no opinion on who collected that evidence, and stays that way so
// fixture/adversarial tests can assert DISPOSABLE_CANDIDATE directly. This
// section is the separate, second gate a PRODUCTION caller (the HTTP route)
// must apply on top: it never raises a classification the field-level
// checks already found unsafe, but it caps an all-clear DISPOSABLE_CANDIDATE
// result down to REVIEW whenever the evidence did not come from a source
// this process collected or independently verified itself.
export const EVIDENCE_PROVENANCE_SOURCES = [
  'TRUSTED_LOCAL_COLLECTOR',
  'ORCA_NATIVE_SCAN',
  'CALLER_SUPPLIED',
  'SYNTHETIC_TEST',
  'UNKNOWN'
]

const PRODUCTION_TRUSTED_PROVENANCE = new Set(['TRUSTED_LOCAL_COLLECTOR', 'ORCA_NATIVE_SCAN'])

export function isProductionTrustedProvenance(source) {
  return PRODUCTION_TRUSTED_PROVENANCE.has(source)
}

// Applied by the HTTP route, never by fixture tests calling
// classifyWorkspaceResource directly. A caller can assert any evidence
// fields it likes, including a false `clean: true` or a claimed trusted
// provenance label -- this function only demotes an all-clear result; it
// never trusts the classification it's given to already be correct, and it
// never widens a PROTECTED/UNKNOWN result. See resource-auditor-http-
// routes.mjs's /classify handler for where the source label itself is also
// forcibly overwritten server-side (a caller cannot simply claim
// ORCA_NATIVE_SCAN to bypass this).
export function applyProductionTrustBoundary(classificationResult, evidence) {
  const source = evidence?.provenance?.source
  if (
    classificationResult.classification !== 'DISPOSABLE_CANDIDATE' ||
    isProductionTrustedProvenance(source)
  ) {
    return { ...classificationResult, productionTrustCeilingApplied: false }
  }
  return {
    ...classificationResult,
    classification: 'REVIEW',
    blockers: [
      ...classificationResult.blockers,
      {
        code: 'EVIDENCE_PROVENANCE_NOT_PRODUCTION_TRUSTED',
        tier: 'REVIEW',
        detail: { source: source ?? null }
      }
    ],
    productionTrustCeilingApplied: true
  }
}

// --- Canonical/main-workspace contract (NWR-incident model) ---
//
// These four functions model, at the TSF classifier layer, the SAME
// layered defense confirmed by reading Orca core's real code during
// reconciliation (applyWorkspaceCleanupPolicy's selection gate, and
// worktree-removal-safety.ts's separate, non-shared execution-time guard).
// They are a synthetic-fixture PROOF of the contract this feature commits
// to, not a re-implementation of Orca's own gates -- V0 never calls
// passesFinalRemovalSafetyBoundary to execute anything.
export function isRowSelectable(classificationResult) {
  return classificationResult.classification === 'DISPOSABLE_CANDIDATE'
}

export function isBulkSelectable(classificationResult) {
  return isRowSelectable(classificationResult)
}

export function isAdmittedToDestructiveConfirmation(classificationResult) {
  return (
    classificationResult.classification === 'DISPOSABLE_CANDIDATE' &&
    classificationResult.blockers.length === 0
  )
}

// The final, execution-time boundary. Deliberately re-checks the identity
// fact that matters most directly from `evidence` (not merely from the
// already-computed classification), independent of and redundant with
// isAdmittedToDestructiveConfirmation -- exactly mirroring
// findRegisteredDeletableWorktree's own non-shared guard in Orca core.
export function passesFinalRemovalSafetyBoundary(evidence, classificationResult) {
  if (evidence.isMainWorktree !== false) {
    return false
  }
  if (evidence.pathIdentity?.containsOtherRegisteredWorktree !== false) {
    return false
  }
  return isAdmittedToDestructiveConfirmation(classificationResult)
}

// null/undefined -> `unknownCode` (defaults to a generated UNKNOWN blocker);
// true -> `trueCode` at PROTECTED; false -> `passCode` recorded as passed.
function ternaryCheck(value, trueCode, block, pass, passCode, unknownCode) {
  if (value === true) {
    block(trueCode, 'PROTECTED')
  } else if (value === false) {
    pass(passCode)
  } else {
    block(unknownCode ?? `${trueCode}_UNKNOWN`, 'UNKNOWN')
  }
}

function recommendedActionFor(classification) {
  switch (classification) {
    case 'DISPOSABLE_CANDIDATE':
      return 'OWNER_REVIEW_SUGGESTED_LOW_RISK'
    case 'REVIEW':
      return 'OWNER_REVIEW_SUGGESTED'
    case 'UNKNOWN':
      return 'GATHER_MORE_EVIDENCE'
    case 'PROTECTED':
    default:
      return 'NO_ACTION'
  }
}

function benefitConfidenceFor(classification, evidence) {
  if (classification !== 'DISPOSABLE_CANDIDATE' && classification !== 'REVIEW') {
    return 'NOT_APPLICABLE'
  }
  const usage = evidence.resourceUsage ?? {}
  if (usage.workingSetVolatileDuringSample) {
    return 'LOW'
  }
  return classification === 'DISPOSABLE_CANDIDATE' ? 'MEDIUM' : 'LOW'
}

// Stable, governed proposal. `executionAuthorized` is hardcoded false and
// `confirmationToken` is always null -- V0 produces evidence and plans
// only; nothing reads this shape as authority to act. A future V1
// executor is expected to re-derive a confirmation token from an
// immediate pre-action revalidation, never trust one carried from here.
export function buildResourceAuditDryRunPlan(evidence, classification, clock) {
  const generatedAt = isoNow(clock)
  const snapshotHash = sha256(
    canonicalJson({
      resourceId: evidence.resourceId,
      evidence,
      classification: classification.classification
    })
  )
  const usage = evidence.resourceUsage ?? {}
  const cpuNote =
    typeof usage.cpuPercentSample === 'number'
      ? `${usage.cpuPercentSample}% observed over a ${usage.sampleWindowMs ?? 'unknown'}ms sample -- not proof of active or idle ownership on its own`
      : null
  const provenance = evidence.provenance ?? {}
  const provenanceSource = provenance.source ?? 'UNKNOWN'

  return {
    schemaVersion: 'TSF_RESOURCE_AUDIT_DRYRUN_V1',
    resourceId: evidence.resourceId ?? null,
    hostId: evidence.host ?? null,
    canonicalPath: evidence.path ?? null,
    processIdentity:
      evidence.ownership?.pid !== null && evidence.ownership?.pid !== undefined
        ? { pid: evidence.ownership.pid, startedAt: evidence.ownership.pidStartTime ?? null }
        : null,
    repository: evidence.repoRoot
      ? { root: evidence.repoRoot, branch: evidence.branch ?? null, head: evidence.head ?? null }
      : null,
    evidenceObservedAt: evidence.evidenceObservedAt ?? null,
    evidenceExpiresAt:
      evidence.evidenceObservedAt && evidence.evidenceTtlMs != null
        ? new Date(Date.parse(evidence.evidenceObservedAt) + evidence.evidenceTtlMs).toISOString()
        : null,
    classification: classification.classification,
    passedChecks: classification.passedChecks,
    blockers: classification.blockers,
    recommendedAction: recommendedActionFor(classification.classification),
    expectedBenefit: {
      ramBytesApprox: usage.processWorkingSetBytesApprox ?? null,
      diskBytesApprox: usage.workspaceBytesApprox ?? null,
      cpuNote,
      confidence: benefitConfidenceFor(classification.classification, evidence),
      guaranteedReclaim: false
    },
    // Every dry-run result explains where its evidence came from, how much
    // it should be trusted, and how fresh it is -- required reading before
    // treating `classification` as anything more than one process's honest
    // best guess at the time `evidenceObservedAt` was recorded.
    evidenceProvenance: {
      source: provenanceSource,
      productionTrusted: isProductionTrustedProvenance(provenanceSource),
      productionTrustCeilingApplied: Boolean(classification.productionTrustCeilingApplied),
      collectedAt: provenance.collectedAt ?? evidence.evidenceObservedAt ?? null,
      fresh: !isEvidenceStale(evidence, generatedAt),
      directlyObservedChecks: provenance.directlyObservedChecks ?? [],
      assertedChecks: provenance.assertedChecks ?? []
    },
    snapshotHash,
    confirmationToken: null,
    generatedAt,
    authority: 'ADVISORY_ONLY',
    executionAuthorized: false
  }
}

// Groups already-built dry-run plans by pressure type for the TSF UX ("why
// is Orca slow" / "what's using my RAM"). Purely a reshaping of evidence
// already produced by buildResourceAuditDryRunPlan -- never re-derives or
// upgrades a classification.
export function buildResourcePressureRecommendations(dryRunPlans, contentionSignals = []) {
  const ram = []
  const disk = []
  const cpu = []
  for (const plan of dryRunPlans) {
    const benefit = plan.expectedBenefit ?? {}
    if (benefit.ramBytesApprox !== null && benefit.ramBytesApprox !== undefined) {
      ram.push({
        resourceId: plan.resourceId,
        classification: plan.classification,
        ramBytesApprox: benefit.ramBytesApprox,
        confidence: benefit.confidence,
        guaranteedReclaim: false
      })
    }
    if (benefit.diskBytesApprox !== null && benefit.diskBytesApprox !== undefined) {
      disk.push({
        resourceId: plan.resourceId,
        classification: plan.classification,
        diskBytesApprox: benefit.diskBytesApprox,
        confidence: benefit.confidence
      })
    }
    if (benefit.cpuNote) {
      cpu.push({
        resourceId: plan.resourceId,
        classification: plan.classification,
        note: benefit.cpuNote
      })
    }
  }
  return {
    schemaVersion: 'TSF_RESOURCE_PRESSURE_RECOMMENDATIONS_V1',
    ram,
    disk,
    cpu,
    contention: contentionSignals,
    authority: 'ADVISORY_ONLY'
  }
}
