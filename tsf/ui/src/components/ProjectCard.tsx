import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusChip } from '@/components/StatusChip'
import type { ProjectCard as ProjectCardModel } from '@/lib/types'

const MISSION_LABEL: Record<string, string> = {
  ADOPTED: 'Adopted',
  BLOCKED: 'Blocked',
  BLOCKED_ARCHITECTURAL_CONFLICT: 'Blocked',
  READY_FOR_ADOPTION: 'Ready for adoption',
  UNKNOWN: 'Unknown'
}

function shortTesting(testing: string) {
  if (testing.includes('GREEN')) return 'GREEN'
  if (testing.includes('BLOCKED')) return 'BLOCKED'
  if (testing.includes('UNKNOWN')) return 'UNKNOWN'
  return testing.split('_')[0]
}

export function ProjectCard({ project }: { project: ProjectCardModel }) {
  return (
    <Link to={`/projects/${project.id}`} className="group block">
      <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-card/80">
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-1.5">
              <span className="truncate">{project.displayName}</span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </CardTitle>
            <div className="mt-1.5 flex items-center gap-1.5">
              {project.sourceClass === 'FIXTURE' ? <Badge variant="fixture">Fixture</Badge> : <Badge variant="neutral">Real project</Badge>}
              <span className="truncate text-[11px] text-muted-foreground">{MISSION_LABEL[project.missionState] ?? project.missionState}</span>
            </div>
          </div>
          <StatusChip status={project.healthStatus} className="shrink-0" />
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="shrink-0 font-mono">{project.release.stable.head?.slice(0, 10) ?? 'no stable head'}</span>
          <span className="shrink-0 truncate rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide">{shortTesting(project.release.testing)}</span>
        </CardContent>
      </Card>
    </Link>
  )
}
