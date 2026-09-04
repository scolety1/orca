// Trust + Scale Hardening: durable real-provider dispatch bookkeeping.
// Proves the pre-flight attempt ledger classifies every dispatch boundary
// honestly (EXACTLY_ONCE / AT_MOST_ONCE / AT_LEAST_ONCE /
// AMBIGUOUS_REQUIRES_RECONCILIATION) rather than assuming a blind
// redispatch is always safe -- the real risk with non-idempotent, billable
// real-provider APIs (Parallel/Exa) if TSF crashes between calling the
// provider and durably recording the confirmed result.
import assert from 'node:assert/strict'
import test from 'node:test'
import { addResearchNode, createResearchMission } from '../domain/research-mission.mjs'
import {
  classifyDispatchDeliveryGuarantee,
  listUnresolvedDispatchAmbiguities,
  recordDispatchAttempt,
  resolveDispatchAttempt
} from '../domain/research-dispatch-bookkeeping.mjs'
import { markResearchNodeReady, recordResearchNodeDispatch } from '../domain/research-node.mjs'
import { buildNflQb2001Specification } from '../fixtures/nfl-2001-qb-research-fixture.mjs'

const clock = () => new Date('2026-10-05T09:00:00.000Z')
const TF_A = 'a'.repeat(64)
const TF_B = 'b'.repeat(64)

function baseMission() {
  const specification = buildNflQb2001Specification()
  let mission = createResearchMission({ id: 'm', projectId: 'p', specification, expectedUniverse: specification.expectedUniverse }, clock)
  mission = addResearchNode(mission, { id: 'node:x', nodeRole: 'PRIMARY_RESEARCH', requestedFields: [], requestedOutputSchema: {} }, clock)
  mission = markResearchNodeReady(mission, 'node:x', clock, mission.revision)
  return mission
}

const workerRunRef = (id) => ({ provider: 'FAKE', providerRunId: id, dispatchedAt: clock().toISOString() })

test('nothing ever attempted classifies as null -- there is no boundary to reconcile yet', () => {
  const mission = baseMission()
  assert.equal(classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A), null)
  assert.deepEqual(listUnresolvedDispatchAmbiguities(mission.nodes[0]), [])
})

test('CRASH scenario A2: an attempt recorded before the network call, never resolved -- classified AMBIGUOUS, not assumed safe to retry', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  // "Crash": the provider call never returns and the process dies here.
  const result = classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A)
  assert.equal(result.guarantee, 'AMBIGUOUS_REQUIRES_RECONCILIATION')
  assert.equal(result.unresolvedAttemptCount, 1)
  assert.equal(result.confirmedDispatchRecordCount, 0)
  assert.deepEqual(listUnresolvedDispatchAmbiguities(mission.nodes[0]).map((c) => c.taskFingerprint), [TF_A])
})

test('a clean, synchronous CONFIRMED resolution followed by the matching durable dispatch record -> EXACTLY_ONCE', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: TF_A, workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  const result = classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A)
  assert.equal(result.guarantee, 'EXACTLY_ONCE')
  assert.deepEqual(listUnresolvedDispatchAmbiguities(mission.nodes[0]), [])
})

// Independent-verification finding: an earlier version threw here instead
// of classifying -- the window between a real provider call resolving
// CONFIRMED and recordResearchNodeDispatch actually being called (which,
// in live-bakeoff-runner.mjs, only happens after an up-to-60s result-
// polling loop) is a REACHABLE, non-ambiguous state, not an invariant
// violation. It is unambiguously EXACTLY_ONCE: TSF already durably knows
// the provider confirmed the dispatch; dispatchRecords simply hasn't
// caught up yet.
test('a CONFIRMED-resolved attempt with no dispatchRecord written yet -> EXACTLY_ONCE, never throws', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  // "Crash": recordResearchNodeDispatch was never reached.
  const result = classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A)
  assert.equal(result.guarantee, 'EXACTLY_ONCE')
  assert.equal(result.confirmedDispatchRecordCount, 0)
})

