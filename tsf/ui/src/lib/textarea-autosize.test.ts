import assert from 'node:assert/strict'
import test from 'node:test'
import { computeAutosizeHeightPx } from './textarea-autosize.ts'

test('a short single-line content never shrinks below minPx', () => {
  assert.equal(computeAutosizeHeightPx(20, { minPx: 36, maxPx: 200 }), 36)
})

test('content between min and max grows to fit exactly', () => {
  assert.equal(computeAutosizeHeightPx(90, { minPx: 36, maxPx: 200 }), 90)
})

test('very long content is capped at maxPx, never grows unbounded', () => {
  assert.equal(computeAutosizeHeightPx(5000, { minPx: 36, maxPx: 200 }), 200)
})

test('exactly minPx/maxPx pass through unchanged', () => {
  assert.equal(computeAutosizeHeightPx(36, { minPx: 36, maxPx: 200 }), 36)
  assert.equal(computeAutosizeHeightPx(200, { minPx: 36, maxPx: 200 }), 200)
})
