import { useEffect } from 'react'

// Real, live-discovered staleness bug (Global Command Dock V1 pilot
// evidence): Tim created a ResearchMission through Command; HQ's own
// onActivity refresh fired once, immediately -- while the mission was
// still phase CREATED (invisible by design, see work-feed-summary.mjs's
// "started must mean something real"). Nothing ever refreshed again once
// the fleet driver's own next tick (~30s later) actually moved it to
// EXECUTING, so "Active research: 0" stayed stuck indefinitely with no
// user action to unstick it. Bounded, foreground-only polling (never SSE/
// websockets) -- capped interval, pauses when the tab is hidden, stops
// entirely on unmount -- closes that gap generically for any durable
// mutation, not just this one path.
export function useForegroundPolling(reload: () => void, intervalMs = 15000) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    function start() {
      if (timer == null && document.visibilityState === 'visible') {
        timer = setInterval(reload, intervalMs)
      }
    }
    function stop() {
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        start()
      } else {
        stop()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [reload, intervalMs])
}
