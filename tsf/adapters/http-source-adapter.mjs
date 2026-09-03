// Generic, domain-neutral HTTP source-first acquisition adapter. Distinct
// from the BoundedResearchWorker seam -- this is for bulk, one-shot
// fetches of a real, license-clear source (an API, an open dataset), NOT
// for targeted AI-driven deep research. Mirrors the same {ok:true,...} |
// {ok:false, reason, detail} envelope convention every other adapter in
// this codebase uses. No credential handling here -- callers needing auth
// inject their own fetch headers via `init`.
import { createHash } from 'node:crypto'
import { isoNow } from '../domain/canonical.mjs'

// Fetches one URL and returns a durable-shaped snapshot: content hash for
// immutable-reuse detection (research library/cache semantics), never a
// parsed/interpreted structure -- parsing is a separate, source-specific
// concern layered on top, not this adapter's job.
export async function fetchSourceSnapshot({ url, init = {}, fetchImpl = fetch, clock } = {}) {
  let response
  try {
    response = await fetchImpl(url, init)
  } catch (error) {
    return { ok: false, reason: 'NETWORK_ERROR', detail: error.message }
  }
  if (!response.ok) {
    return { ok: false, reason: 'HTTP_ERROR', detail: `HTTP ${response.status}`, httpStatus: response.status }
  }
  const rawContent = await response.text()
  const contentHash = `sha256:${createHash('sha256').update(rawContent, 'utf8').digest('hex')}`
  return {
    ok: true,
    snapshot: {
      sourceRef: url,
      url,
      httpStatus: response.status,
      contentHash,
      rawContent,
      retrievedAt: isoNow(clock)
    }
  }
}
