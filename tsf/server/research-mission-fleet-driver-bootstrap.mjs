// Hands-on pilot round 3 -- Research Autonomy Bootstrap: wires Job 2's
// research-mission-fleet-driver.mjs to the real durable state, mirroring
// keep-going-fleet-driver-bootstrap.mjs exactly. Before this fix, the pilot
// required manually launching the driver as a genuinely separate companion
// process -- normal TSF server startup owned Keep Going's own autonomous
// heartbeat but never Research's, a real production integration blocker.
// Kept as its own file for the same reason keep-going-fleet-driver-
// bootstrap.mjs is: http-server.mjs's own startStandaloneServer stays a
// thin composition root, not a growing dumping ground for each new
// background subsystem's wiring.
import { loadState } from './data-store.mjs'
import { startResearchMissionFleetDriver } from './research-mission-fleet-driver.mjs'
import { createWebTableResearchWorker } from '../adapters/web-table-research-worker.mjs'

// Opt-in via TSF_RESEARCH_MISSION_FLEET_DRIVER=1 -- same convention as
// TSF_KEEP_GOING_FLEET_DRIVER (main.mjs's realSpawnFn sets both for the
// one real production spawn path; never set for a test-spawned server,
// same reasoning as that flag's own comment: a periodic background driver
// that can dispatch real work is exactly the kind of thing an isolated
// test's ephemeral state file must never accidentally trigger).
// Discovery re-reads real, persisted state fresh every cycle
// (loadState().researchMissions), so a restarted process resumes exactly
// where the durable mission state left off -- no separate recovery step,
// identical resume story to Keep Going's own bootstrap and to the
// research-mission-store.mjs primitives underneath it (already proven
// crash-safe across real, separate OS processes by this session's own
// adversarial lease/mission tests). Two independent server processes
// somehow both bootstrapping this against the SAME state file could not
// double-dispatch either: dispatchResearchNodeDurable's own
// classifyDispatchDeliveryGuarantee check (research-dispatch-bookkeeping.mjs)
// is the real, already-tested cross-process safeguard -- this bootstrap
// adds no new one because none is needed.
export function bootstrapResearchMissionFleetDriverIfEnabled(server) {
  if (process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER !== '1') {
    return
  }
  const driver = startResearchMissionFleetDriver({
    listEligibleMissionIds: () => {
      const state = loadState()
      return Object.entries(state.researchMissions ?? {})
        .filter(([, mission]) => mission.state === 'ACTIVE')
        .map(([id]) => id)
    },
    onError: (error) => {
      console.error('Research mission fleet driver cycle failed:', error)
    },
    // Real operational visibility for "record typed missingness/blocker
    // honestly": a dispatch that returns {ok:false} (the real, per-URL
    // reason/detail from the free-public worker) is otherwise invisible
    // once resolved -- dispatchAttempts durably records only outcome/
    // timestamps, not why. Logged, never stored as new durable state.
    onCycle: (results) => {
      for (const result of results) {
        if (result?.action === 'DISPATCHED' && result.dispatchResult?.ok === false) {
          console.log(`Research node dispatch (${result.missionId}/${result.nodeId}) found no real match: ${result.dispatchResult.reason} -- ${result.dispatchResult.detail}`)
        }
      }
    },
    // REAL FREE-PATH RESEARCH EXECUTION V1: a genuinely $0, free-public
    // worker (never Exa/Parallel) -- deps.requiresPaidApproval stays unset
    // (falsy), so dispatch always uses the ungated dispatchResearchNodeDurable
    // path, correct for a worker that structurally cannot spend anything.
    // Real paid dispatch remains exclusively behind the separate,
    // deliberately-gated TSF_RESEARCH_LIVE_DISPATCH_ENABLED HTTP route
    // (research-http-routes.mjs), untouched by this.
    worker: createWebTableResearchWorker(),
    // Test-only override (real production always uses the real default) --
    // same convention as TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS.
    ...(process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS
      ? { intervalMs: Number(process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS) }
      : {})
  })
  server.on('close', driver.stop)
}
