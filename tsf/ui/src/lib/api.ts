import { createKeepGoingApi } from './keep-going-api'
import { createPlannerNeedsYouApi } from './planner-needs-you-api'
import { createEvalApi } from './eval-api'
import type { ChatPlacement } from './chat-dispatch-types'
import type { FleetWorkStatusItem } from './fleet-status-types'
import type { RuntimeIdentity, UpdateSafety } from './system-status-types'
import type {
  GenerateEstimateError,
  GenerateEstimateRequest,
  ProjectEstimateView
} from './estimate-types'
import type { FlightRecorderView } from './flight-recorder-types'
import type { FleetScheduleError, FleetScheduleResponse } from './fleet-types'
import type {
  FleetHealthScanResult,
  HealthRepairApiError,
  HealthRepairOperationListResponse,
  HealthRepairOperationResponse,
  HealthRepairOperationStartResponse,
  PrepareMissionResult
} from './health-repair-types'
import type { CapacitySnapshot } from './capacity-types'
import type {
  MembershipChangeResponse,
  PrepareForWorkOperationListResponse,
  PrepareForWorkOperationResponse,
  PrepareForWorkStartResponse
} from './prepare-for-work-types'
import { prepareForWork as prepareForWorkDurable } from './prepare-for-work-polling'
import {
  healthRepairBaselineDurable,
  healthRepairRepairDurable,
  healthRepairSelectedDurable
} from './health-repair-polling'
import {
  normalizeMembershipChange,
  normalizePortfolio,
  normalizeWorkSummary
} from './api-response-normalization'
import type {
  AgentEvidence,
  AttentionResponse,
  ChatAttachmentMeta,
  ChatMessage,
  ChatResponse,
  Portfolio,
  ProjectCard,
  ProjectDetail,
  ReceiptEntry,
  ResearchMissionSummary,
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
  portfolio: () => request<Portfolio>('/portfolio').then(normalizePortfolio),
  projects: () => request<ProjectCard[]>('/projects'),
  project: (id: string) => request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  work: () => request<WorkSummary>('/work').then(normalizeWorkSummary),
  attention: () => request<AttentionResponse>('/attention'),
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
    placement?: ChatPlacement,
    selfRepair?: boolean,
    // Global Command Dock V1: the current route's project, if any -- a
    // bounded fallback the server only consults when the message itself
    // resolves to no project (see http-server.mjs's chat route). Only
    // meaningful alongside projectId: null; ignored for an already
    // project-scoped call.
    contextProjectId?: string
  ) =>
    request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        message,
        attachments,
        ...(placement ? { placement } : {}),
        ...(selfRepair ? { selfRepair: true } : {}),
        ...(contextProjectId ? { contextProjectId } : {})
      })
    }),
  chatHistory: (projectId: string) =>
    request<ChatMessage[]>(`/chat/${encodeURIComponent(projectId)}`),
  fleetStatus: () => request<FleetWorkStatusItem[]>('/fleet/status'),
  // GET /api/research[?projectId=] -- HQ's Active Research, Work's Research
  // filter, Project detail's "Research for this project".
  researchMissions: (projectId?: string) =>
    request<{ missions: ResearchMissionSummary[] }>(
      `/research${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`
    ).then((r) => r.missions),
  runtimeIdentity: () => request<RuntimeIdentity>('/runtime-identity'),
  updateSafety: () => request<UpdateSafety>('/update-safety'),
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
  ...createKeepGoingApi(request),
  ...createPlannerNeedsYouApi(request),
  ...createEvalApi(request, requestTolerant),
  estimate: (projectId: string) =>
    request<ProjectEstimateView>(`/projects/${encodeURIComponent(projectId)}/estimate`),
  generateEstimate: (projectId: string, body: GenerateEstimateRequest) =>
    requestTolerant<ProjectEstimateView, GenerateEstimateError>(
      `/projects/${encodeURIComponent(projectId)}/estimate`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
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
  // BUG-05 (bug-ledger.json): baseline/repair/repair-selected are now
  // durable operations (health-repair-polling.ts polls to completion) --
  // the public function names/return shapes below are unchanged, so
  // ProjectHealthRepairCard.tsx/HealthRepairCenterPage.tsx need no changes
  // beyond this file. prepare-mission stays a direct request (fast,
  // synchronous server-side, no I/O -- see health-repair-http-routes.mjs's
  // own comment on why it's deliberately not wrapped).
  healthRepairBaseline: (projectId: string) =>
    healthRepairBaselineDurable(
      projectId,
      () => api.startHealthRepairBaseline(projectId),
      api.getHealthRepairOperation
    ),
  healthRepairRepair: (projectId: string, cause: string) =>
    healthRepairRepairDurable(
      projectId,
      () => api.startHealthRepairRepair(projectId, cause),
      api.getHealthRepairOperation
    ),
  healthRepairPrepareMission: (projectId: string, cause: string) =>
    requestTolerant<PrepareMissionResult, HealthRepairApiError>(
      `/health-repair/${encodeURIComponent(projectId)}/prepare-mission`,
      { method: 'POST', body: JSON.stringify({ cause }) }
    ),
  healthRepairSelected: (projectIds: string[]) =>
    healthRepairSelectedDurable(
      () => api.startHealthRepairSelected(projectIds),
      api.getHealthRepairOperation
    ),
  startHealthRepairBaseline: (projectId: string) =>
    request<HealthRepairOperationStartResponse>(
      `/health-repair/${encodeURIComponent(projectId)}/baseline`,
      { method: 'POST' }
    ),
  startHealthRepairRepair: (projectId: string, cause: string) =>
    request<HealthRepairOperationStartResponse>(
      `/health-repair/${encodeURIComponent(projectId)}/repair`,
      { method: 'POST', body: JSON.stringify({ cause }) }
    ),
  startHealthRepairSelected: (projectIds: string[]) =>
    request<HealthRepairOperationStartResponse>('/health-repair/repair-selected', {
      method: 'POST',
      body: JSON.stringify({ projectIds })
    }),
  getHealthRepairOperation: (operationId: string) =>
    request<HealthRepairOperationResponse>(`/health-repair-operations/${operationId}`),
  listHealthRepairOperations: () =>
    request<HealthRepairOperationListResponse>('/health-repair-operations'),
  capacity: () => request<CapacitySnapshot>('/capacity'),
  setActiveFleetMembership: (projectIds: string[], add: boolean) =>
    request<MembershipChangeResponse>('/portfolio/active-fleet', {
      method: 'POST',
      body: JSON.stringify({ projectIds, add })
    }).then(normalizeMembershipChange),
  setWorkSetMembership: (projectIds: string[], add: boolean) =>
    request<MembershipChangeResponse>('/portfolio/work-set', {
      method: 'POST',
      body: JSON.stringify({ projectIds, add })
    }).then(normalizeMembershipChange),
  prepareForWork: (projectIds: string[]) =>
    prepareForWorkDurable(projectIds, api.startPrepareForWork, api.getPrepareForWorkOperation),
  startPrepareForWork: (projectIds: string[]) =>
    request<PrepareForWorkStartResponse>('/projects/prepare-for-work', {
      method: 'POST',
      body: JSON.stringify({ projectIds })
    }),
  getPrepareForWorkOperation: (operationId: string) =>
    request<PrepareForWorkOperationResponse>(`/projects/prepare-for-work/${operationId}`),
  listPrepareForWorkOperations: () =>
    request<PrepareForWorkOperationListResponse>('/prepare-for-work-operations')
}
