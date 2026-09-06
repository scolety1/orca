// GET/POST /api/research/:missionId[/...] route handlers, mirroring
// keep-going-http-routes.mjs's split-out-of-http-server.mjs pattern
// exactly -- pure route glue over research-mission-driver.mjs, no domain
// logic here.
//
// "GENERIC V0 ADOPTION READINESS" Phase 2 finding: CREATE/READ/CANCEL was
// previously the whole surface, with real dispatch deliberately withheld
// pending "a real decision about which credentials/provider a request is
// allowed to trigger." That decision is made now, by direct analogy to
// this codebase's own existing precedent -- keep-going-http-routes.mjs's
// `tick` route already exposes a real, governed "trigger real dispatch"
// HTTP action (Keep Going's one real entry point for autonomous
// wave-dispatch pending a separately-authorized cron trigger), not
// withheld "for safety" in the abstract. Research's dispatch carries a
// genuinely different, additional risk Keep Going's tick does not (real,
// metered, per-call EXTERNAL THIRD-PARTY SPEND against Parallel/Exa), so
// the smallest safe boundary mirrors `tick`'s shape while closing that
// specific gap -- never a bare, ungated endpoint "for symmetry" (HQ's own
// explicit instruction):
//   - provider allowlist: only PARALLEL/EXA below, never a caller-named
//     provider string, so a request can never reach an arbitrary adapter;
//   - credential availability check BEFORE any network call: a missing
//     env var refuses cleanly (422) and never reveals whether/what value
//     is configured;
//   - pricing is a fixed, server-side PRICING_POLICY -- NEVER accepted
//     from the request body, so a caller can never inject a fabricated
//     (e.g. $0) price to defeat the fail-closed cost gate;
//   - spend authorization is the SAME authorizeMeteredExecution gate
//     dispatchResearchNodeDurable already enforces internally (no new
//     governance mechanism, no second control plane);
//   - dispatch/poll are the existing, already-durable, idempotent driver
//     functions -- calling this route twice is exactly as safe as calling
//     dispatchResearchNodeDurable twice directly;
//   - cancellation already existed (the /cancel route below, unchanged);
//   - auditability: every real call still flows through the same durable
//     dispatch-bookkeeping/cost-governance records dispatchResearchNodeDurable
//     always writes -- this route adds no separate, unaudited path.
import { createExaHttpTransport } from '../adapters/exa-http-transport.mjs'
import { createExaResearchWorker, EXA_PROVIDER_ID } from '../adapters/exa-research-worker.mjs'
import { createParallelHttpTransport } from '../adapters/parallel-http-transport.mjs'
import { createParallelResearchWorker, PARALLEL_PROVIDER_ID } from '../adapters/parallel-research-worker.mjs'
import {
  cancelResearchNodeDurable,
  createResearchMissionDurable,
  dispatchResearchNodeDurable,
  pollAndAdmitResearchNodeDurable,
  readAllResearchMissionSummaries,
  readResearchMissionArtifacts,
  readResearchMissionCompleteness,
  readResearchMissionProviderUsage,
  readResearchMissionReviewItems,
  readResearchMissionStatus
} from './research-mission-driver.mjs'

const CONFLICT_CODES = new Set(['TSF_STALE_REVISION', 'TSF_STATE_LOCK_TIMEOUT'])

// Server-side only -- never derived from, or overridable by, the request
// body. List price, disclosed same as every real script in this repo;
// Parallel/Exa report no reliable per-call usage cost today, matching the
// real pilot's own "unknown, disclosed, never silently $0" handling.
const PROVIDER_ALLOWLIST = Object.freeze({
  [PARALLEL_PROVIDER_ID]: {
    envVar: 'PARALLEL_API_KEY',
    pricingPolicy: { [PARALLEL_PROVIDER_ID]: { costPerRequestUsd: 0.025 } },
    createWorker: (clock) => createParallelResearchWorker({ transport: createParallelHttpTransport({ apiKey: process.env.PARALLEL_API_KEY }), clock })
  },
  [EXA_PROVIDER_ID]: {
    envVar: 'EXA_API_KEY',
    pricingPolicy: { [EXA_PROVIDER_ID]: { costPerRequestUsd: 0.1 } },
    createWorker: (clock) => createExaResearchWorker({ transport: createExaHttpTransport({ apiKey: process.env.EXA_API_KEY }), clock })
  }
})
const DEFAULT_MAX_APPROVED_SPEND_USD = 5.0

