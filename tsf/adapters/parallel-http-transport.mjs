// Real HTTP transport for parallel-research-worker.mjs, built against the
// CURRENT documented Parallel Task API as of 2026-09-03 (docs.parallel.ai):
//   POST https://api.parallel.ai/v1/tasks/runs            (header: x-api-key)
//   GET  https://api.parallel.ai/v1/tasks/runs/{id}/result?timeout=<seconds>
// The result endpoint BLOCKS server-side until the run completes or the
// timeout elapses (408 if still active) -- this transport uses a short
// per-call timeout so it composes naturally with the adapter's existing
// poll-loop model (research-bakeoff-harness.mjs's dispatchAndAwaitResult)
// instead of one long blocking call.
//
// getTaskRun returns a FLATTENED {status, output, error, run_id} shape --
// unwrapping the real API's {run, output} result-envelope here so
// parallel-research-worker.mjs's existing fetchResult logic (which reads
// run.status / run.output directly) needs no change for this wire detail.
//
// SECRET HANDLING: apiKey is used only as the literal header value on the
// two fetch calls below. It is never interpolated into an Error message,
// never logged, never included in the returned response objects.
const DEFAULT_BASE_URL = 'https://api.parallel.ai'
const RESULT_POLL_TIMEOUT_SECONDS = 5

function httpError(message, status) {
  const error = new Error(message)
  error.code = 'PARALLEL_HTTP_ERROR'
  error.status = status
  return error
}

export function createParallelHttpTransport({ apiKey, fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL }) {
  if (!apiKey) {
    throw new Error('createParallelHttpTransport requires apiKey -- credentials must come from the environment, never hardcoded')
  }

  async function createTaskRun(spec) {
    const response = await fetchImpl(`${baseUrl}/v1/tasks/runs`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(spec)
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      // body?.error?.message is provider-returned text about the REQUEST,
      // never the credential itself -- safe to surface.
      throw httpError(`Parallel createTaskRun: HTTP ${response.status}${body?.error?.message ? ` -- ${body.error.message}` : ''}`, response.status)
    }
    return body // {run_id, interaction_id, status, is_active, processor, warnings, error, ...}
  }

  async function getTaskRun(runId) {
    const url = `${baseUrl}/v1/tasks/runs/${encodeURIComponent(runId)}/result?timeout=${RESULT_POLL_TIMEOUT_SECONDS}`
    const response = await fetchImpl(url, { method: 'GET', headers: { 'x-api-key': apiKey } })
    if (response.status === 408) {
      // Documented: "Request timed out; run still active" -- not an error,
      // just "not ready yet within this short poll window."
      return { status: 'running' }
    }
    const body = await response.json().catch(() => null)
    if (response.status === 404) {
      // Documented ambiguously as "Run failed or run id not found" --
      // treated as an honest failure rather than risking an infinite poll
      // against a run that will never resolve.
      return { status: 'failed', error: { message: body?.error?.message ?? 'run failed or not found (HTTP 404)' } }
    }
    if (!response.ok) {
      throw httpError(`Parallel getTaskRun: HTTP ${response.status}${body?.error?.message ? ` -- ${body.error.message}` : ''}`, response.status)
    }
    // body: { run: {run_id, status, ...}, output: {type, content, basis} }
    if (body?.run?.status === 'failed') {
      return { status: 'failed', error: body.run.error ?? { message: 'run reported failed' } }
    }
    if (body?.run?.status !== 'completed') {
      // action_required / cancelling / cancelled / queued / running --
      // anything not yet a real terminal success is treated as PENDING for
      // this short-poll transport (a permanently-stuck cancelling/
      // action_required run will still terminate honestly once the
      // caller's own maxPolls bound is exhausted).
      return { status: body?.run?.status === 'cancelled' ? 'failed' : 'running', error: body?.run?.status === 'cancelled' ? { message: 'run was cancelled' } : undefined }
    }
    return { status: 'completed', output: body.output, run_id: body.run.run_id }
  }

  return { createTaskRun, getTaskRun }
}
