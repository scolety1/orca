// Wires Stage H's autonomous driver (keep-going-fleet-driver.mjs) to the
// real project catalog -- kept as its own file so http-server.mjs's own
// startStandaloneServer stays a thin composition root, not a growing
// dumping ground for each new background subsystem's wiring.
import { projectsById } from './project-catalog.mjs'
import { startKeepGoingFleetDriver } from './keep-going-fleet-driver.mjs'

// Opt-in via TSF_KEEP_GOING_FLEET_DRIVER=1 -- see main.mjs's realSpawnFn
// for why this is never set for a test-spawned server. Discovery re-reads
// real, persisted state fresh every cycle (projectsById -> loadState), so
// a restarted process picks up exactly where the durable run state left
// off with no separate recovery step. Stops itself when `server` closes --
// callers just call this once, no separate wiring needed. No-op if not
// enabled.
export function bootstrapKeepGoingFleetDriverIfEnabled(server) {
  if (process.env.TSF_KEEP_GOING_FLEET_DRIVER !== '1') {
    return
  }
  const driver = startKeepGoingFleetDriver({
    listEligibleProjectIds: () => {
      const { opState } = projectsById()
      return Object.entries(opState.keepGoingRuns ?? {})
        .filter(([, run]) => run.state === 'ACTIVE')
        .map(([id]) => id)
    },
    onError: (error) => {
      console.error('Keep Going fleet driver cycle failed:', error)
    },
    // Test-only override (real production always uses the real default) --
    // an isolated real-time autonomy proof needs a real, but fast, cadence
    // rather than waiting on the real 30s production interval.
    ...(process.env.TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS
      ? { intervalMs: Number(process.env.TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS) }
      : {})
  })
  server.on('close', driver.stop)
}
