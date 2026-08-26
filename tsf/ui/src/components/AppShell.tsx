import { NavLink, Outlet } from 'react-router-dom'
import {
  CalendarClock,
  Compass,
  FlaskConical,
  FolderKanban,
  LayoutGrid,
  MessageSquareText,
  Stethoscope,
  TerminalSquare
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { CapacityIndicator } from '@/components/CapacityIndicator'
import { SystemStatusIndicator } from '@/components/SystemStatusIndicator'

const NAV = [
  { to: '/', label: 'Home', icon: LayoutGrid, end: true },
  { to: '/command', label: 'Command', icon: MessageSquareText },
  { to: '/work', label: 'Work', icon: Compass },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/agents', label: 'Agents', icon: TerminalSquare },
  { to: '/evaluation', label: 'Evaluation', icon: FlaskConical },
  { to: '/fleet', label: 'Fleet', icon: CalendarClock },
  { to: '/health-repair', label: 'Health Repair', icon: Stethoscope }
]

export function AppShell() {
  const { data: meta } = useApi(() => api.meta(), [])

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
      <div className="relative z-10 flex h-full">
        <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/40 py-4">
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
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring',
                    isActive && 'bg-secondary text-secondary-foreground'
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-4 flex shrink-0 flex-col gap-2 px-3">
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
        </aside>
        <main className="tsf-scrollbar min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
