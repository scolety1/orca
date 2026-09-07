#!/usr/bin/env node
// Phase 12 (Durable State / Restart Gauntlet, category 4 -- Needs You): a
// real spawned OS process that durably dispatches one node, then raises a
// real Needs You question on the mission, writes a marker proving both are
// durable on disk, then sleeps forever until the parent SIGKILLs it --
// mirrors research-mission-crash-dispatch-worker.mjs's own shape
// (REUSE_PATTERN, same fixture/spec, no new mechanism).
//
// Usage: node research-mission-needs-you-crash-worker.mjs <missionId> <nodeId> <stateFile> <resultPath>
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , missionId, nodeId, stateFile, resultPath] = process.argv
// Set BEFORE any dynamic import below -- data-store.mjs captures
// TSF_UI_STATE_FILE into a module-level const at import time.
process.env.TSF_UI_STATE_FILE = stateFile

const here = import.meta.dirname
const driverUrl = pathToFileURL(path.join(here, '..', '..', 'server', 'research-mission-driver.mjs')).href
const storeUrl = pathToFileURL(path.join(here, '..', '..', 'server', 'research-mission-store.mjs')).href
const workerUrl = pathToFileURL(path.join(here, '..', '..', 'adapters', 'deterministic-fake-research-worker.mjs')).href
const nodeUrl = pathToFileURL(path.join(here, '..', '..', 'domain', 'research-node.mjs')).href
const missionUrl = pathToFileURL(path.join(here, '..', '..', 'domain', 'research-mission.mjs')).href
const fixtureUrl = pathToFileURL(path.join(here, 'generic-research-crash-fixture.mjs')).href

const { createResearchMissionDurable, dispatchResearchNodeDurable } = await import(driverUrl)
const { withResearchMission } = await import(storeUrl)
const { createDeterministicFakeResearchWorker } = await import(workerUrl)
const { buildBoundedResearchRequest } = await import(nodeUrl)
const { raiseResearchNeedsYou } = await import(missionUrl)
const { buildGenericCrashFixtureMissionInput, genericScriptEntry } = await import(fixtureUrl)

const clock = () => new Date('2026-09-07T12:00:00.000Z')
const QUESTION = 'Fixture ambiguity: which fixture entity did the operator mean?'

const mission = await createResearchMissionDurable(missionId, buildGenericCrashFixtureMissionInput(missionId, nodeId), clock)
const node = mission.nodes.find((n) => n.id === nodeId)
const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)

const script = new Map([[request.taskFingerprint, genericScriptEntry()]])
const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })

const dispatched = await dispatchResearchNodeDurable(missionId, nodeId, 'FAKE', worker, clock)
if (!dispatched.ok) { throw new Error(`fixture dispatch unexpectedly failed: ${JSON.stringify(dispatched)}`) }

// A real, standalone Needs You raise -- not tied to any node-status
// precondition (unlike escalateResearchNodeToNeedsYou's BLOCKED-only
// wrapper), modeling a genuine mission-level ambiguity found mid-dispatch.
const withNeedsYou = await withResearchMission(missionId, (current) =>
  raiseResearchNeedsYou(current, { question: QUESTION, nodeId, category: 'UNIVERSE_AMBIGUITY' }, clock, current.revision)
)
const needsYouEntry = withNeedsYou.needsYou.at(-1)

// Written the moment both are durable on disk -- proves to the parent this
// child genuinely got past a real dispatch AND a real Needs You raise
// before being killed, not merely spawned.
writeFileSync(resultPath, JSON.stringify({
  dispatched: true,
  needsYouRaised: true,
  needsYouId: needsYouEntry.id,
  question: needsYouEntry.question
}))

// Never resolves, never exits on its own -- see research-mission-crash-
// dispatch-worker.mjs's own identical comment on why a live timer (not a
// bare hanging await) is required to model a real still-running crash
// target on this Node version.
setInterval(() => {}, 2 ** 31 - 1)
