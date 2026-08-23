import type {
  KeepGoingCandidateWorkItem,
  KeepGoingRunView,
  KeepGoingTickResult
} from './keep-going-types'
import type { ChatPlacement } from './chat-dispatch-types'
import type {
  GenerateEstimateError,
  GenerateEstimateRequest,
  ProjectEstimateView
} from './estimate-types'
import type { EvalComparison, EvalPackSummary, EvalRunResult } from './eval-types'
import type { FlightRecorderView } from './flight-recorder-types'
import type { FleetScheduleError, FleetScheduleResponse } from './fleet-types'
import type {
  BaselineCheckResult,
  FleetHealthScanResult,
  HealthRepairApiError,
  PrepareMissionResult,
  RepairActionResult,
  RepairSelectedResult
} from './health-repair-types'
import type {
  AgentEvidence,
  ChatAttachmentMeta,
  ChatMessage,
  ChatResponse,
  Portfolio,
  ProjectCard,
  ProjectDetail,
  ReceiptEntry,
  RoutingInfo,
  WorkSummary
} from './types'
import type {
  DirectoryBrowseResult,
  DirectionRetryResult,
  OnboardingAnalysis,
  OnboardingAnalysisError,
  OnboardingCommitResult,
  OnboardingRefreshResult,
  OrcaStatusRefreshResult,
  ReconciliationResolution,
  ResolveReconciliationError,
  ResolveReconciliationResult
} from './onboarding-types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers }
  })
  const body = await res.json().catch(() => ({ ok: false, error: 'Invalid response' }))
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`)
  }
  return body as T
}

// Onboarding analysis can legitimately fail (not a Git repo, unavailable
// path, etc.) with a meaningful body the UI renders directly — that's not
// an exceptional condition worth throwing for, unlike a real network/server
// failure, which still throws.
async function requestTolerant<TOk, TErr>(path: string, init?: RequestInit): Promise<TOk | TErr> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers }
  })
  const body = await res.json().catch(() => null)
  if (body === null) {
    throw new ApiError(res.status, `Request failed: ${res.status}`)
  }
  if (!res.ok && res.status >= 500) {
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`)
  }
  return body as TOk | TErr
}

