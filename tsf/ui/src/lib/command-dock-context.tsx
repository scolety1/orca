import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

// Global Command Dock V1: open/closed state and the current route's
// bounded project context live here, ABOVE the router's per-route pages
// (provided once in App.tsx, read by AppShell/GlobalCommandDock and set by
// ProjectDetailPage) -- so the SAME CommandPanel instance and its
// conversation survive route navigation instead of remounting per page.
type RouteContext = { projectId: string; displayName: string } | null

type CommandDockContextValue = {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  routeContext: RouteContext
  setRouteContext: (ctx: RouteContext) => void
  // Bumped once per real durable mutation the dock's own CommandPanel
  // causes (a real dispatch, a real mission created/continued) -- an
  // immediate, best-effort nudge for whichever page is currently mounted
  // (HQ/Work) to refresh right away, on top of useForegroundPolling's
  // bounded backstop for changes that land later (e.g. the fleet driver's
  // own next tick moving a mission from CREATED to EXECUTING).
  activityTick: number
  notifyActivity: () => void
}

const CommandDockContext = createContext<CommandDockContextValue | null>(null)

export function CommandDockProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [routeContext, setRouteContext] = useState<RouteContext>(null)
  const [activityTick, setActivityTick] = useState(0)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  const notifyActivity = useCallback(() => setActivityTick((t) => t + 1), [])
  const value = useMemo(
    () => ({ isOpen, open, close, toggle, routeContext, setRouteContext, activityTick, notifyActivity }),
    [isOpen, open, close, toggle, routeContext, activityTick, notifyActivity]
  )
  return <CommandDockContext.Provider value={value}>{children}</CommandDockContext.Provider>
}

export function useCommandDock() {
  const ctx = useContext(CommandDockContext)
  if (!ctx) {
    throw new Error('useCommandDock must be used within a CommandDockProvider')
  }
  return ctx
}

// HQ/Work's own convenience: re-fetches once, immediately, whenever the
// dock reports real activity -- skips the very first render (mounting
// already triggers useApi's own initial fetch).
export function useReloadOnDockActivity(reload: () => void) {
  const { activityTick } = useCommandDock()
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) {
      reload()
    }
    mounted.current = true
  }, [activityTick, reload])
}

// ProjectDetailPage's own convenience: sets route context on mount/update,
// clears it on unmount (leaving the project page) -- a project page that
// fails to load never leaves a stale "Context: X" chip behind.
export function useSetCommandDockRouteContext(ctx: RouteContext) {
  const { setRouteContext } = useCommandDock()
  const projectId = ctx?.projectId ?? null
  const displayName = ctx?.displayName ?? null
  useEffect(() => {
    setRouteContext(projectId && displayName ? { projectId, displayName } : null)
    return () => setRouteContext(null)
  }, [projectId, displayName, setRouteContext])
}
