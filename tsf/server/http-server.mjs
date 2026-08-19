// Narrow local adapter that exposes real tsf/domain state + real pilot
// evidence as JSON, plus the fixture adoption candidate and the chat
// responder. No Orca core files are touched; this only reads tsf/ and the
// pilot fixtures already checked into the repo, and writes to its own
// gitignored local-state file.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadRealPilotProjects } from './portfolio-projection.mjs'
import { createFixtureState, decideFixtureCandidate, FIXTURE_PROJECT_ID } from './fixture-project.mjs'
import { loadState, saveState } from './data-store.mjs'
import { respond, classifyIntent, classifyDecision } from './chat-responder.mjs'
import { invokeLivePlanner, providerLabel, fallbackLabel } from './live-planner.mjs'
import { analyzeRepository, commitOnboarding } from './onboarding.mjs'
import { projectOnboardedProject } from './onboarded-project-projection.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'
import usageModes from '../routing/usage-modes.v1.json' with { type: 'json' }
import providerRoles from '../routing/provider-role-mappings.v1.json' with { type: 'json' }

const FOUNDATION = Object.freeze({
  product: 'Thousand Sunny Fleet — Orca Foundation',
  upstreamVersion: 'v1.4.184',
  upstreamCoreFilesModified: 0
})

function projectsById() {
  const real = loadRealPilotProjects()
  const fixture = createFixtureState()
  const opState = loadState()
  if (opState.fixtureCandidateDecision) {
    fixture.mission.state = opState.fixtureCandidateDecision.decision === 'ADOPT' ? 'ADOPTED' : opState.fixtureCandidateDecision.decision === 'REJECT' ? 'REJECTED' : 'REVISION_REQUESTED'
    fixture.release.adoption = fixture.mission.state
    fixture.candidateObject = { ...fixture.candidateObject, state: fixture.mission.state === 'ADOPTED' ? 'ADOPTED' : fixture.mission.state === 'REJECTED' ? 'REJECTED' : 'REVISION_REQUESTED' }
  }
  fixture.candidate = fixtureCandidateView(fixture)
  const fixtureReceiptChain = opState.fixtureReceipts.map((r) => ({ ...r, chainValid: verifyReceipt(r) }))
  fixture.receipts = { chain: fixtureReceiptChain, chainValid: fixtureReceiptChain.every((r) => r.chainValid), tip: fixtureReceiptChain.at(-1)?.receiptHash ?? null }
  const onboarded = Object.values(opState.onboardedProjects ?? {})
    .filter((record) => record.acceptedAt) // only committed onboardings appear as real projects; a pure analysis isn't persisted here
    .map((record) => projectOnboardedProject(record, { activeFleet: opState.portfolio.activeFleet.includes(record.lastAnalysis.projectId), workSet: opState.portfolio.workSet.includes(record.lastAnalysis.projectId) }))
  const all = [...real, fixture, ...onboarded]
  const map = new Map(all.map((p) => [p.id, p]))
  return { map, opState }
}

