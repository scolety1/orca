#!/usr/bin/env node
// Spawned as a genuinely separate OS process by
// planner-mission-lease-concurrent-takeover.test.mjs -- one of TWO real
// successor processes racing to reclaim the SAME STALE (already-expired,
// previously held by a now-dead process) lease, via the real
// PlannerSessionLifecycle.acquireLeaseAndHydrate entrypoint (not just the
// bare store-level acquirePlannerLease planner-mission-lease-worker.mjs
// exercises) -- proves the end-to-end hydrate path, not only the lease
// primitive, stays single-writer under real concurrent takeover.
//
// Usage: node planner-mission-lease-concurrent-successor-worker.mjs <missionId> <plannerSessionId> <resultPath> <startMarkerPath>
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , missionId, plannerSessionId, resultPath, startMarkerPath] = process.argv

const { PlannerSessionLifecycle } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'planner-session-lifecycle.mjs')).href
)

const repoState = { branch: 'tsf/feature/f4-crash-reclaim-fixture', sha: 'c'.repeat(40) }
const fakeHealthyMemory = () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, usedPercent: 50 })

const successor = new PlannerSessionLifecycle({
  missionId,
  plannerSessionId,
  deps: { clock: () => new Date(), collectHostMemoryEvidence: fakeHealthyMemory, observeRepoState: () => repoState }
})

// Written BEFORE the acquire attempt -- proves genuine overlap between the
// two racing successor processes, not accidental serialization.
writeFileSync(startMarkerPath, String(Date.now()))

let result
try {
  const checkpoint = await successor.acquireLeaseAndHydrate()
  result = { granted: true, missionGoal: checkpoint.missionGoal, workerCount: successor.getWorkers().length }
} catch (error) {
  result = { granted: false, code: error.code }
}
writeFileSync(resultPath, JSON.stringify(result))
