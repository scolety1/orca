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
      // F30: forced HEALTHY -- this test's own real point is the domain
      // contract wiring, not this host's real memory at run time.
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }),
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

// F30 (Phase 3, resource-aware execution hardening): this was the one real
// production call site that launched a full Electron instance with zero
// Resource Pressure Governor check at all -- newBrowserPilots existed in
// the domain policy since V0 but had no real caller until this fix.
test('F30: respondDogfoodCommand refuses a real Electron launch under CRITICAL memory pressure', async () => {
  let launchCalls = 0
  const result = await respondDogfoodCommand({
    message: 'dogfood orca',
    deps: {
      forceRunEvenWhenUnbuilt: true,
      collectHostMemoryEvidence: () => ({ availableBytes: 2 * 1024 ** 3 }), // CRITICAL (1.5-2.5GB)
      launch: async () => {
        launchCalls += 1
        return { page: {}, close: async () => {} }
      },
      surfaceStrategy: () => []
    }
  })
  assert.equal(result.live, false)
  assert.match(result.text, /withheld/)
  assert.match(result.providerLabel, /RESOURCE_PRESSURE_REFUSED/)
  assert.equal(launchCalls, 0)
})

test('F30: respondDogfoodCommand still runs a real dogfood pass under HEALTHY memory', async () => {
  const fakePage = {
    setViewportSize: async () => {},
    evaluate: async () => {},
    waitForTimeout: async () => {}
  }
  const result = await respondDogfoodCommand({
    message: 'dogfood orca',
    deps: {
      forceRunEvenWhenUnbuilt: true,
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }), // HEALTHY
      launch: async () => ({ page: fakePage, close: async () => {} }),
      attachCapture: () => ({ consoleErrors: [], failedRequests: [], reset() {}, detach() {} }),
      surfaceStrategy: () => [{ id: 'home', title: 'Home', open: async () => {} }]
    }
  })
  assert.equal(result.live, true)
})

test('respondDogfoodCommand honestly reports a failed dogfood run instead of throwing', async () => {
  const result = await respondDogfoodCommand({
    message: 'dogfood orca',
    deps: {
      forceRunEvenWhenUnbuilt: true,
      // F30: forced HEALTHY so this exercises the launch-failure path
      // itself, deterministically, regardless of this host's real memory.
      collectHostMemoryEvidence: () => ({ availableBytes: 8 * 1024 ** 3 }),
      launch: async () => {
        throw new Error('electron launch failed')
      },
      surfaceStrategy: () => []
    }
  })
  assert.equal(result.live, false)
  assert.match(result.text, /electron launch failed/)
})
