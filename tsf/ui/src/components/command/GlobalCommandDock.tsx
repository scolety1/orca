import { Link, useLocation } from 'react-router-dom'
import { Maximize2, MessageSquareText, Minus } from 'lucide-react'
import { CommandPanel } from './CommandPanel'
import { useCommandDock } from '@/lib/command-dock-context'
import { Button } from '@/components/ui/button'

// Routes the persistent dock button appears on -- HQ, Work, Projects
// (list/add/detail), More. Command's own full page already IS this
// composer full-width; Agents/Evaluation/Fleet/Health Repair Center are
// dense, advanced surfaces the dock would only clutter.
function isDockRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/work' || pathname === '/more' || pathname.startsWith('/projects')
}

// Global Command Dock V1: the SAME CommandPanel every route already had
// access to (HQ's embedded copy, the full /command page) -- one instance,
// mounted once here, never unmounted on route change, so the conversation
// genuinely survives navigation. Only its VISIBILITY (button vs. floating
// panel vs. hidden) changes per route; no second engine, no duplicated
// dispatch path.
export function GlobalCommandDock() {
  const { isOpen, open, close, routeContext, notifyActivity } = useCommandDock()
  const { pathname } = useLocation()
  const onDockRoute = isDockRoute(pathname)
  const showButton = onDockRoute && !isOpen
  const showPanel = onDockRoute && isOpen

  return (
    <>
      {showButton && (
        <button
          onClick={open}
          aria-label="Open Command"
          className="fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageSquareText className="size-5" />
        </button>
      )}
      {/* Always mounted once opened -- `hidden` (not conditional removal)
          keeps CommandPanel's own state alive while navigating to a
          non-dock route and back. */}
      <div
        hidden={!showPanel}
        className="fixed bottom-5 right-5 z-40 flex h-[min(600px,calc(100vh-100px))] w-[min(400px,calc(100vw-40px))] flex-col overflow-hidden rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between gap-1 rounded-t-xl border border-b-0 border-border bg-card px-2 py-1.5">
          <Link
            to="/command"
            onClick={close}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Open full-page Command"
          >
            <Maximize2 className="size-3" />
            Full view
          </Link>
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Minimize Command">
            <Minus className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <CommandPanel onActivity={notifyActivity} routeContext={routeContext} />
        </div>
      </div>
    </>
  )
}
