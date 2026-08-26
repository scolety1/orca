import assert from 'node:assert/strict'
import test from 'node:test'
import { assertUsageModeAllowed } from '../domain/usage-mode-validation.mjs'
import { startKeepGoingRun } from '../server/keep-going-controller.mjs'

const clock = () => new Date('2026-08-25T18:00:00.000Z')

test('assertUsageModeAllowed accepts every real config entry', () => {
  for (const mode of ['TEST_MINIMAL', 'ECONOMY', 'BALANCED', 'MAXIMUM']) {
    assert.doesNotThrow(() => assertUsageModeAllowed(mode))
  }
})

test('assertUsageModeAllowed rejects HIGH_ASSURANCE with the same "reserved" message as /api/usage-mode', () => {
  assert.throws(
    () => assertUsageModeAllowed('HIGH_ASSURANCE'),
    (error) => {
      assert.equal(error.code, 'TSF_USAGE_MODE_RESERVED')
      assert.match(error.message, /reserved, not yet available/)
      return true
    }
  )
})

test('assertUsageModeAllowed rejects an unrecognized mode, not just HIGH_ASSURANCE specifically', () => {
  assert.throws(() => assertUsageModeAllowed('MADE_UP_MODE'), /TSF_USAGE_MODE_RESERVED|reserved/)
})

test('startKeepGoingRun closes the real silent-accept hole: HIGH_ASSURANCE is rejected before a run is ever created', () => {
  assert.throws(
    () =>
      startKeepGoingRun(
        {},
        'proj-ha',
        { originalGoal: 'Ship it.', acceptanceCriteria: ['X'], usageMode: 'HIGH_ASSURANCE' },
        clock
      ),
    (error) => {
      assert.equal(error.code, 'TSF_USAGE_MODE_RESERVED')
      return true
    }
  )
})

test('startKeepGoingRun still defaults an omitted usageMode to BALANCED, unaffected by the new validation', () => {
  const { run } = startKeepGoingRun(
    {},
    'proj-default',
    { originalGoal: 'Ship it.', acceptanceCriteria: ['X'] },
    clock
  )
  assert.equal(run.usageMode, 'BALANCED')
})
