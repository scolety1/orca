import { useApi } from './use-api'
import { api } from './api'

// Shared by StartMissionDialog.tsx and StartOvernightFleetDialog.tsx --
// previously duplicated byte-for-byte in both (an adversarial-review
// finding: two copies of the same sensitivity rule can silently drift).
// High Assurance is a reserved usage mode (usage-modes.v1.json has no
// config entry for it, and the server rejects it outright) -- this powers
// only the honest "required (reserved)" indicator on a sensitive project's
// row, never an offer to actually select it.
export function useSensitiveProjectIds(dependency: unknown) {
  const { data: portfolio } = useApi(() => api.portfolio(), [dependency])
  return new Set(
    (portfolio?.knownProjects ?? [])
      .filter((p) => p.migrationClassification === 'SENSITIVE')
      .map((p) => p.id)
  )
}
