import assert from 'node:assert/strict'
import test from 'node:test'
import { isAuthorizedSelfRepair } from '../domain/self-repair-authority.mjs'

const base = {
  toggleOn: true,
  matchedOn: 'id',
  decisionClass: 'AUTO_DECIDE',
  projectId: 'tsf-orca',
  selfRepairProjectId: 'tsf-orca'
}

test('requires the toggle to be explicitly on -- an exact match with the toggle off is never authorized', () => {
  assert.equal(isAuthorizedSelfRepair({ ...base, toggleOn: false }), false)
})

test('requires an exact match -- a fuzzy-resolved project is never authorized even with the toggle on', () => {
  assert.equal(isAuthorizedSelfRepair({ ...base, matchedOn: 'fuzzy' }), false)
})

test('requires the message to clear TIM_REQUIRED', () => {
  assert.equal(isAuthorizedSelfRepair({ ...base, decisionClass: 'TIM_REQUIRED' }), false)
})

test('requires a project to actually be resolved at all', () => {
  assert.equal(isAuthorizedSelfRepair({ ...base, matchedOn: null }), false)
})

// Adversarial-review finding: an exactly-matched but UNRELATED project must
// never be authorized just because the toggle happens to be on.
test('requires the resolved project to actually be the configured self-repair project -- an unrelated exact match is never authorized', () => {
  assert.equal(isAuthorizedSelfRepair({ ...base, projectId: 'some-other-project' }), false)
})

test('requires a self-repair project to actually be configured -- authorization is impossible when unset, never a guessed default', () => {
  assert.equal(isAuthorizedSelfRepair({ ...base, selfRepairProjectId: null }), false)
  assert.equal(isAuthorizedSelfRepair({ ...base, selfRepairProjectId: undefined }), false)
})

test('authorized when the toggle is on, the match is exact (id or displayName), the project is the configured self-repair project, and authority clears', () => {
  assert.equal(isAuthorizedSelfRepair(base), true)
  assert.equal(isAuthorizedSelfRepair({ ...base, matchedOn: 'displayName' }), true)
  assert.equal(isAuthorizedSelfRepair({ ...base, decisionClass: 'RECOMMEND_AND_PROCEED' }), true)
})
