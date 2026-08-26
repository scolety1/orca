import assert from 'node:assert/strict'
import test from 'node:test'
import { assessAdoptionReadiness, createAdoptionReceipt } from '../domain/self-update-adoption.mjs'

const clock = () => new Date('2026-08-25T12:00:00.000Z')

const allGreen = {
  candidateIsFastForward: true,
  candidateWorktreeClean: true,
  liveMainClean: true,
  independentReviewGreen: true,
  requiredTestsGreen: true,
  orcaCoreDeltaZero: true
}

test('every condition green is ready with no blockers', () => {
  const result = assessAdoptionReadiness(allGreen)
  assert.equal(result.ready, true)
  assert.deepEqual(result.blockers, [])
})

test('a non-fast-forward candidate is refused, never silently forced', () => {
  const result = assessAdoptionReadiness({ ...allGreen, candidateIsFastForward: false })
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some((b) => b.includes('fast-forward')))
})

test('every real blocker is reported, not just the first one found', () => {
  const result = assessAdoptionReadiness({
    ...allGreen,
    candidateWorktreeClean: false,
    independentReviewGreen: false,
    orcaCoreDeltaZero: false
  })
  assert.equal(result.ready, false)
  assert.equal(result.blockers.length, 3)
})

test('createAdoptionReceipt refuses any authorizer other than Tim', () => {
  assert.throws(
    () =>
      createAdoptionReceipt(
        { previousHead: 'a'.repeat(40), adoptedHead: 'b'.repeat(40), decidedBy: 'AUTOMATION' },
        clock
      ),
    (error) => {
      assert.equal(error.code, 'TSF_ADOPTION_REQUIRES_TIM')
      return true
    }
  )
})

test('createAdoptionReceipt requires real previousHead/adoptedHead values', () => {
  assert.throws(() =>
    createAdoptionReceipt(
      { previousHead: null, adoptedHead: 'b'.repeat(40), decidedBy: 'TIM' },
      clock
    )
  )
})

test('createAdoptionReceipt records a real, honest receipt when properly authorized', () => {
  const receipt = createAdoptionReceipt(
    {
      previousHead: 'a'.repeat(40),
      adoptedHead: 'b'.repeat(40),
      decidedBy: 'TIM',
      reason: 'verified candidate, fleet idle'
    },
    clock
  )
  assert.equal(receipt.schemaVersion, 'TSF_SELF_ADOPTION_RECEIPT_V1')
  assert.equal(receipt.previousHead, 'a'.repeat(40))
  assert.equal(receipt.adoptedHead, 'b'.repeat(40))
  assert.equal(receipt.rollbackAvailable, true)
  assert.equal(receipt.decidedAt, '2026-08-25T12:00:00.000Z')
})
