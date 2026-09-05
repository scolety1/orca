// ResearchMission Autonomy Driver V0 -- the required zero-relay acceptance
// test. ONE ResearchMission, created once; Tim (a human) sends zero further
// messages; the fleet driver (server/research-mission-fleet-driver.mjs)
// autonomously ticks it end to end using the real, durable primitives
// (research-mission-driver.mjs, domain/research-autonomy-policy.mjs)
// through: gap analysis -> bounded worker dispatch -> a worker returning
// deliberately bad evidence -> independent verification catching it ->
// automatic correction/redispatch to an independent provider -> corrected
// evidence passing -> reconciliation -> mission completion -- then a
// simulated backend restart (a fresh driver control object, same durable
// state on disk) resumes and confirms no duplicate dispatch. A separate
// dedicated case proves an unauthorized paid dispatch is never silently
// attempted. Uses the same deterministic, $0, zero-network fake worker
// research-e2e-normal-mission.test.mjs already relies on -- no live
// research, no real provider call, no cost.
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { addResearchNode, createResearchMission, findResearchNode } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest } from '../domain/research-node.mjs'

const HERE = import.meta.dirname
const STATE_FILE = path.join(HERE, '..', 'server', '.local-state', `operator-state.test-research-autonomy-zero-relay-${process.pid}.json`)
process.env.TSF_UI_STATE_FILE = STATE_FILE

const { readResearchMission, withResearchMission } = await import('../server/research-mission-store.mjs')
const { advanceOneMission, driveOneCycle, startResearchMissionFleetDriver } = await import(
  '../server/research-mission-fleet-driver.mjs'
)

function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.research.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const clock = () => new Date('2026-09-05T06:00:00.000Z')

function specification(id) {
  return {
    schemaVersion: 'TSF_RESEARCH_SPECIFICATION_V1',
    id: `spec:${id}`,
    researchQuestion: 'What is the fixture value for each entity?',
    entityType: 'FIXTURE_ENTITY',
    requestedFields: [{ fieldName: 'value', valueType: 'number', required: true, derivationRule: null }],
    sourcePolicy: {
      preferredSources: ['fixture.invalid'],
      disallowedSources: [],
      licensingConstraints: [],
      freshnessPolicy: 'HISTORICAL_STATIC',
      requireIndependentSources: false,
      minSourceCount: 1
    },
    temporalRequirements: { asOfDate: '2026-09-05', periodScope: 'FIXTURE_SCOPE' },
    budget: { maxCostUsd: null, maxLatencyMs: 60000, maxToolCallsPerNode: 5 },
    toolPermissions: ['fake-research-worker'],
    expectedUniverse: { schemaVersion: 'TSF_EXPECTED_UNIVERSE_V1', entityType: 'FIXTURE_ENTITY', expectedCount: 2, expectedEntities: [] }
  }
}

function fieldsSchema() {
  return { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }
}

function buildMission(missionId) {
  const spec = specification(missionId)
  let mission = createResearchMission({ id: missionId, projectId: 'fixture:zero-relay', specification: spec, expectedUniverse: spec.expectedUniverse }, clock)
  mission = addResearchNode(
    mission,
    { id: 'node:alpha', nodeRole: 'PRIMARY_RESEARCH', requestedFields: spec.requestedFields, requestedOutputSchema: fieldsSchema() },
    clock
  )
  mission = addResearchNode(
    mission,
    { id: 'node:beta', nodeRole: 'PRIMARY_RESEARCH', requestedFields: spec.requestedFields, requestedOutputSchema: fieldsSchema() },
    clock
  )
  return mission
}

