import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendCleanupReceipt,
  createCleanupReceipt,
  verifyCleanupReceipt,
  verifyCleanupReceiptChain
} from '../domain/cleanup-receipt-chain.mjs'

const CLOCK = () => new Date('2026-09-06T12:00:00.000Z')

test('createCleanupReceipt refuses an unsupported kind', () => {
  assert.throws(() => createCleanupReceipt({ kind: 'NOT_A_KIND', requestId: 'r1' }, { clock: CLOCK }))
})

test('createCleanupReceipt refuses a missing requestId', () => {
  assert.throws(() => createCleanupReceipt({ kind: 'RECOMMENDATION_ISSUED' }, { clock: CLOCK }))
})

test('a single receipt verifies against its own hash', () => {
  const receipt = createCleanupReceipt({ kind: 'RECOMMENDATION_ISSUED', requestId: 'r1' }, { clock: CLOCK })
  assert.equal(verifyCleanupReceipt(receipt), true)
})

test('tampering with a receipt field after the fact breaks verification', () => {
  const receipt = createCleanupReceipt({ kind: 'RECOMMENDATION_ISSUED', requestId: 'r1' }, { clock: CLOCK })
  const tampered = { ...receipt, actionClass: 'SOMETHING_ELSE' }
  assert.equal(verifyCleanupReceipt(tampered), false)
})

test('appendCleanupReceipt builds a real hash chain -- each entry links to the previous', () => {
  let receipts = []
  receipts = appendCleanupReceipt(receipts, { kind: 'RECOMMENDATION_ISSUED', requestId: 'r1' }, CLOCK)
  receipts = appendCleanupReceipt(receipts, { kind: 'PLAN_BUILT', requestId: 'r1' }, CLOCK)
  receipts = appendCleanupReceipt(receipts, { kind: 'AUTHORIZATION_GRANTED', requestId: 'r1' }, CLOCK)
  assert.equal(receipts[0].previousReceiptHash, null)
  assert.equal(receipts[1].previousReceiptHash, receipts[0].receiptHash)
  assert.equal(receipts[2].previousReceiptHash, receipts[1].receiptHash)
  assert.equal(verifyCleanupReceiptChain(receipts), -1)
})

test('verifyCleanupReceiptChain detects a removed/reordered entry (a broken link), returning the break index', () => {
  let receipts = []
  receipts = appendCleanupReceipt(receipts, { kind: 'RECOMMENDATION_ISSUED', requestId: 'r1' }, CLOCK)
  receipts = appendCleanupReceipt(receipts, { kind: 'PLAN_BUILT', requestId: 'r1' }, CLOCK)
  receipts = appendCleanupReceipt(receipts, { kind: 'AUTHORIZATION_GRANTED', requestId: 'r1' }, CLOCK)
  const withMiddleRemoved = [receipts[0], receipts[2]]
  assert.equal(verifyCleanupReceiptChain(withMiddleRemoved), 1)
})

test('verifyCleanupReceiptChain detects a tampered middle entry', () => {
  let receipts = []
  receipts = appendCleanupReceipt(receipts, { kind: 'RECOMMENDATION_ISSUED', requestId: 'r1' }, CLOCK)
  receipts = appendCleanupReceipt(receipts, { kind: 'PLAN_BUILT', requestId: 'r1', detail: { blocked: false } }, CLOCK)
  receipts = appendCleanupReceipt(receipts, { kind: 'AUTHORIZATION_GRANTED', requestId: 'r1' }, CLOCK)
  receipts[1] = { ...receipts[1], detail: { blocked: true } }
  assert.equal(verifyCleanupReceiptChain(receipts), 1)
})

test('verifyCleanupReceiptChain accepts an empty chain as clean', () => {
  assert.equal(verifyCleanupReceiptChain([]), -1)
})
