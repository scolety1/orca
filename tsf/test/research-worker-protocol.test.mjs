import assert from 'node:assert/strict'
import test from 'node:test'
import { assertBoundedResearchWorker } from '../adapters/bounded-research-worker-protocol.mjs'
import { createDeterministicFakeResearchWorker } from '../adapters/deterministic-fake-research-worker.mjs'
import { validateBoundedResearchRequest, validateBoundedResearchResult } from '../contracts/validate-research-contracts.mjs'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import { buildBoundedResearchRequest, computeTaskFingerprint } from '../domain/research-node.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-09-10T12:00:00.000Z')

function missionWithOneNode() {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'mission:proto-test', projectId: 'fixture:proj', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: { type: 'object' } }, clock)
  return mission
}

test('assertBoundedResearchWorker rejects an object missing dispatch/fetchResult', () => {
  assert.throws(() => assertBoundedResearchWorker({}), /dispatch/)
  assert.doesNotThrow(() => assertBoundedResearchWorker(createDeterministicFakeResearchWorker({})))
})

test('computeTaskFingerprint is a stable 64-hex digest and differs per provider', () => {
  const a = computeTaskFingerprint({ nodeId: 'n', researchQuestion: 'q', requestedOutputSchema: {}, provider: 'A' })
  const b = computeTaskFingerprint({ nodeId: 'n', researchQuestion: 'q', requestedOutputSchema: {}, provider: 'B' })
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, b)
  assert.equal(a, computeTaskFingerprint({ nodeId: 'n', researchQuestion: 'q', requestedOutputSchema: {}, provider: 'A' }))
})

test('buildBoundedResearchRequest scopes researchQuestion to the node\'s targetEntity -- live-bake-off regression', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e:1', name: 'Example Entity Name' }, requestedFields: [], requestedOutputSchema: { type: 'object' } }, clock)
  const request = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE', clock)
  assert.ok(request.researchQuestion.includes('Example Entity Name'), 'a real provider has no other signal to scope from -- the node\'s target entity must appear in the question text')
  assert.notEqual(request.researchQuestion, specification.researchQuestion, 'must not send the bare mission-level question unscoped')
})

test('buildBoundedResearchRequest falls back to entityId when targetEntity has no name, and to the bare question when there is no targetEntity at all', () => {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:no-name', nodeRole: 'PRIMARY_RESEARCH', targetEntity: { entityId: 'e:only-id' }, requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = addResearchNode(mission, { id: 'node:no-entity', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  const withId = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === 'node:no-name'), 'FAKE', clock)
  assert.ok(withId.researchQuestion.includes('e:only-id'))
  const withoutEntity = buildBoundedResearchRequest(mission, mission.nodes.find((n) => n.id === 'node:no-entity'), 'FAKE', clock)
  assert.equal(withoutEntity.researchQuestion, specification.researchQuestion)
})

test('buildBoundedResearchRequest never leaks worker input into scope/toolPermissions -- always copied from the specification', () => {
  const mission = missionWithOneNode()
  const request = buildBoundedResearchRequest(mission, mission.nodes[0], 'FAKE', clock)
  assert.doesNotThrow(() => validateBoundedResearchRequest(request))
  assert.deepEqual(request.toolPermissions, mission.specification.toolPermissions)
  assert.deepEqual(request.scope, [`node:${mission.nodes[0].id}`])
})

test('fake worker: SUCCESS behavior', async () => {
  const mission = missionWithOneNode()
  const node = mission.nodes[0]
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const script = new Map([[request.taskFingerprint, { behavior: 'SUCCESS', proposedClaims: [{ fieldName: 'x', proposedValue: 1, providerConfidence: 0.9, providerReasoning: 'ok' }] }]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })
  const dispatched = await worker.dispatch(request)
  assert.equal(dispatched.ok, true)
  const fetched = await worker.fetchResult(dispatched.workerRunRef)
  assert.equal(fetched.status, 'READY')
  assert.equal(fetched.result.status, 'SUCCEEDED')
  assert.doesNotThrow(() => validateBoundedResearchResult(fetched.result))
})

test('fake worker: FAILURE behavior produces a FAILED result with failureDetails', async () => {
  const mission = missionWithOneNode()
  const node = mission.nodes[0]
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const script = new Map([[request.taskFingerprint, { behavior: 'FAILURE', failureDetails: { reason: 'PROVIDER_TIMEOUT', detail: 'simulated' } }]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })
  const { workerRunRef } = await worker.dispatch(request)
  const fetched = await worker.fetchResult(workerRunRef)
  assert.equal(fetched.result.status, 'FAILED')
  assert.equal(fetched.result.failureDetails.reason, 'PROVIDER_TIMEOUT')
})

test('fake worker: TIMEOUT_SUSPENSION never becomes READY', async () => {
  const mission = missionWithOneNode()
  const node = mission.nodes[0]
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const script = new Map([[request.taskFingerprint, { behavior: 'TIMEOUT_SUSPENSION' }]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })
  const { workerRunRef } = await worker.dispatch(request)
  for (let i = 0; i < 5; i += 1) {
    const fetched = await worker.fetchResult(workerRunRef)
    assert.equal(fetched.status, 'PENDING')
  }
})

test('fake worker: DELAYED_COMPLETION becomes READY only after the scripted poll count, deterministically', async () => {
  const mission = missionWithOneNode()
  const node = mission.nodes[0]
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const script = new Map([[request.taskFingerprint, { behavior: 'DELAYED_COMPLETION', readyAfterPolls: 3, proposedClaims: [] }]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })
  const { workerRunRef } = await worker.dispatch(request)
  const first = await worker.fetchResult(workerRunRef)
  const second = await worker.fetchResult(workerRunRef)
  const third = await worker.fetchResult(workerRunRef)
  assert.equal(first.status, 'PENDING')
  assert.equal(second.status, 'PENDING')
  assert.equal(third.status, 'READY')
})

test('fake worker: DUPLICATE_RESULT_DELIVERY returns the identical result on repeated fetch', async () => {
  const mission = missionWithOneNode()
  const node = mission.nodes[0]
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const script = new Map([[request.taskFingerprint, { behavior: 'DUPLICATE_RESULT_DELIVERY', proposedClaims: [{ fieldName: 'x', proposedValue: 1, providerConfidence: 0.9, providerReasoning: 'ok' }] }]])
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script, clock })
  const { workerRunRef } = await worker.dispatch(request)
  const first = await worker.fetchResult(workerRunRef)
  const second = await worker.fetchResult(workerRunRef)
  assert.deepEqual(first.result, second.result)
})

test('fake worker: dispatching a request with no script entry is an honest ok:false, never a fabricated success', async () => {
  const mission = missionWithOneNode()
  const node = mission.nodes[0]
  const request = buildBoundedResearchRequest(mission, node, 'FAKE', clock)
  const worker = createDeterministicFakeResearchWorker({ provider: 'FAKE', script: new Map(), clock })
  const dispatched = await worker.dispatch(request)
  assert.equal(dispatched.ok, false)
  assert.equal(dispatched.reason, 'NO_SCRIPT_FOR_FINGERPRINT')
})
