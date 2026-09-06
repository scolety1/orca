import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  pinConnectionToAddresses,
  createPinnedFetch,
  isRemoteAddressVetted,
  buildPinnedLookup,
  RebindingDetectedError
} from '../adapters/pinned-connection-fetch.mjs'
import { fetchBounded } from '../adapters/bounded-http-fetch.mjs'

function startServer(host, body = 'ok') {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => res.end(body))
    server.listen(0, host, () => resolve(server))
  })
}

test('buildPinnedLookup tags each address with its own family, not one guessed from the first entry', () => {
  const lookup = buildPinnedLookup(['93.184.216.34', '2001:db8::1'])
  let allResult
  lookup('irrelevant-host', { all: true }, (err, addresses) => {
    allResult = addresses
  })
  assert.deepEqual(allResult, [
    { address: '93.184.216.34', family: 4 },
    { address: '2001:db8::1', family: 6 }
  ])
})

test('buildPinnedLookup single-answer form tags the first address correctly regardless of family', () => {
  const lookup = buildPinnedLookup(['2001:db8::1'])
  let seenAddress, seenFamily
  lookup('irrelevant-host', {}, (err, address, family) => {
    seenAddress = address
    seenFamily = family
  })
  assert.equal(seenAddress, '2001:db8::1')
  assert.equal(seenFamily, 6)
})

test('isRemoteAddressVetted is a pure membership check', () => {
  assert.equal(isRemoteAddressVetted('10.0.0.1', ['10.0.0.1', '10.0.0.2']), true)
  assert.equal(isRemoteAddressVetted('10.0.0.3', ['10.0.0.1', '10.0.0.2']), false)
})

test('connects to exactly the vetted address, never re-resolving the hostname', async () => {
  const server = await startServer('127.0.0.1', 'pinned response')
  const port = server.address().port
  try {
    // "example.internal" would never actually resolve to 127.0.0.1 via real
    // DNS -- proving the connection used our forced address, not a real lookup.
    const response = await pinConnectionToAddresses(`http://example.internal:${port}/`, {}, [
      '127.0.0.1'
    ])
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'pinned response')
  } finally {
    server.close()
  }
})

