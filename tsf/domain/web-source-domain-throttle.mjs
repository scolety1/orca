// Domain-aware throttling: tracks the last request time per hostname so
// concurrent/serial fetches to the same domain stay spaced out. Pure state
// object plus functions -- no timers -- so callers control waiting.

export function createDomainThrottleState() {
  return { lastRequestAtByHost: new Map() }
}

/**
 * Returns how many ms the caller must wait before hitting `hostname` again,
 * given `minIntervalMs` between requests to the same host. 0 means proceed now.
 */
export function msUntilDomainSlot(state, hostname, minIntervalMs, now) {
  const last = state.lastRequestAtByHost.get(hostname)
  if (last === undefined) {
    return 0
  }
  const elapsed = now - last
  return elapsed >= minIntervalMs ? 0 : minIntervalMs - elapsed
}

export function recordDomainRequest(state, hostname, now) {
  state.lastRequestAtByHost.set(hostname, now)
}

export function computeBackoffDelayMs(
  attempt,
  baseDelayMs,
  { maxDelayMs = 30_000, jitterFn = Math.random } = {}
) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
  const jitter = exponential * 0.2 * jitterFn()
  return Math.round(exponential + jitter)
}
