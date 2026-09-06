import test from 'node:test'
import assert from 'node:assert/strict'
import { validateUrlStructure, assertPublicHttpUrl } from '../domain/ssrf-safe-url-guard.mjs'

test('accepts a normal https URL structurally', () => {
  assert.equal(validateUrlStructure('https://example.com/stats').ok, true)
})

test('rejects a non-http(s) scheme', () => {
  const result = validateUrlStructure('file:///etc/passwd')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'UNSUPPORTED_PROTOCOL')
})

test('rejects an unparseable URL', () => {
  assert.equal(validateUrlStructure('not a url').ok, false)
})

test('rejects embedded credentials', () => {
  const result = validateUrlStructure('https://user:pass@example.com/')
  assert.equal(result.reason, 'EMBEDDED_CREDENTIALS')
})

test('rejects localhost and .internal/.local suffixes', () => {
  assert.equal(validateUrlStructure('http://localhost/x').ok, false)
  assert.equal(validateUrlStructure('http://service.internal/x').ok, false)
  assert.equal(validateUrlStructure('http://box.local/x').ok, false)
})

test('rejects IPv4 loopback, private, link-local and CGNAT literals', () => {
  for (const host of [
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.1.1',
    '100.64.0.1'
  ]) {
    assert.equal(validateUrlStructure(`http://${host}/`).ok, false, host)
  }
})

test('rejects IPv6 loopback and unique-local literals', () => {
  assert.equal(validateUrlStructure('http://[::1]/').ok, false)
  assert.equal(validateUrlStructure('http://[fd00::1]/').ok, false)
})

test('accepts a plausible public IPv4 literal', () => {
  assert.equal(validateUrlStructure('http://93.184.216.34/').ok, true)
})

test('rejects an IPv4-mapped IPv6 loopback literal, including its hex-serialized form', () => {
  // Node's URL parser normalizes an IPv4-mapped literal to hex groups
  // (::ffff:7f00:1), not the dotted-quad form -- both must be blocked.
  assert.equal(validateUrlStructure('http://[::ffff:127.0.0.1]/').ok, false)
  assert.equal(validateUrlStructure('http://[::ffff:7f00:1]/').ok, false)
})

test('rejects an IPv4-mapped IPv6 private-range literal', () => {
  assert.equal(validateUrlStructure('http://[::ffff:a00:1]/').ok, false) // ::ffff:10.0.0.1
})

test('rejects the NAT64 well-known-prefix mapping of a blocked IPv4 address', () => {
  assert.equal(validateUrlStructure('http://[64:ff9b::7f00:1]/').ok, false) // 64:ff9b::127.0.0.1
})

test('accepts a public IPv4-mapped IPv6 literal', () => {
  assert.equal(validateUrlStructure('http://[::ffff:5db8:d822]/').ok, true) // ::ffff:93.184.216.34
})

test('assertPublicHttpUrl blocks a hostname that resolves to a private address', async () => {
  const result = await assertPublicHttpUrl('https://internal.example.com/', {
    resolveImpl: async () => [{ address: '10.0.0.1' }]
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'RESOLVES_TO_BLOCKED_ADDRESS')
})

test('assertPublicHttpUrl allows a hostname resolving only to public addresses', async () => {
  const result = await assertPublicHttpUrl('https://example.com/', {
    resolveImpl: async () => [{ address: '93.184.216.34' }]
  })
  assert.equal(result.ok, true)
})

test('assertPublicHttpUrl surfaces a DNS failure as a distinct, fail-closed reason', async () => {
  const result = await assertPublicHttpUrl('https://nowhere.invalid/', {
    resolveImpl: async () => {
      throw new Error('ENOTFOUND')
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'DNS_RESOLUTION_FAILED')
})
