// GET /api/attention -- Operator Attention V1, Wave 2. Read-only fleet-wide
// attention projection (see docs/tsf/OPERATOR_ATTENTION_NOTIFICATIONS_V1_
// CHECKPOINT.md). Mirrors resource-pressure-governor-http-routes.mjs's exact
// handleXxxRoute(parts, req, res, ctx, helpers) shape. Reuses attention-
// status-reconciler.mjs's own real-deps reader rather than re-deriving real
// project/run/mission/finding/resource-pressure reads a third time.
import { buildFleetAttentionItems } from '../domain/fleet-attention-status.mjs'
import { gatherRealDeps } from './attention-status-reconciler.mjs'

export async function handleAttentionRoute(parts, req, res, _ctx, { json, notFound }) {
  if (parts[1] !== 'attention') {
    return false
  }

  if (parts.length === 2 && req.method === 'GET') {
    const clock = () => new Date()
    const items = buildFleetAttentionItems({ ...gatherRealDeps(clock), clock })
    json(res, 200, { ok: true, items })
    return true
  }

  notFound(res, `unknown attention route: ${parts.slice(2).join('/')}`)
  return true
}
