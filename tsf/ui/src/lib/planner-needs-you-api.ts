// Planner Needs-You API methods, split out of api.ts (same reason and
// convention as keep-going-api.ts's own split: adding this inline pushed
// api.ts past the repo's max-lines lint cap). `request` stays private to
// api.ts; this module receives it as a param so there's still exactly one
// fetch/error-handling implementation, not two.
type Requester = <T>(path: string, init?: RequestInit) => Promise<T>

export function createPlannerNeedsYouApi(request: Requester) {
  return {
    // Pre-UI Productization V1, Priority 5: the real, previously-unwired
    // answer action for a planner mission's own Needs-You question.
    resolvePlannerNeedsYou: (missionId: string, needsYouId: string, resolution: string) =>
      request<{ ok: true }>(
        `/planner-missions/${encodeURIComponent(missionId)}/needs-you/${encodeURIComponent(needsYouId)}/resolve`,
        { method: 'POST', body: JSON.stringify({ resolution }) }
      )
  }
}
