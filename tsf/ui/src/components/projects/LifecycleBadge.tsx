import { Badge } from '@/components/ui/badge'
import { classifyProjectLifecycle, LIFECYCLE_LABEL } from '@/lib/project-lifecycle'
import type { ProjectCard } from '@/lib/types'

const VARIANT: Record<
  string,
  'healthy' | 'degraded' | 'blocked' | 'primary' | 'neutral' | 'unknown'
> = {
  NEEDS_YOU: 'degraded',
  NEEDS_REPAIR: 'degraded',
  READY_FOR_WORK: 'healthy',
  WORKING: 'primary',
  READY_FOR_ADOPTION: 'primary',
  PAUSED: 'neutral',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown'
}

export function LifecycleBadge({ project }: { project: ProjectCard }) {
  const bucket = classifyProjectLifecycle(project)
  return <Badge variant={VARIANT[bucket]}>{LIFECYCLE_LABEL[bucket]}</Badge>
}