function goodResult(fieldValue, sourceRef) {
  return {
    behavior: 'SUCCESS',
    observations: [{ rawContent: `Fixture reading: ${fieldValue}.`, extractedAt: '2026-09-05T00:00:00.000Z', providerConfidence: 0.95, providerReasoning: 'Primary fixture source.' }],
    proposedClaims: [{ fieldName: 'value', proposedValue: fieldValue, temporalScope: 'FIXTURE_SCOPE', providerConfidence: 0.95, providerReasoning: 'Primary fixture source.' }],
    evidence: [{ claimFieldName: 'value', sourceRef, snippet: `value is ${fieldValue}`, supportsClaim: true }],
    sourceReferences: [{ sourceRef, url: `https://example.invalid/${sourceRef}`, publisher: sourceRef, retrievedAt: '2026-09-05T00:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [{ sourceRef, contentHash: `sha256:${sourceRef}`, rawContentRef: `fixture://${sourceRef}` }],
    newGapProposals: [],
    warnings: [],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 100, providerReportedCostUsd: 0 }
  }
}

// Deliberately bad evidence: a real, structurally valid SUCCESS result --
// a claim IS proposed -- but its only "supporting" evidence actually
// CONTRADICTS it (supportsClaim: false), exactly the "worker returns
// deliberately bad evidence" scenario the acceptance test requires.
// verifyResearchClaim's own real assertion (hasContradictingEvidence must
// be false) fails this honestly with verdict FAIL, REJECTING the claim --
// never a dispatch-level FAILURE. (Zero evidence entirely produces
// INCONCLUSIVE, not FAIL -- research-verification.mjs's own documented
// behavior -- which deliberately leaves the claim UNVERIFIED rather than
// REJECTED, so it would still count as "live" against detectResearchConflicts
// and wrongly conflict with the corrected retry's claim. A real
// contradicted claim is both a more realistic bad-evidence case and the
// one that correctly clears out of the way for the correction retry.)
function badEvidenceResult(fieldValue) {
  return {
    behavior: 'SUCCESS',
    observations: [],
    proposedClaims: [{ fieldName: 'value', proposedValue: fieldValue, temporalScope: 'FIXTURE_SCOPE', providerConfidence: 0.4, providerReasoning: 'Low-confidence guess, contradicted by its own cited source.' }],
    evidence: [{ claimFieldName: 'value', sourceRef: 'fixture:bad-source', snippet: 'This source actually contradicts the proposed value.', supportsClaim: false }],
    sourceReferences: [{ sourceRef: 'fixture:bad-source', url: 'https://example.invalid/fixture/bad-source', publisher: 'fixture:bad-source', retrievedAt: '2026-09-05T00:00:00.000Z' }],
    sourceSnapshotsOrSnapshotRefs: [],
    newGapProposals: [],
    warnings: ['cited source does not actually support the proposed value'],
    unresolvedQuestions: [],
    usage: { requestCount: 1, tokensOrUnits: 50, providerReportedCostUsd: 0 }
  }
}

test('ZERO-RELAY GOLDEN PATH: gap analysis -> dispatch -> bad evidence caught by verification -> automatic correction to an independent provider -> reconciliation -> completion -> restart resumes without duplicate dispatch, with zero messages from Tim after mission creation', async () => {
  const missionId = 'mission:zero-relay-fixture'
  const mission = buildMission(missionId)
  await withResearchMission(missionId, () => mission)

  const alphaNode = findResearchNode(mission, 'node:alpha')
  const betaNode = findResearchNode(mission, 'node:beta')
  const alphaRequest = buildBoundedResearchRequest(mission, alphaNode, 'PRIMARY', clock)
  const betaRequestPrimary = buildBoundedResearchRequest(mission, betaNode, 'PRIMARY', clock)
  const betaRequestSecondary = buildBoundedResearchRequest(mission, betaNode, 'SECONDARY', clock)

  const script = new Map()
  script.set(alphaRequest.taskFingerprint, goodResult(42, 'fixture:alpha:primary'))
  // Worker 1 (alpha's PRIMARY) succeeds cleanly first try.
  // Worker 2 (beta's PRIMARY) returns bad evidence -- this is the
  // deliberately-bad-evidence case.
  script.set(betaRequestPrimary.taskFingerprint, badEvidenceResult(999))
  // The automatic correction retry uses a DIFFERENT provider (SECONDARY) --
  // see research-mission-fleet-driver.mjs's own comment on why a same-
  // provider retry would be classified alreadyDispatched and never
  // actually re-ask. This is the corrected, good evidence.
  script.set(betaRequestSecondary.taskFingerprint, goodResult(7, 'fixture:beta:secondary'))

  const worker = createDeterministicFakeResearchWorker({ provider: 'PRIMARY', script, clock })
  const deps = {
    worker,
    providerId: 'PRIMARY',
    retryProviderId: 'SECONDARY',
    collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) // HEALTHY -- resource gate must not interfere
  }

  // Tim sends zero further messages from here on -- every subsequent call
  // is the autonomous driver ticking on its own, exactly like
  // startResearchMissionFleetDriver's real setInterval would.
  const actionsSeen = []
  for (let i = 0; i < 20; i += 1) {
    const result = await advanceOneMission(missionId, clock, deps) // eslint-disable-line no-await-in-loop
    actionsSeen.push(result.action)
    if (result.action === 'COMPLETED') {
      break
    }
  }

  const dispatchCount = actionsSeen.filter((a) => a === 'DISPATCHED').length
  assert.equal(dispatchCount, 3, `expected exactly 3 real dispatches (alpha x1, beta x2 incl. the correction retry), saw: ${actionsSeen.join(', ')}`)
  assert.ok(actionsSeen.includes('VERIFIED_AND_RECONCILED'), `expected verification/reconciliation to run, saw: ${actionsSeen.join(', ')}`)
  assert.equal(actionsSeen.at(-1), 'COMPLETED', `mission must reach COMPLETED with zero human relay, saw full sequence: ${actionsSeen.join(', ')}`)

  const completed = readResearchMission(missionId)
  assert.equal(completed.state, 'COMPLETE')

  const alphaFinal = findResearchNode(completed, 'node:alpha')
  const betaFinal = findResearchNode(completed, 'node:beta')
  assert.equal(alphaFinal.canonicalFacts.find((f) => f.fieldName === 'value')?.value, 42)
  // PROOF the bad evidence never became canonical, and the CORRECTED value
  // (from the independent SECONDARY provider) is what actually won.
  assert.equal(betaFinal.canonicalFacts.find((f) => f.fieldName === 'value')?.value, 7)
  assert.equal(
    betaFinal.claims.some((c) => c.proposedValue === 999 && c.status === 'REJECTED'),
    true,
    'the bad-evidence claim must be durably recorded as REJECTED, never silently discarded'
  )
  assert.equal(betaFinal.retryCount, 1, 'exactly one automatic correction retry was needed and recorded')

  // PROOF this happened with zero further durable dispatch/spend beyond
  // the two real attempts scripted (one bad, one corrected) -- no
  // duplicate-dispatch drift from ticking 20 times.
  assert.equal(betaFinal.dispatchRecords.length, 2, 'exactly the primary attempt and the one correction retry, never more')
  assert.equal(alphaFinal.dispatchRecords.length, 1)

  // RESTART: a fresh driver control object (mirrring a real TSF backend
  // process restart -- server/research-mission-fleet-driver.mjs holds no
  // in-memory state itself; advanceOneMission always reads fresh from the
  // durable store) must resume cleanly and never re-dispatch anything now
  // that the mission is COMPLETE.
  const controller = startResearchMissionFleetDriver({
    listEligibleMissionIds: () => [missionId],
    clock,
    ...deps
  })
  try {
    const afterRestart = await new Promise((resolve) => {
      controller.fireNow().then(() => resolve())
    })
    void afterRestart
  } finally {
    controller.stop()
  }
  const afterRestartMission = readResearchMission(missionId)
  const betaAfterRestart = findResearchNode(afterRestartMission, 'node:beta')
  assert.equal(afterRestartMission.state, 'COMPLETE', 'restart-resume must never regress a completed mission')
  assert.equal(betaAfterRestart.dispatchRecords.length, 2, 'a post-completion restart tick must never duplicate a dispatch')
})

