import { Link } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { humanizeResearchPhase } from '@/lib/orchestration-terminology'
import { formatRelativeTime } from '@/lib/relative-time'
import type { ResearchMissionSummary, ResearchMissionWorkItem } from '@/lib/types'

const PHASE_BADGE_VARIANT: Record<string, 'primary' | 'healthy' | 'degraded' | 'blocked' | 'neutral'> = {
  CREATED: 'neutral',
  EXECUTING: 'primary',
  WAITING_NEEDS_INPUT: 'degraded',
  COMPLETE: 'healthy',
  BLOCKED: 'blocked'
}

// Renders either the thin Work-feed shape (ResearchMissionWorkItem) or the
// richer /api/research list shape (ResearchMissionSummary) -- both carry
// the same real fields, just from two different real reads (see
// tsf/domain/work-feed-summary.mjs and readAllResearchMissionSummaries).
type Item = ResearchMissionWorkItem | ResearchMissionSummary

export function ResearchMissionCard({ item, now, linkToProject = true }: { item: Item; now?: Date; linkToProject?: boolean }) {
  const title = item.researchQuestion ?? item.missionId
  // linkToProject=false when already on that project's own page (e.g. its
  // Research tab) -- linking back to the same page is a dead loop.
  const linkable = linkToProject && item.projectId && item.projectId !== 'COMMAND_CHAT'
  const body = (
    <Card className="transition-colors hover:border-primary/50">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-1.5 text-sm leading-snug">
          <FlaskConical className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="line-clamp-2">{title}</span>
        </CardTitle>
        <Badge variant={PHASE_BADGE_VARIANT[item.phase] ?? 'neutral'}>{humanizeResearchPhase(item.phase)}</Badge>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>Research</span>
        {item.expectedCount != null && <span>{item.expectedCount} expected item{item.expectedCount === 1 ? '' : 's'}</span>}
        {item.freePathOnly && <span>Free-path only</span>}
        <span>Last activity {formatRelativeTime(item.updatedAt, now)}</span>
      </CardContent>
    </Card>
  )
  return linkable ? (
    <Link to={`/projects/${item.projectId}?tab=research`} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}
