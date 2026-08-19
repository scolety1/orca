import type { AgentEvidence, ChatAttachmentMeta, ChatMessage, ChatResponse, Portfolio, ProjectCard, ProjectDetail, ReceiptEntry, RoutingInfo, WorkSummary } from './types'

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
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`)
  return body as T
}

export const api = {
  meta: () => request<{ product: string; upstreamVersion: string; upstreamCoreFilesModified: number; usageMode: string }>('/meta'),
  portfolio: () => request<Portfolio>('/portfolio'),
  projects: () => request<ProjectCard[]>('/projects'),
  project: (id: string) => request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  work: () => request<WorkSummary>('/work'),
  routing: () => request<RoutingInfo>('/routing'),
  setUsageMode: (mode: string) => request<{ ok: true; mode: string }>('/usage-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  agents: (id: string) => request<AgentEvidence>(`/agents/${encodeURIComponent(id)}`),
  receipts: (id: string) => request<{ chain: ReceiptEntry[]; chainValid: boolean; tip: string | null }>(`/receipts/${encodeURIComponent(id)}`),
  decideCandidate: (projectId: string, body: { decision: string; requestId: string; reason?: string }) =>
    request<{ ok: true; candidateState: string; receipt: ReceiptEntry }>(`/candidates/${encodeURIComponent(projectId)}/decision`, { method: 'POST', body: JSON.stringify(body) }),
  chat: (projectId: string | null, message: string, attachments: ChatAttachmentMeta[] = []) =>
    request<ChatResponse>('/chat', { method: 'POST', body: JSON.stringify({ projectId, message, attachments }) }),
  chatHistory: (projectId: string) => request<ChatMessage[]>(`/chat/${encodeURIComponent(projectId)}`)
}
