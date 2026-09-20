import { isResearchMissionWorkItem, type WorkSummary } from '@/lib/types'

// Hands-Free Command + Project Manager V1: the focused project's own
// display name, resolved from whatever real WorkSummary data the
// background-work line already fetches (never a second, dedicated fetch
// just for a label) -- falls back to the bare id (still real, informative)
// if the project isn't in any currently-fetched bucket (e.g. a fully
// DONE/quiet project with no active/waiting/needsYou entry). Split out of
// CommandPanel.tsx purely to stay under this repo's max-lines budget.
export function resolveFocusDisplayName(work: WorkSummary | null, focusProjectId: string): string {
  if (!work) {
    return focusProjectId
  }
  for (const bucket of [work.active, work.waiting, work.needsYou, work.verifying, work.queued]) {
    for (const item of bucket) {
      if (!isResearchMissionWorkItem(item) && item.id === focusProjectId) {
        return item.displayName
      }
    }
  }
  return focusProjectId
}
