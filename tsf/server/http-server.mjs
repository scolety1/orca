// Narrow local adapter that exposes real tsf/domain state + real pilot
// evidence as JSON, plus the fixture adoption candidate and the chat
// responder. No Orca core files are touched; this only reads tsf/ and the
// pilot fixtures already checked into the repo, and writes to its own
// gitignored local-state file.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { createStaticUiHandler } from './static-ui-server.mjs'
import { loadRealPilotProjects } from './portfolio-projection.mjs'
import {
  createFixtureState,
  decideFixtureCandidate,
  FIXTURE_PROJECT_ID
} from './fixture-project.mjs'
import { loadState, saveState } from './data-store.mjs'
import {
  respond,
  classifyIntent,
  classifyDecision,
  isLiveRunRelevantFor
} from './chat-responder.mjs'
import { invokeLivePlanner, providerLabel, fallbackLabel } from './live-planner.mjs'
import { planAndDispatchFromChat } from './chat-dispatch-bridge.mjs'
import { resolveRepositoryIdentity } from './repository-identity.mjs'
import { projectOnboardedProject } from './onboarded-project-projection.mjs'
import { handleKeepGoingRoute } from './keep-going-http-routes.mjs'
import { handleOnboardingRoute } from './onboarding-http-routes.mjs'
import { handleProjectMemoryRoute } from './project-memory-http-routes.mjs'
import { keepGoingRunFor } from './keep-going-controller.mjs'
import { verifyReceipt } from '../domain/receipts.mjs'
import { compareStateToGoal } from '../domain/keep-going.mjs'
import usageModes from '../routing/usage-modes.v1.json' with { type: 'json' }
import providerRoles from '../routing/provider-role-mappings.v1.json' with { type: 'json' }

const FOUNDATION = Object.freeze({
  product: 'Thousand Sunny Fleet — Orca Foundation',
  upstreamVersion: 'v1.4.184',
  upstreamCoreFilesModified: 0
})

// M3: turns a dispatch-worthy chat message with an explicit placement into
// a real Orca dispatch via chat-dispatch-bridge.mjs, returning the SAME
// {intent, decisionClass, text, ...} response shape every other chat
// branch already produces. Requires placement.worktree specifically (not
// yet workerTerminal-only) -- the plan capsule's repository binding needs
// a real filesystem path to resolve identity from; reusing an existing
// terminal's own known worktree is a follow-up wiring wave, not yet built.
async function dispatchFromChat({ project, message, placement }) {
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  if (!placement.worktree) {
    return {
      intent,
      decisionClass,
      text: `I need an exact worktree path to dispatch into -- reusing an existing terminal for a chat-triggered dispatch isn't wired up yet, please supply a worktree.`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, no repository binding available',
      live: false,
      dispatched: false
    }
  }
  const resolved = await resolveRepositoryIdentity(placement.worktree)
  if (!resolved.ok) {
    const reasonText =
      resolved.reason === 'REPOSITORY_UNAVAILABLE'
        ? 'that worktree path does not exist'
        : resolved.reason === 'NOT_A_GIT_REPOSITORY'
          ? 'that path is not a git repository'
          : 'the repository could not be inspected'
    return {
      intent,
      decisionClass,
      text: `I can't dispatch this: ${reasonText} (${resolved.detail}).`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, repository resolution failed',
      live: false,
      dispatched: false
    }
  }

  const dispatch = await planAndDispatchFromChat({
    project,
    message,
    placement,
    identity: { repository: resolved.identity },
    clock: () => new Date()
  })

  if (!dispatch.ok) {
    const detailText = dispatch.detail ? ` (${dispatch.detail})` : ''
    return {
      intent,
      decisionClass,
      text: `I couldn't dispatch this on **${project.displayName}**: ${dispatch.reason}${detailText}.`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, did not complete',
      live: false,
      dispatched: false,
      dispatchReason: dispatch.reason,
      dispatchDetail: dispatch.detail
    }
  }

  const items = dispatch.tickResult.dispatchRecords ?? []
  const dispatchedText =
    items.length > 0
      ? `Dispatched **${dispatch.candidateWorkItem.id}** on **${project.displayName}** (task ${items[0].taskId}) -- real Orca worker, no terminal opened by hand.`
      : `Started work on **${project.displayName}**: ${dispatch.tickResult.action}.`
  return {
    intent,
    decisionClass,
    text: dispatchedText,
    providerLabel: 'PLANNER_DEEP · real dispatch via Keep Going',
    live: true,
    dispatched: true,
    tickResult: dispatch.tickResult,
    candidateWorkItem: dispatch.candidateWorkItem,
    planCapsule: dispatch.planCapsule
  }
}

