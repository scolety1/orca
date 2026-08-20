// GET/POST /api/keep-going/:projectId[/start|pause|resume] route handlers,
// split out of http-server.mjs to keep that file under the repo's
// max-lines lint cap. Pure route glue over keep-going-controller.mjs --
// no domain logic lives here.
import {
  keepGoingRunFor,
  pauseKeepGoingRun,
  projectKeepGoingRun,
  resumeKeepGoingRun,
  startKeepGoingRun
} from './keep-going-controller.mjs'

// Returns true and writes the response if this request matched a Keep
// Going route; returns false (writes nothing) otherwise, so the caller can
// fall through to its other routes.
export async function handleKeepGoingRoute(
  parts,
  req,
  res,
  { map, opState },
  { json, notFound, readBody, saveState }
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
      const { opState: nextState, run } = startKeepGoingRun(
        opState,
        projectId,
        body,
        () => new Date(),
        body.expectedRevision
      )
      saveState(nextState)
      json(
        res,
        200,
        projectKeepGoingRun(run, () => new Date())
      )
    } catch (error) {
      json(res, error.code === 'TSF_STALE_REVISION' ? 409 : 422, {
        ok: false,
        error: error.message,
        code: error.code ?? null
      })
    }
    return true
  }

  if (parts[3] === 'pause') {
    const body = await readBody(req)
    try {
      const { opState: nextState, run } = pauseKeepGoingRun(
        opState,
        projectId,
        body.reason,
        () => new Date(),
        body.expectedRevision
      )
      saveState(nextState)
      json(
        res,
        200,
        projectKeepGoingRun(run, () => new Date())
      )
    } catch (error) {
      json(res, error.code === 'TSF_STALE_REVISION' ? 409 : 422, {
        ok: false,
        error: error.message,
        code: error.code ?? null
      })
    }
    return true
  }

  if (parts[3] === 'resume') {
    const body = await readBody(req)
    try {
      const { opState: nextState, run } = resumeKeepGoingRun(
        opState,
        projectId,
        () => new Date(),
        body.expectedRevision
      )
      saveState(nextState)
      json(
        res,
        200,
        projectKeepGoingRun(run, () => new Date())
      )
    } catch (error) {
      json(res, error.code === 'TSF_STALE_REVISION' ? 409 : 422, {
        ok: false,
        error: error.message,
        code: error.code ?? null
      })
    }
    return true
  }

  return false
}