export const api = {
  meta: () =>
    request<{
      product: string
      upstreamVersion: string
      upstreamCoreFilesModified: number
      usageMode: string
    }>('/meta'),
  portfolio: () => request<Portfolio>('/portfolio'),
  projects: () => request<ProjectCard[]>('/projects'),
  project: (id: string) => request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  work: () => request<WorkSummary>('/work'),
  routing: () => request<RoutingInfo>('/routing'),
  setUsageMode: (mode: string) =>
    request<{ ok: true; mode: string }>('/usage-mode', {
      method: 'POST',
      body: JSON.stringify({ mode })
    }),
  agents: (id: string) => request<AgentEvidence>(`/agents/${encodeURIComponent(id)}`),
  receipts: (id: string) =>
    request<{ chain: ReceiptEntry[]; chainValid: boolean; tip: string | null }>(
      `/receipts/${encodeURIComponent(id)}`
    ),
  decideCandidate: (
    projectId: string,
    body: { decision: string; requestId: string; reason?: string }
  ) =>
    request<{ ok: true; candidateState: string; receipt: ReceiptEntry }>(
      `/candidates/${encodeURIComponent(projectId)}/decision`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  chat: (
    projectId: string | null,
    message: string,
    attachments: ChatAttachmentMeta[] = [],
    placement?: ChatPlacement
  ) =>
    request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({ projectId, message, attachments, ...(placement ? { placement } : {}) })
    }),
  chatHistory: (projectId: string) =>
    request<ChatMessage[]>(`/chat/${encodeURIComponent(projectId)}`),
  browseDirectory: (dirPath?: string) =>
    request<DirectoryBrowseResult>(
      `/onboarding/browse${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`
    ),
  analyzeRepo: (
    repoPath: string,
    handoffText: string,
    resolution: ReconciliationResolution | null = null
  ) =>
    requestTolerant<OnboardingAnalysis, OnboardingAnalysisError>('/onboarding/analyze', {
      method: 'POST',
      body: JSON.stringify({ repoPath, handoffText, resolution })
    }),
  resolveReconciliation: (
    repoPath: string,
    handoffText: string,
    resolution: ReconciliationResolution
  ) =>
    requestTolerant<ResolveReconciliationResult, ResolveReconciliationError>(
      '/onboarding/resolve',
      {
        method: 'POST',
        body: JSON.stringify({ repoPath, handoffText, resolution })
      }
    ),
  commitOnboarding: (
    analysis: OnboardingAnalysis,
    addTo: { knownProjects?: boolean; activeFleet?: boolean; workSet?: boolean }
  ) =>
    request<OnboardingCommitResult>('/onboarding/commit', {
      method: 'POST',
      body: JSON.stringify({ analysis, addTo })
    }),
  refreshOnboardedProject: (projectId: string) =>
    request<OnboardingRefreshResult>('/onboarding/refresh', {
      method: 'POST',
      body: JSON.stringify({ projectId })
    }),
  refreshOrcaStatus: (repoPath: string) =>
    request<OrcaStatusRefreshResult>('/onboarding/orca-status', {
      method: 'POST',
      body: JSON.stringify({ repoPath })
    }),
  retryDirection: (repoPath: string, handoffText: string) =>
    requestTolerant<DirectionRetryResult, OnboardingAnalysisError>('/onboarding/retry-direction', {
      method: 'POST',
      body: JSON.stringify({ repoPath, handoffText })
    }),
  keepGoing: (projectId: string) =>
    request<KeepGoingRunView>(`/keep-going/${encodeURIComponent(projectId)}`),
  startKeepGoing: (
    projectId: string,
    body: {
      originalGoal: string
      acceptanceCriteria: string[]
      usageMode?: string
      budget?: Record<string, number>
      constraints?: string[]
      stopConditions?: string[]
      expectedRevision?: number
    }
  ) =>
    request<KeepGoingRunView>(`/keep-going/${encodeURIComponent(projectId)}/start`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  pauseKeepGoing: (projectId: string, reason: string | undefined, expectedRevision: number) =>
    request<KeepGoingRunView>(`/keep-going/${encodeURIComponent(projectId)}/pause`, {
      method: 'POST',
      body: JSON.stringify({ reason, expectedRevision })
    }),
  resumeKeepGoing: (projectId: string, expectedRevision: number) =>
    request<KeepGoingRunView>(`/keep-going/${encodeURIComponent(projectId)}/resume`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision })
    }),
  tickKeepGoing: (projectId: string, candidateWorkItems: KeepGoingCandidateWorkItem[]) =>
    request<KeepGoingTickResult>(`/keep-going/${encodeURIComponent(projectId)}/tick`, {
      method: 'POST',
      body: JSON.stringify({ candidateWorkItems })
    }),
  abandonStalledKeepGoingWave: (
    projectId: string,
    reason: string | undefined,
    expectedRevision: number
  ) =>
    request<KeepGoingRunView>(`/keep-going/${encodeURIComponent(projectId)}/abandon-stalled-wave`, {
      method: 'POST',
      body: JSON.stringify({ reason, expectedRevision })
    }),
  estimate: (projectId: string) =>
    request<ProjectEstimateView>(`/projects/${encodeURIComponent(projectId)}/estimate`),
  generateEstimate: (projectId: string, body: GenerateEstimateRequest) =>
    requestTolerant<ProjectEstimateView, GenerateEstimateError>(
      `/projects/${encodeURIComponent(projectId)}/estimate`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  evalPacks: () => request<{ ok: true; packs: EvalPackSummary[] }>('/eval'),
  evalHistory: (packId: string) =>
    request<{ ok: true; packId: string; runs: EvalRunResult[] }>(
      `/eval/${encodeURIComponent(packId)}/history`
    ),
  runEvalPack: (packId: string) =>
    request<{ ok: true; packId: string; run: EvalRunResult }>(
      `/eval/${encodeURIComponent(packId)}/run`,
      { method: 'POST' }
    ),
  evalRegressionCheck: (packId: string) =>
    requestTolerant<
      { ok: true; packId: string; comparison: EvalComparison },
      { ok: false; error: string }
    >(`/eval/${encodeURIComponent(packId)}/regression-check`, { method: 'POST' }),
  flightRecorder: (projectId: string) =>
    request<FlightRecorderView>(`/projects/${encodeURIComponent(projectId)}/flight-recorder`),
  fleetSchedule: (body: {
    projectIds: string[]
    priorities?: Record<string, number>
    maxConcurrentWorkers?: number
  }) =>
    requestTolerant<FleetScheduleResponse, FleetScheduleError>('/fleet/schedule', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  healthRepairScan: () => request<FleetHealthScanResult>('/health-repair/scan'),
  healthRepairBaseline: (projectId: string) =>
    request<BaselineCheckResult>(`/health-repair/${encodeURIComponent(projectId)}/baseline`, {
      method: 'POST'
    }),
  healthRepairRepair: (projectId: string, cause: string) =>
    requestTolerant<RepairActionResult, HealthRepairApiError>(
      `/health-repair/${encodeURIComponent(projectId)}/repair`,
      { method: 'POST', body: JSON.stringify({ cause }) }
    ),
  healthRepairPrepareMission: (projectId: string, cause: string) =>
    requestTolerant<PrepareMissionResult, HealthRepairApiError>(
      `/health-repair/${encodeURIComponent(projectId)}/prepare-mission`,
      { method: 'POST', body: JSON.stringify({ cause }) }
    ),
  healthRepairSelected: (projectIds: string[]) =>
    request<RepairSelectedResult>('/health-repair/repair-selected', {
      method: 'POST',
      body: JSON.stringify({ projectIds })
    })
}
