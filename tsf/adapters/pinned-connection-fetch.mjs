// Connection-time DNS-rebinding protection. Resolves and SSRF-validates a
// hostname once (reusing ssrf-safe-url-guard.mjs unchanged), then forces
// the actual TCP/TLS connection to exactly that vetted address via
// node:http(s)'s `lookup` override -- closing the window where a
// rebinding/malicious DNS answer could otherwise be returned between
// validation and connect. Zero new dependencies: node:http/https/stream
// only.
//
// This is a drop-in fetchImpl for bounded-http-fetch.mjs (same (url, init)
// => Response contract as global fetch), not a replacement for it -- byte
// cap, timeout, content-type allowlist, retry, and per-hop re-validation
// all still come from bounded-http-fetch.mjs unchanged. This module only
// changes how the socket is opened. Passing it as `fetchOptions.fetchImpl`
// is opt-in; the adapter's default (global fetch) is untouched, preserving
// Main TSF's existing adoption of bounded-http-fetch.mjs as-is.
//
// Host header and TLS SNI: node's http(s).request derives both from the
// `hostname` option, which this module never rewrites -- only the
// `lookup` answer changes, so the server still sees the real hostname and
// TLS still validates the certificate against it. `rejectUnauthorized` is
// never touched (stays at its secure default). Verified live against a
// real HTTPS host during design (see the module's test file for the
// mocked, offline equivalent): pinning to the real resolved address
// succeeds with a valid, authorized TLS handshake; pinning to a
// non-routable address times out rather than silently reaching a
// different server -- the override is real, not superficial.

import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { assertPublicHttpUrl } from '../domain/ssrf-safe-url-guard.mjs'

export class RebindingDetectedError extends Error {
  constructor(remoteAddress, vettedAddresses) {
    super(
      `connected socket address ${remoteAddress} was not among the vetted addresses [${vettedAddresses.join(', ')}]`
    )
    this.name = 'RebindingDetectedError'
    this.remoteAddress = remoteAddress
    this.vettedAddresses = vettedAddresses
  }
}

/** Pure check, unit-testable without any real socket. */
export function isRemoteAddressVetted(remoteAddress, vettedAddresses) {
  return vettedAddresses.includes(remoteAddress)
}

function toWebHeaders(nodeHeaders) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) {
      continue
    }
    for (const single of Array.isArray(value) ? value : [value]) {
      headers.append(key, single)
    }
  }
  return headers
}

/**
 * Builds a node:dns-lookup-shaped function that always answers with
 * `vettedAddresses`, tagging each with its own address family -- never a
 * single family guessed from the first entry, which mistags minority-family
 * addresses in a mixed IPv4/IPv6 (dual-stack) vetted list.
 */
export function buildPinnedLookup(vettedAddresses) {
  const familyOf = (address) => (address.includes(':') ? 6 : 4)
  return (_hostname, options, callback) =>
    options?.all
      ? callback(
          null,
          vettedAddresses.map((address) => ({ address, family: familyOf(address) }))
        )
      : callback(null, vettedAddresses[0], familyOf(vettedAddresses[0]))
}

/**
 * Connects to exactly one of `vettedAddresses` (never re-resolving `url`'s
 * hostname) and returns a Response. Callers must have already vetted these
 * addresses themselves -- this function trusts them as given, which is why
 * it is exported separately from createPinnedFetch below: it lets a test
 * exercise the actual socket-pinning mechanism against a local server
 * without also going through (and being correctly rejected by) the SSRF
 * loopback blocklist that a real caller always sits behind.
 */
export function pinConnectionToAddresses(url, init, vettedAddresses) {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? https : http
  const lookup = buildPinnedLookup(vettedAddresses)

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: init?.method ?? 'GET',
        headers: init?.headers,
        agent: false, // never reuse a pooled socket from a prior, differently-vetted request
        lookup,
        signal: init?.signal
      },
      (res) => {
        const remoteAddress = res.socket.remoteAddress
        if (!isRemoteAddressVetted(remoteAddress, vettedAddresses)) {
          req.destroy()
          reject(new RebindingDetectedError(remoteAddress, vettedAddresses))
          return
        }
        resolve(
          new Response(Readable.toWeb(res), {
            status: res.statusCode,
            headers: toWebHeaders(res.headers)
          })
        )
      }
    )
    req.on('error', reject)
    req.end()
  })
}

/**
 * A (url, init) => Promise<Response> function, matching global fetch's
 * contract, suitable as bounded-http-fetch.mjs's `fetchImpl`. Rejects with
 * an SSRF-style error before any connection if validation fails; rejects
 * with RebindingDetectedError if the socket that actually connects is not
 * one of the addresses vetted immediately before connecting.
 */
export function createPinnedFetch({ resolveImpl } = {}) {
  if (resolveImpl !== undefined && typeof resolveImpl !== 'function') {
    throw new TypeError('createPinnedFetch: resolveImpl, if given, must be a function')
  }
  return async function fetchWithConnectionPinning(url, init = {}) {
    const validation = await assertPublicHttpUrl(url, resolveImpl ? { resolveImpl } : {})
    if (!validation.ok) {
      throw Object.assign(new Error(`${validation.reason}: ${validation.detail}`), {
        code: 'SSRF_BLOCKED',
        reason: validation.reason,
        detail: validation.detail
      })
    }
    return pinConnectionToAddresses(url, init, validation.resolvedAddresses)
  }
}