test('PAID PROVIDER AUTHORITY: an unauthorized paid dispatch is never silently attempted -- the mission stays exactly as it was', async () => {
  const missionId = 'mission:zero-relay-paid-unauthorized'
  const mission = buildMission(missionId)
  await withResearchMission(missionId, () => mission)

  const alphaNode = findResearchNode(mission, 'node:alpha')
  const request = buildBoundedResearchRequest(mission, alphaNode, 'PAID_PROVIDER', clock)
  const script = new Map([[request.taskFingerprint, goodResult(42, 'fixture:paid')]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'PAID_PROVIDER', script, clock })

  const result = await advanceOneMission(missionId, clock, {
    worker,
    providerId: 'PAID_PROVIDER',
    requiresPaidApproval: true, // no approval has been granted -- must refuse
    collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 })
  })

  assert.equal(result.action, 'DISPATCHED')
  assert.equal(result.dispatchResult.ok, false)
  assert.equal(result.dispatchResult.reason, 'NO_PAID_APPROVAL')
  const untouched = findResearchNode(readResearchMission(missionId), 'node:alpha')
  assert.equal(untouched.status, 'PENDING', 'no dispatch record, no status change -- refused before ever touching the worker')
  assert.equal(untouched.dispatchRecords.length, 0)

  // PROOF free work still proceeds even with no paid authority -- "lack of
  // paid authority is not a reason to stop free independent work." A
  // second, unrelated free-path-eligible mission ticks normally in the
  // same process.
  const freeMissionId = 'mission:zero-relay-free-alongside-unauthorized-paid'
  const freeMission = buildMission(freeMissionId)
  await withResearchMission(freeMissionId, () => freeMission)
  const freeResult = await advanceOneMission(freeMissionId, clock, { collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) })
  assert.equal(freeResult.action, 'SKIPPED_NO_PROVIDER_CONFIGURED')
  assert.ok(freeResult.freeProgress, 'free-path progress was still genuinely attempted')
})

