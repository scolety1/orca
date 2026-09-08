import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyRuntimeIdentityRequest,
  respondRuntimeIdentityCommand,
  shouldRouteToRuntimeIdentityBridge
} from '../server/command-runtime-identity-bridge.mjs'

test('classifyRuntimeIdentityRequest recognizes the real trigger phrasings', () => {
  assert.equal(classifyRuntimeIdentityRequest('what version am I actually running?'), 'RUNTIME_IDENTITY_QUERY')
  assert.equal(classifyRuntimeIdentityRequest('is the UI current?'), 'RUNTIME_IDENTITY_QUERY')
  assert.equal(classifyRuntimeIdentityRequest('is this UI up to date?'), 'RUNTIME_IDENTITY_QUERY')
  assert.equal(classifyRuntimeIdentityRequest('what commit is this running?'), 'RUNTIME_IDENTITY_QUERY')
})

test('classifyRuntimeIdentityRequest does not hijack ordinary chat', () => {
  assert.equal(classifyRuntimeIdentityRequest("what's the status?"), null)
  assert.equal(classifyRuntimeIdentityRequest('is this good to adopt?'), null)
})

test('shouldRouteToRuntimeIdentityBridge mirrors classifyRuntimeIdentityRequest', () => {
  assert.equal(shouldRouteToRuntimeIdentityBridge('is the UI current?'), true)
  assert.equal(shouldRouteToRuntimeIdentityBridge('hello'), false)
})

test('respondRuntimeIdentityCommand returns null for a non-matching message (falls through to normal chat)', async () => {
  assert.equal(await respondRuntimeIdentityCommand({ message: 'what is running right now?' }), null)
})

test('REQUIRED PROOF: respondRuntimeIdentityCommand answers from a real (injected) runtime identity read, honestly', async () => {
  const fakeIdentity = {
    state: 'BUILD_FAILED',
    reason: 'npm run build exited with code 1 -- real stderr tail',
    runningCommit: 'a'.repeat(40),
    diskCommit: 'a'.repeat(40),
    uiBundleCommit: 'b'.repeat(40)
  }
  const result = await respondRuntimeIdentityCommand({
    message: 'is the UI current?',
    deps: { getRuntimeIdentityWithBuildState: async () => fakeIdentity }
  })
  assert.equal(result.intent, 'RUNTIME_IDENTITY')
  assert.equal(result.live, true)
  assert.equal(result.scope, 'RUNTIME_IDENTITY')
  assert.match(result.text, /BUILD_FAILED/)
  assert.match(result.text, /real stderr tail/)
  assert.match(result.text, /aaaaaaaaaa/)
})

test('respondRuntimeIdentityCommand reports an honest UP_TO_DATE answer', async () => {
  const result = await respondRuntimeIdentityCommand({
    message: 'what version am I running?',
    deps: {
      getRuntimeIdentityWithBuildState: async () => ({
        state: 'UP_TO_DATE',
        reason: 'the running backend and served UI both match the current commit',
        runningCommit: 'c'.repeat(40),
        diskCommit: 'c'.repeat(40),
        uiBundleCommit: 'c'.repeat(40)
      })
    }
  })
  assert.match(result.text, /UP_TO_DATE/)
  assert.match(result.text, /cccccccccc/)
})
