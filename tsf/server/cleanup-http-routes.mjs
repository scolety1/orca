// GET/POST /api/cleanup/* -- Cleanup V1 governed destructive automation.
// Every mutating route runs the full runGovernedCleanupAction pipeline,
// which fails closed behind the real, unset-by-default owner-authorization
// gate (cleanup-owner-authorization-gate.mjs) -- no request body field can
// substitute for that gate; `gateCheck` is never taken from the request.
import { runGovernedCleanupAction, recoverStalledCleanupExecution } from './cleanup-executor.mjs'
import { readCleanupRequestRecord, readAllCleanupRequestRecords } from './cleanup-request-store.mjs'
import { readOwnerAuthorizationGateState } from './cleanup-owner-authorization-gate.mjs'
import { computeCleanupRequestId } from '../domain/cleanup-lifecycle.mjs'
import { CLEANUP_ACTION_CLASSES } from '../domain/cleanup-action-taxonomy.mjs'

export async function handleCleanupRoute(parts, req, res, ctx, { json, notFound, readBody }) {
  if (parts[1] !== 'cleanup') {
    return false
  }

  // GET /api/cleanup/action-classes -- the taxonomy, for a UI/CLI to render
  // available action classes and their tier without duplicating the list.
  if (parts[2] === 'action-classes' && req.method === 'GET') {
    json(res, 200, { ok: true, actionClasses: CLEANUP_ACTION_CLASSES })
    return true
  }

  // GET /api/cleanup/gate-state -- diagnostic only, never mutates; reports
  // whether the real owner-authorization gate is currently open.
  if (parts[2] === 'gate-state' && req.method === 'GET') {
    const state = readOwnerAuthorizationGateState()
    json(res, 200, { ok: true, gateState: { open: state.open, reason: state.reason } })
    return true
  }

  // GET /api/cleanup/request?requestId=... -- read the durable record for
  // one request (recommendation/plan/authorization/executions/receipts).
  if (parts[2] === 'request' && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost')
    const requestId = url.searchParams.get('requestId')
    if (!requestId) {
      json(res, 422, { ok: false, error: 'requestId query parameter is required' })
      return true
    }
    const record = readCleanupRequestRecord(requestId)
    json(res, 200, { ok: true, record })
    return true
  }

  // GET /api/cleanup/requests -- list every durable request record known to
  // this worktree's own TSF server (per-worktree scope, like researchMissions).
  if (parts[2] === 'requests' && req.method === 'GET') {
    json(res, 200, { ok: true, records: readAllCleanupRequestRecords() })
    return true
  }

  // POST /api/cleanup/preview { actionClass, targetIdentity } -- computes
  // the deterministic requestId a real call would use, without running the
  // pipeline at all. Purely informational.
  if (parts[2] === 'preview' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body?.actionClass || !body?.targetIdentity) {
      json(res, 422, { ok: false, error: 'actionClass and targetIdentity are required' })
      return true
    }
    const requestId = computeCleanupRequestId(body.actionClass, body.targetIdentity)
    json(res, 200, { ok: true, requestId })
    return true
  }

  // POST /api/cleanup/run { actionClass, targetIdentity, rationale, basis,
  // grantedBy, mutationParams, safetyOptions } -- the full governed
  // pipeline. `gateCheck` is deliberately NOT accepted from the request
  // body -- always the real gate for this route.
  if (parts[2] === 'run' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body?.actionClass || !body?.targetIdentity || !body?.rationale) {
      json(res, 422, { ok: false, error: 'actionClass, targetIdentity, and rationale are required' })
      return true
    }
    const outcome = await runGovernedCleanupAction({
      actionClass: body.actionClass,
      targetIdentity: body.targetIdentity,
      rationale: body.rationale,
      basis: body.basis ?? null,
      grantedBy: body.grantedBy ?? 'http-caller',
      mutationParams: body.mutationParams ?? {},
      safetyOptions: body.safetyOptions ?? {}
    })
    json(res, 200, { ok: true, outcome })
    return true
  }

  // POST /api/cleanup/recover { requestId } -- reconciles a stalled
  // (IN_PROGRESS) execution's quarantine state against real filesystem
  // state. Never guesses; may report requiresOwnerReview.
  if (parts[2] === 'recover' && req.method === 'POST') {
    const body = await readBody(req)
    if (!body?.requestId) {
      json(res, 422, { ok: false, error: 'requestId is required' })
      return true
    }
    const recovery = recoverStalledCleanupExecution(body.requestId)
    json(res, 200, { ok: true, recovery })
    return true
  }

  notFound(res, `unknown cleanup route: ${parts.slice(2).join('/')}`)
  return true
}
