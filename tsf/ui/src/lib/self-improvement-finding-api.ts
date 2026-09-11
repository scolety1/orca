// Self-Improvement Finding API methods, split out of api.ts (same reason
// and convention as keep-going-api.ts/planner-needs-you-api.ts's own
// splits). `request` stays private to api.ts; this module receives it as
// a param so there's still exactly one fetch/error-handling
// implementation, not two.
//
// Manual Self-Improvement Finding Disposition V1.
export type SelfImprovementFindingRecord = {
  findingId: string
  projectId: string | null
  sourceDetector: string
  severity: string
  // Detector-specific free-form payloads -- never assumed to have a fixed
  // shape here, matched exactly by what the real backend record carries.
  evidence: unknown
  reproduction: unknown
  affectedSurface: string
  confidence: number
  candidateFixScope: { kind: string; summary: string | null; filesHint: string[] } | null
  authorityRequired: string | null
  status: string
  transitions: { from: string | null; to: string; reason: string; evidence: unknown[]; at: string }[]
  createdAt: string
  updatedAt: string
}

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>

export function createSelfImprovementFindingApi(request: Requester) {
  return {
    selfImprovementFinding: (findingId: string) =>
      request<{ ok: true; finding: SelfImprovementFindingRecord }>(
        `/self-improvement/findings/${encodeURIComponent(findingId)}`
      ),
    startFix: (findingId: string) =>
      request<{ ok: boolean; reason?: string; missionId?: string; findingStatus?: string }>(
        `/self-improvement/findings/${encodeURIComponent(findingId)}/start-fix`,
        { method: 'POST' }
      ),
    applyVerifiedFix: (findingId: string) =>
      request<{ ok: boolean; reason?: string; adopted?: boolean; adoptionReason?: string; findingStatus?: string }>(
        `/self-improvement/findings/${encodeURIComponent(findingId)}/apply-fix`,
        { method: 'POST' }
      ),
    dismissSelfImprovementFinding: (findingId: string, reason?: string) =>
      request<{ ok: boolean; reason?: string; finding?: SelfImprovementFindingRecord }>(
        `/self-improvement/findings/${encodeURIComponent(findingId)}/dismiss`,
        { method: 'POST', body: JSON.stringify({ reason }) }
      )
  }
}
