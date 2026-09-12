// Unit coverage for domain/reconcile-upgrade-classification.mjs -- the
// thin, one-directional wrapper over parent-mission-intent-
// classification.mjs's own trigger detection. The trigger patterns
// themselves are exhaustively tested in
// test/parent-mission-intent-classification.test.mjs; this file proves
// this module's own real contract: the { isReconcileUpgrade, parentIntent }
// shape, and that it can never return DATASET_RESEARCH.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARENT_MISSION_INTENTS } from '../domain/parent-mission-intent-classification.mjs'
import { classifyReconcileUpgradeIntent, hasReconcileUpgradeTriggerSignal } from '../domain/reconcile-upgrade-classification.mjs'

test('classifyReconcileUpgradeIntent: a real trigger phrase resolves isReconcileUpgrade:true, parentIntent SOFTWARE_PRODUCT_ENGINEERING', () => {
  const result = classifyReconcileUpgradeIntent('Audit this workflow.')
  assert.deepEqual(result, { isReconcileUpgrade: true, parentIntent: PARENT_MISSION_INTENTS.SOFTWARE_PRODUCT_ENGINEERING })
})

test('classifyReconcileUpgradeIntent: a non-trigger message resolves isReconcileUpgrade:false, parentIntent null -- never fabricated', () => {
  const result = classifyReconcileUpgradeIntent('What is the capital of France?')
  assert.deepEqual(result, { isReconcileUpgrade: false, parentIntent: null })
})

test('classifyReconcileUpgradeIntent: empty/non-string input is honestly false, never throws', () => {
  assert.deepEqual(classifyReconcileUpgradeIntent(''), { isReconcileUpgrade: false, parentIntent: null })
  assert.deepEqual(classifyReconcileUpgradeIntent(undefined), { isReconcileUpgrade: false, parentIntent: null })
})

// This function must never return DATASET_RESEARCH, by construction --
// the whole point of the module.
test('classifyReconcileUpgradeIntent: parentIntent is never DATASET_RESEARCH, for any real trigger phrase', () => {
  const triggers = ['Research this area and upgrade it.', 'Dogfood this.', 'Make this production-ready.']
  for (const message of triggers) {
    const result = classifyReconcileUpgradeIntent(message)
    assert.notEqual(result.parentIntent, PARENT_MISSION_INTENTS.DATASET_RESEARCH)
  }
})

test('re-exports the real hasReconcileUpgradeTriggerSignal unchanged (same function, not a re-implementation)', () => {
  assert.equal(typeof hasReconcileUpgradeTriggerSignal, 'function')
  assert.equal(hasReconcileUpgradeTriggerSignal('Dogfood this.'), true)
})