// HQ FINAL ADOPTION EVIDENCE RECONCILIATION §3: before formal merge,
// externally billable dispatch must have an explicit operator-controlled
// enablement gate, DEFAULT DISABLED. Reuses this codebase's own existing
// convention exactly (server/keep-going-fleet-driver-bootstrap.mjs's
// `TSF_KEEP_GOING_FLEET_DRIVER !== '1'` no-op-unless-enabled gate) --
// no new config system invented. Applies ONLY to /dispatch: /poll is
// structurally incapable of creating a new billable provider run --
// pollAndAdmitResearchNodeDurable only ever calls worker.fetchResult()
// against an ALREADY-recorded dispatch (requires node.dispatchRecords to
// be non-empty, returns NOT_YET_DISPATCHED otherwise; it never calls
// worker.dispatch()) -- so it may safely remain available for recovery
// (checking whether an already-authorized call completed) even while new
// dispatch is disabled. CREATE/READ/ARTIFACT/STATUS/CANCEL are pure state
// operations, never billable, and are completely unaffected either way.
function liveDispatchEnabled() {
  return process.env.TSF_RESEARCH_LIVE_DISPATCH_ENABLED === '1'
}

function respondError(res, json, error) {
  json(res, CONFLICT_CODES.has(error.code) ? 409 : 422, {
    ok: false,
    error: error.message,
    code: error.code ?? null
  })
}

