import { useEffect, useRef } from 'react'

// HQ Snapshot Migration (finish item A): the fast path onto GET
// /api/operator-events (tsf/server/operator-snapshot-http-routes.mjs) --
// on any real revision change, calls `onRevisionChange` (the caller's own
// job is simply to refetch the snapshot, never to trust the SSE payload
// itself as data, mirroring that route's own stated contract). Honest
// degrade, not a second correctness mechanism: a connection that never
// opens or drops (proxy strips SSE, offline, dev-server quirk) leaves this
// hook silently inert -- useForegroundPolling (composed alongside this by
// every real caller) is the existing, independent correctness backstop
// that already covers exactly this case, so there is no retry/backoff
// logic to build or get wrong here.
export function useOperatorEvents(onRevisionChange: () => void) {
  const onRevisionChangeRef = useRef(onRevisionChange)
  onRevisionChangeRef.current = onRevisionChange

  useEffect(() => {
    let closed = false
    let source: EventSource | null = null
    try {
      source = new EventSource('/api/operator-events')
    } catch {
      // A browser/environment that cannot construct EventSource at all
      // (none known today, but never assumed) -- the polling backstop
      // still covers correctness.
      return
    }
    source.onmessage = () => {
      if (!closed) {
        onRevisionChangeRef.current()
      }
    }
    source.onerror = () => {
      // A genuinely dead connection never auto-recovers past the
      // browser's own built-in reconnect attempts forever -- rather than
      // build a second, independent reconnect/backoff policy, close it
      // once and rely on the polling backstop from here on. Never surfaced
      // to the operator as an error: a slower refresh is not a failure.
      source?.close()
    }
    return () => {
      closed = true
      source?.close()
    }
  }, [])
}
