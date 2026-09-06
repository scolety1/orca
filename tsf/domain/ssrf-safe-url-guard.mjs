// SSRF-safe URL validation for the web source acquisition adapter.
// Scope: literal-IP and hostname-literal checks, plus DNS-resolution checks.
// Known limitation (documented, not solved here): no connection-time IP
// pinning, so a DNS-rebinding attack between validation and the actual fetch
// is not closed. Closing that fully needs a custom dispatcher/Agent with a
// connect hook -- out of V0 scope; see final report's unresolved-gaps list.

import dns from 'node:dns/promises'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32]
]

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip)
  if (value === null) {
    return false
  }
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => {
    const baseValue = ipv4ToInt(base)
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (value & mask) === (baseValue & mask)
  })
}

// Expands any valid textual IPv6 form (including "::" compression and an
// embedded dotted-quad in the last group) to its 8 16-bit groups. Needed
// because Node's URL parser serializes an IPv4-mapped address in hex form
// (e.g. "::ffff:7f00:1"), not the dotted-quad form a naive regex expects --
// matching only the dotted-quad form let a loopback/private IPv4-mapped
// address through unblocked.
function parseIpv6Groups(hostname) {
  const withoutZone = hostname.split('%')[0]
  const halves = withoutZone.split('::')
  if (halves.length > 2) {
    return null
  }
  const expandGroup = (group) => {
    if (!group.includes('.')) {
      return [group]
    }
    const value = ipv4ToInt(group)
    if (value === null) {
      return null
    }
    return [((value >>> 16) & 0xffff).toString(16), (value & 0xffff).toString(16)]
  }
  const expandSide = (side) => {
    if (side === '') {
      return []
    }
    const out = []
    for (const group of side.split(':')) {
      const expanded = expandGroup(group)
      if (expanded === null) {
        return null
      }
      out.push(...expanded)
    }
    return out
  }
  const left = expandSide(halves[0])
  const right = halves.length === 2 ? expandSide(halves[1]) : []
  if (left === null || right === null) {
    return null
  }
  let groups
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 0) {
      return null
    }
    groups = [...left, ...Array(missing).fill('0'), ...right]
  } else {
    groups = left
  }
  if (groups.length !== 8) {
    return null
  }
  const parsed = groups.map((g) => Number.parseInt(g, 16))
  return parsed.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : parsed
}

function ipv4FromLastTwoGroups(groups) {
  return `${(groups[6] >> 8) & 0xff}.${groups[6] & 0xff}.${(groups[7] >> 8) & 0xff}.${groups[7] & 0xff}`
}

function isBlockedIpv6(ip) {
  const groups = parseIpv6Groups(ip.toLowerCase())
  if (!groups) {
    return false
  }
  if (groups.every((g) => g === 0)) {
    return true
  } // :: unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) {
    return true
  } // ::1 loopback
  if ((groups[0] & 0xfe00) === 0xfc00) {
    return true
  } // fc00::/7 unique local
  if ((groups[0] & 0xffc0) === 0xfe80) {
    return true
  } // fe80::/10 link-local
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return isBlockedIpv4(ipv4FromLastTwoGroups(groups))
  } // ::ffff:0:0/96 IPv4-mapped
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return isBlockedIpv4(ipv4FromLastTwoGroups(groups))
  } // 64:ff9b::/96 NAT64
  return false
}

function isBlockedLiteralIp(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return isBlockedIpv4(hostname)
  }
  if (hostname.includes(':')) {
    return isBlockedIpv6(hostname.replace(/^\[|\]$/g, ''))
  }
  return false
}

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal']

/**
 * Structural validation only: scheme, credentials, literal-IP/hostname
 * denylist. Does not resolve DNS. Use assertPublicHttpUrl for the full check.
 */
export function validateUrlStructure(urlString) {
  let parsed
  try {
    parsed = new URL(urlString)
  } catch {
    return { ok: false, reason: 'INVALID_URL', detail: urlString }
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: 'UNSUPPORTED_PROTOCOL', detail: parsed.protocol }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'EMBEDDED_CREDENTIALS', detail: null }
  }
  const hostname = parsed.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return { ok: false, reason: 'BLOCKED_HOSTNAME', detail: hostname }
  }
  if (isBlockedLiteralIp(hostname)) {
    return { ok: false, reason: 'BLOCKED_IP_LITERAL', detail: hostname }
  }
  return { ok: true, url: parsed }
}

/**
 * Full check: structural validation, then resolve the hostname and reject if
 * any resolved address is private/loopback/link-local/reserved. Does not pin
 * the resolved address for the subsequent fetch -- see module header.
 */
export async function assertPublicHttpUrl(urlString, { resolveImpl = dns.lookup } = {}) {
  const structural = validateUrlStructure(urlString)
  if (!structural.ok) {
    return structural
  }
  const hostname = structural.url.hostname
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
    return { ok: true, url: structural.url, resolvedAddresses: [hostname] }
  }
  let addresses
  try {
    const result = await resolveImpl(hostname, { all: true, verbatim: true })
    addresses = Array.isArray(result) ? result.map((r) => r.address) : [result.address]
  } catch (error) {
    return { ok: false, reason: 'DNS_RESOLUTION_FAILED', detail: error.message }
  }
  const blocked = addresses.find((address) => isBlockedLiteralIp(address))
  if (blocked) {
    return { ok: false, reason: 'RESOLVES_TO_BLOCKED_ADDRESS', detail: blocked }
  }
  return { ok: true, url: structural.url, resolvedAddresses: addresses }
}