// Returns true and writes the response if this request matched a research
// route; returns false (writes nothing) otherwise, so the caller can fall
// through to its other routes -- same contract as handleKeepGoingRoute.
export async function handleResearchRoute(parts, req, res, {}, { json, notFound, readBody }) {
  if (parts[1] !== 'research') {
    return false
  }

  // GET /api/research[?projectId=x] -- list summaries (HQ "Active Research",
  // Work's Research filter, a Project's "Research for this project" section).
  if (parts.length === 2 && req.method === 'GET') {
    const projectId = new URL(req.url, 'http://localhost').searchParams.get('projectId') || undefined
    json(res, 200, { missions: readAllResearchMissionSummaries({ projectId }) })
    return true
  }

  const missionId = parts[2]
  if (!missionId) {
    return false
  }

  if (parts.length === 3 && req.method === 'GET') {
    const status = readResearchMissionStatus(missionId)
    if (!status) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, status)
    return true
  }

  if (parts.length === 3 && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const mission = await createResearchMissionDurable(missionId, body, () => new Date())
      json(res, 200, readResearchMissionStatus(mission.id))
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'review-items') {
    const items = readResearchMissionReviewItems(missionId)
    if (items == null) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, { missionId, reviewItems: items })
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'completeness') {
    const completeness = readResearchMissionCompleteness(missionId, () => new Date())
    if (!completeness) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, completeness)
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'artifacts') {
    const artifacts = readResearchMissionArtifacts(missionId, () => new Date())
    if (!artifacts) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, artifacts)
    return true
  }

  if (parts.length === 4 && req.method === 'GET' && parts[3] === 'usage') {
    const usage = readResearchMissionProviderUsage(missionId)
    if (!usage) {
      notFound(res, `unknown research mission: ${missionId}`)
      return true
    }
    json(res, 200, usage)
    return true
  }

  if (parts.length === 6 && req.method === 'POST' && parts[3] === 'nodes' && parts[5] === 'cancel') {
    const nodeId = parts[4]
    try {
      const mission = await cancelResearchNodeDurable(missionId, nodeId, () => new Date())
      json(res, 200, readResearchMissionStatus(mission.id))
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  if (parts.length === 6 && req.method === 'POST' && parts[3] === 'nodes' && parts[5] === 'dispatch') {
    // Checked FIRST, before provider allowlist/credential checks, so a
    // disabled system reveals nothing about what providers/credentials
    // might otherwise be checked -- fails closed with a clear, machine-
    // readable reason, never a bare 404/silent no-op.
    if (!liveDispatchEnabled()) {
      json(res, 403, { ok: false, error: 'live research dispatch is disabled by operator configuration (set TSF_RESEARCH_LIVE_DISPATCH_ENABLED=1 to enable) -- no billable request can be initiated while disabled', code: 'TSF_RESEARCH_LIVE_DISPATCH_DISABLED' })
      return true
    }
    const nodeId = parts[4]
    const body = await readBody(req)
    const providerId = body?.providerId
    const provider = PROVIDER_ALLOWLIST[providerId]
    if (!provider) {
      json(res, 422, { ok: false, error: `unknown or disallowed providerId: ${providerId ?? '(missing)'} -- must be one of ${Object.keys(PROVIDER_ALLOWLIST).join(', ')}`, code: 'TSF_UNKNOWN_PROVIDER' })
      return true
    }
    if (!process.env[provider.envVar]) {
      // Never reveals whether/what value might be set -- only that the
      // request cannot proceed. No network call, no worker construction,
      // happens before this check.
      json(res, 422, { ok: false, error: `provider credentials are not configured for ${providerId} -- request refused before any network call`, code: 'TSF_MISSING_PROVIDER_CREDENTIALS' })
      return true
    }
    try {
      const clock = () => new Date()
      const worker = provider.createWorker(clock)
      const maxApprovedSpendUsd = typeof body?.maxApprovedSpendUsd === 'number' ? body.maxApprovedSpendUsd : DEFAULT_MAX_APPROVED_SPEND_USD
      const result = await dispatchResearchNodeDurable(missionId, nodeId, providerId, worker, clock, { costGovernance: { pricingPolicy: provider.pricingPolicy, maxApprovedSpendUsd } })
      if (!result.ok && result.costRefused) {
        json(res, 422, { ok: false, error: 'dispatch refused by the cost governance gate before any network call', code: 'TSF_COST_GATE_REFUSED', decision: result.decision })
        return true
      }
      if (!result.ok && result.ambiguous) {
        json(res, 409, { ok: false, error: 'a prior dispatch attempt is ambiguous and requires reconciliation before redispatching', code: 'TSF_DISPATCH_AMBIGUOUS', classification: result.classification })
        return true
      }
      json(res, 200, { ok: result.ok, alreadyDispatched: result.alreadyDispatched ?? false, status: readResearchMissionStatus(missionId) })
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  if (parts.length === 6 && req.method === 'POST' && parts[3] === 'nodes' && parts[5] === 'poll') {
    // Deliberately NOT gated by liveDispatchEnabled() -- structurally
    // incapable of creating a new billable provider run (see the
    // liveDispatchEnabled comment above pollAndAdmitResearchNodeDurable's
    // own contract). Safe to keep available for recovery even while new
    // dispatch is disabled: an operator can still learn whether an
    // already-authorized call (made before disabling) completed.
    const nodeId = parts[4]
    const body = await readBody(req)
    const providerId = body?.providerId
    const provider = PROVIDER_ALLOWLIST[providerId]
    if (!provider) {
      json(res, 422, { ok: false, error: `unknown or disallowed providerId: ${providerId ?? '(missing)'} -- must be one of ${Object.keys(PROVIDER_ALLOWLIST).join(', ')}`, code: 'TSF_UNKNOWN_PROVIDER' })
      return true
    }
    if (!process.env[provider.envVar]) {
      json(res, 422, { ok: false, error: `provider credentials are not configured for ${providerId} -- request refused before any network call`, code: 'TSF_MISSING_PROVIDER_CREDENTIALS' })
      return true
    }
    try {
      const clock = () => new Date()
      const worker = provider.createWorker(clock)
      const result = await pollAndAdmitResearchNodeDurable(missionId, nodeId, worker, clock)
      json(res, 200, { ok: result.ok, ready: result.ready ?? false, status: readResearchMissionStatus(missionId) })
    } catch (error) {
      respondError(res, json, error)
    }
    return true
  }

  return false
}
