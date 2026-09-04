// §7: transport verification before money. Mocked fetch only -- no real
// network call anywhere in this file.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createExaHttpTransport } from '../adapters/exa-http-transport.mjs'

function mockFetch(handler) {
  return async (url, init) => handler(url, init)
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('createExaHttpTransport throws immediately if apiKey is missing', () => {
  assert.throws(() => createExaHttpTransport({ apiKey: undefined, fetchImpl: mockFetch(() => jsonResponse(200, {})) }), /requires apiKey/)
})

test('createAgentRun posts to the exact documented endpoint with the exact documented Bearer auth header', async () => {
  let captured
  const fetchImpl = mockFetch((url, init) => {
    captured = { url, init }
    return jsonResponse(200, { id: 'agent_run_01', status: 'queued' })
  })
  const transport = createExaHttpTransport({ apiKey: 'exa-test-secret-value', fetchImpl })
  const result = await transport.createAgentRun({ query: 'q', effort: 'medium', outputSchema: {} })
  assert.equal(captured.url, 'https://api.exa.ai/agent/runs')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.headers.Authorization, 'Bearer exa-test-secret-value')
  assert.equal(result.id, 'agent_run_01')
})

test('SECRET HANDLING: the api key never appears in a thrown error message', async () => {
  const fetchImpl = mockFetch(() => jsonResponse(401, { error: { message: 'invalid credentials' } }))
  const transport = createExaHttpTransport({ apiKey: 'exa-super-secret-do-not-leak', fetchImpl })
  await assert.rejects(
    transport.createAgentRun({ query: 'q', effort: 'medium' }),
    (error) => {
      assert.ok(!error.message.includes('exa-super-secret-do-not-leak'))
      assert.ok(error.message.includes('401'))
      return true
    }
  )
})

test('getAgentRun polls the exact documented GET endpoint with the run id in the path', async () => {
  const fetchImpl = mockFetch((url) => {
    assert.equal(url, 'https://api.exa.ai/agent/runs/agent_run_01')
    return jsonResponse(200, { id: 'agent_run_01', status: 'running' })
  })
  const transport = createExaHttpTransport({ apiKey: 'k', fetchImpl })
  const run = await transport.getAgentRun('agent_run_01')
  assert.equal(run.status, 'running')
})

test('a completed run passes through output/costDollars/usage verbatim for the adapter to normalize', async () => {
  const fetchImpl = mockFetch(() =>
    jsonResponse(200, {
      id: 'agent_run_01',
      status: 'completed',
      output: { structured: { fieldA: 'x' }, grounding: [] },
      costDollars: 0.1,
      usage: { agentComputeUnits: 1 }
    })
  )
  const transport = createExaHttpTransport({ apiKey: 'k', fetchImpl })
  const run = await transport.getAgentRun('agent_run_01')
  assert.equal(run.status, 'completed')
  assert.equal(run.costDollars, 0.1)
  assert.equal(run.usage.agentComputeUnits, 1)
})

test('a network-level throw from fetch propagates as a real error, never swallowed into a fake success', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED')
  }
  const transport = createExaHttpTransport({ apiKey: 'k', fetchImpl })
  await assert.rejects(transport.createAgentRun({ query: 'q', effort: 'medium' }), /ECONNREFUSED/)
})

test('a non-2xx, non-JSON response body is handled without throwing a secondary parse error', async () => {
  const fetchImpl = mockFetch(() => ({ ok: false, status: 500, json: async () => { throw new Error('not json') } }))
  const transport = createExaHttpTransport({ apiKey: 'k', fetchImpl })
  await assert.rejects(transport.createAgentRun({ query: 'q', effort: 'medium' }), /HTTP 500/)
})
