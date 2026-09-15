import { Badge } from '@/components/ui/badge'
import type { OwnerPrimaryState } from '@/lib/operator-snapshot-types'
import type { ProjectCard } from '@/lib/types'

// TSF UI FINDINGS #2-#16 CLOSURE, Gate 3A: this badge previously read
// classifyProjectLifecycle's own separate 8-bucket vocabulary (project-
// lifecycle.ts), which also folded health into the lifecycle word
// (NEEDS_REPAIR) -- the exact "same project, different label on the
// Projects card than everywhere else" gap Finding #5 named. Now reads
// project.primaryState/primaryReasonLabel directly, the same canonical
// WORKING/WAITING/NEEDS_YOU/DONE collapse HQ/Work/Command/Overview already
// render. project-lifecycle.ts's own bucket system is intentionally left
// unchanged for LifecycleFilterBar.tsx/sortProjects -- internal filter/
// sort richness (Finding #5's own "internal fidelity" allowance), not a
// second owner-facing status label.
const VARIANT: Record<OwnerPrimaryState, 'healthy' | 'neutral' | 'degraded'> = {
  WORKING: 'healthy',
  WAITING: 'neutral',
  NEEDS_YOU: 'degraded',
  DONE: 'neutral'
}

export function LifecycleBadge({ project }: { project: ProjectCard }) {
  const label = project.primaryReasonLabel ?? project.primaryState.replace('_', ' ')
  return <Badge variant={VARIANT[project.primaryState]}>{label}</Badge>
}
