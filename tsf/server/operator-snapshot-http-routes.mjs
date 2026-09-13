// GET /api/operator-snapshot, GET /api/operator-events?since=<revision> --
// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 5. Split out of http-server.mjs,
// mirroring attention-http-routes.mjs's/keep-going-http-routes.mjs's own
// stated reason for existing as a separate file (keeping http-server.mjs
// itself under the repo's max-lines lint cap). Pure route glue over
// operator-snapshot.mjs -- no domain logic lives here.
import { buildOperatorSnapshot, currentOperatorRevision } from './operator-snapshot.mjs'

// Small, deliberately simple live-update channel -- no message broker, no
// event-sourcing rewrite (this mission's own explicit instruction). A
// client opens this once and receives a `revision` event every time the
// real operator revision (operator-snapshot.mjs's own state-file-mtime
// marker) actually changes, polled server-side at a fixed, cheap interval
// -- the client's own job on receipt is simply "refetch
// /api/operator-snapshot", never to trust the SSE payload as the data
// itself. `pollIntervalMs` is injectable so tests never need a real timer.
export async function handleOperatorSnapshotRoute(
  parts,
  req,
  res,
  _ctx,
  { json, notFound },
  deps = {}
) {
  if (parts[1] !== 'operator-snapshot' && parts[1] !== 'operator-events') {
    return false
  }

  if (parts[1] === 'operator-snapshot' && parts.length === 2 && req.method === 'GET') {
    const build = deps.buildOperatorSnapshot ?? buildOperatorSnapshot
    json(res, 200, build())
    return true
  }

  if (parts[1] === 'operator-events' && parts.length === 2 && req.method === 'GET') {
    const url = new URL(req.url, 'http://localhost')
    const since = Number(url.searchParams.get('since') ?? 0)
    const readRevision = deps.currentOperatorRevision ?? currentOperatorRevision
    const pollIntervalMs = deps.pollIntervalMs ?? 1000
    const setIntervalFn = deps.setInterval ?? setInterval
    const clearIntervalFn = deps.clearInterval ?? clearInterval

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    let lastSeen = Number.isFinite(since) ? since : 0
    const emitIfChanged = () => {
      const revision = readRevision()
      if (revision !== lastSeen) {
        lastSeen = revision
        res.write(`data: ${JSON.stringify({ revision, changedAt: new Date().toISOString() })}\n\n`)
      }
    }
    // Fire once immediately -- a client connecting after a real mutation it
    // never saw a snapshot for should not have to wait a full poll interval
    // to learn it's already stale.
    emitIfChanged()
    const timer = setIntervalFn(emitIfChanged, pollIntervalMs)
    req.on('close', () => clearIntervalFn(timer))
    return true
  }

  notFound(res, `unknown route: ${parts.slice(1).join('/')}`)
  return true
}
