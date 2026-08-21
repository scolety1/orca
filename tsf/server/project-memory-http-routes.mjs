// GET/POST /api/projects/:id/memory[/*/supersede] route handlers, split
// out alongside keep-going-http-routes.mjs/onboarding-http-routes.mjs --
// same reasoning (keeps http-server.mjs under the max-lines cap, one
// module per route group). Pure route glue over
// tsf/domain/project-memory.mjs -- no domain logic here.
//
// Follows onboarding-http-routes.mjs's simpler snapshot-read/saveState
// pattern (not keep-going's tick-locked compare-and-swap): adding or
// superseding a memory record isn't racing an autonomous dispatch loop
// the way a Keep Going tick is, so the lighter-weight pattern already
// established for onboarding commit/refresh applies here too.
//
// authorizedBy/reason on the supersede route are trust-on-request, like
// every other mutating route on this server: there is no authentication
// anywhere and the server only ever binds to 127.0.0.1 (matching every
// sibling route's own trust model) -- this is the first place a
// domain-layer "human authorization" gate (project-memory.mjs's own
// TSF_MEMORY_EXPLICIT_IMMUTABLE check, mirroring keep-going.mjs's
// replaceGoal) is reachable directly from an HTTP body, so it's called
// out explicitly rather than left for a future reader to assume is a
// real identity check.
import {
  emptyProjectMemory,
  addMemoryRecord,
  supersedeMemoryRecord,
  activeRecordsOfClass,
  MEMORY_CLASSES
} from '../domain/project-memory.mjs'

const MAX_LISTED_RECORDS = 500

export async function handleProjectMemoryRoute(
  parts,
  req,
  res,
  url,
  { map, opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'projects' || parts[3] !== 'memory') {
    return false
  }
  const projectId = parts[2]
  // Matches keep-going-http-routes.mjs's/onboarding-http-routes.mjs's own
  // precedent: reject an unknown project id honestly rather than silently
  // creating/reading a memory bucket for a project that doesn't exist.
  if (!map.get(projectId)) {
    notFound(res, `unknown project: ${projectId}`)
    return true
  }

  // GET /api/projects/:id/memory[?class=FACT|PREFERENCE|EXPERIENCE] --
  // active (non-superseded) records only, optionally filtered by class.
  // Bounded the same way onboarding's own browse endpoint is (.slice),
  // since this is an operator/UI listing, not the LLM-facing capsule path
  // (that bound is retrieveExperiencesForCapsule's own .slice(-limit),
  // already enforced separately) -- but still shouldn't grow unbounded.
  if (parts.length === 4 && req.method === 'GET') {
    const memory = opState.projectMemory?.[projectId] ?? emptyProjectMemory()
    const filterClass = url.searchParams.get('class')
    if (filterClass && !MEMORY_CLASSES.includes(filterClass)) {
      json(res, 400, { ok: false, error: `class must be one of ${MEMORY_CLASSES.join(', ')}` })
      return true
    }
    const records = (
      filterClass
        ? activeRecordsOfClass(memory, filterClass)
        : MEMORY_CLASSES.flatMap((c) => activeRecordsOfClass(memory, c))
    ).slice(-MAX_LISTED_RECORDS)
    json(res, 200, { ok: true, projectId, records })
    return true
  }

  // POST /api/projects/:id/memory { class, statement, source, explicit? }
  if (parts.length === 4 && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const memory = opState.projectMemory?.[projectId] ?? emptyProjectMemory()
      const next = addMemoryRecord(
        memory,
        {
          class: body.class,
          statement: body.statement,
          source: body.source,
          explicit: body.explicit === true
        },
        () => new Date()
      )
      saveState({
        ...opState,
        projectMemory: { ...opState.projectMemory, [projectId]: next }
      })
      json(res, 200, { ok: true, record: next.records.at(-1) })
    } catch (error) {
      json(res, 422, { ok: false, error: error.message })
    }
    return true
  }

  // POST /api/projects/:id/memory/:recordId/supersede
  //   { statement, source, authorizedBy?, reason? }
  if (parts.length === 6 && parts[5] === 'supersede' && req.method === 'POST') {
    const recordId = parts[4]
    const body = await readBody(req)
    try {
      const memory = opState.projectMemory?.[projectId] ?? emptyProjectMemory()
      const next = supersedeMemoryRecord(
        memory,
        recordId,
        { statement: body.statement, source: body.source },
        body.authorizedBy || body.reason
          ? { authorizedBy: body.authorizedBy, reason: body.reason }
          : undefined,
        () => new Date()
      )
      saveState({
        ...opState,
        projectMemory: { ...opState.projectMemory, [projectId]: next }
      })
      json(res, 200, { ok: true, record: next.records.at(-1) })
    } catch (error) {
      const status = error.code === 'TSF_MEMORY_EXPLICIT_IMMUTABLE' ? 403 : 422
      json(res, status, { ok: false, error: error.message, code: error.code ?? null })
    }
    return true
  }

  notFound(res)
  return true
}
