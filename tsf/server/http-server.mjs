// Narrow local adapter that exposes real tsf/domain state + real pilot
// evidence as JSON, plus the fixture adoption candidate and the chat
// responder. No Orca core files are touched; this only reads tsf/ and the
// pilot fixtures already checked into the repo, and writes to its own
// gitignored local-state file.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { ensureWindowsUserEnv } from '../adapters/windows-user-env.mjs'
import { createStaticUiHandler } from './static-ui-server.mjs'

// Real V1 stabilization finding: run first, before any other module in
// this process spawns a subprocess -- see windows-user-env.mjs for the
// real, reproduced root cause (a real Orca-hosted TSF process can start
// with APPDATA missing from its own environment, breaking Orca CLI calls
// and the live planner's own credential/config resolution alike).
ensureWindowsUserEnv()
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
import { planAndDispatchFromChat, ensureWorktreeForDispatch } from './chat-dispatch-bridge.mjs'
import { respondCommand, DISPATCH_WORTHY_INTENTS } from './command-responder.mjs'
import { isAuthorizedSelfRepair } from '../domain/self-repair-authority.mjs'

// Configures which real, known project id actually IS TSF's own -- self-
// repair (domain/self-repair-authority.mjs) can never be authorized for any
// project until this is set; there is no invented default to guess from.
const SELF_REPAIR_PROJECT_ID = process.env.TSF_SELF_REPAIR_PROJECT_ID || null
import { resolveRepositoryIdentity } from './repository-identity.mjs'
import { projectsById, summarizeWork, summarizeCard } from './project-catalog.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { resolveProjectsFromText } from './project-name-resolver.mjs'
import { loadProjectAliases } from '../domain/project-aliases.mjs'
import { handleKeepGoingRoute } from './keep-going-http-routes.mjs'
import { handleResearchRoute } from './research-http-routes.mjs'
import { handleOnboardingRoute } from './onboarding-http-routes.mjs'
import {
  handleHealthRepairRoute,
  recoverInterruptedHealthRepairOperations
} from './health-repair-http-routes.mjs'
import { handleProjectMemoryRoute } from './project-memory-http-routes.mjs'
import { handleEstimateRoute } from './estimate-http-routes.mjs'
import { handleEvalRoute } from './eval-http-routes.mjs'
import { handleFlightRecorderRoute } from './flight-recorder-http-routes.mjs'
import { handleFleetOptimizerRoute } from './fleet-optimizer-http-routes.mjs'
import { handleCapacityRoute } from './capacity-http-routes.mjs'
import { handlePortfolioMembershipRoute } from './portfolio-membership-http-routes.mjs'
import {
  handlePrepareForWorkRoute,
  recoverInterruptedPrepareForWorkOperations
} from './prepare-for-work-http-routes.mjs'
import { keepGoingRunFor } from './keep-going-controller.mjs'
import { compareStateToGoal } from '../domain/keep-going.mjs'
import usageModes from '../routing/usage-modes.v1.json' with { type: 'json' }
import providerRoles from '../routing/provider-role-mappings.v1.json' with { type: 'json' }
import { assertUsageModeAllowed } from '../domain/usage-mode-validation.mjs'
import { writeRuntimeMetadata } from './runtime-identity-tracker.mjs'
import { bootstrapKeepGoingFleetDriverIfEnabled } from './keep-going-fleet-driver-bootstrap.mjs'
import { handleSafeUpdateRoute } from './safe-update-http-routes.mjs'

const FOUNDATION = Object.freeze({
  product: 'Thousand Sunny Fleet — Orca Foundation',
  upstreamVersion: 'v1.4.184',
  upstreamCoreFilesModified: 0
})

