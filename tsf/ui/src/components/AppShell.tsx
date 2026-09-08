import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Compass, FolderKanban, LayoutGrid, Menu, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { CapacityIndicator } from '@/components/CapacityIndicator'
import { SystemStatusIndicator } from '@/components/SystemStatusIndicator'
import { GlobalRunStatusIndicator } from '@/components/GlobalRunStatusIndicator'
import { GlobalCommandDock } from '@/components/command/GlobalCommandDock'

// Operator IA consolidation V1: normal navigation converges on these four
// destinations (goals/durable objects, not implementation subsystems) --
// Command, Agents, Evaluation, Fleet, and Health Repair Center remain real,
// reachable routes (deep links + More's own links), just out of PRIMARY
// nav. Command itself is now primarily reached via the persistent Global
// Command Dock (rendered below, every normal screen), not a nav item.
const NAV = [
  { to: '/', label: 'HQ', icon: LayoutGrid, end: true },
  { to: '/work', label: 'Work', icon: Compass },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/more', label: 'More', icon: MoreHorizontal }
]
// Advanced/legacy routes reachable via More or a deep link, highlighted as
// "More" being active in the sidebar so the operator isn't left with no
// nav item highlighted while on one of them.
const ADVANCED_ROUTE_PREFIXES = ['/command', '/agents', '/evaluation', '/fleet', '/health-repair']

type Meta = Awaited<ReturnType<typeof api.meta>>

// Shared between the desktop rail and the mobile off-canvas drawer so nav
// items, active-state logic, and the global attention indicators never
// drift between the two. `onNavigate` closes the drawer on link click.
function SidebarContent({ onAdvancedRoute, meta, onNavigate }: { onAdvancedRoute: boolean; meta: Meta | null; onNavigate?: () => void }) {
  return (
    <>
      <div className="mb-6 flex items-center gap-2 px-5">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary/20 text-primary shadow-[0_0_16px_rgba(145,97,249,0.35)]">
          <span className="text-sm font-bold">⛵</span>
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-semibold tracking-tight">Thousand Sunny Fleet</span>
          <span className="text-[10px] text-muted-foreground">Orca Foundation</span>
        </div>
      </div>
      {/* Only this inner list scrolls if the nav itself ever outgrows
          the viewport (e.g. a very short window) -- the header above
          and the footer below stay pinned, per the "if the sidebar
          itself exceeds available height, only its inner content
          scrolls" requirement. */}
      <nav className="tsf-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                // "More" also lights up on an advanced route reached via a
                // deep link (e.g. /fleet) so the operator is never left
                // with no nav item highlighted at all.
                (isActive || (to === '/more' && onAdvancedRoute)) && 'bg-secondary text-secondary-foreground'
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-4 flex shrink-0 flex-col gap-2 px-3">
        <GlobalRunStatusIndicator />
        <SystemStatusIndicator />
        <CapacityIndicator />
        <div className="flex flex-col gap-1 px-2 text-[10px] text-muted-foreground">
          {meta && (
            <>
              <span>Orca {meta.upstreamVersion}</span>
              <span>{meta.upstreamCoreFilesModified} core files modified</span>
            </>
          )}
        </div>
      </div>
    </>
  )
}

export function AppShell() {
  const { data: meta } = useApi(() => api.meta(), [])
  const { pathname } = useLocation()
  const onAdvancedRoute = ADVANCED_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const [navOpen, setNavOpen] = useState(false)

  return (
    // Real V1 stabilization finding (Operator UX pass): the sidebar used to
    // live inside a `min-h-screen` flex row with no height cap, so once main
    // content grew taller than the viewport the WHOLE row grew with it and
    // the sidebar scrolled away with the page instead of staying put. Fixed
    // by capping the shell itself at the viewport (`h-screen overflow-hidden`
    // here) so the sidebar's own `h-full` genuinely means "the viewport,"
    // and giving `<main>` sole ownership of vertical scrolling.
    <div className="relative h-screen overflow-hidden">
      <div className="tsf-ambient-glow" />
      {/* Real dogfood finding (narrow-viewport pass): the fixed 224px rail
          below caused horizontal clipping of the whole app at phone widths
          (~375px), with no way to reach nav. Below `md` it collapses into a
          compact top bar whose trigger opens the same nav in an off-canvas
          drawer; at `md` and up the layout is the prior desktop behavior. */}
      <div className="relative z-10 flex h-full flex-col md:flex-row">
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-card/40 px-4 py-2.5 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary/20 text-primary">
              <span className="text-xs font-bold">⛵</span>
            </div>
            <span className="text-[13px] font-semibold tracking-tight">Thousand Sunny Fleet</span>
          </div>
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
                <Menu className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent className="tsf-scrollbar overflow-y-auto">
              <SheetTitle>Navigation</SheetTitle>
              <SidebarContent onAdvancedRoute={onAdvancedRoute} meta={meta} onNavigate={() => setNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </header>
        <aside className="hidden h-full w-56 shrink-0 flex-col border-r border-border bg-card/40 py-4 md:flex">
          <SidebarContent onAdvancedRoute={onAdvancedRoute} meta={meta} />
        </aside>
        <main className="tsf-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <GlobalCommandDock />
    </div>
  )
}
