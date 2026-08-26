// Mirrors tsf/domain/fleet-work-status.mjs's fleetWorkStatus() output --
// the one shared "what's really running" projection GET /api/fleet/status,
// GET /api/work, and Command's status answers all read from, so a status
// panel and a chat sentence can never disagree.
export type FleetWorkStatusItem = {
  projectId: string
  displayName: string
  hasRun: boolean
  feed: { state: string; reason: string } | null
  runId: string | null
}
