import type {
  HandoffReconciliation,
  MigrationClassification,
  OrcaRegistrationStatus,
  UpgradeCandidate
} from './onboarding-types'

export type SourceClass = 'REAL' | 'FIXTURE' | 'SYSTEM' | 'INTERNAL'
export type HealthStatus = 'HEALTHY' | 'UNKNOWN' | 'DEGRADED' | 'BLOCKED'
export type DecisionClass = 'AUTO_DECIDE' | 'RECOMMEND_AND_PROCEED' | 'TIM_REQUIRED'
export type CandidateState =
  | 'READY_FOR_ADOPTION'
  | 'ADOPTED'
  | 'REJECTED'
  | 'REVISION_REQUESTED'
  | 'BLOCKED'
  | 'NOT_READY'

export type HealthFinding = {
  code: string
  status: string
  summary: string
  remediation: string
  evidence?: Record<string, unknown>
}

export type Health = {
  schemaVersion: string
  status: HealthStatus
  findings: HealthFinding[]
  observedAt: string
  authority: string
}

export type ReleaseRef = {
  head: string | null
  tree: string | null
  branch?: string | null
}

export type Release = {
  stable: ReleaseRef
  previousStable: ReleaseRef | null
  upgrade: ReleaseRef | null
  testing: string
  adoption: string
  published: string
}

export type Mission = {
  id: string | null
  state: string
  blockedReason: string | null
}

export type ResultCapsuleView = {
  id: string | null
  status: string
  filesChanged: string[]
  testsRun: { command?: string; passed?: number; failed?: number; exitCode?: number }[]
  implementationSummary: string | null
  workerIdentity: {
    orcaSessionId?: string
    worktreeId?: string | null
    role?: string
    providerId?: string
    agentId?: string
    modelObserved?: string
  } | null
}

export type CandidateView = {
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

export type ReceiptEntry = {
  kind: string
  timestamp: string
  receiptHash: string
  previousReceiptHash: string | null
  chainValid: boolean
  decision: string | null
  result: string | null
  execution: {
    role: string | null
    providerId: string | null
    agentId: string | null
    modelObserved: string | null
  }
}

export type ProjectCard = {
  id: string
  displayName: string
  sourceClass: SourceClass
  lifecycle: string
  activeFleet: boolean
  workSet: boolean
  missionState: string
  blockedReason: string | null
  healthStatus: HealthStatus
  topFinding: { code: string; summary: string; remediation: string } | null
  migrationClassification: string | null
  restrictions: string[]
  release: Release
  candidateState: CandidateState | null
}

export type ProjectDetail = {
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

export type OnboardingSummary = {
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

export type Portfolio = {
  usageMode: string
  workSet: string[]
  activeFleet: string[]
  knownProjects: ProjectCard[]
}

// A project with a real Keep Going run carries its live projection
// (tsf/domain/live-work-feed.mjs's state/reason) alongside the usual
// ProjectDetail fields -- absent for a project bucketed by legacy
// mission.state alone (no Keep Going run exists for it).
export type WorkItem = ProjectDetail & {
  liveWorkFeed?: { state: string; reason: string }
  runId?: string | null
  // Persistent global execution visibility (bug-ledger.json): the run's
  // real last checkpoint timestamp, or null if none recorded yet / no run.
  lastCheckpointAt?: string | null
}

export type WorkSummary = {
  active: WorkItem[]
  // Always empty in this pass -- no domain signal yet distinguishes
  // "queued" from "planning" (see tsf/domain/work-feed-summary.mjs).
  queued: WorkItem[]
  verifying: WorkItem[]
  needsYou: WorkItem[]
  stalled: WorkItem[]
  blocked: ProjectDetail[]
  readyForAdoption: WorkItem[]
  recentlyCompleted: {
    id: string
    displayName: string
    missionId: string | null
    adoptedAt: string | null
  }[]
}

export type UsageModeConfig = {
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

export type RoutingInfo = {
  usageModes: Record<string, UsageModeConfig>
  reservedModes: string[]
  providerRoles: Record<
    string,
    {
      preferredProfile: string
      fallbackProfile: string | null
      modelClass: string
      effortClass: string
    }
  >
  activeUsageMode: string
}

export type ChatResponse = {
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
  // Command (M-Command): which real project(s), if any, this turn resolved
  // to (project-name-resolver.mjs) -- absent/empty for a fleet-wide answer
  // with no specific project named. Always present on a response to a
  // projectId: null (Command) request; absent on ordinary project-scoped
  // Planner Chat responses.
  resolvedProjectIds?: string[]
  scope?: 'PROJECT' | 'MULTI_PROJECT' | 'FLEET'
  dispatched?: boolean
  dispatchResults?: {
    projectId: string
    ok: boolean
    reason: string | null
    detail: string | null
  }[]
}

export type ChatAttachmentMeta = {
  name: string
  type: string
  // Real extracted content (migration-context-attachments.ts's
  // extractAttachmentContext), not just filename/type metadata -- optional
  // so a caller that only ever sent {name,type} (Planner Chat's prior
  // behavior) is unaffected.
  extractedText?: string | null
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  at: string
  decisionClass?: DecisionClass
  intent?: string
}

export type AgentEvidence = {
  projectId: string
  sessions: Record<string, unknown>[]
  worktrees: string[]
  note: string
}
