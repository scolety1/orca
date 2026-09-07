import assert from 'node:assert/strict'
import test from 'node:test'
import { createDomOverflowDetector } from '../adapters/dom-overflow-detector.mjs'

function fakePage(evaluateResult) {
  return { evaluate: async () => evaluateResult }
}

test('createDomOverflowDetector reports no finding when nothing overflows', async () => {
  const detect = createDomOverflowDetector()
  const findings = await detect(fakePage([]), { id: 's', title: 'S' }, 'mobile')
  assert.deepEqual(findings, [])
})

test('REQUIRED PROOF: a real reported overflow becomes a well-formed CLIPPED_CONTENT finding', async () => {
  const detect = createDomOverflowDetector()
  const overflow = [{ tag: 'div', cls: 'toggle-row', right: 420, vw: 390 }]
  const findings = await detect(fakePage(overflow), { id: 's', title: 'Notifications' }, 'mobile')
  assert.equal(findings.length, 1)
  assert.equal(findings[0].category, 'CLIPPED_CONTENT')
  assert.match(findings[0].description, /Notifications/)
  assert.match(findings[0].description, /div/)
})

test('includeSelector scopes the detector to matching surfaces only, without ever calling page.evaluate for others', async () => {
  let evaluateCalled = false
  const page = {
    evaluate: async () => {
      evaluateCalled = true
      return []
    }
  }
  const detect = createDomOverflowDetector({ includeSelector: 'settings-' })
  const findings = await detect(page, { id: 'main-shell', title: 'Shell' }, 'desktop')
  assert.deepEqual(findings, [])
  assert.equal(evaluateCalled, false)
})
