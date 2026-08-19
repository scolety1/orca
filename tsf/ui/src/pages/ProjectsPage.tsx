import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Plus } from 'lucide-react'
import { useApi } from '@/lib/use-api'
import { api, ApiError } from '@/lib/api'
import { LoadingState, ErrorState } from '@/components/States'
import { ProjectCard } from '@/components/ProjectCard'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

export function ProjectsPage() {
  const navigate = useNavigate()
  const { data: portfolio, loading, error, reload } = useApi(() => api.portfolio(), [])
  const { data: routing, reload: reloadRouting } = useApi(() => api.routing(), [])
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  async function setMode(mode: string) {
    setSwitching(mode)
    setSwitchError(null)
    try {
      await api.setUsageMode(mode)
      reload()
      reloadRouting()
    } catch (err) {
      setSwitchError(err instanceof ApiError ? err.message : 'Could not change Usage Mode.')
    } finally {
      setSwitching(null)
    }
  }

  if (loading) return <LoadingState label="Loading Projects…" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!portfolio) return null

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Known Projects, Active Fleet, and Work Set. Usage Mode governs routing and budgets only — never repository authority.</p>
        </div>
        <Button size="sm" onClick={() => navigate('/projects/add')}>
          <Plus className="size-4" /> Add Project
        </Button>
      </header>

      {routing && (
        <div className="mb-8">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Usage Mode</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {Object.keys(routing.usageModes).map((mode) => (
              <button
                key={mode}
                disabled={switching !== null}
                onClick={() => setMode(mode)}
                className={cn(
                  'min-w-0 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors disabled:opacity-50',
                  mode === routing.activeUsageMode ? 'border-primary bg-primary/10 text-foreground shadow-[0_0_0_1px_rgba(145,97,249,0.3)]' : 'border-border text-muted-foreground hover:border-primary/40'
                )}
              >
                <div className="truncate font-medium">{mode.replace('_', ' ')}</div>
                <div className="mt-0.5 truncate text-[10px] opacity-70">{routing.usageModes[mode].plannerTier}</div>
              </button>
            ))}
            <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0" />
              <div>
                <div className="font-medium">High Assurance</div>
                <div className="text-[10px] opacity-70">Reserved</div>
              </div>
            </div>
          </div>
          {switchError && <div className="mt-2 text-xs text-destructive">{switchError}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {portfolio.knownProjects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>

      <Card className="mt-8">
        <CardContent className="flex items-center justify-between p-4 text-xs text-muted-foreground">
          <span>Active Fleet: {portfolio.activeFleet.length} of {portfolio.knownProjects.length} known projects</span>
          <span>Work Set: {portfolio.workSet.length}</span>
        </CardContent>
      </Card>
    </div>
  )
}
