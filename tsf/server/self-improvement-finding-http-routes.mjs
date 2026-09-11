// GET /api/self-improvement/findings/:findingId
// POST /api/self-improvement/findings/:findingId/start-fix
// POST /api/self-improvement/findings/:findingId/apply-fix
// POST /api/self-improvement/findings/:findingId/dismiss
//
// Manual Self-Improvement Finding Disposition V1: wires the real
// disposition primitives (self-improvement-finding-disposition.mjs) --
// invents no domain logic of its own, mirrors planner-needs-you-http-
// routes.mjs's exact handleXxxRoute(parts, req, res, ctx, helpers) shape.
import { readFinding } from './self-improvement-finding-store.mjs'
import { startFix, applyVerifiedFix, dismissFinding } from './self-improvement-finding-disposition.mjs'

export async function handleSelfImprovementFindingRoute(parts, req, res, _ctx, { json, notFound, readBody }) {
  if (parts[1] !== 'self-improvement' || parts[2] !== 'findings') {
    return false
  }
  // Real bug found and fixed here (Manual Self-Improvement Finding
  // Disposition V1's own acceptance test): a real findingId always
  // contains a literal colon (findingIdFor's own `finding:<fingerprint>`
  // shape) -- http-server.mjs's own `parts` array is built from
  // url.pathname.split('/') with NO decoding, so a colon survives as its
  // raw `%3A` percent-encoding, never matching the real, decoded
  // findingId this route's own store lookups need. Every id segment
  // below must be decoded before use.
  const findingId = parts[3] ? decodeURIComponent(parts[3]) : parts[3]
  if (!findingId) {
    return false
  }

  // GET /api/self-improvement/findings/:findingId -- the real detail read
  // ("click into details") the owner's own attention card needs: what TSF
  // found, why it matters, evidence, proposed fix, verification status.
  if (parts.length === 4 && req.method === 'GET') {
    const finding = readFinding(findingId)
    if (!finding) {
      notFound(res, `unknown finding: ${findingId}`)
      return true
    }
    json(res, 200, { ok: true, finding })
    return true
  }

  if (parts.length !== 5 || req.method !== 'POST') {
    return false
  }

  if (parts[4] === 'start-fix') {
    json(res, 200, await startFix(findingId))
    return true
  }
  if (parts[4] === 'apply-fix') {
    json(res, 200, await applyVerifiedFix(findingId))
    return true
  }
  if (parts[4] === 'dismiss') {
    const body = await readBody(req)
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
    json(res, 200, await dismissFinding(findingId, { reason }))
    return true
  }

  return false
}
