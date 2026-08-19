import { isoNow } from './canonical.mjs'

const severityRank = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, BLOCKED: 3 }

function finding(code, status, summary, remediation, evidence = {}) {
  return { code, status, summary, remediation, evidence }
}

// Onboarding-time repository Health — a distinct vocabulary from
// assessHealth's mission-governance status (HEALTHY_WITH_CAVEATS sits
// between HEALTHY and NEEDS_ATTENTION, matching what a first-look repo scan
// actually needs to express: "fine, but worth knowing X"). Every finding
// here traces to a fact repo-inspector.mjs actually observed — nothing is
// fabricated for dimensions that weren't checked.
const onboardingSeverityRank = { HEALTHY: 0, HEALTHY_WITH_CAVEATS: 1, UNKNOWN: 2, NEEDS_ATTENTION: 3, BLOCKED: 4 }

export function assessRepositoryOnboardingHealth(facts, clock) {
  const findings = []
  const add = (code, status, summary, remediation, evidence = {}) => findings.push(finding(code, status, summary, remediation, evidence))

  // Git/state health
  if (facts.activeGitOperation) {
    add('GIT_OPERATION_ACTIVE', 'BLOCKED', `An unfinished Git ${facts.activeGitOperationKind ?? 'operation'} is in progress.`, 'Resolve or abort the Git operation outside TSF before onboarding for work.', { kind: facts.activeGitOperationKind })
  }
  if (facts.conflicted?.length) {
    add('GIT_CONFLICTED_FILES', 'BLOCKED', `${facts.conflicted.length} conflicted file(s) present.`, 'Resolve conflicts before this project is safe for normal work.', { files: facts.conflicted.slice(0, 20) })
  }
  if (facts.detached) {
    add('GIT_DETACHED_HEAD', 'NEEDS_ATTENTION', 'Repository is on a detached HEAD.', 'Confirm the intended branch before any future mutation work.', { head: facts.head })
  }
  if (facts.dirty && !facts.conflicted?.length) {
    add(
      'GIT_DIRTY_WORKING_TREE',
      'HEALTHY_WITH_CAVEATS',
      `Working tree has uncommitted work (${facts.stagedCount ?? 0} staged, ${facts.unstagedCount ?? 0} unstaged, ${facts.untrackedCount ?? 0} untracked).`,
      'Preserve this work — do not reset or clean. Review before it is considered safe for autonomous work.',
      { staged: facts.stagedCount, unstaged: facts.unstagedCount, untracked: facts.untrackedCount }
    )
  }
  if (facts.missingWorktrees?.length) {
    add('WORKTREE_RESIDUE', 'NEEDS_ATTENTION', `${facts.missingWorktrees.length} registered Git worktree path(s) are missing on disk.`, 'Inspect worktree registration; do not prune automatically.', { paths: facts.missingWorktrees })
  }
  if (facts.largeUntrackedDirectories?.length) {
    add('LARGE_UNTRACKED_DIRECTORY', 'HEALTHY_WITH_CAVEATS', `${facts.largeUntrackedDirectories.length} large untracked director${facts.largeUntrackedDirectories.length === 1 ? 'y' : 'ies'} found.`, 'May be generated output or real work — inspect ownership before ignoring or deleting anything.', { directories: facts.largeUntrackedDirectories })
  }

  // Build/test health
  if (!facts.hasKnownTestCommand) {
    add('NO_KNOWN_TEST_COMMAND', 'NEEDS_ATTENTION', 'No test command could be discovered from package scripts.', 'Ask the operator, or look for a test runner config not yet covered by discovery.', {})
  }

  // Architecture/documentation clarity
  if (!facts.hasReadme) {
    add('NO_README', 'HEALTHY_WITH_CAVEATS', 'No README found at the repository root.', 'Not blocking, but onboarding confidence is lower without one.', {})
  }
  if (!facts.hasInstructions) {
    add('NO_PROJECT_INSTRUCTIONS', 'HEALTHY_WITH_CAVEATS', 'No AGENTS.md/CLAUDE.md project instructions found.', 'Consider adding one once this project sees real work — not required to onboard.', {})
  }

  // Dependency/runtime health
  if (facts.hasPackageManifest && !facts.dependenciesInstalled) {
    add('DEPENDENCIES_NOT_INSTALLED', 'UNKNOWN', 'A package manifest exists but dependencies are not installed locally.', 'Install policy and safety are unverified until dependencies are actually installed.', {})
  }

  // Source-of-truth ambiguity
  if (facts.handoffConflict) {
    add('HANDOFF_REPOSITORY_MISMATCH', 'NEEDS_ATTENTION', 'The migration handoff disagrees with observed repository state.', 'An authoritative source must be chosen before trusting handoff claims.', { summary: facts.handoffConflictSummary ?? null })
  }

  // Deployment sensitivity
  if (facts.deploymentConfigPresent) {
    add('DEPLOYMENT_CONFIG_PRESENT', 'HEALTHY_WITH_CAVEATS', 'Deployment configuration files were found in this repository.', 'Treat with elevated caution; confirm no live/production target is implied before any write action.', { files: facts.deploymentConfigFiles ?? [] })
  }

  const status = findings.reduce(
    (current, item) => (onboardingSeverityRank[item.status] > onboardingSeverityRank[current] ? item.status : current),
    'HEALTHY'
  )
  return {
    schemaVersion: 'TSF_ONBOARDING_HEALTH_V1',
    status,
    findings,
    observedAt: isoNow(clock),
    authority: 'ADVISORY_ONLY'
  }
}

