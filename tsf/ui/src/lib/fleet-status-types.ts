// Mirrors tsf/domain/fleet-work-status.mjs's fleetWorkStatus() output --
// the one shared "what's really running" projection GET /api/fleet/status,
// GET /api/work, and Command's status answers all read from, so a status
// panel and a chat sentence can never disagree.
//
// TSF REAL-PILOT READINESS CLOSURE V1, Round 2 Finding #17: `primaryState`/
// `primaryReasonLabel` were always present on the real API response
// (fleet-work-status.mjs computes them via the same canonical
// keepGoingRunWorkItem() every other surface reads) but never declared
// here, so CommandPage.tsx read the older `feed.state`/`feed.reason`
// instead -- the one owner-facing panel that never migrated. `feed`
// stays for its own richer detail sentence (`feed.reason`), never as the
// primary status word.
export type FleetWorkStatusItem = {
  projectId: string
  displayName: string
  hasRun: boolean
  feed: { state: string; reason: string } | null
  primaryState: string | null
  primaryReasonLabel: string | null
  runId: string | null
}
