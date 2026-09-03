// GET/POST /api/research/:missionId[/...] route handlers, mirroring
// keep-going-http-routes.mjs's split-out-of-http-server.mjs pattern
// exactly -- pure route glue over research-mission-driver.mjs, no domain
// logic here.
//
// SCOPE (deliberate, disclosed): this surface covers CREATE/READ/CANCEL --
// every operation that can never spend real money or touch a real
// provider. dispatchResearchNodeDurable/pollAndAdmitResearchNodeDurable/
// verifyAndReconcileResearchNodeFieldDurable are real, tested, and durable
// (research-mission-driver.mjs, research-mission-driver.test.mjs) but are
// NOT exposed over bare HTTP in this pass -- doing so safely requires a
// real decision about which credentials/provider a request is allowed to
// trigger and how an accidental/malicious call is prevented from causing
// unbounded real spend, which is a separate, deliberate follow-up rather
// than something to rush into this HTTP surface. Real dispatch remains
// reachable today through the driver functions themselves, called from a
// trusted server-side context (the same trust boundary
// fixtures/live-bakeoff-runner.mjs already operated in, now durable
// instead of in-memory-only).
import {
  cancelResearchNodeDurable,
  createResearchMissionDurable,
  readResearchMissionArtifacts,
  readResearchMissionCompleteness,
  readResearchMissionProviderUsage,
  readResearchMissionReviewItems,
  readResearchMissionStatus
} from './research-mission-driver.mjs'

const CONFLICT_CODES = new Set(['TSF_STALE_REVISION', 'TSF_STATE_LOCK_TIMEOUT'])

function respondError(res, json, error) {
  json(res, CONFLICT_CODES.has(error.code) ? 409 : 422, {
    ok: false,
    error: error.message,
    code: error.code ?? null
  })
}

// Returns true and writes the response if this request matched a research
// route; returns false (writes nothing) otherwise, so the caller can fall
// through to its other routes -- same contract as handleKeepGoingRoute.
export async function handleResearchRoute(parts, req, res, {}, { json, notFound, readBody }) {
  if (parts[1] !== 'research') {
    return false
  }
  const missionId = parts[2]
  if (!missionId) {
    return false
  }

  if (parts.length === 3 && req.method === 'GET') {
    const status = readResearchMissionStatus(missionId)
    if (!status) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, status)
    return true
  }

  if (parts.length === 3 && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const mission = await createResearchMissionDurable(missionId, body, () => new Date())
      json(res, 200, readResearchMissionStatus(mission.id))
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'review-items') {
    const items = readResearchMissionReviewItems(missionId)
    if (items == null) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, { missionId, reviewItems: items })
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'completeness') {
    const completeness = readResearchMissionCompleteness(missionId, () => new Date())
    if (!completeness) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, completeness)
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'artifacts') {
    const artifacts = readResearchMissionArtifacts(missionId, () => new Date())
    if (!artifacts) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, artifacts)
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'usage') {
    const usage = readResearchMissionProviderUsage(missionId)
    if (!usage) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, usage)
    return true
  }

  if (parts.length === 6 && req.method === 'POST' && parts[3] === 'nodes' && parts[5] === 'cancel') {
    const nodeId = parts[4]
    try {
      const mission = await cancelResearchNodeDurable(missionId, nodeId, () => new Date())
      json(res, 200, readResearchMissionStatus(mission.id))
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  return false
}
