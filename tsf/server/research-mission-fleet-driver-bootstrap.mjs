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
    // Test-only override (real production always uses the real default) --
    // same convention as TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS.
    ...(process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS
      ? { intervalMs: Number(process.env.TSF_RESEARCH_MISSION_FLEET_DRIVER_INTERVAL_MS) }
      : {})
  })
  server.on('close', driver.stop)
}
