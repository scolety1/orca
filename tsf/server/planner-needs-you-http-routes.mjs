// POST /api/planner-missions/:missionId/needs-you/:needsYouId/resolve --
// Pre-UI Productization V1, Priority 5: the real, previously-unwired
// counterpart to a planner mission's own Needs-You question. The domain
// mutator (resolvePlannerNeedsYou) and the durable, atomic checkpoint write
// (mutateCheckpoint) already existed -- server/chat-dispatch-bridge.mjs's
// own recoveryHintFor comment disclosed that no route called either. This
// wires the existing primitives; it invents no new domain logic.
//
// Deliberately NOT gated behind an active planner-session lease
// (mutateCheckpoint's optional requireLeaseHolder is left unset): an owner
// answering a durable, already-raised question is a fresh, independent
// write to the checkpoint record, the same way an operator resolving a
// Keep Going blocker doesn't need to "hold a lease" on the run -- the
// checkpoint itself is the durable source of truth a future planner
// session rehydrates from.
import { resolvePlannerNeedsYou } from '../domain/planner-mission-checkpoint.mjs'
import { mutateCheckpoint, readPlannerMissionRecord } from './planner-mission-store.mjs'

export async function handlePlannerNeedsYouRoute(parts, req, res, _ctx, { json, notFound, readBody }) {
  if (parts[1] !== 'planner-missions') {
    return false
  }
  // Real bug found and fixed here (Manual Self-Improvement Finding
  // Disposition V1's own acceptance test caught the identical shape on a
  // sibling route): a real missionId can genuinely contain a literal
  // colon (e.g. a self-improvement repair mission's own
  // `mission:selfimprove:<findingId>` shape, computeRepairMissionId) --
  // http-server.mjs's own `parts` array is built from
  // url.pathname.split('/') with NO decoding, so a colon survives as its
  // raw `%3A` percent-encoding, never matching the real, decoded
  // missionId this route's own store lookup needs.
  const missionId = parts[2] ? decodeURIComponent(parts[2]) : parts[2]
  if (
    parts.length !== 6 ||
    parts[3] !== 'needs-you' ||
    parts[5] !== 'resolve' ||
    req.method !== 'POST'
  ) {
    return false
  }
  const needsYouId = parts[4]

  const record = readPlannerMissionRecord(missionId)
  if (!record?.checkpoint) {
    notFound(res, `unknown planner mission: ${missionId}`)
    return true
  }
  if (!record.checkpoint.needsYou.some((n) => n.id === needsYouId)) {
    notFound(res, `unknown Needs-You item: ${needsYouId}`)
    return true
  }

  const body = await readBody(req)
  const resolution = typeof body?.resolution === 'string' ? body.resolution.trim() : ''
  if (!resolution) {
    json(res, 422, { ok: false, error: 'resolution is required' })
    return true
  }

  const checkpoint = await mutateCheckpoint(
    missionId,
    (current, clock) => resolvePlannerNeedsYou(current, needsYouId, resolution, clock),
    () => new Date()
  )
  json(res, 200, { ok: true, checkpoint })
  return true
}
