import { useCallback, useEffect, useState } from 'react'
import { ApiError } from './api'

interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useApi<T>(fetcher: () => Promise<T>, deps: React.DependencyList): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Unavailable — could not reach the TSF operator API.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  useEffect(() => load(), [load])

  // Real, independently-discovered bug (reproduced via Operator Attention
  // V1, Wave 2's own real Playwright validation of HQPage.tsx -- pre-
  // existing, not introduced there): an inline arrow function here has a
  // NEW identity every render. A caller that composes several useApi
  // results into one useCallback (e.g. HQPage.tsx's `reloadAll`) and feeds
  // that into an effect keyed on it (useReloadOnDockActivity/
  // useForegroundPolling) got a real infinite render loop the instant a
  // fetch first settled: settling triggers one re-render -> `reload`'s
  // fresh identity makes the dependent effect re-run -> the effect calls
  // `reload()` -> `setTick` -> another re-render -> repeat forever. A
  // stable identity (useCallback, no deps -- `setTick`'s updater form
  // never needs the closure to change) fixes this at the root for every
  // caller, not just the one that happened to trip it first.
  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { data, loading, error, reload }
}