function projectsById() {
  const real = loadRealPilotProjects()
  const fixture = createFixtureState()
  const opState = loadState()
  if (opState.fixtureCandidateDecision) {
    fixture.mission.state =
      opState.fixtureCandidateDecision.decision === 'ADOPT'
        ? 'ADOPTED'
        : opState.fixtureCandidateDecision.decision === 'REJECT'
          ? 'REJECTED'
          : 'REVISION_REQUESTED'
    fixture.release.adoption = fixture.mission.state
    fixture.candidateObject = {
      ...fixture.candidateObject,
      state:
        fixture.mission.state === 'ADOPTED'
          ? 'ADOPTED'
          : fixture.mission.state === 'REJECTED'
            ? 'REJECTED'
            : 'REVISION_REQUESTED'
    }
  }
  fixture.candidate = fixtureCandidateView(fixture)
  const fixtureReceiptChain = opState.fixtureReceipts.map((r) => ({
    ...r,
    chainValid: verifyReceipt(r)
  }))
  fixture.receipts = {
    chain: fixtureReceiptChain,
    chainValid: fixtureReceiptChain.every((r) => r.chainValid),
    tip: fixtureReceiptChain.at(-1)?.receiptHash ?? null
  }
  const onboarded = Object.values(opState.onboardedProjects ?? {})
    .filter((record) => record.acceptedAt) // only committed onboardings appear as real projects; a pure analysis isn't persisted here
    .map((record) =>
      projectOnboardedProject(record, {
        activeFleet: opState.portfolio.activeFleet.includes(record.lastAnalysis.projectId),
        workSet: opState.portfolio.workSet.includes(record.lastAnalysis.projectId)
      })
    )
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
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function notFound(res, msg = 'not found') {
  json(res, 404, { ok: false, error: msg })
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  if (!chunks.length) {
    return {}
  }
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
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      missionId: p.mission.id,
      adoptedAt: p.receipts?.chain?.at(-1)?.timestamp ?? null
    }))
  return { active, blocked, readyForAdoption, recentlyCompleted }
}