test('driveOneCycle: a bounded worker-pool pass advances several independent missions at once, one mission erroring never blocking the others', async () => {
  const goodId = 'mission:zero-relay-cycle-good'
  const good = buildMission(goodId)
  await withResearchMission(goodId, () => good)
  const alphaNode = findResearchNode(good, 'node:alpha')
  const req = buildBoundedResearchRequest(good, alphaNode, 'PRIMARY', clock)
  const script = new Map([[req.taskFingerprint, goodResult(1, 'fixture:cycle')]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'PRIMARY', script, clock })
  const deps = { worker, providerId: 'PRIMARY', collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }) }

  const results = await driveOneCycle([goodId, 'mission:zero-relay-cycle-unknown'], clock, deps, 2)
  assert.equal(results.length, 2)
  const goodResultEntry = results.find((r) => r.missionId === goodId)
  const unknownResultEntry = results.find((r) => r.missionId === 'mission:zero-relay-cycle-unknown')
  assert.equal(goodResultEntry.action, 'DISPATCHED')
  assert.equal(unknownResultEntry.action, 'SKIPPED')
  assert.equal(unknownResultEntry.reason, 'unknown mission')
})

test('RESOURCE PRESSURE ADMISSION: CRITICAL host memory refuses new dispatch before ever touching the worker -- WAITING_FOR_RESOURCES, not FAILED', async () => {
  const missionId = 'mission:zero-relay-resource-pressure'
  const mission = buildMission(missionId)
  await withResearchMission(missionId, () => mission)

  let workerCalled = false
  const worker = {
    dispatch: async () => {
      workerCalled = true
      return { ok: true, workerRunRef: { providerRunId: 'should-never-happen' } }
    },
    fetchResult: async () => ({ ok: false })
  }

  const result = await advanceOneMission(missionId, clock, {
    worker,
    providerId: 'PRIMARY',
    collectHostMemoryEvidence: () => ({ availableBytes: 1 * 1024 ** 3 }) // 1 GB free -> EMERGENCY (well under CRITICAL floor too)
  })

  assert.equal(result.action, 'WAITING_FOR_RESOURCES')
  assert.equal(workerCalled, false, 'the worker must never be touched under refused admission')
  const untouched = findResearchNode(readResearchMission(missionId), 'node:alpha')
  assert.equal(untouched.status, 'PENDING', 'the node is honestly left exactly as it was -- untouched, ready to try again once resources clear')
})
