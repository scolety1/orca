// Real HTTP transport for exa-research-worker.mjs, built against the
// CURRENT documented Exa Agent API as of 2026-09-03 (exa.ai/docs):
//   POST https://api.exa.ai/agent/runs      (header: Authorization: Bearer <key>)
//   GET  https://api.exa.ai/agent/runs/{id}
// Non-blocking poll (unlike Parallel's blocking result endpoint) -- a
// plain GET returns the run's current status immediately.
//
// SECRET HANDLING: apiKey is used only as the literal Bearer header value.
// Never interpolated into an Error message, never logged.
const DEFAULT_BASE_URL = 'https://api.exa.ai'

function httpError(message, status) {
  const error = new Error(message)
  error.code = 'EXA_HTTP_ERROR'
  error.status = status
  return error
}

export function createExaHttpTransport({ apiKey, fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL }) {
  if (!apiKey) {
    throw new Error('createExaHttpTransport requires apiKey -- credentials must come from the environment, never hardcoded')
  }

  async function createAgentRun(spec) {
    const response = await fetchImpl(`${baseUrl}/agent/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(spec)
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      throw httpError(`Exa createAgentRun: HTTP ${response.status}${body?.error?.message ? ` -- ${body.error.message}` : ''}`, response.status)
    }
    return body // {id, status, createdAt, request}
  }

  async function getAgentRun(id) {
    const response = await fetchImpl(`${baseUrl}/agent/runs/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      throw httpError(`Exa getAgentRun: HTTP ${response.status}${body?.error?.message ? ` -- ${body.error.message}` : ''}`, response.status)
    }
    // body: {id, status: queued|running|completed|failed|cancelled, output?, error?, costDollars?, usage?}
    return body
  }

  return { createAgentRun, getAgentRun }
}
