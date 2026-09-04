import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/StatusChip'
import { LifecycleBadge } from '@/components/projects/LifecycleBadge'
import { explainProject } from '@/lib/project-lifecycle'
import type { ProjectCard as ProjectCardModel } from '@/lib/types'
import { cn } from '@/lib/cn'

function shortTesting(testing: string) {
  if (testing.includes('GREEN')) {
    return 'GREEN'
  }
  if (testing.includes('BLOCKED')) {
    return 'BLOCKED'
  }
  if (testing.includes('UNKNOWN')) {
    return 'UNKNOWN'
  }
  return testing.split('_')[0]
}

// Operator UX pass (spec section 5): a card must answer "is this actually
// unhealthy, is it intentional, can TSF work on it, why/why not, what's
// next" -- not just show a bare status enum. `explainProject` reuses the
// same real facts (blockedReason, restrictions, the top health finding)
// the detail page already renders.
export function ProjectCard({
  project,
  selectable = false,
  selected = false,
  onToggleSelect
}: {
  project: ProjectCardModel
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const { why, next } = explainProject(project)
  return (
    <Card
      className={cn(
        'h-full transition-colors',
        selected && 'border-primary/60 bg-primary/5 shadow-[0_0_0_1px_rgba(145,97,249,0.3)]'
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {selectable && (
            <input
              type="checkbox"
              className="mt-1 size-3.5 shrink-0 accent-primary"
              checked={selected}
              onChange={() => onToggleSelect?.(project.id)}
              aria-label={`Select ${project.displayName}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <Link to={`/projects/${project.id}`} className="group/link flex items-center gap-1.5">
              <CardTitle className="truncate">{project.displayName}</CardTitle>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100" />
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <LifecycleBadge project={project} />
              {project.sourceClass === 'FIXTURE' && <Badge variant="fixture">Fixture</Badge>}
              {/* BUG-03 (bug-ledger.json): activeFleet/workSet were already
                  on this card's own data (types.ts) but never rendered --
                  an operator selecting/bulk-acting on projects here had no
                  way to see current membership without opening each
                  project's own detail page. Only shown when true, to keep
                  the common non-member case uncluttered. */}
              {project.activeFleet && (
                <Badge variant="neutral" title="TSF actively manages/monitors this project">
                  Fleet
                </Badge>
              )}
              {project.workSet && (
                <Badge variant="neutral" title="TSF may dispatch new work for this project">
                  Work Set
                </Badge>
              )}
            </div>
          </div>
        </div>
        <StatusChip status={project.healthStatus} className="shrink-0" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {why && <p className="text-xs text-muted-foreground">{why}</p>}
        {next && <p className="text-[11px] text-primary/90">Next: {next}</p>}
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-mono">
            {project.release.stable.head?.slice(0, 10) ?? 'no stable head'}
          </span>
          <span className="shrink-0 truncate rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide">
            {shortTesting(project.release.testing)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
