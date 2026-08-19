// Narrow local adapter that exposes real tsf/domain state + real pilot
// evidence as JSON, plus the fixture adoption candidate and the chat
// responder. No Orca core files are touched; this only reads tsf/ and the
// pilot fixtures already checked into the repo, and writes to its own
// gitignored local-state file.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { loadRealPilotProjects } from './portfolio-projection.mjs'
import { createFixtureState, decideFixtureCandidate, FIXTURE_PROJECT_ID } from './fixture-project.mjs'
import { loadState, saveState } from './data-store.mjs'
import { respond, classifyIntent, classifyDecision } from './chat-responder.mjs'
import { invokeLivePlanner, providerLabel, fallbackLabel } from './live-planner.mjs'
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
  const all = [...real, fixture]
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
          workSet: opState.workSet,
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
