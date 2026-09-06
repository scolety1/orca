// Retrieves a single origin's /robots.txt using the existing bounded,
// SSRF-safe fetch primitive unmodified -- redirect re-validation, timeout,
// byte cap, and retry all come from bounded-http-fetch.mjs as-is. This file
// only adds robots-specific limits (a small byte cap, text/plain content
// type) and the explicit acquisition user-agent token, without touching the
// already-adopted primitive's public contract.

import { fetchBounded } from './bounded-http-fetch.mjs'

export const TSF_WEB_ACQUISITION_USER_AGENT =
  'TsfWebSourceAcquisitionBot/0.1 (+web-table-source-adapter)'

const ROBOTS_MAX_BYTES = 512 * 1024 // RFC 9309 §2.5 recommends crawlers cap parsing at some limit; 512KB is generous for a robots.txt

/**
 * Fetches `origin`'s /robots.txt. Wraps the caller's fetchImpl (default
 * global fetch) to add the acquisition user-agent header -- bounded-http-
 * fetch.mjs itself stays untouched.
 */
export function fetchRobotsTxt(origin, { fetchOptions = {} } = {}) {
  const baseFetchImpl = fetchOptions.fetchImpl ?? fetch
  const userAgentFetchImpl = (url, init) =>
    baseFetchImpl(url, {
      ...init,
      headers: { ...init?.headers, 'User-Agent': TSF_WEB_ACQUISITION_USER_AGENT }
    })
  const robotsUrl = new URL('/robots.txt', origin).toString()
  return fetchBounded({
    ...fetchOptions,
    url: robotsUrl,
    fetchImpl: userAgentFetchImpl,
    maxResponseBytes: ROBOTS_MAX_BYTES,
    allowedContentTypes: ['text/plain']
  })
}