export function createRequestHandler() {
  return async function handler(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'api') {
      if (typeof next === 'function') {
        return next()
      }
      return notFound(res)
    }
    try {
      const { map, opState } = projectsById()
      const projects = [...map.values()]

      // GET /api/meta
      if (parts[1] === 'meta' && req.method === 'GET') {
        return json(res, 200, {
          ...FOUNDATION,
          usageMode: opState.usageMode,
          generatedAt: new Date().toISOString()
        })
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
        if (!project) {
          return notFound(res, `unknown project: ${parts[2]}`)
        }
        return json(res, 200, project)
      }

      // GET /api/work
      if (parts[1] === 'work' && req.method === 'GET') {
        return json(res, 200, summarizeWork(projects))
      }

      // GET /api/health
      if (parts[1] === 'health' && req.method === 'GET') {
        return json(
          res,
          200,
          projects.map((p) => ({ id: p.id, displayName: p.displayName, health: p.health }))
        )
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
        if (!validModes.includes(body.mode)) {
          return json(res, 400, {
            ok: false,
            error: `mode must be one of ${validModes.join(', ')} (HIGH_ASSURANCE is reserved, not yet available)`
          })
        }
        const next = { ...opState, usageMode: body.mode }
        saveState(next)
        return json(res, 200, { ok: true, mode: body.mode, authority: 'ROUTING_AND_BUDGET_ONLY' })
      }

      // GET /api/agents/:id
      if (parts[1] === 'agents' && parts.length === 3 && req.method === 'GET') {
        const project = map.get(parts[2])
        if (!project) {
          return notFound(res, `unknown project: ${parts[2]}`)
        }
        return json(res, 200, {
          projectId: project.id,
          sessions: [
            project.evidence.planner,
            project.evidence.verifier,
            ...(project.evidence.resultCapsules ?? []).map((r) => r.workerIdentity)
          ].filter(Boolean),
          worktrees: [
            ...new Set(
              [
                project.evidence.planner?.worktree,
                project.evidence.verifier?.worktree,
                ...(project.evidence.resultCapsules ?? []).map((r) => r.workerIdentity?.worktreeId)
              ].filter(Boolean)
            )
          ],
          note: 'Recorded session evidence from completed pilot work. These Orca sessions are historical, not live — open the worktree path directly in Orca to inspect it.'
        })
      }

      // GET /api/receipts/:id
      if (parts[1] === 'receipts' && parts.length === 3 && req.method === 'GET') {
        const project = map.get(parts[2])
        if (!project) {
          return notFound(res, `unknown project: ${parts[2]}`)
        }
        return json(res, 200, project.receipts)
      }

      // POST /api/candidates/:id/decision { decision, requestId, reason }
      if (
        parts[1] === 'candidates' &&
        parts.length === 4 &&
        parts[3] === 'decision' &&
        req.method === 'POST'
      ) {
        const projectId = parts[2]
        if (projectId !== FIXTURE_PROJECT_ID) {
          return json(res, 409, {
            ok: false,
            error:
              'This candidate is historical evidence from a completed pilot; it is not live-decidable in this UI.'
          })
        }
        const body = await readBody(req)
        try {
          const fixture = createFixtureState()
          const previousTip = opState.fixtureReceipts.at(-1)?.receiptHash ?? null
          const { candidate, receipt } = decideFixtureCandidate(fixture, body, previousTip)
          const next = {
            ...opState,
            fixtureCandidateDecision: {
              decision: body.decision,
              requestId: body.requestId,
              reason: body.reason ?? null,
              at: receipt.timestamp,
              receiptHash: receipt.receiptHash
            },
            fixtureReceipts: [...opState.fixtureReceipts, receipt]
          }
          saveState(next)
          return json(res, 200, { ok: true, candidateState: candidate.state, receipt })
        } catch (error) {
          return json(res, 422, { ok: false, error: error.message, code: error.code ?? null })
        }
      }

      // GET/POST /api/keep-going/:projectId[/start|pause|resume] -- see keep-going-http-routes.mjs
      if (
        await handleKeepGoingRoute(
          parts,
          req,
          res,
          { map, opState },
          { json, notFound, readBody, saveState }
        )
      ) {
        return
      }

      // POST /api/chat { projectId, message, attachments? }
      if (parts[1] === 'chat' && req.method === 'POST') {
        const body = await readBody(req)
        const project = map.get(body.projectId) ?? null
        const message = String(body.message ?? '').slice(0, 4000)
        if (!message.trim()) {
          return json(res, 400, { ok: false, error: 'message is required' })
        }
        const attachments = Array.isArray(body.attachments)
          ? body.attachments.slice(0, 10).map((a) => ({
              name: String(a?.name ?? 'attachment').slice(0, 200),
              type: String(a?.type ?? '').slice(0, 100)
            }))
          : []

        const intent = classifyIntent(message)
        const decisionClass = classifyDecision(message, intent)
        let result
        let plannerSessions = opState.plannerSessions

        // M3: real dispatch is opt-in per request via an explicit
        // `placement` field (worktree/workerTerminal + optional agent) --
        // no silent default, matching every other M2 dispatch path. Until
        // the UI itself gathers this (a later wave), existing callers that
        // never send `placement` keep the exact prior conversational
        // behavior below, unchanged.
        const dispatchWorthy = intent === 'DISPATCH_REQUEST' || intent === 'FIX_REQUEST'
        const hasExplicitPlacement = !!(body.placement?.worktree || body.placement?.workerTerminal)

        // M3: "what is it doing?" must answer from the real, live Keep
        // Going run once one exists -- the live conversational planner
        // call below has zero awareness of Keep Going state (its own
        // project-context capsule never reads keepGoingRuns), so letting
        // a STATUS/NEXT_ACTION question through to it would risk an
        // uninformed or fabricated-sounding answer about work that is
        // actually, verifiably in progress. respond()'s own live-run path
        // (chat-responder.mjs) is grounded and deterministic instead.
        const liveRun = project ? keepGoingRunFor(opState, project.id) : null
        const liveGap = liveRun
          ? compareStateToGoal(liveRun, { verifiedSatisfied: [] }, () => new Date())
          : null
        // Uses the exact same relevance rule respond() itself applies
        // (chat-responder.mjs's isLiveRunRelevantFor) so this "should I
        // skip the live conversational call" decision can never drift
        // from what respond() actually does with the same inputs -- a
        // COMPLETE/BLOCKED run does NOT count, however long ago it
        // finished (an independent review finding: an earlier version
        // let any existing run, however stale, permanently shadow this
        // decision).
        const statusWorthy = isLiveRunRelevantFor(intent, liveRun)

        if (!project) {
          result = respond(project, message)
        } else if (decisionClass === 'TIM_REQUIRED') {
          // Consequential phrasing is refused deterministically, before ever
          // spending a live call on it — not left to the model's judgment.
          // Label this distinctly from an actually-unavailable provider: one
          // may well be configured and reachable, it was just deliberately
          // not called for this message.
          result = {
            ...respond(project, message, liveRun, liveGap),
            providerLabel:
              'PLANNER_DEEP · policy refusal — consequential action, no live call made',
            live: false
          }
        } else if (dispatchWorthy && hasExplicitPlacement) {
          result = await dispatchFromChat({ project, message, placement: body.placement })
        } else if (statusWorthy) {
          result = {
            ...respond(project, message, liveRun, liveGap),
            providerLabel: 'PLANNER_DEEP · grounded in the live Keep Going run, no live call made',
            live: false
          }
        } else {
          const key = body.projectId
          const history = (opState.chatThreads[key] ?? []).slice(-12)
          const live = await invokeLivePlanner({
            project,
            message,
            opState,
            recentHistory: history,
            attachments
          })
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
            result = {
              ...respond(project, message, liveRun, liveGap),
              providerLabel: fallbackLabel(live.reason),
              live: false,
              unavailableReason: live.reason,
              unavailableDetail: live.detail
            }
          }
        }

        // Re-read fresh right before saving -- `opState` was captured once
        // at the very top of this request, before this route's own work
        // (M3's dispatch path in particular) may have mutated OTHER state
        // fields through their own properly-locked writes. A blind save
        // from that stale snapshot would silently revert those -- a real,
        // live-confirmed bug: a chat-triggered dispatch's freshly-created
        // Keep Going run vanished the instant this route's own
        // chatThreads save ran, because it saved `{...opState, ...}` with
        // opState.keepGoingRuns still empty from before the dispatch.
        const freshState = loadState()
        const plannerSessionChanged =
          project && plannerSessions[project.id] !== opState.plannerSessions[project.id]
        const nextPlannerSessions = plannerSessionChanged
          ? { ...freshState.plannerSessions, [project.id]: plannerSessions[project.id] }
          : freshState.plannerSessions
        const threads = { ...freshState.chatThreads }
        const key = body.projectId ?? '__none__'
        const attachmentSummary = attachments.length
          ? { attachmentCount: attachments.length, attachmentNames: attachments.map((a) => a.name) }
          : {}
        threads[key] = [
          ...(threads[key] ?? []),
          { role: 'user', content: message, at: new Date().toISOString(), ...attachmentSummary },
          {
            role: 'assistant',
            content: result.text,
            at: new Date().toISOString(),
            decisionClass: result.decisionClass,
            intent: result.intent
          }
        ].slice(-200)
        saveState({ ...freshState, chatThreads: threads, plannerSessions: nextPlannerSessions })
        return json(res, 200, result)
      }

      // GET /api/chat/:projectId (history)
      if (parts[1] === 'chat' && parts.length === 3 && req.method === 'GET') {
        return json(res, 200, opState.chatThreads[parts[2]] ?? [])
      }

      // GET/POST /api/onboarding/* -- see onboarding-http-routes.mjs
      if (
        await handleOnboardingRoute(
          parts,
          req,
          res,
          url,
          { opState },
          { json, notFound, readBody, saveState }
        )
      ) {
        return
      }

      // GET/POST /api/projects/:id/memory[/*/supersede] -- see
      // project-memory-http-routes.mjs
      if (
        await handleProjectMemoryRoute(
          parts,
          req,
          res,
          url,
          { map, opState },
          { json, notFound, readBody, saveState }
        )
      ) {
        return
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

// M6: standalone/production mode has no Vite dev server to fall back to
// for non-/api requests, unlike tsf/ui's own `npm run dev` (which mounts
// createRequestHandler as Vite middleware and lets Vite serve everything
// else) -- so this serves tsf/ui's built dist directly instead of 404ing.
export function startStandaloneServer(port = 4610, options = {}) {
  const handler = createRequestHandler()
  const distDir = options.uiDistDir ?? path.join(import.meta.dirname, '..', 'ui', 'dist')
  const serveStaticUi = createStaticUiHandler(distDir)
  const server = createServer((req, res) =>
    handler(req, res, () => {
      if (serveStaticUi(req, res)) {
        return
      }
      notFound(res)
    })
  )
  server.listen(port, '127.0.0.1', () => {
    console.log(`TSF operator API listening on http://127.0.0.1:${port}`)
  })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStandaloneServer(Number(process.env.TSF_API_PORT) || 4610)
}
