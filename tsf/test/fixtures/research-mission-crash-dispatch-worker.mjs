#!/usr/bin/env node
// Finding F6: spawned as a genuinely separate OS process by
// research-mission-process-crash-survival.test.mjs -- simulates a real
// ResearchMission execution process that creates a mission, dispatches one
// node through the real durable dispatch path, writes a marker proving that
// dispatch is durably recorded, then NEVER polls/admits/relinquishes: it
// sleeps forever until the parent test SIGKILLs it, simulating a genuine
// crash mid-mission. Mirrors planner-crash-reclaim-worker.mjs's own shape
// (REUSE_PATTERN): acquire/dispatch, write a result marker, then sleep.
//
// Usage: node research-mission-crash-dispatch-worker.mjs <missionId> <nodeId> <stateFile> <resultPath>
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , missionId, nodeId, stateFile, resultPath] = process.argv
// Set BEFORE any dynamic import below -- data-store.mjs captures
// TSF_UI_STATE_FILE into a module-level const at import time.
process.env.TSF_UI_STATE_FILE = stateFile

const here = import.meta.dirname
const driverUrl = pathToFileURL(path.join(here, '..', '..', 'server', 'research-mission-driver.mjs')).href
const workerUrl = pathToFileURL(path.join(here, '..', '..', 'adapters', 'deterministic-fake-research-worker.mjs')).href
const nodeUrl = pathToFileURL(path.join(here, '..', '..', 'domain', 'research-node.mjs')).href
const fixtureUrl = pathToFileURL(path.join(here, 'generic-research-crash-fixture.mjs')).href

const { createResearchMissionDurable, dispatchResearchNodeDurable } = await import(driverUrl)
const { createDeterministicFakeResearchWorker } = await import(workerUrl)
const { buildBoundedResearchRequest } = await import(nodeUrl)
const { buildGenericCrashFixtureMissionInput, genericScriptEntry } = await import(fixtureUrl)

const clock = () => new Date('2026-09-07T12:00:00.000Z')

const mission = await createResearchMissionDurable(missionId, buildGenericCrashFixtureMissionInput(missionId, nodeId), clock)
const node = mission.nodes.find((n) => n.id === nodeId)
const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)

const script = new Map([[request.taskFingerprint, genericScriptEntry()]])
const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })

const dispatched = await dispatchResearchNodeDurable(missionId, nodeId, 'FAKE', worker, clock)
if (!dispatched.ok) { throw new Error(`fixture dispatch unexpectedly failed: ${JSON.stringify(dispatched)}`) }

// Written the moment the dispatch is durable on disk -- proves to the
// parent this child genuinely got past a real dispatch before being
// killed, not merely spawned.
writeFileSync(resultPath, JSON.stringify({
  dispatched: true,
  taskFingerprint: request.taskFingerprint,
  workerRunRef: dispatched.workerRunRef
}))

// Never polls, never admits, never exits on its own -- a real crash never
// gets to run its own cleanup either. A bare `await new Promise(() => {})`
// is NOT enough on this Node version: with nothing else scheduled, Node's
// own "unsettled top-level await" idle-detector force-exits the process
// (code 13) almost immediately, which would make the parent's later
// SIGKILL a no-op against an already-dead process -- silently defeating
// the whole "kill a genuinely still-running process" premise of this test.
// A real, live timer handle keeps the event loop (and the process) alive
// for real, exactly like a real hung/crashed process would stay resident
// until something actually kills it.
setInterval(() => {}, 2 ** 31 - 1)
