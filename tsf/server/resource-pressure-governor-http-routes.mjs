// GET/POST /api/resource-pressure/state, POST /api/resource-pressure/
// heavy-task-lease/{acquire,release} -- TSF Resource Pressure Governor V0.
// Read-only host-tier evidence + admission recommendation, plus a small
// durable heavy-task lease record (mutual exclusion only -- never a
// process kill, never a worktree/file mutation). See
// domain/resource-pressure-governor.mjs for the actual logic and
// docs/tsf/TSF_RESOURCE_PRESSURE_GOVERNOR_V0.md for the design record.
import { collectHostMemoryEvidence } from './resource-pressure-collector.mjs'
import {
  buildResourcePressureState,
  requestHeavyTaskLease,
  releaseHeavyTaskLease,
  classifyResourcePressureTier
} from '../domain/resource-pressure-governor.mjs'

function currentLeases(opState) {
  return opState.resourcePressureLeases ?? {}
}

export async function handleResourcePressureGovernorRoute(
  parts,
  req,
  res,
  { opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'resource-pressure') {
    return false
  }

  // GET/POST /api/resource-pressure/state -- GET returns live host-tier
  // evidence with honestly empty protectedProcesses/
  // missionsWaitingForResources (TSF has no independent mission-state
  // enumeration yet). POST lets an already-informed caller (e.g. a
  // Command/HQ layer that knows its own active missions) supply those two
  // fields; reclaimCandidates can never be supplied by either verb --
  // buildResourcePressureState has no parameter for it.
  if (parts[2] === 'state' && (req.method === 'GET' || req.method === 'POST')) {
    const body = req.method === 'POST' ? await readBody(req) : {}
    const state = buildResourcePressureState({
      hostMemory: collectHostMemoryEvidence(),
      protectedProcesses: body?.protectedProcesses,
      missionsWaitingForResources: body?.missionsWaitingForResources,
      leases: currentLeases(opState)
    })
    json(res, 200, { ok: true, state })
    return true
  }

  // POST /api/resource-pressure/heavy-task-lease/acquire
  // { kind, missionId, ttlMs? } -- mutual exclusion only; refused
  // outright under CRITICAL/EMERGENCY regardless of slot availability.
  if (parts[2] === 'heavy-task-lease' && parts[3] === 'acquire' && req.method === 'POST') {
    const body = await readBody(req)
    if (
      typeof body?.kind !== 'string' ||
      !body.kind ||
      typeof body?.missionId !== 'string' ||
      !body.missionId
    ) {
      json(res, 422, { ok: false, error: 'kind and missionId are required strings' })
      return true
    }
    const { availableBytes } = collectHostMemoryEvidence()
    const tier = classifyResourcePressureTier(availableBytes)
    const result = requestHeavyTaskLease(
      currentLeases(opState),
      { kind: body.kind, missionId: body.missionId, ttlMs: body.ttlMs },
      tier
    )
    opState.resourcePressureLeases = result.leases
    await saveState(opState)
    json(res, 200, {
      ok: true,
      granted: result.granted,
      lease: result.lease,
      reason: result.reason,
      waitingFor: result.waitingFor,
      tier
    })
    return true
  }

  // POST /api/resource-pressure/heavy-task-lease/release
  // { kind, missionId } -- a mission can only release its own lease.
  if (parts[2] === 'heavy-task-lease' && parts[3] === 'release' && req.method === 'POST') {
    const body = await readBody(req)
    if (
      typeof body?.kind !== 'string' ||
      !body.kind ||
      typeof body?.missionId !== 'string' ||
      !body.missionId
    ) {
      json(res, 422, { ok: false, error: 'kind and missionId are required strings' })
      return true
    }
    const result = releaseHeavyTaskLease(currentLeases(opState), {
      kind: body.kind,
      missionId: body.missionId
    })
    opState.resourcePressureLeases = result.leases
    await saveState(opState)
    json(res, 200, { ok: true, released: result.released, reason: result.reason })
    return true
  }

  notFound(res, `unknown resource-pressure route: ${parts.slice(2).join('/')}`)
  return true
}
