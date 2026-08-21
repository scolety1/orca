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
import {
  emptyProjectMemory,
  addMemoryRecord,
  supersedeMemoryRecord,
  activeRecordsOfClass,
  MEMORY_CLASSES
} from '../domain/project-memory.mjs'

export async function handleProjectMemoryRoute(
  parts,
  req,
  res,
  url,
  { opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'projects' || parts[3] !== 'memory') {
    return false
  }
  const projectId = parts[2]

  // GET /api/projects/:id/memory[?class=FACT|PREFERENCE|EXPERIENCE] --
  // active (non-superseded) records only, optionally filtered by class.
  if (parts.length === 4 && req.method === 'GET') {
    const memory = opState.projectMemory?.[projectId] ?? emptyProjectMemory()
    const filterClass = url.searchParams.get('class')
    if (filterClass && !MEMORY_CLASSES.includes(filterClass)) {
      json(res, 400, { ok: false, error: `class must be one of ${MEMORY_CLASSES.join(', ')}` })
      return true
    }
    const records = filterClass
      ? activeRecordsOfClass(memory, filterClass)
      : MEMORY_CLASSES.flatMap((c) => activeRecordsOfClass(memory, c))
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
