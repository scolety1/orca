// Wires the Native Self-Improvement Loop V1 autonomous driver
// (self-improvement-fleet-driver.mjs) into the real server -- mirrors
// keep-going-fleet-driver-bootstrap.mjs's exact shape (REUSE_PATTERN):
// opt-in via one env var, no-op otherwise, stops itself when `server`
// closes.
//
// DELIBERATE DIVERGENCE from TSF_KEEP_GOING_FLEET_DRIVER's own convention,
// documented here rather than silently copied: main.mjs's realSpawnFn sets
// TSF_KEEP_GOING_FLEET_DRIVER=1 unconditionally for every real plugin
// spawn, making that driver effectively always-on in production.
// TSF_SELF_IMPROVEMENT_LOOP_ENABLED is NEVER set anywhere in this wave's
// own committed code -- not in main.mjs, not in a test default, not here.
// The mission brief's own explicit, non-negotiable instruction: build the
// real, correct, always-on-capable loop, but leave it OFF by construction.
// An operator who deliberately wants this loop running sets the env var
// themselves outside this codebase's own control.
import { readAllFindings } from './self-improvement-finding-store.mjs'
import { startSelfImprovementFleetDriver } from './self-improvement-fleet-driver.mjs'

export function bootstrapSelfImprovementFleetDriverIfEnabled(server, { canonicalRepoPath = process.cwd() } = {}) {
  if (process.env.TSF_SELF_IMPROVEMENT_LOOP_ENABLED !== '1') {
    return
  }
  const driver = startSelfImprovementFleetDriver({
    canonicalRepoPath,
    readFindings: readAllFindings,
    onError: (error) => {
      console.error('Self-Improvement fleet driver cycle failed:', error)
    },
    // Test-only override, same convention as
    // TSF_KEEP_GOING_FLEET_DRIVER_INTERVAL_MS.
    ...(process.env.TSF_SELF_IMPROVEMENT_LOOP_INTERVAL_MS ? { intervalMs: Number(process.env.TSF_SELF_IMPROVEMENT_LOOP_INTERVAL_MS) } : {})
  })
  server.on('close', driver.stop)
}
