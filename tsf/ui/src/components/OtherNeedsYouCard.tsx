import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { projectDeepLinkTo } from '@/lib/project-work-deep-link'
import type { OtherNeedsYouItem } from '@/lib/home-needs-you-items'

const KIND_LABEL: Record<OtherNeedsYouItem['kind'], string> = {
  PLANNER_MISSION_NEEDS_YOU: 'Planner',
  SELF_IMPROVEMENT_FINDING: 'Self-improvement'
}

// HQPage.tsx dispatches PLANNER_MISSION_NEEDS_YOU/SELF_IMPROVEMENT_FINDING
// to their own real, inline-resolvable cards before ever reaching this one.
export function OtherNeedsYouCard({ item }: { item: OtherNeedsYouItem }) {
  const cardBody = (
    <Card className="border-status-degraded/40 bg-status-degraded/5 transition-colors hover:border-status-degraded/70">
      <CardContent className="flex items-center justify-between gap-2 p-3">
        <div>
          <div className="text-sm font-medium">{item.label}</div>
          <div className="text-xs text-muted-foreground">{item.reason}</div>
        </div>
        <Badge variant="degraded">{KIND_LABEL[item.kind]}</Badge>
      </CardContent>
    </Card>
  )
  return item.projectId ? <Link to={projectDeepLinkTo(item.projectId)}>{cardBody}</Link> : cardBody
}
