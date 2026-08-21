import assert from 'node:assert/strict'
import test from 'node:test'
import { decideCapacityAction } from '../domain/capacity-policy.mjs'

test('a missing snapshot for the provider reports UNKNOWN assurance and defaults to PROCEED, never fabricating a reading', () => {
  const result = decideCapacityAction({ claude: null, codex: null }, 'codex')
  assert.equal(result.action, 'PROCEED')
  assert.equal(result.assurance, 'UNKNOWN')
})

test('an entirely missing snapshot object also reports UNKNOWN rather than throwing', () => {
  const result = decideCapacityAction(null, 'claude')
  assert.equal(result.action, 'PROCEED')
  assert.equal(result.assurance, 'UNKNOWN')
})

test('low real usage proceeds normally with OBSERVED assurance', () => {
  const snapshot = { claude: { sessionUsedPercent: 10, weeklyUsedPercent: 20, status: 'ok' } }
  const result = decideCapacityAction(snapshot, 'claude')
  assert.equal(result.action, 'PROCEED')
  assert.equal(result.assurance, 'OBSERVED')
})

test('usage past the downgrade threshold prefers a cheaper worker', () => {
  const snapshot = { codex: { weeklyUsedPercent: 75, status: 'ok' } }
  assert.equal(decideCapacityAction(snapshot, 'codex').action, 'DOWNGRADE_WORKER')
})

test('usage past the reduce-concurrency threshold reduces concurrency', () => {
  const snapshot = { codex: { weeklyUsedPercent: 88, status: 'ok' } }
  assert.equal(decideCapacityAction(snapshot, 'codex').action, 'REDUCE_CONCURRENCY')
})

test('usage past the pause threshold pauses and checkpoints', () => {
  const snapshot = { codex: { weeklyUsedPercent: 97, status: 'ok' } }
  assert.equal(decideCapacityAction(snapshot, 'codex').action, 'PAUSE_AND_CHECKPOINT')
})

// The exact real status string this program observed live during M2's
// own dogfood proof (state.json's providerCapacityStatus record) --
// Orca's own computed status overrides a raw percentage that might not
// yet have crossed this module's own threshold.
test('a real AT_EXPIRING_CAPACITY_SAFETY_RESERVE status forces PAUSE_AND_CHECKPOINT even at a lower percentage', () => {
  const snapshot = {
    codex: { weeklyUsedPercent: 60, status: 'AT_EXPIRING_CAPACITY_SAFETY_RESERVE' }
  }
  const result = decideCapacityAction(snapshot, 'codex')
  assert.equal(result.action, 'PAUSE_AND_CHECKPOINT')
})

test('session usage counts even when weekly usage is low -- the worse of the two governs', () => {
  const snapshot = { claude: { sessionUsedPercent: 96, weeklyUsedPercent: 5, status: 'ok' } }
  assert.equal(decideCapacityAction(snapshot, 'claude').action, 'PAUSE_AND_CHECKPOINT')
})
