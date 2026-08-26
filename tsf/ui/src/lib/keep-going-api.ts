// Keep Going API methods, split out of api.ts (adversarial-review finding:
// my own additions there pushed it past the repo's max-lines lint cap --
// same convention as keep-going-types.ts's own split from types.ts).
// `request` stays private to api.ts; this module receives it as a param so
// there's still exactly one fetch/error-handling implementation, not two.
import type {
  KeepGoingCandidateWorkItem,
  KeepGoingRunView,
  KeepGoingTickResult
} from './keep-going-types'

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>

export function createKeepGoingApi(request: Requester) {
  return {
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
      request<KeepGoingRunView>(
        `/keep-going/${encodeURIComponent(projectId)}/abandon-stalled-wave`,
        {
          method: 'POST',
          body: JSON.stringify({ reason, expectedRevision })
        }
      )
  }
}
