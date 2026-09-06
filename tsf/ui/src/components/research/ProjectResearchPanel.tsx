import { useApi } from '@/lib/use-api'
import { api } from '@/lib/api'
import { LoadingState, ErrorState, EmptyState } from '@/components/States'
import { ResearchMissionCard } from './ResearchMissionCard'

// Project detail's "Research for this project" -- ResearchMissions
// attributed to THIS real project (see server/command-research-bridge.mjs's
// contextProjectId; a mission created via global Command stays under
// COMMAND_CHAT and never appears here). To start one, just type
// "research <topic>" in the chat panel on this page -- the same real
// research bridge Command's own "research X" already uses.
export function ProjectResearchPanel({ projectId }: { projectId: string }) {
  const { data: missions, loading, error, reload } = useApi(() => api.researchMissions(projectId), [projectId])

  if (loading && !missions) {
    return <LoadingState label="Loading research…" />
  }
  if (error && !missions) {
    return <ErrorState message={error} onRetry={reload} />
  }
  if (!missions || missions.length === 0) {
    return (
      <EmptyState
        title="No research yet for this project"
        description={'Type "research <topic>" in the chat panel to start one -- no separate research UI needed.'}
      />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {missions.map((m) => (
        <ResearchMissionCard key={m.missionId} item={m} linkToProject={false} />
      ))}
    </div>
  )
}