export function assessHealth(facts, clock) {
  const findings = []
  if (facts.repositoryAvailable === false) {
    findings.push(finding('REPOSITORY_UNAVAILABLE', 'BLOCKED', 'Project repository is unavailable.', 'Verify the registered path without mutating it.'))
  }
  if (facts.worktreeHealthy === false) {
    findings.push(finding('WORKTREE_UNHEALTHY', 'BLOCKED', 'Orca reports an unhealthy worktree.', 'Inspect Orca worktree facts and preserve the candidate.'))
  }
  if (facts.workerStuck === true) {
    findings.push(finding('WORKER_STUCK', 'DEGRADED', 'Worker has exceeded its progress threshold.', 'Pause or replace it at a recovery checkpoint.'))
  }
  if (facts.sessionStale === true) {
    findings.push(finding('SESSION_STALE', 'DEGRADED', 'Session identity is stale.', 'Create a replacement receipt at a mission boundary.'))
  }
  if (facts.testsPassed === false) {
    findings.push(finding('TESTS_FAILED', 'BLOCKED', 'Candidate tests failed.', 'Return the exact failure evidence for bounded repair.'))
  }
  if (facts.providerAvailable === false) {
    findings.push(finding('PROVIDER_UNAVAILABLE', 'DEGRADED', 'Requested provider is unavailable.', 'Use the configured fallback at a mission boundary.'))
  }
  if (facts.upgradeBlocked === true) {
    findings.push(finding('UPGRADE_BLOCKED', 'BLOCKED', 'Upgrade cannot advance.', 'Resolve the linked candidate or test blocker.'))
  }
  if (facts.humanDecisionPending === true) {
    findings.push(finding('HUMAN_DECISION_PENDING', 'DEGRADED', 'A consequential decision is waiting for Tim.', 'Present the exact current binding and options.'))
  }
  if (facts.upstreamDrift === true) {
    findings.push(finding('UPSTREAM_DRIFT', 'DEGRADED', 'Pinned Orca upstream has drifted.', 'Run the bounded upstream compatibility workflow.'))
  }
  if (facts.overlayCompatible === false) {
    findings.push(finding('OVERLAY_INCOMPATIBLE', 'BLOCKED', 'TSF overlay contract is incompatible with Orca.', 'Stop foundation work and inspect the plugin contract delta.'))
  }
  const status = findings.reduce(
    (current, item) => (severityRank[item.status] > severityRank[current] ? item.status : current),
    facts.repositoryAvailable === undefined ? 'UNKNOWN' : 'HEALTHY'
  )
  return {
    schemaVersion: 'TSF_HEALTH_REPORT_V1',
    status,
    findings,
    observedAt: isoNow(clock),
    authority: 'ADVISORY_ONLY'
  }
}
