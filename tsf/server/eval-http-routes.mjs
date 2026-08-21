// GET/POST /api/eval[/:packId/*] route handlers, split out alongside
// estimate-http-routes.mjs/project-memory-http-routes.mjs -- same
// reasoning (keeps http-server.mjs under the max-lines cap). Pure route
// glue over eval-pack-registry.mjs and evaluation-pack.mjs -- no domain
// logic here. Eval runs are append-only history (never overwritten, per
// acceptance item 8 "historical eval results remain inspectable"), so
// every route here either reads that history or appends to it, never
// rewrites a past entry.
import { getEvalPackEntry, listEvalPacks } from './eval-pack-registry.mjs'
import { compareEvalRuns, runEvalPack } from '../domain/evaluation-pack.mjs'
import { loadState } from './data-store.mjs'

export async function handleEvalRoute(
  parts,
  req,
  res,
  url,
  { opState },
  { json, notFound, saveState }
) {
  if (parts[1] !== 'eval') {
    return false
  }

  // GET /api/eval -- every real, registered eval pack (not history).
  if (parts.length === 2 && req.method === 'GET') {
    json(res, 200, { ok: true, packs: listEvalPacks() })
    return true
  }

  const packId = parts[2]
  const entry = packId ? getEvalPackEntry(packId) : null
  if (parts.length >= 3 && !entry) {
    notFound(res, `unknown eval pack: ${packId}`)
    return true
  }

  // GET /api/eval/:packId/history -- the real, append-only run history.
  if (parts.length === 4 && parts[3] === 'history' && req.method === 'GET') {
    json(res, 200, { ok: true, packId, runs: opState.evalRuns?.[packId] ?? [] })
    return true
  }

  // POST /api/eval/:packId/run -- actually runs the pack right now
  // against this program's real, current capabilities, appends the
  // result to history, and returns it.
  if (parts.length === 4 && parts[3] === 'run' && req.method === 'POST') {
    const actualOutputs = await entry.run(entry.pack)
    const run = runEvalPack(entry.pack, actualOutputs)
    const freshState = loadState()
    saveState({
      ...freshState,
      evalRuns: {
        ...freshState.evalRuns,
        [packId]: [...(freshState.evalRuns?.[packId] ?? []), run]
      }
    })
    json(res, 200, { ok: true, packId, run })
    return true
  }

  // POST /api/eval/:packId/regression-check -- runs the pack fresh as a
  // candidate and compares it against the most recent history entry as
  // the baseline. Never runs the comparison against a fabricated
  // baseline: honestly reports NO_BASELINE_YET if no prior run exists.
  if (parts.length === 4 && parts[3] === 'regression-check' && req.method === 'POST') {
    const history = opState.evalRuns?.[packId] ?? []
    const baselineRun = history.at(-1)
    if (!baselineRun) {
      json(res, 422, { ok: false, error: 'NO_BASELINE_YET' })
      return true
    }
    const actualOutputs = await entry.run(entry.pack)
    const candidateRun = runEvalPack(entry.pack, actualOutputs)
    const freshState = loadState()
    saveState({
      ...freshState,
      evalRuns: {
        ...freshState.evalRuns,
        [packId]: [...(freshState.evalRuns?.[packId] ?? []), candidateRun]
      }
    })
    json(res, 200, { ok: true, packId, comparison: compareEvalRuns(baselineRun, candidateRun) })
    return true
  }

  notFound(res)
  return true
}
