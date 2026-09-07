#!/usr/bin/env node
// Spawned as a genuinely separate OS process by
// planner-mission-lease-crash-reclaim.test.mjs -- simulates a real planner
// session that starts a mission, dispatches one fixture worker, then NEVER
// relinquishes: it sleeps forever until the parent test SIGKILLs it,
// simulating a genuine crash while the lease is held. Mirrors
// resource-pressure-lease-worker.mjs's own 'hold' op (REUSE_PATTERN):
// acquire, write a result marker proving real durable progress, then sleep.
//
// Usage: node planner-crash-reclaim-worker.mjs <missionId> <plannerSessionId> <ttlMs> <resultPath>
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , missionId, plannerSessionId, ttlMsArg, resultPath] = process.argv
const ttlMs = Number(ttlMsArg)

const { PlannerSessionLifecycle } = await import(
  pathToFileURL(path.join(import.meta.dirname, '..', '..', 'server', 'planner-session-lifecycle.mjs')).href
)

// Fixed, hermetic repo state shared with the parent test's own successor
// instance -- this fixture never depends on real git state.
const repoState = { branch: 'tsf/feature/f4-crash-reclaim-fixture', sha: 'c'.repeat(40) }
// Forced HEALTHY -- resource-pressure-collector.mjs's own test-override
// convention -- so this fixture's admission check never depends on real
// host memory (which this suite has observed run CRITICAL under load).
const fakeHealthyMemory = () => ({ totalBytes: 16 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, availableBytes: 8 * 1024 ** 3, usedPercent: 50 })

const lifecycle = new PlannerSessionLifecycle({
  missionId,
  plannerSessionId,
  deps: {
    clock: () => new Date(),
    collectHostMemoryEvidence: fakeHealthyMemory,
    leaseTtlMs: ttlMs,
    dispatchWorker: async ({ taskId }) => ({ workerId: `worker-${taskId}`, providerId: 'fixture-provider' })
  }
})

await lifecycle.startMission({ missionGoal: 'crash-reclaim fixture mission', phase: 'BUILD', repoState })
const dispatch = await lifecycle.dispatchWorkerForTask({ taskId: 'crash-reclaim-task-1', kind: 'FIXTURE_WORKER' })

// Written the moment real state is durable on disk -- proves to the parent
// this child genuinely got past acquire+dispatch before being killed, not
// merely spawned.
writeFileSync(resultPath, JSON.stringify({ held: true, workerId: dispatch.worker.workerId }))

// Never relinquishes, never exits on its own.
await new Promise(() => {})
