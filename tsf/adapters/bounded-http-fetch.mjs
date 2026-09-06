// Bounded HTTP retrieval for the web table source adapter: SSRF-safe,
// timeout- and size-limited, content-type validated, redirect-checked,
// bounded-retry fetch. This is the only module in the acquisition path that
// performs network I/O -- everything downstream operates on its plain result.
//
// Size-bounded body reading follows the same "read then cancel on overflow"
// shape as src/shared/fetch-response-body.ts elsewhere in this repo (a
// different package/runtime, not importable from this zero-dependency
// workspace, so the pattern is repeated rather than shared).

import { assertPublicHttpUrl } from '../domain/ssrf-safe-url-guard.mjs'
import {
  computeBackoffDelayMs,
  msUntilDomainSlot,
  recordDomainRequest
} from '../domain/web-source-domain-throttle.mjs'

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml']
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MIN_DOMAIN_INTERVAL_MS = 500

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504])

async function readBoundedText(response, maxResponseBytes) {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxResponseBytes) {
    return { ok: false, reason: 'RESPONSE_TOO_LARGE', detail: `content-length ${contentLength}` }
  }
  if (!response.body) {
    return { ok: true, text: await response.text(), bytesRead: 0 }
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytesRead = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    bytesRead += value.byteLength
    if (bytesRead > maxResponseBytes) {
      await reader.cancel('response-too-large').catch(() => {})
      return {
        ok: false,
        reason: 'RESPONSE_TOO_LARGE',
        detail: `exceeded ${maxResponseBytes} bytes`
      }
    }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8')
  return { ok: true, text, bytesRead }
}

function contentTypeAllowed(contentTypeHeader, allowedContentTypes) {
  if (!contentTypeHeader) {
    return false
  }
  const mimeType = contentTypeHeader.split(';')[0].trim().toLowerCase()
  return allowedContentTypes.includes(mimeType)
}

async function fetchOnce({
  url,
  fetchImpl,
  timeoutMs,
  allowedContentTypes,
  maxResponseBytes,
  resolveImpl
}) {
  const validation = await assertPublicHttpUrl(url, resolveImpl ? { resolveImpl } : {})
  if (!validation.ok) {
    return {
      ok: false,
      reason: 'SSRF_BLOCKED',
      detail: `${validation.reason}: ${validation.detail}`
    }
  }

  let response
  try {
    response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return { ok: false, reason: 'TIMEOUT', detail: `${timeoutMs}ms` }
    }
    return { ok: false, reason: 'NETWORK_ERROR', detail: error.message }
  }

  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    const location = new URL(response.headers.get('location'), url).toString()
    return { ok: true, redirect: location, httpStatus: response.status }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'HTTP_ERROR',
      detail: `status ${response.status}`,
      httpStatus: response.status,
      retryable: RETRYABLE_HTTP_STATUSES.has(response.status)
    }
  }

  const contentType = response.headers.get('content-type')
  if (!contentTypeAllowed(contentType, allowedContentTypes)) {
    return { ok: false, reason: 'UNSUPPORTED_CONTENT_TYPE', detail: contentType }
  }

  const body = await readBoundedText(response, maxResponseBytes)
  if (!body.ok) {
    return body
  }

  return {
    ok: true,
    httpStatus: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    contentType,
    bodyText: body.text,
    bytesRead: body.bytesRead
  }
}

/**
 * Fetches `url` with SSRF validation, a bounded manual redirect chain, a
 * content-type allowlist, a byte-size cap, per-domain throttling, and
 * exponential-backoff retry on transient failures.
 */
export async function fetchBounded({
  url,
  fetchImpl = fetch,
  resolveImpl,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  allowedContentTypes = DEFAULT_ALLOWED_CONTENT_TYPES,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  minDomainIntervalMs = DEFAULT_MIN_DOMAIN_INTERVAL_MS,
  domainThrottleState,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = () => Date.now(),
  jitterFn
}) {
  const redirectChain = []
  let currentUrl = url
  let attempts = 0
  let lastFailure = null

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts++
      if (domainThrottleState) {
        const hostname = new URL(currentUrl).hostname
        const wait = msUntilDomainSlot(domainThrottleState, hostname, minDomainIntervalMs, clock())
        if (wait > 0) {
          await sleepImpl(wait)
        }
        recordDomainRequest(domainThrottleState, hostname, clock())
      }

      const result = await fetchOnce({
        url: currentUrl,
        fetchImpl,
        timeoutMs,
        allowedContentTypes,
        maxResponseBytes,
        resolveImpl
      })

      if (result.ok && result.redirect) {
        redirectChain.push({ from: currentUrl, to: result.redirect, httpStatus: result.httpStatus })
        currentUrl = result.redirect
        lastFailure = null
        break // move to next redirect hop, resetting the retry loop
      }

      if (result.ok) {
        return {
          ok: true,
          finalUrl: currentUrl,
          redirectChain,
          attempts,
          httpStatus: result.httpStatus,
          headers: result.headers,
          contentType: result.contentType,
          bodyText: result.bodyText,
          bytesRead: result.bytesRead
        }
      }

      lastFailure = result
      const retryable =
        result.reason === 'NETWORK_ERROR' || result.reason === 'TIMEOUT' || result.retryable
      if (!retryable || attempt === maxAttempts) {
        break
      }
      await sleepImpl(computeBackoffDelayMs(attempt, baseDelayMs, jitterFn ? { jitterFn } : {}))
    }

    if (lastFailure) {
      return {
        ok: false,
        reason: lastFailure.reason,
        detail: lastFailure.detail,
        httpStatus: lastFailure.httpStatus,
        attempts,
        redirectChain,
        finalUrl: currentUrl
      }
    }
  }

  return {
    ok: false,
    reason: 'TOO_MANY_REDIRECTS',
    detail: `exceeded ${maxRedirects} redirects`,
    attempts,
    redirectChain,
    finalUrl: currentUrl
  }
}
