import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyDogfoodRequest,
  respondDogfoodCommand,
  shouldRouteToDogfoodBridge
} from '../server/command-dogfood-bridge.mjs'

test('classifyDogfoodRequest recognizes the real trigger phrasings', () => {
  assert.equal(classifyDogfoodRequest('dogfood orca'), 'DOGFOOD_ORCA_SELF')
  assert.equal(classifyDogfoodRequest('review the UI'), 'DOGFOOD_ORCA_SELF')
  assert.equal(classifyDogfoodRequest('check this before I look'), 'DOGFOOD_ORCA_SELF')
  assert.equal(
    classifyDogfoodRequest('check this candidate before I look at it'),
    'DOGFOOD_ORCA_SELF'
  )
})

test('classifyDogfoodRequest does not hijack ordinary status/review chat', () => {
  assert.equal(classifyDogfoodRequest("what's the status?"), null)
  assert.equal(classifyDogfoodRequest('check if the build passed'), null)
  assert.equal(classifyDogfoodRequest('review the PR'), null)
})

test('classifyDogfoodRequest is honest about an unsupported named target', () => {
  assert.equal(classifyDogfoodRequest('dogfood NWR'), 'DOGFOOD_UNSUPPORTED_TARGET')
})

test('shouldRouteToDogfoodBridge mirrors classifyDogfoodRequest', () => {
  assert.equal(shouldRouteToDogfoodBridge('dogfood orca'), true)
  assert.equal(shouldRouteToDogfoodBridge('hello'), false)
})

test('respondDogfoodCommand returns null for a non-dogfood message (falls through to normal chat)', async () => {
  assert.equal(await respondDogfoodCommand({ message: 'what is running right now?' }), null)
})

test('respondDogfoodCommand is honest when a named target is not wired up yet', async () => {
  const result = await respondDogfoodCommand({ message: 'dogfood NWR' })
  assert.equal(result.live, false)
  assert.match(result.text, /isn't wired up here yet/)
})

test('REQUIRED PROOF: respondDogfoodCommand runs the real domain contract against injected fake deps and reports real findings', async () => {
  const fakePage = {
    setViewportSize: async () => {},
    evaluate: async () => {},
    waitForTimeout: async () => {}
  }
  const result = await respondDogfoodCommand({
    message: 'dogfood orca',
    deps: {
      forceRunEvenWhenUnbuilt: true,
      launch: async () => ({ page: fakePage, close: async () => {} }),
      attachCapture: () => ({
        consoleErrors: [{ text: 'real crash', location: null }],
        failedRequests: [],
        reset() {},
        detach() {}
      }),
      surfaceStrategy: () => [{ id: 'home', title: 'Home', open: async () => {} }]
    }
  })
  assert.equal(result.live, true)
  assert.equal(result.scope, 'UI_DOGFOOD')
  assert.equal(result.dogfoodRun.totalFindings, 1)
  assert.match(result.text, /CONSOLE_ERROR/)
})

test('respondDogfoodCommand honestly reports a failed dogfood run instead of throwing', async () => {
  const result = await respondDogfoodCommand({
    message: 'dogfood orca',
    deps: {
      forceRunEvenWhenUnbuilt: true,
      launch: async () => {
        throw new Error('electron launch failed')
      },
      surfaceStrategy: () => []
    }
  })
  assert.equal(result.live, false)
  assert.match(result.text, /electron launch failed/)
})
