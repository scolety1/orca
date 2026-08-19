export type SourceClass = 'REAL' | 'FIXTURE' | 'SYSTEM' | 'INTERNAL'
export type HealthStatus = 'HEALTHY' | 'UNKNOWN' | 'DEGRADED' | 'BLOCKED'
export type DecisionClass = 'AUTO_DECIDE' | 'RECOMMEND_AND_PROCEED' | 'TIM_REQUIRED'
export type CandidateState = 'READY_FOR_ADOPTION' | 'ADOPTED' | 'REJECTED' | 'REVISION_REQUESTED' | 'BLOCKED' | 'NOT_READY'

export interface HealthFinding {
  code: string
  status: string
  summary: string
  remediation: string
  evidence?: Record<string, unknown>
}

export interface Health {
  schemaVersion: string
  status: HealthStatus
  findings: HealthFinding[]
  observedAt: string
  authority: string
}

export interface ReleaseRef {
  head: string | null
  tree: string | null
  branch?: string | null
}

export interface Release {
  stable: ReleaseRef
  previousStable: ReleaseRef | null
  upgrade: ReleaseRef | null
  testing: string
  adoption: string
  published: string
}

export interface Mission {
  id: string | null
  state: string
  blockedReason: string | null
}

export interface ResultCapsuleView {
  id: string | null
  status: string
  filesChanged: string[]
  testsRun: Array<{ command?: string; passed?: number; failed?: number; exitCode?: number }>
  implementationSummary: string | null
  workerIdentity: { orcaSessionId?: string; worktreeId?: string | null; role?: string; providerId?: string; agentId?: string; modelObserved?: string } | null
}

export interface CandidateView {
  id: string
  projectId: string
  missionId: string | null
  state: CandidateState
  decidable: boolean
  branch: string | null
  head: string | null
  tree: string | null
  filesChanged: string[]
  implementationSummary: string | null
  testsRun: ResultCapsuleView['testsRun']
  verifierVerdict: unknown
  verifierChecks: unknown
  residualRisks: string | null
}

export interface ReceiptEntry {
  kind: string
  timestamp: string
  receiptHash: string
  previousReceiptHash: string | null
  chainValid: boolean
  decision: string | null
  result: string | null
  execution: { role: string | null; providerId: string | null; agentId: string | null; modelObserved: string | null }
}

export interface ProjectCard {
  id: string
  displayName: string
  sourceClass: SourceClass
  lifecycle: string
  activeFleet: boolean
  workSet: boolean
  missionState: string
  healthStatus: HealthStatus
  release: Release
  candidateState: CandidateState | null
}

export interface ProjectDetail {
  id: string
  displayName: string
  sourceClass: SourceClass
  provenance: string
  root: string | null
  lifecycle: string
  branch: string | null
  registeredAt: string
  purpose: string | null
  restrictions: string[]
  activeFleet: boolean
  workSet: boolean
  mission: Mission
  release: Release
  health: Health
  baseline: { tests: string; lint: string; typecheck: string; build: string }
  evidence: {
    planner: Record<string, unknown> | null
    selectedMission: { title?: string; rationale?: string; nonScope?: string[] } | null
    verifier: Record<string, unknown> | null
    browser: Record<string, unknown> | null
    resultCapsules: ResultCapsuleView[]
    verifierRaw: unknown
    onboarding?: OnboardingSummary
  }
  receipts: { chain: ReceiptEntry[]; chainValid: boolean; tip: string | null }
  candidate: CandidateView | null
}

export interface OnboardingSummary {
  maturity: string
  migrationClassification: MigrationClassification
  upgradeCandidates: UpgradeCandidate[]
  unfinishedSummary: string | null
  completedSummary: string | null
  alignment: string
  handoffReconciliation: HandoffReconciliation
  orcaRegistration: OrcaRegistrationStatus
  analyzedAt: string
  directionLive: boolean
}

export interface Portfolio {
  usageMode: string
  workSet: string[]
  activeFleet: string[]
  knownProjects: ProjectCard[]
}

export interface WorkSummary {
  active: ProjectDetail[]
  blocked: ProjectDetail[]
  readyForAdoption: ProjectDetail[]
  recentlyCompleted: Array<{ id: string; displayName: string; missionId: string | null; adoptedAt: string | null }>
}

export interface UsageModeConfig {
  plannerTier: string
  workerTier: string
  verifierDepth: string
  parallelism: number
  retryBudget: number
  autonomy: string
  trustMode: string
  researchDepth: string
  browserTesting: string
  highAssuranceChecks: boolean
}

export interface RoutingInfo {
  usageModes: Record<string, UsageModeConfig>
  reservedModes: string[]
  providerRoles: Record<string, { preferredProfile: string; fallbackProfile: string | null; modelClass: string; effortClass: string }>
  activeUsageMode: string
}

