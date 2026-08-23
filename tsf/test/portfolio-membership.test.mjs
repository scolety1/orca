// Bulk Active Fleet / Work Set membership planning (Operator UX pass,
// project multi-select). Pure domain tests -- no HTTP, no state file; see
// test/http-portfolio-membership.test.mjs for the real end-to-end route.
import assert from 'node:assert/strict'
import test from 'node:test'
import { planBulkMembershipChange } from '../domain/portfolio-membership.mjs'
import { createPortfolio, registerProject, setActiveFleet } from '../domain/portfolio.mjs'

const clock = () => new Date('2026-08-23T00:00:00.000Z')

function portfolioWith(ids) {
  let portfolio = createPortfolio(clock)
  for (const id of ids) {
    portfolio = registerProject(
      portfolio,
      { id, displayName: id, root: `C:/${id}`, sourceClass: 'REAL' },
      clock
    )
  }
  return portfolio
}

test('adding an eligible (SAFE_TO_ONBOARD_NOW) project to Active Fleet is applied, not skipped', () => {
  const portfolio = portfolioWith(['alpha'])
  const { nextIds, applied, skipped } = planBulkMembershipChange({
    portfolio,
    classificationsById: { alpha: 'SAFE_TO_ONBOARD_NOW' },
    projectIds: ['alpha'],
    field: 'activeFleet',
    add: true
  })
  assert.deepEqual(applied, ['alpha'])
  assert.deepEqual(skipped, [])
  assert.deepEqual(nextIds, ['alpha'])
})

test('adding a SENSITIVE project to Active Fleet is skipped with a real, explained reason -- never blocks the batch', () => {
  const portfolio = portfolioWith(['alpha', 'beta'])
  const { nextIds, applied, skipped } = planBulkMembershipChange({
    portfolio,
    classificationsById: { alpha: 'SAFE_TO_ONBOARD_NOW', beta: 'SENSITIVE' },
    projectIds: ['alpha', 'beta'],
    field: 'activeFleet',
    add: true
  })
  assert.deepEqual(applied, ['alpha'])
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].projectId, 'beta')
  assert.match(skipped[0].reason, /not allowed/i)
  assert.deepEqual(nextIds, ['alpha'])
})

test('adding a DIRTY_PRESERVE project to Work Set is skipped even though it can join Active Fleet', () => {
  const portfolio = portfolioWith(['gamma'])
  const withFleet = setActiveFleet(portfolio, ['gamma'], clock)
  const { applied, skipped } = planBulkMembershipChange({
    portfolio: withFleet,
    classificationsById: { gamma: 'DIRTY_PRESERVE' },
    projectIds: ['gamma'],
    field: 'workSet',
    add: true
  })
  assert.deepEqual(applied, [])
  assert.equal(
    skipped[0].reason.includes('DIRTY PRESERVE') || skipped[0].reason.includes('not allowed'),
    true
  )
})

test('adding to Work Set is skipped with a clear reason when the project is not yet in Active Fleet', () => {
  const portfolio = portfolioWith(['delta'])
  const { applied, skipped } = planBulkMembershipChange({
    portfolio,
    classificationsById: { delta: 'SAFE_TO_ONBOARD_NOW' },
    projectIds: ['delta'],
    field: 'workSet',
    add: true
  })
  assert.deepEqual(applied, [])
  assert.match(skipped[0].reason, /Active Fleet membership first/)
})

test('a project with no classification at all (analysis missing) is skipped, never silently allowed', () => {
  const portfolio = portfolioWith(['epsilon'])
  const { applied, skipped } = planBulkMembershipChange({
    portfolio,
    classificationsById: {},
    projectIds: ['epsilon'],
    field: 'activeFleet',
    add: true
  })
  assert.deepEqual(applied, [])
  assert.match(skipped[0].reason, /onboarding analysis/)
})

test('an unknown (never-onboarded) project id is skipped, never crashes the batch', () => {
  const portfolio = portfolioWith(['zeta'])
  const { applied, skipped } = planBulkMembershipChange({
    portfolio,
    classificationsById: { 'ghost-project': 'SAFE_TO_ONBOARD_NOW' },
    projectIds: ['ghost-project'],
    field: 'activeFleet',
    add: true
  })
  assert.deepEqual(applied, [])
  assert.match(skipped[0].reason, /known \(onboarded\)/)
})

test('removal never needs classification gating -- reducing membership always applies', () => {
  const portfolio = setActiveFleet(portfolioWith(['eta']), ['eta'], clock)
  const { nextIds, applied, skipped } = planBulkMembershipChange({
    portfolio,
    classificationsById: {}, // deliberately absent -- must not matter for removal
    projectIds: ['eta'],
    field: 'activeFleet',
    add: false
  })
  assert.deepEqual(applied, ['eta'])
  assert.deepEqual(skipped, [])
  assert.deepEqual(nextIds, [])
})

test('a mixed batch (some eligible, some not) processes the eligible ones and reports the rest -- bulk selection never widens authority', () => {
  const portfolio = portfolioWith(['a', 'b', 'c'])
  const { nextIds, applied, skipped } = planBulkMembershipChange({
    portfolio,
    classificationsById: {
      a: 'SAFE_TO_ONBOARD_NOW',
      b: 'SENSITIVE',
      c: 'READ_ONLY_ONBOARDING_ONLY'
    },
    projectIds: ['a', 'b', 'c'],
    field: 'activeFleet',
    add: true
  })
  assert.deepEqual(applied, ['a'])
  assert.equal(skipped.length, 2)
  assert.deepEqual(skipped.map((s) => s.projectId).sort(), ['b', 'c'])
  assert.deepEqual(nextIds, ['a'])
})
