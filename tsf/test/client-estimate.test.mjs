import assert from 'node:assert/strict'
import test from 'node:test'
import { buildClientEstimate } from '../domain/client-estimate.mjs'

const CLOCK = () => new Date('2026-03-01T00:00:00.000Z')

function fakeInternalEstimate(overrides = {}) {
  return {
    projectId: 'proj-1',
    preliminary: false,
    startDate: '2026-01-05T00:00:00.000Z',
    calendarOptions: {},
    wbs: [
      { title: 'Discovery', assumptions: ['assumption A'] },
      { title: 'Implementation', assumptions: ['assumption B', 'assumption A'] }
    ],
    plan: {
      schedule: [
        { title: 'Discovery', endDate: '2026-01-06T00:00:00.000Z' },
        { title: 'Implementation', endDate: '2026-01-10T00:00:00.000Z' }
      ],
      estimate: { wallClockHours: { p50: 40, p80: 60 } }
    },
    // Internal-only fields that must never leak into the client view.
    providerForecast: { codex: { currentAction: 'PROCEED' } },
    costForecast: { codex: { costUsd: null } },
    calibration: { calibrated: false },
    competingCommitments: {
      otherActiveRuns: [{ projectId: 'other', goal: 'secret internal goal' }]
    },
    ...overrides
  }
}

test('never includes any internal-only field, by construction', () => {
  const client = buildClientEstimate(fakeInternalEstimate(), { clock: CLOCK })
  for (const internalField of [
    'providerForecast',
    'costForecast',
    'calibration',
    'competingCommitments'
  ]) {
    assert.equal(internalField in client, false)
  }
})

test('scope and assumptions are pulled from the real WBS, de-duplicated', () => {
  const client = buildClientEstimate(fakeInternalEstimate(), { clock: CLOCK })
  assert.deepEqual(client.scope, ['Discovery', 'Implementation'])
  assert.deepEqual(client.assumptions.sort(), ['assumption A', 'assumption B'])
})

test('milestones come from the real schedule', () => {
  const client = buildClientEstimate(fakeInternalEstimate(), { clock: CLOCK })
  assert.deepEqual(client.milestones, [
    { title: 'Discovery', targetDate: '2026-01-06T00:00:00.000Z' },
    { title: 'Implementation', targetDate: '2026-01-10T00:00:00.000Z' }
  ])
})

test('REQUIRED PROOF: pricing is honestly absent (not a fabricated default) when no pricing policy is supplied', () => {
  const client = buildClientEstimate(fakeInternalEstimate(), { clock: CLOCK })
  assert.deepEqual(client.pricing, { configured: false, reason: 'NO_PRICING_POLICY_CONFIGURED' })
  assert.equal(client.revisionAllowance, null)
  assert.equal(client.contingency, null)
})

test('a real, explicit pricing policy is reflected when Tim supplies one', () => {
  const client = buildClientEstimate(fakeInternalEstimate(), {
    clock: CLOCK,
    pricingPolicy: () => ({ model: 'FIXED_PRICE', amountUsd: 5000 })
  })
  assert.deepEqual(client.pricing, { configured: true, model: 'FIXED_PRICE', amountUsd: 5000 })
})

test('delivery range uses wall-clock P50/P80 (the client-delivery clock), producing two genuinely different dates', () => {
  const client = buildClientEstimate(fakeInternalEstimate(), { clock: CLOCK })
  assert.notEqual(
    client.deliveryRange.recommendedDeliveryDate.getTime(),
    client.deliveryRange.committedDeliveryDate.getTime()
  )
  assert.ok(
    client.deliveryRange.committedDeliveryDate.getTime() >
      client.deliveryRange.recommendedDeliveryDate.getTime()
  )
})

test('validUntil is real validityDays out from generation time, not a fixed guess', () => {
  const client = buildClientEstimate(fakeInternalEstimate(), { clock: CLOCK, validityDays: 10 })
  assert.equal(client.generatedAt, '2026-03-01T00:00:00.000Z')
  assert.equal(client.validUntil, '2026-03-11T00:00:00.000Z')
})
