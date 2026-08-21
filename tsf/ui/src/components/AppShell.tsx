import { NavLink, Outlet } from 'react-router-dom'
import { Compass, FlaskConical, FolderKanban, LayoutGrid, TerminalSquare } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'

const NAV = [
  { to: '/', label: 'Home', icon: LayoutGrid, end: true },
  { to: '/work', label: 'Work', icon: Compass },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/agents', label: 'Agents', icon: TerminalSquare },
  { to: '/evaluation', label: 'Evaluation', icon: FlaskConical }
]

export function AppShell() {
  const { data: meta } = useApi(() => api.meta(), [])

  return (
    <div className="relative min-h-screen">
      <div className="tsf-ambient-glow" />
      <div className="relative z-10 flex min-h-screen">
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card/40 px-3 py-4">
          <div className="mb-6 flex items-center gap-2 px-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/20 text-primary shadow-[0_0_16px_rgba(145,97,249,0.35)]">
              <span className="text-sm font-bold">⛵</span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[13px] font-semibold tracking-tight">Thousand Sunny Fleet</span>
              <span className="text-[10px] text-muted-foreground">Orca Foundation</span>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
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
          <div className="mt-auto flex flex-col gap-1 px-2 pt-4 text-[10px] text-muted-foreground">
            {meta && (
              <>
                <span>Orca {meta.upstreamVersion}</span>
                <span>{meta.upstreamCoreFilesModified} core files modified</span>
              </>
            )}
          </div>
        </aside>
        <main className="min-w-0 flex-1 tsf-scrollbar overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