// M3/M-Command: turns a dispatch-worthy chat message into a real Orca
// dispatch via chat-dispatch-bridge.mjs, returning the SAME {intent,
// decisionClass, text, ...} response shape every other chat branch already
// produces. If the caller (Planner Chat's Advanced field, or a directly-
// supplied placement) gave an explicit worktree/workerTerminal, that wins
// unchanged; otherwise this auto-provisions a fresh worktree
// (ensureWorktreeForDispatch, M-Command) instead of refusing outright --
// the manual field is now a debug override, not a requirement (spec Phase
// 6). `selfRepairFromBranch` is only ever set by an already-authorized
// self-repair caller (domain/self-repair-authority.mjs); every other
// caller auto-provisions from the repo's own default base.
async function dispatchFromChat({ project, message, placement, selfRepairFromBranch }) {
  const intent = classifyIntent(message)
  const decisionClass = classifyDecision(message, intent)
  let effectivePlacement = placement
  if (!effectivePlacement?.worktree && !effectivePlacement?.workerTerminal) {
    const provisioned = await ensureWorktreeForDispatch(
      project,
      {},
      { fromBranch: selfRepairFromBranch }
    )
    if (!provisioned.ok) {
      return {
        intent,
        decisionClass,
        text: `I need a worktree to dispatch into. I tried to create one automatically and couldn't: ${provisioned.detail ?? provisioned.reason}. Supply a worktree path manually (Advanced) instead.`,
        providerLabel: 'PLANNER_DEEP · dispatch attempted, auto-provisioning failed',
        live: false,
        dispatched: false
      }
    }
    effectivePlacement = { worktree: provisioned.worktree }
  }
  if (!effectivePlacement.worktree) {
    return {
      intent,
      decisionClass,
      text: `I need an exact worktree path to dispatch into -- reusing an existing terminal for a chat-triggered dispatch isn't wired up yet, please supply a worktree.`,
      providerLabel: 'PLANNER_DEEP · dispatch attempted, no repository binding available',
      live: false,
      dispatched: false
    }
  }
  const resolved = await resolveRepositoryIdentity(effectivePlacement.worktree)
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
    placement: effectivePlacement,
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
  // BUG-06 (bug-ledger.json): the SAME chat phrasing ("go ahead" etc.)
  // silently either creates a brand new Keep Going run/mission or adds a
  // work item to whichever run is already ACTIVE for this project,
  // depending on hidden server-side state the operator cannot see --
  // freshlyCreated (now threaded through planAndDispatchFromChat, was
  // previously computed and discarded) is what actually distinguishes
  // them; said explicitly here rather than identical text either way.
  const missionPhrase = dispatch.freshlyCreated
    ? 'Started a new mission'
    : 'Added to the mission already running'
  const dispatchedText =
    items.length > 0
      ? `${missionPhrase} for **${project.displayName}**: dispatched **${dispatch.candidateWorkItem.id}** (task ${items[0].taskId}) -- real Orca worker, no terminal opened by hand.`
      : `${missionPhrase} for **${project.displayName}**: ${dispatch.tickResult.action}.`
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

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // M14 defect 1 fix: the desktop launcher's first-run guide polls this
    // API from a file:// origin (Origin: null) while deciding whether to
    // hand off to the real UI. Without this header Chromium-based engines
    // (WebView2 included) complete the request at the network level -- so
    // it looked "reachable" in every process/port check -- but silently
    // discard the response in fetch(), so the guide never detected a
    // genuinely-ready backend. Safe to allow any origin: this server only
    // ever listens on 127.0.0.1, so only local processes can reach it
    // regardless of this header.
    'access-control-allow-origin': '*'
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

// Adversarial-review finding: GET /api/runtime-identity previously
// recomputed its own hardcoded default dist dir, ignoring whatever
// uiDistDir startStandaloneServer was actually configured with (exercised
// by http-server-standalone.test.mjs) -- it would read build-identity.json
// from the wrong location whenever a non-default dist dir is in use.
export function createRequestHandler(options = {}) {
  const distDir = options.uiDistDir ?? path.join(import.meta.dirname, '..', 'ui', 'dist')
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
        return json(
          res,
          200,
          summarizeWork(projects, opState.keepGoingRuns, () => new Date())
        )
      }

      // GET /api/fleet/status -- Command's "what's running right now"
      // source of truth. Thin, pure-data read (not conversational) so a
      // status panel never needs to round-trip through the chat pipeline;
      // shares fleetWorkStatus with GET /api/work and Command's own
      // STATUS prose answers, so a table and a sentence can never disagree.
      if (parts[1] === 'fleet' && parts[2] === 'status' && req.method === 'GET') {
        return json(
          res,
          200,
          fleetWorkStatus(projects, opState.keepGoingRuns, () => new Date())
        )
      }

      // GET /api/runtime-identity, GET /api/update-safety -- see safe-update-http-routes.mjs
      if (await handleSafeUpdateRoute(parts, req, res, { projects, opState, distDir }, { json })) {
        return
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
        try {
          assertUsageModeAllowed(body.mode)
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message })
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

      // GET/POST /api/research/:missionId[/review-items|completeness|artifacts|
      // usage|nodes/:nodeId/{cancel,dispatch,poll}] -- see research-http-
      // routes.mjs. dispatch/poll are governed (server-side provider
      // allowlist, credential check, fixed pricing, the same durable cost
      // gate the driver enforces internally), never a bare endpoint -- see
      // that file's own header comment for the full rationale.
      if (await handleResearchRoute(parts, req, res, {}, { json, notFound, readBody })) {
        return
      }

      // POST /api/chat { projectId, message, attachments?, placement?, selfRepair? }
      // projectId: null is Command's global scope (M-Command) -- generalized
      // here rather than a parallel route, since this handler was already
      // null-projectId-tolerant at the plumbing level. A message resolving
      // to exactly ONE project, by an EXACT id/displayName match only, is
      // treated identically to the operator having picked that project
      // directly, reusing every branch below unchanged (including a real
      // dispatch). Adversarial-review finding, fixed here: a fuzzy-only
      // single match must NOT get this treatment -- it used to fall
      // straight into the same dispatch-capable path as an exact pick,
      // letting a 60%-confidence name guess trigger a real worktree/
      // dispatch with no confirmation. Zero matches, multiple matches, or
      // a fuzzy-only match are all answered by command-responder.mjs
      // instead, which never dispatches on anything less than an exact
      // match either.
      if (parts[1] === 'chat' && req.method === 'POST') {
        const body = await readBody(req)
        const message = String(body.message ?? '').slice(0, 4000)
        if (!message.trim()) {
          return json(res, 400, { ok: false, error: 'message is required' })
        }
        const attachments = Array.isArray(body.attachments)
          ? body.attachments.slice(0, 10).map((a) => ({
              name: String(a?.name ?? 'attachment').slice(0, 200),
              type: String(a?.type ?? '').slice(0, 100),
              // Real extracted text (migration-context-attachments.ts),
              // capped again server-side defensively -- optional, so a
              // caller that only ever sent {name,type} (existing Planner
              // Chat behavior) is unaffected.
              extractedText:
                typeof a?.extractedText === 'string' ? a.extractedText.slice(0, 20000) : null
            }))
          : []

        let project = map.get(body.projectId) ?? null
        let matchedOn = project ? 'id' : null
        // Adversarial-review finding: a falsy check treated an explicit
        // empty-string projectId identically to Command's genuine null/
        // omitted scope. Precise null/undefined check instead, so an
        // empty-string projectId 404s honestly as an unknown project
        // (below) rather than silently entering Command's fleet-wide
        // resolution path.
        if (!project && body.projectId == null) {
          // Adversarial-review finding: loaded once and passed to both this
          // call and respondCommand's own internal resolution below --
          // previously each independently re-read+re-parsed
          // TSF_PROJECT_ALIASES_JSON for the same request.
          const commandAliases = loadProjectAliases()
          const resolution = resolveProjectsFromText(message, projects, {
            aliases: commandAliases
          })
          if (resolution.matches.length === 1 && resolution.matches[0].matchedOn !== 'fuzzy') {
            project = resolution.matches[0].project
            matchedOn = resolution.matches[0].matchedOn
          } else {
            const commandResult = await respondCommand({
              message,
              projects,
              opState,
              clock: () => new Date(),
              aliases: commandAliases
            })
            const freshState = loadState()
            const threads = { ...freshState.chatThreads }
            threads.__command__ = [
              ...(threads.__command__ ?? []),
              { role: 'user', content: message, at: new Date().toISOString() },
              {
                role: 'assistant',
                content: commandResult.text,
                at: new Date().toISOString(),
                decisionClass: commandResult.decisionClass,
                intent: commandResult.intent,
                // Bounded follow-up conversational context: the ONLY thing
                // a later turn's back-reference resolution ("what about
                // it?") is allowed to read -- see
                // command-responder.mjs's lastReferencedProjectId. Persisted
                // here (not recomputed from `content` text later) so it's
                // exactly what THIS turn actually resolved to, never a
                // re-guess from prose.
                resolvedProjectIds: commandResult.resolvedProjectIds ?? [],
                scope: commandResult.scope ?? null
              }
            ].slice(-200)
            saveState({ ...freshState, chatThreads: threads })
            return json(res, 200, commandResult)
          }
        }

        const intent = classifyIntent(message)
        const decisionClass = classifyDecision(message, intent)
        let result
        let plannerSessions = opState.plannerSessions

        // M3/M-Command: a dispatch-worthy, non-TIM_REQUIRED message always
        // attempts a real dispatch now -- an explicit placement (Planner
        // Chat's Advanced field) still wins when supplied, otherwise
        // dispatchFromChat auto-provisions a worktree itself (spec Phase
        // 6: the manual field is an advanced override, not a requirement).
        const dispatchWorthy = DISPATCH_WORTHY_INTENTS.has(intent)
        const selfRepairAuthorized = isAuthorizedSelfRepair({
          toggleOn: !!body.selfRepair,
          matchedOn,
          decisionClass,
          projectId: project?.id ?? null,
          selfRepairProjectId: SELF_REPAIR_PROJECT_ID
        })
        // Adversarial-review finding: this was 'main' -- the real accepted
        // TSF branch (confirmed via `git branch -a`) is 'tsf/main', not a
        // bare 'main'. Configurable so this doesn't silently drift from
        // whatever the real accepted branch is called in a given
        // deployment, rather than hardcoding a second guess.
        const selfRepairFromBranch = selfRepairAuthorized
          ? process.env.TSF_SELF_REPAIR_BASE_BRANCH || 'tsf/main'
          : undefined

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
        } else if (dispatchWorthy) {
          result = await dispatchFromChat({
            project,
            message,
            placement: body.placement,
            selfRepairFromBranch
          })
        } else if (statusWorthy) {
          result = {
            ...respond(project, message, liveRun, liveGap),
            providerLabel: 'PLANNER_DEEP · grounded in the live Keep Going run, no live call made',
            live: false
          }
        } else {
          const key = body.projectId ?? project.id
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
        const key = body.projectId ?? project?.id ?? '__none__'
        result = { ...result, resolvedProjectIds: project ? [project.id] : [] }
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

      // GET/POST /api/health-repair/* -- see health-repair-http-routes.mjs
      if (
        await handleHealthRepairRoute(
          parts,
          req,
          res,
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

      // GET/POST /api/projects/:id/estimate -- see estimate-http-routes.mjs
      if (
        await handleEstimateRoute(
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

      // GET/POST /api/eval[/:packId/*] -- see eval-http-routes.mjs
      if (await handleEvalRoute(parts, req, res, url, { opState }, { json, notFound, saveState })) {
        return
      }

      // GET /api/projects/:id/flight-recorder -- see flight-recorder-http-routes.mjs
      if (handleFlightRecorderRoute(parts, req, res, url, { map, opState }, { json, notFound })) {
        return
      }

      // POST /api/fleet/schedule -- see fleet-optimizer-http-routes.mjs
      if (
        await handleFleetOptimizerRoute(
          parts,
          req,
          res,
          url,
          { opState },
          { json, notFound, readBody }
        )
      ) {
        return
      }

      // GET /api/capacity -- see capacity-http-routes.mjs
      if (await handleCapacityRoute(parts, req, res, { json, notFound })) {
        return
      }

      // POST /api/portfolio/active-fleet, /api/portfolio/work-set -- see
      // portfolio-membership-http-routes.mjs
      if (
        await handlePortfolioMembershipRoute(
          parts,
          req,
          res,
          { map, opState },
          { json, notFound, readBody, saveState }
        )
      ) {
        return
      }

      // POST /api/projects/prepare-for-work -- see
      // prepare-for-work-http-routes.mjs
      if (
        await handlePrepareForWorkRoute(
          parts,
          req,
          res,
          { opState },
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

// M6: standalone/production mode has no Vite dev server to fall back to
// for non-/api requests, unlike tsf/ui's own `npm run dev` (which mounts
// createRequestHandler as Vite middleware and lets Vite serve everything
// else) -- so this serves tsf/ui's built dist directly instead of 404ing.
export function startStandaloneServer(port = 4610, options = {}) {
  const distDir = options.uiDistDir ?? path.join(import.meta.dirname, '..', 'ui', 'dist')
  const handler = createRequestHandler({ uiDistDir: distDir })
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
  // Real V1 live-use defect fix: reacquire any Prepare-for-Work operation
  // left RUNNING by a previous process instance that died mid-operation
  // (the exact incident this exists for -- see prepare-for-work-http-
  // routes.mjs's own header). Fire-and-forget by design: startup must not
  // block on however long the resumed pipeline(s) take.
  recoverInterruptedPrepareForWorkOperations().catch((error) => {
    console.error('prepare-for-work recovery scan failed:', error)
  })
  // BUG-05 (bug-ledger.json): same reacquire-on-startup posture as Prepare
  // for Work above, now that Health Repair's baseline/repair/repair-
  // selected actions are durable operations too.
  recoverInterruptedHealthRepairOperations().catch((error) => {
    console.error('health-repair recovery scan failed:', error)
  })
  // Safe Update Manager (spec Phase 5): records this real process's own
  // PID/commit/startedAt so a later checker can tell a genuinely-alive
  // current process apart from a stale/orphaned one -- fire-and-forget,
  // same convention as the recovery scan above; startup must not block on
  // a git spawn.
  writeRuntimeMetadata().catch((error) => {
    console.error('runtime metadata write failed:', error)
  })
  bootstrapKeepGoingFleetDriverIfEnabled(server) // see keep-going-fleet-driver-bootstrap.mjs
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStandaloneServer(Number(process.env.TSF_API_PORT) || 4610)
}
