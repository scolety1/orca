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
  abandonKeepGoingStalledWave,
  keepGoingRunFor,
  pauseKeepGoingRun,
  projectKeepGoingRun,
  resumeKeepGoingRun,
  startKeepGoingRun
} from './keep-going-controller.mjs'
import { hasExplicitPlacement, tickKeepGoingRun } from './keep-going-dispatch-loop.mjs'
import { withKeepGoingRun } from './keep-going-run-store.mjs'

// TSF_STATE_LOCK_TIMEOUT (cross-process-file-lock.mjs, via
// keep-going-run-store.mjs) is a transient contention failure, not a
// permanent client error -- treated as a 409 (retryable) like the other
// two, not the 422 an earlier version of this route left it as (a real
// review finding: without this, a client keying retry logic on 409 would
// treat brief lock contention as a permanent failure).
const CONFLICT_CODES = new Set([
  'TSF_STALE_REVISION',
  'TSF_TICK_IN_PROGRESS',
  'TSF_STATE_LOCK_TIMEOUT'
])

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
async function mutateThroughStore(projectId, controllerFn) {
  return withKeepGoingRun(projectId, (current) => {
    const { run } = controllerFn({ keepGoingRuns: { [projectId]: current } })
    return run
  })
}

// Rejects a malformed candidate work item BEFORE it ever reaches
// tickKeepGoingRun -- a bad item reaching dispatchStep's claim() would
// wedge the run in "tick in progress" for minutes before its own catch
// releases the lock (a real review finding: this route is the first path
// letting untrusted external input reach that call at all). Cheap, fails
// fast, never touches the lock. Two independently-classified reasons
// (matching dispatchStep's own two checks, planWave's id/scope validation
// and requireExplicitPlacement) so the two failure classes stay
// distinguishable end to end, not collapsed into one generic error (a
// real review finding).
function findInvalidWorkItem(candidateWorkItems) {
  const badShape = candidateWorkItems.find(
    (item) => !item?.id || !Array.isArray(item.scope) || item.scope.length === 0
  )
  if (badShape) {
    return { item: badShape, reason: 'TSF_INVALID_WORK_ITEM' }
  }
  const unplaced = candidateWorkItems.find((item) => !hasExplicitPlacement(item))
  if (unplaced) {
    return { item: unplaced, reason: 'TSF_MISSING_PLACEMENT' }
  }
  return null
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
      const run = await mutateThroughStore(projectId, (fakeOpState) =>
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
      const run = await mutateThroughStore(projectId, (fakeOpState) =>
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
      const run = await mutateThroughStore(projectId, (fakeOpState) =>
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

  // Recovers a run whose in-flight wave stalled -- once run.state reaches
  // STALLED, tickKeepGoingRun immediately NOOPs (it requires ACTIVE before
  // even looking at inFlightWave) and the UI's own Run now form stops
  // rendering entirely, so there was no path back to ACTIVE with the stuck
  // wave cleared through the product surface at all (a real, live-confirmed
  // gap: a manual UI acceptance test hit this exact stuck state). Wraps the
  // same abandonStalledWave already proven in waves 18/18b -- the
  // controller enforces run.state === 'STALLED' before calling it, since
  // that domain function itself has no opinion on run state and would
  // otherwise let this route abort a healthy, still-in-progress wave too.
  if (parts[3] === 'abandon-stalled-wave') {
    const body = await readBody(req)
    try {
      const run = await mutateThroughStore(projectId, (fakeOpState) =>
        abandonKeepGoingStalledWave(
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
    const candidateWorkItems = Array.isArray(body.candidateWorkItems) ? body.candidateWorkItems : []
    try {
      const invalid = findInvalidWorkItem(candidateWorkItems)
      if (invalid) {
        json(res, 422, {
          ok: false,
          error:
            invalid.reason === 'TSF_MISSING_PLACEMENT'
              ? `work item ${invalid.item?.id ?? '(unknown)'} requires an explicit worktree or workerTerminal -- there is no safe default`
              : 'every candidate work item requires a non-empty id and a non-empty scope array',
          code: invalid.reason
        })
        return true
      }
      const result = await tickKeepGoingRun(projectId, candidateWorkItems, () => new Date())
      json(res, 200, result)
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  return false
}
