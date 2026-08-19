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
  }
  receipts: { chain: ReceiptEntry[]; chainValid: boolean; tip: string | null }
  candidate: CandidateView | null
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
