// §7: transport verification before money. Mocked fetch only -- no real
// network call anywhere in this file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createParallelHttpTransport } from '../adapters/parallel-http-transport.mjs'

function mockFetch(handler) {
  return async (url, init) => handler(url, init)
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('createParallelHttpTransport throws immediately if apiKey is missing -- never silently uses no auth', () => {
  assert.throws(() => createParallelHttpTransport({ apiKey: undefined, fetchImpl: mockFetch(() => jsonResponse(200, {})) }), /requires apiKey/)
})

test('createTaskRun posts to the exact documented endpoint with the exact documented auth header', async () => {
  let captured
  const fetchImpl = mockFetch((url, init) => {
    captured = { url, init }
    return jsonResponse(202, { run_id: 'trun_123', status: 'queued' })
  })
  const transport = createParallelHttpTransport({ apiKey: 'sk-test-secret-value', fetchImpl })
  const result = await transport.createTaskRun({ input: 'q', processor: 'core', task_spec: {} })
  assert.equal(captured.url, 'https://api.parallel.ai/v1/tasks/runs')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.headers['x-api-key'], 'sk-test-secret-value')
  assert.equal(result.run_id, 'trun_123')
})

test('SECRET HANDLING: the api key never appears in a thrown error message', async () => {
  const fetchImpl = mockFetch(() => jsonResponse(401, { error: { message: 'invalid credentials' } }))
  const transport = createParallelHttpTransport({ apiKey: 'sk-super-secret-do-not-leak', fetchImpl })
  await assert.rejects(
    transport.createTaskRun({ input: 'q', processor: 'core', task_spec: {} }),
    (error) => {
      assert.ok(!error.message.includes('sk-super-secret-do-not-leak'), 'the api key must never appear in an error message')
      assert.ok(error.message.includes('401'))
      return true
    }
  )
})

test('a 408 (still active) on the result endpoint maps to a "running" status, not an error', async () => {
  const fetchImpl = mockFetch(() => jsonResponse(408, {}))
  const transport = createParallelHttpTransport({ apiKey: 'k', fetchImpl })
  const run = await transport.getTaskRun('trun_123')
  assert.equal(run.status, 'running')
})

test('a 404 on the result endpoint maps to an honest failed status, never an infinite-poll trap', async () => {
  const fetchImpl = mockFetch(() => jsonResponse(404, { error: { message: 'run failed or not found' } }))
  const transport = createParallelHttpTransport({ apiKey: 'k', fetchImpl })
  const run = await transport.getTaskRun('trun_123')
  assert.equal(run.status, 'failed')
})

test('a completed result is flattened to {status, output, run_id} matching what parallel-research-worker.mjs expects', async () => {
  const fetchImpl = mockFetch((url) => {
    assert.ok(url.includes('/v1/tasks/runs/trun_123/result'))
    assert.ok(url.includes('timeout='))
    return jsonResponse(200, {
      run: { run_id: 'trun_123', status: 'completed' },
      output: { type: 'json', content: { fieldA: 'x' }, basis: [] }
    })
  })
  const transport = createParallelHttpTransport({ apiKey: 'k', fetchImpl })
  const run = await transport.getTaskRun('trun_123')
  assert.equal(run.status, 'completed')
  assert.deepEqual(run.output.content, { fieldA: 'x' })
  assert.equal(run.run_id, 'trun_123')
})

test('a cancelled run maps to a failed status, never silently treated as pending forever', async () => {
  const fetchImpl = mockFetch(() => jsonResponse(200, { run: { run_id: 'r', status: 'cancelled' }, output: null }))
  const transport = createParallelHttpTransport({ apiKey: 'k', fetchImpl })
  const run = await transport.getTaskRun('r')
  assert.equal(run.status, 'failed')
})

test('a network-level throw from fetch propagates as a real error, never swallowed into a fake success', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED')
  }
  const transport = createParallelHttpTransport({ apiKey: 'k', fetchImpl })
  await assert.rejects(transport.createTaskRun({ input: 'q', processor: 'core', task_spec: {} }), /ECONNREFUSED/)
})