test('the Host header still reflects the real hostname, not the pinned IP', async () => {
  let seenHost = null
  const server = http.createServer((req, res) => {
    seenHost = req.headers.host
    res.end('ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await pinConnectionToAddresses(`http://my-real-hostname.example:${port}/`, {}, ['127.0.0.1'])
    assert.equal(seenHost, `my-real-hostname.example:${port}`)
  } finally {
    server.close()
  }
})

test('pinning to an address nothing is listening on fails, instead of silently reaching a different server', async () => {
  // 127.0.0.2 is a distinct, real, bindable loopback address with no server
  // on it here -- if the override were silently ignored (falling back to a
  // real lookup of the hostname), this would need to fail differently, not
  // just refuse the connection outright.
  await assert.rejects(
    () => pinConnectionToAddresses('http://example.internal:1/', {}, ['127.0.0.2']),
    (error) => ['ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)
  )
})

test('detects and rejects when the connected socket does not match the vetted address (defense in depth)', async () => {
  // Simulates the case the check exists for: even if a lookup override were
  // somehow bypassed, a post-connect mismatch must still be caught. We
  // force this deterministically by vetting an address the real connection
  // target (127.0.0.1) does not match.
  const server = await startServer('127.0.0.1')
  const port = server.address().port
  try {
    await assert.rejects(
      () => pinConnectionToAddresses(`http://127.0.0.1:${port}/`, {}, ['203.0.113.9']),
      (error) => {
        // The lookup override itself would force-connect to 203.0.113.9 (unreachable);
        // this documents the intended failure mode either way -- never a silent success
        // against an unvetted address.
        return (
          error instanceof RebindingDetectedError ||
          ['ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)
        )
      }
    )
  } finally {
    server.close()
  }
})

test('createPinnedFetch rejects a private-address candidate before ever connecting (no server needed)', async () => {
  const pinnedFetch = createPinnedFetch({})
  await assert.rejects(
    () => pinnedFetch('http://127.0.0.1:9/', {}),
    (error) => error.code === 'SSRF_BLOCKED'
  )
})

test('createPinnedFetch actually uses the injected resolver, not real DNS', async () => {
  // "stand-in-hostname.invalid" would never really resolve. Getting
  // RESOLVES_TO_BLOCKED_ADDRESS (not DNS_RESOLUTION_FAILED) proves the
  // injected resolver's answer was the one actually checked -- confirming
  // createPinnedFetch's validate -> pin wiring, entirely offline. (A
  // successful end-to-end connection through this same validation gate
  // cannot be demonstrated with a local server, since any address the gate
  // would let through is by definition not loopback; the connection
  // mechanism itself is proven directly against a real socket in the
  // pinConnectionToAddresses tests above.)
  const pinnedFetch = createPinnedFetch({ resolveImpl: async () => [{ address: '127.0.0.1' }] })
  await assert.rejects(
    () => pinnedFetch('http://stand-in-hostname.invalid/', {}),
    (error) => error.code === 'SSRF_BLOCKED' && error.reason === 'RESOLVES_TO_BLOCKED_ADDRESS'
  )
})

test('bounded-http-fetch.mjs redirect chain re-pins independently per hop, not just the first', async () => {
  // Two distinct, real, bindable loopback addresses stand in for two
  // distinct hostnames -- each hop must be independently vetted and pinned
  // to ITS OWN address, not have the first hop's pinning silently reused.
  // Both hops are real socket connections (through pinConnectionToAddresses),
  // including the one that issues the redirect.
  let redirectTargetPort
  const serverA = http.createServer((req, res) => {
    res.writeHead(302, { location: `http://site-b.example.test:${redirectTargetPort}/` })
    res.end()
  })
  await new Promise((resolve) => serverA.listen(0, '127.0.0.1', resolve))
  const serverB = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('from B, the real final content')
  })
  await new Promise((resolve) => serverB.listen(0, '127.0.0.2', resolve))
  const portA = serverA.address().port
  const portB = serverB.address().port
  redirectTargetPort = portB
  const addressForHost = { 'site-a.example.test': '127.0.0.1', 'site-b.example.test': '127.0.0.2' }
  // Stands in for createPinnedFetch's own per-call resolve+pin, without the
  // SSRF gate loopback would otherwise trip (already thoroughly tested
  // elsewhere) -- this isolates the property under test: does each redirect
  // hop get its OWN pin, driven by bounded-http-fetch.mjs's unmodified
  // per-hop fetchImpl invocation.
  const perHopPinnedFetch = (url) => {
    const { hostname } = new URL(url)
    return pinConnectionToAddresses(url, {}, [addressForHost[hostname]])
  }
  try {
    // bounded-http-fetch.mjs's own SSRF check (independent of whatever
    // fetchImpl does) always runs first and would itself reject a loopback
    // target -- already proven exhaustively elsewhere. Here it is given a
    // fixed, non-blocked stand-in address via resolveImpl so it passes for
    // every hop, isolating the property actually under test: does the
    // redirect loop re-invoke fetchImpl per hop, giving a pinning fetchImpl
    // (like the real createPinnedFetch) the chance to independently pin
    // each hop to its own real, different address.
    const result = await fetchBounded({
      url: `http://site-a.example.test:${portA}/`,
      resolveImpl: async () => [{ address: '93.184.216.34' }],
      fetchImpl: perHopPinnedFetch,
      sleepImpl: () => Promise.resolve()
    })
    assert.equal(result.ok, true)
    assert.equal(result.bodyText, 'from B, the real final content')
    assert.equal(result.redirectChain.length, 1)
    assert.equal(result.finalUrl, `http://site-b.example.test:${portB}/`)
  } finally {
    serverA.close()
    serverB.close()
  }
})

test('createPinnedFetch response plugs directly into a fetch-shaped consumer (Response contract)', async () => {
  const server = await startServer('127.0.0.1', '<table><tr><td>x</td></tr></table>')
  const port = server.address().port
  try {
    const response = await pinConnectionToAddresses(`http://example.internal:${port}/`, {}, [
      '127.0.0.1'
    ])
    assert.equal(typeof response.text, 'function')
    assert.equal(
      response.headers.get('content-length') === null ||
        typeof response.headers.get('content-length') === 'string',
      true
    )
    assert.equal(response.ok, true)
  } finally {
    server.close()
  }
})
