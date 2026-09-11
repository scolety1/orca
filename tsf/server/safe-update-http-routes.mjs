// GET /api/runtime-identity and GET /api/update-safety -- Safe Update
// Manager spec Phases 1-2. Extracted from http-server.mjs (which was at
// its max-lines budget) rather than inlined, matching this codebase's own
// established per-route-group extraction convention (capacity-http-
// routes.mjs, fleet-optimizer-http-routes.mjs, etc.).
//
// Stale-UI-build-prevention spec: runtime-identity now also reflects
// whether a rebuild is in progress/failed (getRuntimeIdentityWithBuildState
// composes the real identity read with ui-build-orchestrator.mjs's own
// in-memory build-action state) -- the same real read first-run-setup.html
// and the Command runtime-identity bridge both use.
import { getRuntimeIdentityWithBuildState, runUiSetup } from './ui-build-orchestrator.mjs'
import { classifyUpdateSafety } from '../domain/update-safety.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'

export async function handleSafeUpdateRoute(
  parts,
  req,
  res,
  { projects, opState, distDir, uiDir },
  { json }
) {
  // GET /api/runtime-identity: whether the currently-running backend and
  // served UI bundle genuinely match what's on disk right now, from real
  // git/build identity, never inferred from "files changed" alone.
  if (parts[1] === 'runtime-identity' && req.method === 'GET') {
    json(res, 200, await getRuntimeIdentityWithBuildState(distDir))
    return true
  }

  // POST /api/ui-setup -- Pre-UI Productization V1, Priority 4 gap 2: the
  // real "Set up TSF" action first-run-setup.html's own button hits. Only
  // ever runs when explicitly invoked here (never automatically) -- see
  // runUiSetup's own header for why this is the controlled counterpart to
  // the automatic rebuild trigger's "never run an uncontrolled npm
  // install" boundary.
  if (parts[1] === 'ui-setup' && req.method === 'POST') {
    json(res, 200, await runUiSetup({ uiDir, distDir }))
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
