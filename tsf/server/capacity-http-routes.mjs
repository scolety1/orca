// GET /api/capacity -- pure route glue over the real M5 capacity signal
// (adapters/orca-capacity-bridge.mjs's fetchCapacitySnapshot, unchanged)
// and its real decision layer (domain/capacity-policy.mjs's
// decideCapacityAction, unchanged) -- no second capacity subsystem, this
// only reshapes what those two already-adopted modules produce for the
// Operator UX Capacity view. Never fabricates a remaining/reset figure the
// CLI didn't report: a provider/window with no real reading stays honestly
// null, and the UI is expected to render that as UNKNOWN.
import { fetchCapacitySnapshot } from '../adapters/orca-capacity-bridge.mjs'
import { decideCapacityAction } from '../domain/capacity-policy.mjs'

// Routing config already states each provider's real primary role
// (routing/provider-role-mappings.v1.json: PLANNER_DEEP prefers Claude,
// every WORKER_* role prefers Codex) -- surfaced as a readable label
// instead of inventing a live "active workers" counter this program has
// no real per-provider worker-count signal for yet.
const PRIMARY_ROLE_LABEL = { claude: 'Planner', codex: 'Implementation worker' }

function shapeProvider(id, snapshot) {
  if (!snapshot) {
    return { id, available: false, primaryRole: PRIMARY_ROLE_LABEL[id] }
  }
  // Real V1 stabilization finding (Operator UX pass, real browser testing):
  // Codex never reports a session window at all -- extractSnapshot's codex
  // shape has no sessionUsedPercent key, so it's `undefined`, not `null`.
  // A strict `=== null` check let it fall through as "present" and built a
  // bogus session object (NaN/undefined fields), rendering a bare "%" with
  // no number in the Capacity panel. Loose `== null` catches both.
  const hasSession = snapshot.sessionUsedPercent != null
  const hasWeekly = snapshot.weeklyUsedPercent != null
  const usedPercent = Math.max(snapshot.sessionUsedPercent ?? 0, snapshot.weeklyUsedPercent ?? 0)
  const hasSignal = hasSession || hasWeekly
  return {
    id,
    available: true,
    primaryRole: PRIMARY_ROLE_LABEL[id],
    status: snapshot.status,
    remainingPercent: hasSignal ? Math.max(0, 100 - usedPercent) : null,
    session: hasSession
      ? {
          usedPercent: snapshot.sessionUsedPercent,
          remainingPercent: Math.max(0, 100 - snapshot.sessionUsedPercent),
          resetsAt: snapshot.sessionResetsAt,
          resetDescription: snapshot.sessionResetDescription
        }
      : null,
    weekly: hasWeekly
      ? {
          usedPercent: snapshot.weeklyUsedPercent,
          remainingPercent: Math.max(0, 100 - snapshot.weeklyUsedPercent),
          resetsAt: snapshot.weeklyResetsAt,
          resetDescription: snapshot.weeklyResetDescription
        }
      : null,
    capacityAction: hasSignal ? decideCapacityAction({ [id]: snapshot }, id) : null
  }
}

export async function handleCapacityRoute(parts, req, res, { json, notFound }) {
  if (parts[1] !== 'capacity') {
    return false
  }
  if (parts.length !== 2 || req.method !== 'GET') {
    notFound(res)
    return true
  }
  const result = await fetchCapacitySnapshot()
  if (!result.ok) {
    json(res, 200, {
      ok: true,
      available: false,
      reason: result.reason,
      detail: result.detail,
      observedAt: new Date().toISOString()
    })
    return true
  }
  json(res, 200, {
    ok: true,
    available: true,
    claude: shapeProvider('claude', result.result.claude),
    codex: shapeProvider('codex', result.result.codex),
    observedAt: new Date().toISOString()
  })
  return true
}
