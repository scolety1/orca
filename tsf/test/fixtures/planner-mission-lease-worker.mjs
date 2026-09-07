#!/usr/bin/env node
// Spawned as a genuinely separate OS process by
// planner-mission-lease-cross-process.test.mjs -- simulates one real
// planner session (its own process, inheriting TSF_UI_STATE_FILE) trying to
// acquire or relinquish the mission lease, or racing another such process.
// Mirrors resource-pressure-lease-worker.mjs's own proven pattern.
//
// Usage: node planner-mission-lease-worker.mjs <op> <missionId> <plannerSessionId> <resultPath> [startMarkerPath]
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , op, missionId, plannerSessionId, resultPath, startMarkerPath] = process.argv

const { acquirePlannerLease, relinquishPlannerLease } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'planner-mission-store.mjs')).href
)

const clock = () => new Date()
let result
if (op === 'acquire') {
  if (startMarkerPath) {
    // Written BEFORE the acquire attempt -- proves genuine overlap between
    // two racing processes, not accidental serialization.
    writeFileSync(startMarkerPath, String(Date.now()))
  }
  result = await acquirePlannerLease(missionId, plannerSessionId, clock)
} else if (op === 'relinquish') {
  result = await relinquishPlannerLease(missionId, plannerSessionId, clock)
} else {
  throw new Error(`unknown op: ${op}`)
}

writeFileSync(resultPath, JSON.stringify(result))
