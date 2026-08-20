// GET/POST /api/keep-going/:projectId[/start|pause|resume] route handlers,
// split out of http-server.mjs to keep that file under the repo's
// max-lines lint cap. Pure route glue over keep-going-controller.mjs --
// no domain logic lives here.
//
// Mutating routes (start/pause/resume) deliberately do NOT use the
// `opState` snapshot the caller captured before this handler ran -- that
// snapshot predates `await readBody(req)`, so two requests racing the same
// project (including a pause landing while an autonomous wave-dispatch
// tick holds its lock, see keep-going-dispatch-loop.mjs) could otherwise
// each act on a stale read and the later `saveState` silently discard the
// other (this was wave 11 finding 1, and a real review finding on the
// concurrency-hardening wave: leaving it unfixed here would have made the
// tick's own pause-rejection guarantee only true in theory, not over
// HTTP). Instead, each mutation re-reads fresh and commits atomically via
// keep-going-run-store.mjs's synchronous compare-and-swap -- the same
// primitive the tick itself uses -- immediately before applying the real
// domain transition, so a concurrent tick's lock (or another request that
// landed first) is always seen.
import {
  keepGoingRunFor,
  pauseKeepGoingRun,
  projectKeepGoingRun,
  resumeKeepGoingRun,
  startKeepGoingRun
} from './keep-going-controller.mjs'
import { tickKeepGoingRun } from './keep-going-dispatch-loop.mjs'
import { withKeepGoingRun } from './keep-going-run-store.mjs'

const CONFLICT_CODES = new Set(['TSF_STALE_REVISION', 'TSF_TICK_IN_PROGRESS'])

function respondError(res, json, error) {
  json(res, CONFLICT_CODES.has(error.code) ? 409 : 422, {
    ok: false,
    error: error.message,
    code: error.code ?? null
  })
}

// Runs one of keep-going-controller.mjs's existing (opState-shaped) pure
// functions against a freshly-read run, wrapped in a throwaway opState of
// exactly that one project -- reuses their unchanged logic/signature
// without needing to break their existing callers (the dogfood fixture,
// keep-going-controller.test.mjs) while still committing through the real
// atomic primitive.
function mutateThroughStore(projectId, controllerFn) {
  return withKeepGoingRun(projectId, (current) => {
    const { run } = controllerFn({ keepGoingRuns: { [projectId]: current } })
    return run
  })
}

// Returns true and writes the response if this request matched a Keep
// Going route; returns false (writes nothing) otherwise, so the caller can
// fall through to its other routes.
export async function handleKeepGoingRoute(
  parts,
  req,
  res,
  { map, opState },
  { json, notFound, readBody }
) {
  if (parts[1] !== 'keep-going') {
    return false
  }
  const projectId = parts[2]

  if (parts.length === 3 && req.method === 'GET') {
    if (!map.get(projectId)) {
      notFound(res, `unknown project: ${projectId}`)
      return true
    }
    json(
      res,
      200,
      projectKeepGoingRun(keepGoingRunFor(opState, projectId), () => new Date())
    )
    return true
  }

  if (parts.length !== 4 || req.method !== 'POST') {
    return false
  }
  if (!map.get(projectId)) {
    notFound(res, `unknown project: ${projectId}`)
    return true
  }

  if (parts[3] === 'start') {
    const body = await readBody(req)
    try {
      const run = mutateThroughStore(projectId, (fakeOpState) =>
        startKeepGoingRun(fakeOpState, projectId, body, () => new Date(), body.expectedRevision)
      )
      json(
        res,
        200,
        projectKeepGoingRun(run, () => new Date())
      )
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  if (parts[3] === 'pause') {
    const body = await readBody(req)
    try {
      const run = mutateThroughStore(projectId, (fakeOpState) =>
        pauseKeepGoingRun(
          fakeOpState,
          projectId,
          body.reason,
          () => new Date(),
          body.expectedRevision
        )
      )
      json(
        res,
        200,
        projectKeepGoingRun(run, () => new Date())
      )
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  if (parts[3] === 'resume') {
    const body = await readBody(req)
    try {
      const run = mutateThroughStore(projectId, (fakeOpState) =>
        resumeKeepGoingRun(fakeOpState, projectId, () => new Date(), body.expectedRevision)
      )
      json(
        res,
        200,
        projectKeepGoingRun(run, () => new Date())
      )
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  // Manual "Run now" -- the one real entry point for the autonomous
  // wave-dispatch loop (tickKeepGoingRun) until an `orca automations
  // create --trigger cron` job is separately, explicitly authorized (see
  // keep-going-dispatch-loop.mjs's module header). Never fabricates a
  // plan: candidateWorkItems must come from the caller (today: an
  // operator/planner session), same restriction tickKeepGoingRun itself
  // enforces. Uses tickKeepGoingRun's own default deps (the real
  // orchestration bridge + the real synchronous store), so a call here
  // performs genuine Orca dispatch/settlement, not a simulation.
  if (parts[3] === 'tick') {
    const body = await readBody(req)
    try {
      const result = await tickKeepGoingRun(
        projectId,
        Array.isArray(body.candidateWorkItems) ? body.candidateWorkItems : [],
        () => new Date()
      )
      json(res, 200, result)
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  return false
}
