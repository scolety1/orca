import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendSelfImprovementReceipt,
  createSelfImprovementReceipt,
  verifySelfImprovementReceipt,
  verifySelfImprovementReceiptChain
} from '../domain/self-improvement-receipt-chain.mjs'

const clock = () => new Date('2026-09-07T12:00:00.000Z')

test('a single receipt hashes itself and verifies clean', () => {
  const receipt = createSelfImprovementReceipt({ kind: 'MISSION_ORIGINATED', missionId: 'mission:x', findingId: 'finding:x', detail: { a: 1 } }, { clock })
  assert.equal(verifySelfImprovementReceipt(receipt), true)
  assert.equal(receipt.previousReceiptHash, null)
})

test('an unknown kind is refused, not silently accepted', () => {
  assert.throws(() => createSelfImprovementReceipt({ kind: 'NOT_A_REAL_KIND', missionId: 'mission:x', findingId: 'finding:x' }, { clock }))
})

test('a chain of receipts hash-links each entry to the previous one, and verifies clean end to end', () => {
  let receipts = []
  receipts = appendSelfImprovementReceipt(receipts, { kind: 'MISSION_ORIGINATED', missionId: 'mission:x', findingId: 'finding:x' }, clock)
  receipts = appendSelfImprovementReceipt(receipts, { kind: 'WORKER_DISPATCHED', missionId: 'mission:x', findingId: 'finding:x' }, clock)
  receipts = appendSelfImprovementReceipt(receipts, { kind: 'VERIFIER_RESULT', missionId: 'mission:x', findingId: 'finding:x' }, clock)
  assert.equal(receipts[1].previousReceiptHash, receipts[0].receiptHash)
  assert.equal(receipts[2].previousReceiptHash, receipts[1].receiptHash)
  assert.equal(verifySelfImprovementReceiptChain(receipts), -1)
})

test('a tampered receipt hash is caught -- the chain never silently ignores a broken link', () => {
  let receipts = []
  receipts = appendSelfImprovementReceipt(receipts, { kind: 'MISSION_ORIGINATED', missionId: 'mission:x', findingId: 'finding:x' }, clock)
  receipts = appendSelfImprovementReceipt(receipts, { kind: 'WORKER_DISPATCHED', missionId: 'mission:x', findingId: 'finding:x' }, clock)
  const tampered = [receipts[0], { ...receipts[1], detail: { injected: true } }]
  assert.equal(verifySelfImprovementReceiptChain(tampered), 1)
})

test('a broken previousReceiptHash link (reordered receipts) is caught', () => {
  let receipts = []
  receipts = appendSelfImprovementReceipt(receipts, { kind: 'MISSION_ORIGINATED', missionId: 'mission:x', findingId: 'finding:x' }, clock)
  receipts = appendSelfImprovementReceipt(receipts, { kind: 'WORKER_DISPATCHED', missionId: 'mission:x', findingId: 'finding:x' }, clock)
  const reordered = [receipts[1], receipts[0]]
  assert.equal(verifySelfImprovementReceiptChain(reordered), 0)
})