export interface ChatResponse {
  intent: string
  decisionClass: DecisionClass
  text: string
  plannerRole: string
  providerLabel: string
  live?: boolean
  agentId?: string
  providerId?: string
  model?: string
  unavailableReason?: string
}

export interface ChatAttachmentMeta {
  name: string
  type: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  at: string
  decisionClass?: DecisionClass
  intent?: string
}

export interface AgentEvidence {
  projectId: string
  sessions: Array<Record<string, unknown>>
  worktrees: string[]
  note: string
}

// --- Project Onboarding V1 ---

export type MigrationClassificationLabel = 'SAFE_TO_ONBOARD_NOW' | 'READ_ONLY_ONBOARDING_ONLY' | 'DIRTY_PRESERVE' | 'SENSITIVE' | 'NOT_READY' | 'TIM_REQUIRED'

export interface MigrationClassification {
  classification: MigrationClassificationLabel
  reasons: string[]
  evidence: Record<string, unknown>
}

export interface PortfolioGatingRule {
  allowed: boolean
  default: boolean
}

export interface PortfolioGating {
  knownProjects: PortfolioGatingRule
  activeFleet: PortfolioGatingRule
  workSet: PortfolioGatingRule
}

export interface HandoffReconciliation {
  hasHandoff: boolean
  claims: Array<{ field: string; claimed: string }>
  discrepancies: string[]
  agreements: string[]
  hasConflict?: boolean
}

export interface OrcaRegistrationStatus {
  checked: boolean
  registered: boolean
  repo?: Record<string, unknown> | null
  reason?: string
  detail?: string
}

export interface UpgradeCandidate {
  title: string
  rationale: string
  evidence?: string
  category: string
  importance: 'LOW' | 'MEDIUM' | 'HIGH'
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  blocksCurrentWork: boolean
  safeToDefer: boolean
}

export interface OnboardingHealthFinding {
  code: string
  status: 'HEALTHY' | 'HEALTHY_WITH_CAVEATS' | 'NEEDS_ATTENTION' | 'BLOCKED' | 'UNKNOWN'
  summary: string
  remediation: string
  evidence?: Record<string, unknown>
}

export interface OnboardingHealth {
  status: 'HEALTHY' | 'HEALTHY_WITH_CAVEATS' | 'NEEDS_ATTENTION' | 'BLOCKED' | 'UNKNOWN'
  findings: OnboardingHealthFinding[]
  observedAt: string
  authority: string
}

export interface OnboardingDirection {
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

export interface OnboardingAnalysis {
  ok: true
  schemaVersion: string
  analyzedAt: string
  projectId: string
  displayName: string
  repoPath: string
  existingProjectId?: string | null
  identity: { root: string; gitDir: string; branch: string | null; detached: boolean; head: string | null; tree: string | null; remotes: Array<{ name: string; url: string; direction: string }>; commitCount: number | null }
  currentState: {
    dirty: boolean
    staged: string[]
    unstaged: string[]
    untracked: string[]
    untrackedTruncated: boolean
    conflicted: string[]
    activeGitOperation: boolean
    activeGitOperationKind: string | null
    recentCommits: Array<{ sha: string; short: string; date: string; author: string; subject: string }>
    localBranches: Array<{ name: string; lastCommitAt: string }>
    worktrees: Array<Record<string, unknown>>
  }
  maturity: string
  health: OnboardingHealth
  migrationClassification: MigrationClassification
  portfolioGating: PortfolioGating
  handoffReconciliation: HandoffReconciliation
  orcaRegistration: OrcaRegistrationStatus
  discovery: {
    priorityFiles: Array<{ relativePath: string; kind: string; truncated: boolean; bytes: number }>
    discoveredDirectories: Array<{ relativePath: string; fileCount: number }>
    scanTruncated: boolean
    commandGuidance: { packageManager: string; dependenciesInstalled: boolean; testCommands: string[]; buildCommands: string[]; lintCommands: string[]; devCommands: string[]; hasKnownTestCommand: boolean }
  }
  direction: OnboardingDirection
}

export interface OnboardingAnalysisError {
  ok: false
  reason: string
  detail?: string
}

export interface OnboardingCommitResult {
  ok: true
  projectId: string
  receipt: Record<string, unknown>
  orcaRegistration: { attempted: boolean; ok: boolean; alreadyRegistered?: boolean; repo?: Record<string, unknown> | null; reason?: string; detail?: string } | null
  activeFleet: boolean
  workSet: boolean
}

export interface OnboardingRefreshResult {
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

export interface DirectoryBrowseResult {
  ok: true
  path: string
  parent: string | null
  directories: string[]
}
