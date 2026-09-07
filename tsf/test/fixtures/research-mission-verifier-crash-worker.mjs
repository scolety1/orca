#!/usr/bin/env node
// Phase 12 (Durable State / Restart Gauntlet, category 7 -- Verifier
// result). A real spawned OS process that durably dispatches one node,
// admits its result, and canonicalizes a verified claim (the real
// "verifier result": decideReconciliation + admitReconciliationDecision,
// mirroring verifyAndReconcileResearchNodeFieldDurable's own real sequence)
// -- then sleeps forever until the parent SIGKILLs it. Mirrors
// research-mission-crash-dispatch-worker.mjs's own shape (REUSE_PATTERN).
//
// Usage: node research-mission-verifier-crash-worker.mjs <missionId> <nodeId> <stateFile> <resultPath>
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , missionId, nodeId, stateFile, resultPath] = process.argv
process.env.TSF_UI_STATE_FILE = stateFile

const here = import.meta.dirname
const driverUrl = pathToFileURL(path.join(here, '..', '..', 'server', 'research-mission-driver.mjs')).href
const workerUrl = pathToFileURL(path.join(here, '..', '..', 'adapters', 'deterministic-fake-research-worker.mjs')).href
const nodeUrl = pathToFileURL(path.join(here, '..', '..', 'domain', 'research-node.mjs')).href
const fixtureUrl = pathToFileURL(path.join(here, 'generic-research-crash-fixture.mjs')).href

const { createResearchMissionDurable, dispatchResearchNodeDurable, pollAndAdmitResearchNodeDurable, verifyAndReconcileResearchNodeFieldDurable } =
  await import(driverUrl)
const { createDeterministicFakeResearchWorker } = await import(workerUrl)
const { buildBoundedResearchRequest } = await import(nodeUrl)
const { buildGenericCrashFixtureMissionInput, genericScriptEntry, FIELD_NAME } = await import(fixtureUrl)

const clock = () => new Date('2026-09-07T12:00:00.000Z')

const mission = await createResearchMissionDurable(missionId, buildGenericCrashFixtureMissionInput(missionId, nodeId), clock)
const node = mission.nodes.find((n) => n.id === nodeId)
const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)

const script = new Map([[request.taskFingerprint, genericScriptEntry()]])
const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })

const dispatched = await dispatchResearchNodeDurable(missionId, nodeId, 'FAKE', worker, clock)
if (!dispatched.ok) { throw new Error(`fixture dispatch unexpectedly failed: ${JSON.stringify(dispatched)}`) }

const admitted = await pollAndAdmitResearchNodeDurable(missionId, nodeId, worker, clock)
if (!admitted.ok || !admitted.ready) { throw new Error(`fixture admit unexpectedly failed: ${JSON.stringify(admitted)}`) }

// The real verifier result -- decideReconciliation + admitReconciliationDecision,
// durably canonicalizing the single verified claim.
const verified = await verifyAndReconcileResearchNodeFieldDurable(missionId, nodeId, FIELD_NAME, 'FIXTURE_VERIFIER', clock)
if (!verified.ok || !verified.canonicalized) { throw new Error(`fixture verify unexpectedly failed: ${JSON.stringify(verified)}`) }
const canonicalFact = verified.mission.nodes.find((n) => n.id === nodeId).canonicalFacts.at(-1)

// Written the moment the verifier result is durable on disk -- proves to
// the parent this child genuinely got past real dispatch, admit, AND
// canonicalization before being killed, not merely spawned.
writeFileSync(resultPath, JSON.stringify({
  verified: true,
  canonicalFactId: canonicalFact.id,
  value: canonicalFact.value
}))

// Never resolves on its own -- see research-mission-crash-dispatch-worker.mjs's
// own identical comment on why a live timer is required on this Node version.
setInterval(() => {}, 2 ** 31 - 1)
