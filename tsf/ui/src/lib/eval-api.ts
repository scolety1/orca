// Eval Pack API methods, split out of api.ts (same reason and convention
// as keep-going-api.ts's own split -- this session's own addition of
// planner-needs-you methods elsewhere pushed api.ts past the repo's
// max-lines lint cap; this is the pre-existing, already-cohesive group
// closest to a clean boundary: every `/eval*` endpoint, already backed by
// its own separate eval-types.ts). `request`/`requestTolerant` stay
// private to api.ts; this module receives them as params so there's still
// exactly one fetch/error-handling implementation, not two.
import type { EvalComparison, EvalPackSummary, EvalRunResult } from './eval-types'

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>
type TolerantRequester = <TOk, TErr>(path: string, init?: RequestInit) => Promise<TOk | TErr>

export function createEvalApi(request: Requester, requestTolerant: TolerantRequester) {
  return {
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
      >(`/eval/${encodeURIComponent(packId)}/regression-check`, { method: 'POST' })
  }
}
