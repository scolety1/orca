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
//
// Returns the real driver handle (or null if not enabled) -- purely
// additive, every existing real caller already ignores the return value.
// A caller that needs a REAL "no more work can land after this" guarantee
// (this session's own overnight-mission finding: `server.emit('close')`
// never awaits an EventEmitter listener's returned promise, so the
// `server.on('close', driver.stop)` wiring below is fire-and-forget by
// construction) should `await` this handle's own `stop()` directly
// instead of relying on emit('close') alone.
export function bootstrapKeepGoingFleetDriverIfEnabled(server) {
  if (process.env.TSF_KEEP_GOING_FLEET_DRIVER !== '1') {
    return null
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
  return driver
}
