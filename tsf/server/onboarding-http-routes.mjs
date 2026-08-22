// GET/POST /api/onboarding/* route handlers, split out of http-server.mjs
// alongside keep-going-http-routes.mjs -- same reasoning: keeps
// http-server.mjs under the repo's max-lines lint cap, and generalizes
// the extraction from a keep-going-specific one-off into the repeatable
// pattern finding 3 of the wave-8 code review asked for (one module per
// route group, same (parts, req, res, ...) -> boolean-handled signature).
// Pure route glue over tsf/server/onboarding.mjs -- no domain logic here.
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { analyzeRepository, commitOnboarding, refreshOrcaRegistrationStatus, retryDirectionAnalysis } from './onboarding.mjs'

// Returns true and writes the response if this request matched an
// onboarding route; returns false (writes nothing) otherwise, so the
// caller can fall through to its other routes. `url` is the parsed
// request URL (needed for browse's ?path= query param).
export async function handleOnboardingRoute(
  parts,
  req,
  res,
  url,
  { opState },
  { json, notFound, readBody, saveState }
) {
  if (parts[1] !== 'onboarding') {
    return false
  }

  // GET /api/onboarding/browse?path=<dir> — bounded local directory
  // listing, the "Browse" affordance for a plain local web app (no
  // native OS file-picker is reachable from here).
  if (parts[2] === 'browse' && req.method === 'GET') {
    const requested = url.searchParams.get('path')
    const target = path.resolve(requested && requested.trim() ? requested : os.homedir())
    try {
      const stat = statSync(target)
      if (!stat.isDirectory()) {
        json(res, 400, { ok: false, error: `not a directory: ${target}` })
        return true
      }
      const entries = readdirSync(target, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.'))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 500)
      json(res, 200, {
        ok: true,
        path: target,
        parent: path.dirname(target) === target ? null : path.dirname(target),
        directories: entries
      })
    } catch (error) {
      json(res, 400, { ok: false, error: `cannot list directory: ${error.message}` })
    }
    return true
  }

  // POST /api/onboarding/analyze { repoPath, handoffText? } — read-only.
  if (parts[2] === 'analyze' && req.method === 'POST') {
    const body = await readBody(req)
    const repoPath = String(body.repoPath ?? '').trim()
    if (!repoPath) {
      json(res, 400, { ok: false, error: 'repoPath is required' })
      return true
    }
    const analysis = await analyzeRepository({
      repoPath,
      handoffText: String(body.handoffText ?? '')
    })
    if (!analysis.ok) {
      json(res, 422, analysis)
      return true
    }
    // Duplicate/case-normalized-path guard: if a project already known
    // under this exact repo root exists, surface that instead of a
    // second identity for the same repository.
    const normalizedTarget = analysis.repoPath.replace(/\\/g, '/').toLowerCase()
    const existing = Object.values(opState.onboardedProjects ?? {}).find(
      (record) =>
        record.lastAnalysis.repoPath.replace(/\\/g, '/').toLowerCase() === normalizedTarget
    )
    json(res, 200, { ...analysis, existingProjectId: existing?.lastAnalysis.projectId ?? null })
    return true
  }

  // POST /api/onboarding/orca-status { repoPath } — standalone "Refresh Orca
  // status" action (M7 real-migration finding, defect 3): re-checks
  // registration alone, without re-running discovery/health/migration/the
  // live planner call. Read-only, same as the check /analyze already does.
  if (parts[2] === 'orca-status' && req.method === 'POST') {
    const body = await readBody(req)
    const repoPath = String(body.repoPath ?? '').trim()
    if (!repoPath) {
      json(res, 400, { ok: false, error: 'repoPath is required' })
      return true
    }
    const result = await refreshOrcaRegistrationStatus(repoPath)
    json(res, 200, result)
    return true
  }

  // POST /api/onboarding/retry-direction { repoPath, handoffText? } —
  // standalone "Retry direction analysis" action (M7 real-migration finding,
  // defect 4): re-runs only the live planner call against freshly re-read
  // repository facts, without re-persisting anything or re-checking Orca.
  if (parts[2] === 'retry-direction' && req.method === 'POST') {
    const body = await readBody(req)
    const repoPath = String(body.repoPath ?? '').trim()
    if (!repoPath) {
      json(res, 400, { ok: false, error: 'repoPath is required' })
      return true
    }
    const result = await retryDirectionAnalysis({ repoPath, handoffText: String(body.handoffText ?? '') })
    if (!result.ok) {
      json(res, 422, result)
      return true
    }
    json(res, 200, result)
    return true
  }

  // POST /api/onboarding/commit { analysis, addTo: { knownProjects, activeFleet, workSet } }
  if (parts[2] === 'commit' && req.method === 'POST') {
    const body = await readBody(req)
    const analysis = body.analysis
    if (!analysis?.ok || !analysis.projectId) {
      json(res, 400, { ok: false, error: 'a valid analysis result is required' })
      return true
    }
    try {
      const existingRecord = opState.onboardedProjects[analysis.projectId]
      const { portfolio, receipt, orcaRegistration } = await commitOnboarding({
        portfolio: opState.portfolio,
        analysis,
        addTo: body.addTo ?? {},
        previousReceiptHash: existingRecord?.receipts?.at(-1)?.receiptHash ?? null
      })
      const now = new Date().toISOString()
      // The analysis snapshot's orcaRegistration is pre-commit (read-only
      // check only); replace it with the real post-commit outcome so the
      // stored/displayed record never shows a stale "not registered".
      const settledAnalysis = orcaRegistration
        ? {
            ...analysis,
            orcaRegistration: {
              checked: true,
              registered: orcaRegistration.ok,
              repo: orcaRegistration.repo ?? null,
              reason: orcaRegistration.reason,
              detail: orcaRegistration.detail
            }
          }
        : analysis
      const onboardedProjects = {
        ...opState.onboardedProjects,
        [analysis.projectId]: {
          repoPath: analysis.repoPath,
          lastAnalysis: settledAnalysis,
          receipts: [...(existingRecord?.receipts ?? []), receipt],
          acceptedAt: existingRecord?.acceptedAt ?? now,
          refreshedAt: now
        }
      }
      saveState({ ...opState, portfolio, onboardedProjects })
      json(res, 200, {
        ok: true,
        projectId: analysis.projectId,
        receipt,
        orcaRegistration,
        activeFleet: portfolio.activeFleet.includes(analysis.projectId),
        workSet: portfolio.workSet.includes(analysis.projectId)
      })
    } catch (error) {
      json(res, 422, { ok: false, error: error.message })
    }
    return true
  }

  // POST /api/onboarding/refresh { projectId } — bounded read-only
  // reconciliation of an already-onboarded project. Refreshes facts
  // only; Known/Active Fleet/Work Set membership and acceptance are
  // durable decisions and are never touched here.
  if (parts[2] === 'refresh' && req.method === 'POST') {
    const body = await readBody(req)
    const record = opState.onboardedProjects[body.projectId]
    if (!record) {
      notFound(res, `no onboarded project: ${body.projectId}`)
      return true
    }
    const prior = record.lastAnalysis
    const fresh = await analyzeRepository({ repoPath: record.repoPath, handoffText: '' })
    if (!fresh.ok) {
      json(res, 422, fresh)
      return true
    }
    const changes = {
      headMoved: prior.identity.head !== fresh.identity.head,
      dirtyStateChanged: prior.currentState.dirty !== fresh.currentState.dirty,
      healthStatusChanged: prior.health.status !== fresh.health.status,
      migrationClassificationChanged:
        prior.migrationClassification.classification !==
        fresh.migrationClassification.classification,
      recommendedNextMissionChanged:
        (prior.direction.recommendedNextMission?.title ?? null) !==
        (fresh.direction.recommendedNextMission?.title ?? null),
      deploymentSensitivityChanged:
        prior.health.findings.some((f) => f.code === 'DEPLOYMENT_CONFIG_PRESENT') !==
        fresh.health.findings.some((f) => f.code === 'DEPLOYMENT_CONFIG_PRESENT')
    }
    const onboardedProjects = {
      ...opState.onboardedProjects,
      [body.projectId]: {
        ...record,
        lastAnalysis: { ...fresh, projectId: prior.projectId },
        refreshedAt: new Date().toISOString()
      }
    }
    saveState({ ...opState, onboardedProjects })
    json(res, 200, { ok: true, analysis: { ...fresh, projectId: prior.projectId }, changes })
    return true
  }

  return false
}
