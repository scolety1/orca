// Real, live health checks against a running TSF server after an update
// (spec Phase 6) -- every check hits an actual HTTP endpoint on the given
// base URL and reports pass/fail from a real response. Never claims
// success without a real check; a failed check preserves its own detail
// as the evidence a rollback decision would use.
//
// Mapping to spec Phase 6's named proof list: "correct accepted HEAD/
// build" + "UI bundle identity" -> runtime-identity; "API health" ->
// /api/meta; "Planner Chat basic call" -> a real (minimal) POST /api/chat;
// "Projects load"/"Work load"/"Capacity loads" -> their own endpoints.
// "Orca integration status" has no dedicated endpoint anywhere in this
// codebase to check honestly -- /api/routing (real provider/routing
// config) is the closest existing proxy; documented here rather than
// fabricating a new "Orca status" concept that doesn't otherwise exist.
const GET_CHECKS = [
  {
    name: 'api-health',
    path: '/api/meta',
    verify: (body) => typeof body?.upstreamVersion === 'string'
  },
  {
    name: 'runtime-identity',
    path: '/api/runtime-identity',
    verify: (body) => typeof body?.state === 'string' && !!body?.diskCommit
  },
  { name: 'projects-load', path: '/api/projects', verify: (body) => Array.isArray(body) },
  { name: 'work-load', path: '/api/work', verify: (body) => Array.isArray(body?.active) },
  {
    name: 'capacity-load',
    path: '/api/capacity',
    verify: (body) => body != null && typeof body === 'object'
  },
  {
    name: 'orca-integration-status',
    path: '/api/routing',
    verify: (body) => body != null && typeof body.activeUsageMode === 'string'
  }
]

async function runCheck(baseUrl, check, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`${baseUrl}${check.path}`, {
      method: check.method ?? 'GET',
      headers: check.body ? { 'content-type': 'application/json' } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined,
      signal: controller.signal
    })
    if (!res.ok) {
      return { name: check.name, ok: false, detail: `HTTP ${res.status}` }
    }
    const body = await res.json()
    const passed = check.verify(body)
    return {
      name: check.name,
      ok: passed,
      detail: passed ? null : 'response shape did not match expectation'
    }
  } catch (error) {
    return { name: check.name, ok: false, detail: error.message }
  } finally {
    clearTimeout(timer)
  }
}

export async function verifyLiveRuntime(
  baseUrl,
  { fetchImpl = fetch, timeoutMs = 5000, includeChatCheck = true } = {}
) {
  const checks = includeChatCheck
    ? [
        ...GET_CHECKS,
        {
          name: 'planner-chat-basic-call',
          path: '/api/chat',
          method: 'POST',
          body: { projectId: null, message: "what's running right now?" },
          verify: (body) => typeof body?.text === 'string' && body.text.length > 0
        }
      ]
    : GET_CHECKS
  const results = []
  for (const check of checks) {
    results.push(await runCheck(baseUrl, check, fetchImpl, timeoutMs))
  }
  return { ok: results.every((r) => r.ok), checks: results }
}
