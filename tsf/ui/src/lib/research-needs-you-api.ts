// Research Needs-You API methods, split out of api.ts (same reason and
// convention as planner-needs-you-api.ts's own split: adding this inline
// pushed api.ts past the repo's max-lines lint cap). `request` stays
// private to api.ts; this module receives it as a param so there's still
// exactly one fetch/error-handling implementation, not two.
type Requester = <T>(path: string, init?: RequestInit) => Promise<T>

export function createResearchNeedsYouApi(request: Requester) {
  return {
    // TSF Final Pre-UI P1 Closure V1, P1 #1: the real, previously-unwired
    // answer action for a research mission's own Needs-You question --
    // mirrors resolvePlannerNeedsYou's own exact shape. `expectedRevision`
    // is optional (additive, real once-only protection when supplied,
    // never required).
    resolveResearchNeedsYou: (
      missionId: string,
      needsYouId: string,
      resolution: string,
      expectedRevision?: number
    ) =>
      request<{ state: string }>(
        `/research/${encodeURIComponent(missionId)}/needs-you/${encodeURIComponent(needsYouId)}/resolve`,
        { method: 'POST', body: JSON.stringify({ resolution, expectedRevision }) }
      )
  }
}
