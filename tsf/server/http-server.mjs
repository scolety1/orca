// Narrow local adapter that exposes real tsf/domain state + real pilot
// evidence as JSON, plus the fixture adoption candidate. No Orca core
// files are touched; this only reads tsf/ and the pilot fixtures already
// checked into the repo, and writes to its own gitignored local-state
// file. Real-time chat dispatch orchestration (POST /api/chat, GET
// /api/chat/:projectId) lives in chat-http-routes.mjs; every other route
// concern here delegates to its own handleXxxRoute module (see the
// imports below) except the small, individually-simple GET handlers
// (meta/portfolio/projects/work/fleet-status/health/routing/usage-mode/
// agents/receipts/candidates-decision) kept inline.
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
import { saveState } from './data-store.mjs'
import { projectsById, summarizeWork, summarizeCard } from './project-catalog.mjs'
import { fleetWorkStatus } from '../domain/fleet-work-status.mjs'
import { handleKeepGoingRoute } from './keep-going-http-routes.mjs'
import { handleResearchRoute } from './research-http-routes.mjs'
import { handleOnboardingRoute } from './onboarding-http-routes.mjs'
import {
  handleHealthRepairRoute,
  recoverInterruptedHealthRepairOperations
} from './health-repair-http-routes.mjs'
import { handleResourceAuditorRoute } from './resource-auditor-http-routes.mjs'
import { handleCleanupRoute } from './cleanup-http-routes.mjs'
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
import usageModes from '../routing/usage-modes.v1.json' with { type: 'json' }
import providerRoles from '../routing/provider-role-mappings.v1.json' with { type: 'json' }
import { assertUsageModeAllowed } from '../domain/usage-mode-validation.mjs'
import { writeRuntimeMetadata } from './runtime-identity-tracker.mjs'
import { bootstrapBackgroundFleetDrivers } from './background-fleet-drivers-bootstrap.mjs'
import { bootstrapResearchMissionFleetDriverIfEnabled } from './research-mission-fleet-driver-bootstrap.mjs'
import { handleSafeUpdateRoute } from './safe-update-http-routes.mjs'
import { handleResourcePressureGovernorRoute } from './resource-pressure-governor-http-routes.mjs'
import { handleAttentionRoute } from './attention-http-routes.mjs'
import { handleChatRoute } from './chat-http-routes.mjs'

const FOUNDATION = Object.freeze({
  product: 'Thousand Sunny Fleet — Orca Foundation',
  upstreamVersion: 'v1.4.184',
  upstreamCoreFilesModified: 0
})

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
          summarizeWork(projects, opState.keepGoingRuns, () => new Date(), opState.researchMissions)
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
      const keepGoingHelpers = { json, notFound, readBody, saveState }
      if (await handleKeepGoingRoute(parts, req, res, { map, opState }, keepGoingHelpers)) {
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

      // POST /api/chat, GET /api/chat/:projectId (history) -- see
      // chat-http-routes.mjs for real-time chat dispatch orchestration.
      if (await handleChatRoute(parts, req, res, { map, opState, projects }, { json, notFound, readBody, saveState })) {
        return
      }

      // GET/POST /api/onboarding/* -- see onboarding-http-routes.mjs
      const onboardingHelpers = { json, notFound, readBody, saveState }
      if (await handleOnboardingRoute(parts, req, res, url, { opState }, onboardingHelpers)) {
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

      // GET/POST /api/resource-auditor/* -- see resource-auditor-http-routes.mjs
      if (await handleResourceAuditorRoute(parts, req, res, { opState }, { json, notFound, readBody })) {
        return
      }

      // GET/POST /api/cleanup/* -- Cleanup V1, see cleanup-http-routes.mjs.
      if (await handleCleanupRoute(parts, req, res, { opState }, { json, notFound, readBody })) {
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

      // GET/POST /api/eval[/:packId/*] -- see eval-http-routes.mjs;
      // GET /api/projects/:id/flight-recorder -- see flight-recorder-http-routes.mjs
      if ((await handleEvalRoute(parts, req, res, url, { opState }, { json, notFound, saveState })) || handleFlightRecorderRoute(parts, req, res, url, { map, opState }, { json, notFound })) {
        return
      }

      // POST /api/fleet/schedule -- see fleet-optimizer-http-routes.mjs;
      // GET /api/capacity -- see capacity-http-routes.mjs
      const fleetOptimizerHelpers = { json, notFound, readBody }
      if (
        (await handleFleetOptimizerRoute(
          parts,
          req,
          res,
          url,
          { opState },
          fleetOptimizerHelpers
        )) ||
        (await handleCapacityRoute(parts, req, res, { json, notFound }))
      ) {
        return
      }

      // POST /api/portfolio/active-fleet, /api/portfolio/work-set -- see
      // portfolio-membership-http-routes.mjs; POST
      // /api/projects/prepare-for-work -- see prepare-for-work-http-routes.mjs
      const portfolioHelpers = { json, notFound, readBody, saveState }
      if (
        (await handlePortfolioMembershipRoute(
          parts,
          req,
          res,
          { map, opState },
          portfolioHelpers
        )) ||
        (await handlePrepareForWorkRoute(parts, req, res, { opState }, portfolioHelpers))
      ) {
        return
      }

      // GET/POST /api/resource-pressure/state, POST /api/resource-pressure/
      // heavy-task-lease/* -- see resource-pressure-governor-http-routes.mjs
      const rpCtx = { opState }
      const rpHelpers = { json, notFound, readBody, saveState }
      if (await handleResourcePressureGovernorRoute(parts, req, res, rpCtx, rpHelpers)) {
        return
      }

      if (await handleAttentionRoute(parts, req, res, {}, { json, notFound, readBody })) { // GET /api/attention
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
    // Adversarial-review finding: gated on the listen SUCCESS callback, not
    // fired unconditionally right after the (async, fallible) listen()
    // call. A losing process in an EADDRINUSE restart-overlap race (the
    // exact case server-process-lifecycle.mjs already treats as "a TSF
    // server is likely already running") must never start its own driver
    // interval -- two drivers ticking the same durable mission state is a
    // real double-dispatch risk (up to and including a real paid provider
    // call), not merely a redundant one. Only the one process that
    // actually bound the fixed port can ever be this mission fleet's
    // driver, on the same host.
    bootstrapResearchMissionFleetDriverIfEnabled(server) // see research-mission-fleet-driver-bootstrap.mjs
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
  bootstrapBackgroundFleetDrivers(server) // see background-fleet-drivers-bootstrap.mjs
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStandaloneServer(Number(process.env.TSF_API_PORT) || 4610)
}
