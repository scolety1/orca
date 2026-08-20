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
// tickKeepGoingRun -- planWave's own validation (tsf/domain/keep-going.mjs)
// throws AFTER dispatchStep's claim() has already taken the tick lock, so
// an unvalidated item reaching that far would wedge the run in "tick in
// progress" for minutes before dispatchStep's own catch releases it (a
// real review finding -- this HTTP route is the first path that lets
// untrusted external input reach that call at all). Cheap, fails fast,
// never touches the lock. Mirrors planWave's own `!item.id` check exactly
// (not a stricter typeof-string/non-blank check an earlier version used)
// -- a real review finding was that a numeric id, accepted by planWave
// directly, would be rejected only when routed through this HTTP layer,
// two validation guards in the same feature silently disagreeing on what
// "valid" means.
// Also requires an explicit worktree or workerTerminal, matching
// dispatchStep's own requireExplicitPlacement -- a real, live-confirmed
// safety finding was that a missing worktree silently defaulted to
// 'current' (the Orca coordinator's own working directory, not anything
// scoped to the project being operated on); a real manual UI validation
// run left the form's worktree field at that old default and the
// resulting live dispatch landed directly in this program's own repo.
function findInvalidWorkItem(candidateWorkItems) {
  return candidateWorkItems.find(
    (item) =>
      !item?.id ||
      !Array.isArray(item.scope) ||
      item.scope.length === 0 ||
      (!item.workerTerminal && !item.worktree?.trim())
  )
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
    const invalidItem = findInvalidWorkItem(candidateWorkItems)
    if (invalidItem !== undefined) {
      json(res, 422, {
        ok: false,
        error: 'every candidate work item requires a non-empty id and a non-empty scope array',
        code: 'TSF_INVALID_WORK_ITEM'
      })
      return true
    }
    try {
      const result = await tickKeepGoingRun(projectId, candidateWorkItems, () => new Date())
      json(res, 200, result)
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  return false
}