test('a confirmed dispatchRecord with zero attempt-ledger history (a call site predating this bookkeeping) -> EXACTLY_ONCE, never null/throw', () => {
  let mission = baseMission()
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: TF_A, workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  const result = classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A)
  assert.equal(result.guarantee, 'EXACTLY_ONCE')
})

test('two independently CONFIRMED attempts for the same task -> AMBIGUOUS (a human must determine which real run is authoritative), never throws', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r2') }, clock, mission.revision)
  const result = classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A)
  assert.equal(result.guarantee, 'AMBIGUOUS_REQUIRES_RECONCILIATION')
})

test('listUnresolvedDispatchAmbiguities never lets one taskFingerprint\'s state suppress another\'s real ambiguity', () => {
  let mission = baseMission()
  // TF_A ends up cleanly EXACTLY_ONCE (not ambiguous).
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: TF_A, workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  // TF_B is a genuine, separate ambiguity.
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_B }, clock, mission.revision)
  const ambiguities = listUnresolvedDispatchAmbiguities(mission.nodes[0])
  assert.deepEqual(ambiguities.map((c) => c.taskFingerprint), [TF_B])
})

test('every attempt cleanly and synchronously rejected, no confirmed record -> AT_MOST_ONCE (the provider never durably accepted anything)', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'FAILED_CLEAN' }, clock, mission.revision)
  const result = classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A)
  assert.equal(result.guarantee, 'AT_MOST_ONCE')
})

test('a reconciled-then-retried attempt sequence -> AT_LEAST_ONCE (the provider may have seen the task more than once)', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  // Operator reconciliation determines the first attempt never reached the
  // provider (checked the provider dashboard, found nothing) and marks it
  // resolved so a retry can proceed.
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'FAILED_CLEAN' }, clock, mission.revision)
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r2') }, clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: TF_A, workerRunRef: workerRunRef('r2') }, clock, mission.revision)
  const result = classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A)
  assert.equal(result.guarantee, 'AT_LEAST_ONCE')
  assert.equal(result.confirmedDispatchRecordCount, 1)
})

test('resolveDispatchAttempt is a safe no-op when there is no UNKNOWN attempt to resolve -- never fabricates one', () => {
  const mission = baseMission()
  const result = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  assert.equal(result.revision, mission.revision, 'a true no-op must not bump revision')
  assert.equal(result.nodes[0].dispatchAttempts.length, 0)
})

test('resolveDispatchAttempt rejects an unknown outcome value', () => {
  const mission = baseMission()
  assert.throws(() => resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'MAYBE' }, clock, mission.revision), /unknown dispatch attempt outcome/)
})

test('two distinct taskFingerprints (e.g. a genuinely re-scoped request) are tracked independently, never conflated', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  mission = resolveDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A, outcome: 'CONFIRMED', workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  mission = recordResearchNodeDispatch(mission, 'node:x', { taskFingerprint: TF_A, workerRunRef: workerRunRef('r1') }, clock, mission.revision)
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_B }, clock, mission.revision)
  // TF_B's attempt "crashes" unresolved -- must not pollute TF_A's clean classification.
  assert.equal(classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_A).guarantee, 'EXACTLY_ONCE')
  assert.equal(classifyDispatchDeliveryGuarantee(mission.nodes[0], TF_B).guarantee, 'AMBIGUOUS_REQUIRES_RECONCILIATION')
  assert.deepEqual(listUnresolvedDispatchAmbiguities(mission.nodes[0]).map((c) => c.taskFingerprint), [TF_B])
})

test('recordDispatchAttempt never dedupes -- each real attempt is a genuinely distinct durable event, always bumps revision', () => {
  let mission = baseMission()
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  const afterFirst = mission.revision
  mission = recordDispatchAttempt(mission, 'node:x', { taskFingerprint: TF_A }, clock, mission.revision)
  assert.equal(mission.revision, afterFirst + 1, 'a second real attempt is a genuinely new event, not an idempotent replay')
  assert.equal(mission.nodes[0].dispatchAttempts.length, 2)
})
