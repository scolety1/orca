// GET /api/projects/:id/flight-recorder -- pure route glue over
// flight-recorder.mjs and the real Keep Going run store. No domain
// logic here.
import { buildRunTimeline, findBottleneck } from '../domain/flight-recorder.mjs'
import { readKeepGoingRun } from './keep-going-run-store.mjs'

export function handleFlightRecorderRoute(parts, req, res, url, context, { json, notFound }) {
  void context
  if (parts[1] !== 'projects' || parts[3] !== 'flight-recorder') {
    return false
  }
  const projectId = parts[2]
  if (parts.length !== 4 || req.method !== 'GET') {
    notFound(res)
    return true
  }
  const run = readKeepGoingRun(projectId)
  if (!run) {
    json(res, 200, { ok: true, projectId, timeline: null, bottleneck: null })
    return true
  }
  const timeline = buildRunTimeline(run)
  json(res, 200, { ok: true, projectId, timeline, bottleneck: findBottleneck(timeline) })
  return true
}
