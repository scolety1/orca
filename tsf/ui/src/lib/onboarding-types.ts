// Project Onboarding V1 types. Kept in its own file rather than lib/types.ts
// to avoid growing that file past the repo's max-lines lint limit (same
// convention as keep-going-types.ts, estimate-types.ts, etc.).

export type MigrationClassificationLabel =
  | 'SAFE_TO_ONBOARD_NOW'
  | 'READ_ONLY_ONBOARDING_ONLY'
  | 'DIRTY_PRESERVE'
  | 'SENSITIVE'
  | 'UNRESOLVED_HANDOFF_DISCREPANCY'
  | 'NOT_READY'
  | 'TIM_REQUIRED'

export type MigrationClassification = {
  classification: MigrationClassificationLabel
  reasons: string[]
  evidence: Record<string, unknown>
}

export type PortfolioGatingRule = {
  allowed: boolean
  default: boolean
}

export type PortfolioGating = {
  knownProjects: PortfolioGatingRule
  activeFleet: PortfolioGatingRule
  workSet: PortfolioGatingRule
}

export type ReconciliationResolutionMode =
  | 'USE_LIVE_REPO_FOR_CURRENT_STATE'
  | 'KEEP_UNRESOLVED'
  | 'USE_HANDOFF'

export type ReconciliationResolution = {
  mode: ReconciliationResolutionMode
}

export type ReconciliationDiscrepancyDetail = {
  field: string
  liveRepo: Record<string, unknown> & { value: string }
  handoff: Record<string, unknown> & { value: string }
}

export type HandoffReconciliation = {
  hasHandoff: boolean
  claims: { field: string; claimed: string }[]
  discrepancies: string[]
  discrepancyDetails: ReconciliationDiscrepancyDetail[]
  agreements: string[]
  hasConflict?: boolean
  identityAmbiguous?: boolean
  resolution: ReconciliationResolution | null
  effectiveConflict?: boolean
}

export type OrcaStatusLabel =
  | 'REGISTERED'
  | 'NOT_REGISTERED'
  | 'ORCA_TEMPORARILY_UNAVAILABLE'
  | 'ORCA_UNKNOWN'

export type OrcaRegistrationStatus = {
  checked: boolean
  registered: boolean
  repo?: Record<string, unknown> | null
  reason?: string
  detail?: string
  status?: OrcaStatusLabel
}

export type UpgradeCandidate = {
  title: string
  rationale: string
  evidence?: string
  category: string
  importance: 'LOW' | 'MEDIUM' | 'HIGH'
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  blocksCurrentWork: boolean
  safeToDefer: boolean
}

export type OnboardingHealthFinding = {
  code: string
  status: 'HEALTHY' | 'HEALTHY_WITH_CAVEATS' | 'NEEDS_ATTENTION' | 'BLOCKED' | 'UNKNOWN'
  summary: string
  remediation: string
  evidence?: Record<string, unknown>
}

export type OnboardingHealth = {
  status: 'HEALTHY' | 'HEALTHY_WITH_CAVEATS' | 'NEEDS_ATTENTION' | 'BLOCKED' | 'UNKNOWN'
  findings: OnboardingHealthFinding[]
  observedAt: string
  authority: string
}

export type OnboardingDirection = {
  live: boolean
  providerLabel: string
  unavailableReason?: string
  unavailableDetail?: string
  purpose: string | null
  completedSummary: string | null
  unfinishedSummary: string | null
  alignment: string
  alignmentRationale?: string
  recommendedNextMission: { title: string; rationale: string } | null
  upgradeCandidates: UpgradeCandidate[]
}

export type OnboardingAnalysis = {
  ok: true
  schemaVersion: string
  analyzedAt: string
  projectId: string
  displayName: string
  repoPath: string
  existingProjectId?: string | null
  identity: {
    root: string
    gitDir: string
    branch: string | null
    detached: boolean
    head: string | null
    tree: string | null
    remotes: { name: string; url: string; direction: string }[]
    commitCount: number | null
    isLinkedWorktree: boolean
    worktreeSiblingCount: number | null
  }
  currentState: {
    dirty: boolean
    staged: string[]
    unstaged: string[]
    untracked: string[]
    untrackedTruncated: boolean
    conflicted: string[]
    activeGitOperation: boolean
    activeGitOperationKind: string | null
    recentCommits: { sha: string; short: string; date: string; author: string; subject: string }[]
    localBranches: { name: string; lastCommitAt: string }[]
    worktrees: Record<string, unknown>[]
  }
  maturity: string
  health: OnboardingHealth
  migrationClassification: MigrationClassification
  portfolioGating: PortfolioGating
  handoffReconciliation: HandoffReconciliation
  orcaRegistration: OrcaRegistrationStatus
  discovery: {
    priorityFiles: { relativePath: string; kind: string; truncated: boolean; bytes: number }[]
    discoveredDirectories: { relativePath: string; fileCount: number }[]
    scanTruncated: boolean
    commandGuidance: {
      packageManager: string
      dependenciesInstalled: boolean
      testCommands: string[]
      buildCommands: string[]
      lintCommands: string[]
      devCommands: string[]
      hasKnownTestCommand: boolean
    }
  }
  direction: OnboardingDirection
}

export type OnboardingAnalysisError = {
  ok: false
  reason: string
  detail?: string
}

export type OnboardingCommitResult = {
  ok: true
  projectId: string
  receipt: Record<string, unknown>
  orcaRegistration: {
    attempted: boolean
    ok: boolean
    alreadyRegistered?: boolean
    repo?: Record<string, unknown> | null
    reason?: string
    detail?: string
  } | null
  activeFleet: boolean
  workSet: boolean
}

export type OrcaStatusRefreshResult = {
  ok: true
  orcaRegistration: OrcaRegistrationStatus
}

export type DirectionRetryResult = {
  ok: true
  direction: OnboardingDirection
}

export type ResolveReconciliationResult = {
  ok: true
  migrationClassification: MigrationClassification
  portfolioGating: PortfolioGating
  handoffReconciliation: HandoffReconciliation
  health: OnboardingHealth
}

export type ResolveReconciliationError = {
  ok: false
  reason: string
  detail?: string
}

export type OnboardingRefreshResult = {
  ok: true
  analysis: OnboardingAnalysis
  changes: {
    headMoved: boolean
    dirtyStateChanged: boolean
    healthStatusChanged: boolean
    migrationClassificationChanged: boolean
    recommendedNextMissionChanged: boolean
    deploymentSensitivityChanged: boolean
  }
}

export type DirectoryBrowseResult = {
  ok: true
  path: string
  parent: string | null
  directories: string[]
}