function fixtureCandidateView(fixture) {
  const c = fixture.candidateObject
  const rc = fixture.evidence.resultCapsules[0]
  return {
    id: c.id,
    projectId: c.projectId,
    missionId: c.missionId,
    state: c.state,
    decidable: c.state === 'READY_FOR_ADOPTION',
    branch: fixture.branch,
    head: rc.repository.head,
    tree: rc.repository.tree,
    filesChanged: rc.filesChanged,
    implementationSummary: rc.implementationSummary,
    testsRun: rc.testsRun,
    verifierVerdict: fixture.evidence.verifierRaw.verdict,
    verifierChecks: fixture.evidence.verifierRaw.checks,
    residualRisks: null,
    binding: null
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function notFound(res, msg = 'not found') {
  json(res, 404, { ok: false, error: msg })
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function summarizeWork(projects) {
  const active = projects.filter((p) => ['ACTIVE', 'PLANNING', 'REVIEW'].includes(p.mission.state))
  const blocked = projects.filter((p) => (p.mission.state ?? '').startsWith('BLOCKED'))
  const readyForAdoption = projects.filter((p) => p.candidate?.state === 'READY_FOR_ADOPTION')
  const recentlyCompleted = projects
    .filter((p) => p.mission.state === 'ADOPTED')
    .map((p) => ({ id: p.id, displayName: p.displayName, missionId: p.mission.id, adoptedAt: p.receipts?.chain?.at(-1)?.timestamp ?? null }))
  return { active, blocked, readyForAdoption, recentlyCompleted }
}

export function createRequestHandler() {
  return async function handler(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'api') {
      if (typeof next === 'function') return next()
      return notFound(res)
    }
    try {
      const { map, opState } = projectsById()
      const projects = [...map.values()]

      // GET /api/meta
      if (parts[1] === 'meta' && req.method === 'GET') {
        return json(res, 200, { ...FOUNDATION, usageMode: opState.usageMode, generatedAt: new Date().toISOString() })
      }

      // GET /api/portfolio
      if (parts[1] === 'portfolio' && req.method === 'GET') {
        return json(res, 200, {
          usageMode: opState.usageMode,
          workSet: projects.filter((p) => p.workSet).map((p) => p.id),
          activeFleet: projects.filter((p) => p.activeFleet).map((p) => p.id),
          knownProjects: projects.map(summarizeCard)
        })
      }

      // GET /api/projects
      if (parts[1] === 'projects' && parts.length === 2 && req.method === 'GET') {
        return json(res, 200, projects.map(summarizeCard))
      }

      // GET /api/projects/:id
      if (parts[1] === 'projects' && parts.length === 3 && req.method === 'GET') {
        const project = map.get(parts[2])
        if (!project) return notFound(res, `unknown project: ${parts[2]}`)
        return json(res, 200, project)
      }

      // GET /api/work
      if (parts[1] === 'work' && req.method === 'GET') {
        return json(res, 200, summarizeWork(projects))
      }

      // GET /api/health
      if (parts[1] === 'health' && req.method === 'GET') {
        return json(res, 200, projects.map((p) => ({ id: p.id, displayName: p.displayName, health: p.health })))
      }

      // GET /api/routing
      if (parts[1] === 'routing' && req.method === 'GET') {
        return json(res, 200, {
          usageModes: usageModes.modes,
          reservedModes: ['HIGH_ASSURANCE'],
          providerRoles: providerRoles.roles,
          activeUsageMode: opState.usageMode
        })
      }

      // POST /api/usage-mode { mode }
      if (parts[1] === 'usage-mode' && req.method === 'POST') {
        const body = await readBody(req)
        const validModes = Object.keys(usageModes.modes)
        if (!validModes.includes(body.mode)) return json(res, 400, { ok: false, error: `mode must be one of ${validModes.join(', ')} (HIGH_ASSURANCE is reserved, not yet available)` })
        const next = { ...opState, usageMode: body.mode }
        saveState(next)
        return json(res, 200, { ok: true, mode: body.mode, authority: 'ROUTING_AND_BUDGET_ONLY' })
      }

      // GET /api/agents/:id
      if (parts[1] === 'agents' && parts.length === 3 && req.method === 'GET') {
        const project = map.get(parts[2])
        if (!project) return notFound(res, `unknown project: ${parts[2]}`)
        return json(res, 200, {
          projectId: project.id,
          sessions: [project.evidence.planner, project.evidence.verifier, ...(project.evidence.resultCapsules ?? []).map((r) => r.workerIdentity)].filter(Boolean),
          worktrees: [...new Set([project.evidence.planner?.worktree, project.evidence.verifier?.worktree, ...(project.evidence.resultCapsules ?? []).map((r) => r.workerIdentity?.worktreeId)].filter(Boolean))],
          note: 'Recorded session evidence from completed pilot work. These Orca sessions are historical, not live — open the worktree path directly in Orca to inspect it.'
        })
      }

      // GET /api/receipts/:id
      if (parts[1] === 'receipts' && parts.length === 3 && req.method === 'GET') {
        const project = map.get(parts[2])
        if (!project) return notFound(res, `unknown project: ${parts[2]}`)
        return json(res, 200, project.receipts)
      }

      // POST /api/candidates/:id/decision { decision, requestId, reason }
      if (parts[1] === 'candidates' && parts.length === 4 && parts[3] === 'decision' && req.method === 'POST') {
        const projectId = parts[2]
        if (projectId !== FIXTURE_PROJECT_ID) {
          return json(res, 409, { ok: false, error: 'This candidate is historical evidence from a completed pilot; it is not live-decidable in this UI.' })
        }
        const body = await readBody(req)
        try {
          const fixture = createFixtureState()
          const previousTip = opState.fixtureReceipts.at(-1)?.receiptHash ?? null
          const { candidate, receipt } = decideFixtureCandidate(fixture, body, previousTip)
          const next = {
            ...opState,
            fixtureCandidateDecision: { decision: body.decision, requestId: body.requestId, reason: body.reason ?? null, at: receipt.timestamp, receiptHash: receipt.receiptHash },
            fixtureReceipts: [...opState.fixtureReceipts, receipt]
          }
          saveState(next)
          return json(res, 200, { ok: true, candidateState: candidate.state, receipt })
        } catch (error) {
          return json(res, 422, { ok: false, error: error.message, code: error.code ?? null })
        }
      }

      // POST /api/chat { projectId, message, attachments? }
      if (parts[1] === 'chat' && req.method === 'POST') {
        const body = await readBody(req)
        const project = map.get(body.projectId) ?? null
        const message = String(body.message ?? '').slice(0, 4000)
        if (!message.trim()) return json(res, 400, { ok: false, error: 'message is required' })
        const attachments = Array.isArray(body.attachments)
          ? body.attachments.slice(0, 10).map((a) => ({ name: String(a?.name ?? 'attachment').slice(0, 200), type: String(a?.type ?? '').slice(0, 100) }))
          : []

        const intent = classifyIntent(message)
        const decisionClass = classifyDecision(message, intent)
        let result
        let plannerSessions = opState.plannerSessions

        if (!project) {
          result = respond(project, message)
        } else if (decisionClass === 'TIM_REQUIRED') {
          // Consequential phrasing is refused deterministically, before ever
          // spending a live call on it — not left to the model's judgment.
          // Label this distinctly from an actually-unavailable provider: one
          // may well be configured and reachable, it was just deliberately
          // not called for this message.
          result = { ...respond(project, message), providerLabel: 'PLANNER_DEEP · policy refusal — consequential action, no live call made', live: false }
        } else {
          const key = body.projectId
          const history = (opState.chatThreads[key] ?? []).slice(-12)
          const live = await invokeLivePlanner({ project, message, opState, recentHistory: history, attachments })
          if (live.ok) {
            plannerSessions = { ...plannerSessions, [project.id]: live.binding }
            result = {
              intent,
              decisionClass,
              text: live.text,
              plannerRole: 'PLANNER_DEEP',
              providerLabel: providerLabel({ agentId: live.agentId, model: live.model }),
              live: true,
              agentId: live.agentId,
              providerId: live.providerId,
              model: live.model
            }
          } else {
            result = { ...respond(project, message), providerLabel: fallbackLabel(live.reason), live: false, unavailableReason: live.reason, unavailableDetail: live.detail }
          }
        }

        const threads = { ...opState.chatThreads }
        const key = body.projectId ?? '__none__'
        const attachmentSummary = attachments.length ? { attachmentCount: attachments.length, attachmentNames: attachments.map((a) => a.name) } : {}
        threads[key] = [
          ...(threads[key] ?? []),
          { role: 'user', content: message, at: new Date().toISOString(), ...attachmentSummary },
          { role: 'assistant', content: result.text, at: new Date().toISOString(), decisionClass: result.decisionClass, intent: result.intent }
        ].slice(-200)
        saveState({ ...opState, chatThreads: threads, plannerSessions })
        return json(res, 200, result)
      }

      // GET /api/chat/:projectId (history)
      if (parts[1] === 'chat' && parts.length === 3 && req.method === 'GET') {
        return json(res, 200, opState.chatThreads[parts[2]] ?? [])
      }

      // GET /api/onboarding/browse?path=<dir> — bounded local directory
      // listing, the "Browse" affordance for a plain local web app (no
      // native OS file-picker is reachable from here).
      if (parts[1] === 'onboarding' && parts[2] === 'browse' && req.method === 'GET') {
        const requested = url.searchParams.get('path')
        const target = path.resolve(requested && requested.trim() ? requested : os.homedir())
        try {
          const stat = statSync(target)
          if (!stat.isDirectory()) return json(res, 400, { ok: false, error: `not a directory: ${target}` })
          const entries = readdirSync(target, { withFileTypes: true })
            .filter((entry) => !entry.name.startsWith('.'))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 500)
          return json(res, 200, { ok: true, path: target, parent: path.dirname(target) === target ? null : path.dirname(target), directories: entries })
        } catch (error) {
          return json(res, 400, { ok: false, error: `cannot list directory: ${error.message}` })
        }
      }

      // POST /api/onboarding/analyze { repoPath, handoffText? } — read-only.
      if (parts[1] === 'onboarding' && parts[2] === 'analyze' && req.method === 'POST') {
        const body = await readBody(req)
        const repoPath = String(body.repoPath ?? '').trim()
        if (!repoPath) return json(res, 400, { ok: false, error: 'repoPath is required' })
        const analysis = await analyzeRepository({ repoPath, handoffText: String(body.handoffText ?? '') })
        if (!analysis.ok) return json(res, 422, analysis)
        // Duplicate/case-normalized-path guard: if a project already known
        // under this exact repo root exists, surface that instead of a
        // second identity for the same repository.
        const normalizedTarget = analysis.repoPath.replace(/\\/g, '/').toLowerCase()
        const existing = Object.values(opState.onboardedProjects ?? {}).find((record) => record.lastAnalysis.repoPath.replace(/\\/g, '/').toLowerCase() === normalizedTarget)
        return json(res, 200, { ...analysis, existingProjectId: existing?.lastAnalysis.projectId ?? null })
      }

      // POST /api/onboarding/commit { analysis, addTo: { knownProjects, activeFleet, workSet } }
      if (parts[1] === 'onboarding' && parts[2] === 'commit' && req.method === 'POST') {
        const body = await readBody(req)
        const analysis = body.analysis
        if (!analysis?.ok || !analysis.projectId) return json(res, 400, { ok: false, error: 'a valid analysis result is required' })
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
            ? { ...analysis, orcaRegistration: { checked: true, registered: orcaRegistration.ok, repo: orcaRegistration.repo ?? null, reason: orcaRegistration.reason, detail: orcaRegistration.detail } }
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
          return json(res, 200, { ok: true, projectId: analysis.projectId, receipt, orcaRegistration, activeFleet: portfolio.activeFleet.includes(analysis.projectId), workSet: portfolio.workSet.includes(analysis.projectId) })
        } catch (error) {
          return json(res, 422, { ok: false, error: error.message })
        }
      }

      // POST /api/onboarding/refresh { projectId } — bounded read-only
      // reconciliation of an already-onboarded project. Refreshes facts
      // only; Known/Active Fleet/Work Set membership and acceptance are
      // durable decisions and are never touched here.
      if (parts[1] === 'onboarding' && parts[2] === 'refresh' && req.method === 'POST') {
        const body = await readBody(req)
        const record = opState.onboardedProjects[body.projectId]
        if (!record) return notFound(res, `no onboarded project: ${body.projectId}`)
        const prior = record.lastAnalysis
        const fresh = await analyzeRepository({ repoPath: record.repoPath, handoffText: '' })
        if (!fresh.ok) return json(res, 422, fresh)
        const changes = {
          headMoved: prior.identity.head !== fresh.identity.head,
          dirtyStateChanged: prior.currentState.dirty !== fresh.currentState.dirty,
          healthStatusChanged: prior.health.status !== fresh.health.status,
          migrationClassificationChanged: prior.migrationClassification.classification !== fresh.migrationClassification.classification,
          recommendedNextMissionChanged: (prior.direction.recommendedNextMission?.title ?? null) !== (fresh.direction.recommendedNextMission?.title ?? null),
          deploymentSensitivityChanged: (prior.health.findings.some((f) => f.code === 'DEPLOYMENT_CONFIG_PRESENT')) !== (fresh.health.findings.some((f) => f.code === 'DEPLOYMENT_CONFIG_PRESENT'))
        }
        const onboardedProjects = { ...opState.onboardedProjects, [body.projectId]: { ...record, lastAnalysis: { ...fresh, projectId: prior.projectId }, refreshedAt: new Date().toISOString() } }
        saveState({ ...opState, onboardedProjects })
        return json(res, 200, { ok: true, analysis: { ...fresh, projectId: prior.projectId }, changes })
      }

      return notFound(res, `no route: ${req.method} ${url.pathname}`)
    } catch (error) {
      return json(res, 500, { ok: false, error: error.message })
    }
  }
}

function summarizeCard(project) {
  return {
    id: project.id,
    displayName: project.displayName,
    sourceClass: project.sourceClass,
    lifecycle: project.lifecycle,
    activeFleet: project.activeFleet,
    workSet: project.workSet,
    missionState: project.mission.state,
    healthStatus: project.health.status,
    release: project.release,
    candidateState: project.candidate?.state ?? null
  }
}

export function startStandaloneServer(port = 4610) {
  const handler = createRequestHandler()
  const server = createServer((req, res) => handler(req, res, () => notFound(res)))
  server.listen(port, '127.0.0.1', () => {
    console.log(`TSF operator API listening on http://127.0.0.1:${port}`)
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStandaloneServer(Number(process.env.TSF_API_PORT) || 4610)
}
