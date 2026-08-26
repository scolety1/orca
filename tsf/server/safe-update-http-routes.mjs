// GET /api/runtime-identity and GET /api/update-safety -- Safe Update
// Manager spec Phases 1-2. Extracted from http-server.mjs (which was at
// its max-lines budget) rather than inlined, matching this codebase's own
// established per-route-group extraction convention (capacity-http-
// routes.mjs, fleet-optimizer-http-routes.mjs, etc.).
import { getRuntimeIdentity } from './runtime-identity-tracker.mjs'
import { classifyUpdateSafety } from '../domain/update-safety.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'

export async function handleSafeUpdateRoute(
  parts,
  req,
  res,
  { projects, opState, distDir },
  { json }
) {
  // GET /api/runtime-identity: whether the currently-running backend and
  // served UI bundle genuinely match what's on disk right now, from real
  // git/build identity, never inferred from "files changed" alone.
  if (parts[1] === 'runtime-identity' && req.method === 'GET') {
    json(res, 200, await getRuntimeIdentity(distDir))
    return true
  }

  // GET /api/update-safety: whether it's currently safe to update,
  // grounded in the same real fleet aggregator Work/Command/
  // GET /api/fleet/status all share.
  if (parts[1] === 'update-safety' && req.method === 'GET') {
    json(
      res,
      200,
      classifyUpdateSafety(fleetWorkStatus(projects, opState.keepGoingRuns, () => new Date()))
    )
    return true
  }

  return false
}
