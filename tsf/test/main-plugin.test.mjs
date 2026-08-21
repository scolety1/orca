import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import activate, { deactivate, FOUNDATION } from '../main.mjs'

// Real end-to-end proof: activate() actually spawns a real tsf/server child
// process (the real http-server.mjs, via node:child_process) and it really
// answers real HTTP requests -- not a mock. An ephemeral, randomized port
// (via testOverrides, never used by the real host) avoids colliding with
// any TSF server a developer/CI runner might already have listening on the
// real default port 4610.
function ephemeralPort() {
  return 40000 + Math.floor(Math.random() * 10000)
}

function fakeOrca() {
  const registered = new Map()
  const logs = []
  return {
    orca: {
      commands: { register: (id, handler) => registered.set(id, handler) },
      events: { on: () => {} },
      host: { call: async () => ({ value: undefined }) },
      log: (message) => logs.push(message)
    },
    registered,
    logs
  }
}

async function waitForServer(base, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/meta`)
      if (res.ok) {
        return res
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw lastError ?? new Error('server did not become ready in time')
}

test('activate() registers the existing commands unchanged', () => {
  const { orca, registered } = fakeOrca()
  activate(orca, {
    port: ephemeralPort(),
    spawnFn: () => ({ stdout: null, stderr: null, on: () => {}, kill: () => {} })
  })
  try {
    assert.ok(registered.has('tsf-foundation-health'))
    assert.ok(registered.has('tsf-status'))
    assert.ok(registered.has('tsf-set-usage-mode'))
  } finally {
    deactivate()
  }
})

test('a re-entrant activate() stops the previous lifecycle rather than orphaning it', () => {
  const { orca } = fakeOrca()
  const stopCalls = []
  function fakeSpawnFn() {
    return {
      stdout: null,
      stderr: null,
      on: () => {},
      kill: () => stopCalls.push('killed')
    }
  }
  activate(orca, { port: ephemeralPort(), spawnFn: fakeSpawnFn })
  activate(orca, { port: ephemeralPort(), spawnFn: fakeSpawnFn })
  try {
    assert.equal(
      stopCalls.length,
      1,
      'the first lifecycle was stopped before the second one started'
    )
  } finally {
    deactivate()
  }
})

test('activate() really spawns tsf/server and it really answers HTTP requests; deactivate() really kills it', async () => {
  const port = ephemeralPort()
  const { orca } = fakeOrca()
  const serverEntryPath = path.join(import.meta.dirname, '..', 'server', 'http-server.mjs')
  activate(orca, { port, serverEntryPath })
  try {
    const res = await waitForServer(`http://127.0.0.1:${port}`)
    const body = await res.json()
    assert.equal(body.product, FOUNDATION.product)
  } finally {
    deactivate()
  }
  // After deactivate(), the port must genuinely free up -- proves the real
  // child process was actually killed, not just detached from our handle.
  await new Promise((resolve) => setTimeout(resolve, 300))
  await assert.rejects(
    () => fetch(`http://127.0.0.1:${port}/api/meta`, { signal: AbortSignal.timeout(500) }),
    'the server must not still be listening after deactivate()'
  )
})
