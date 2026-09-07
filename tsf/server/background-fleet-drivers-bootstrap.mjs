// One composition root for every opt-in background fleet driver's own
// bootstrapXIfEnabled(server) call -- kept separate so http-server.mjs
// (already at its own line budget) gains exactly one call site as new
// drivers are added, instead of a growing list of individual imports/calls
// there. Each bootstrap function still fully owns its own env-var gate and
// no-op-when-disabled default; this file adds no gating logic of its own.
import { bootstrapKeepGoingFleetDriverIfEnabled } from './keep-going-fleet-driver-bootstrap.mjs'
import { bootstrapSelfImprovementFleetDriverIfEnabled } from './self-improvement-fleet-driver-bootstrap.mjs'

export function bootstrapBackgroundFleetDrivers(server) {
  bootstrapKeepGoingFleetDriverIfEnabled(server)
  bootstrapSelfImprovementFleetDriverIfEnabled(server)
}
