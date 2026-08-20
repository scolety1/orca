import type {
  KeepGoingCandidateWorkItem,
  KeepGoingRunView,
  KeepGoingTickResult
} from './keep-going-types'
import type {
  AgentEvidence,
  ChatAttachmentMeta,
  ChatMessage,
  ChatResponse,
  DirectoryBrowseResult,
  OnboardingAnalysis,
  OnboardingAnalysisError,
  OnboardingCommitResult,
  OnboardingRefreshResult,
  Portfolio,
  ProjectCard,
  ProjectDetail,
  ReceiptEntry,
  RoutingInfo,
  WorkSummary
} from './types'

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
  chat: (projectId: string | null, message: string, attachments: ChatAttachmentMeta[] = []) =>
    request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({ projectId, message, attachments })
    }),
  chatHistory: (projectId: string) =>
    request<ChatMessage[]>(`/chat/${encodeURIComponent(projectId)}`),
  browseDirectory: (dirPath?: string) =>
    request<DirectoryBrowseResult>(
      `/onboarding/browse${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`
    ),
  analyzeRepo: (repoPath: string, handoffText: string) =>
    requestTolerant<OnboardingAnalysis, OnboardingAnalysisError>('/onboarding/analyze', {
      method: 'POST',
      body: JSON.stringify({ repoPath, handoffText })
    }),
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
    })
}
