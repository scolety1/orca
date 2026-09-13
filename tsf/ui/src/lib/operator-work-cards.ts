import type { ProjectCard, ResearchMissionWorkItem } from './types'
import type { OwnerWorkItem, OperatorSnapshot } from './operator-snapshot-types'

// HQ Snapshot Migration (finish item A): the one real join this migration
// needs -- OwnerWorkItem (tsf/domain/owner-work-model.mjs) carries the
// canonical state/reason but only a bare projectId, never the display
// fields a card renders (name, health). ProjectCard (the SAME real
// projects array the snapshot already returns) has those. Joining them
// here is NOT reclassification: `state`/`reason` are consumed verbatim,
// never re-derived from either side -- this only recombines already-
// canonical fields into one shape for rendering, exactly like the legacy
// WorkItem = ProjectDetail & {liveWorkFeed, runId} shape it replaces used
// to do server-side inside summarizeWorkFromRuns. Project-kind items only
// (KEEP_GOING_RUN/PROJECT) -- a research item already carries everything
// ResearchMissionCard.tsx needs on the raw OwnerWorkItem itself (see
// researchWorkItems below), so lossily reshaping it through this narrower
// type would only lose fields, never gain anything.
export type OperatorWorkCard = {
  // The OwnerWorkItem's own globally-unique id (e.g. `run:x`, `legacy-
  // blocked:y`) -- safe as a React key even when a project legitimately
  // carries more than one simultaneous reason (a real, confirmed case --
  // see owner-work-model.mjs's own BUG-14 overlap test).
  id: string
  projectId: string
  displayName: string
  healthStatus: ProjectCard['healthStatus']
  state: OwnerWorkItem['state']
  reason: string
  runId: string | null
  availableActions: string[]
}

function toOperatorWorkCard(
  item: OwnerWorkItem,
  project: ProjectCard | undefined
): OperatorWorkCard {
  return {
    id: item.id,
    projectId: item.projectId ?? 'unknown',
    displayName: project?.displayName ?? item.projectId ?? 'Unknown project',
    healthStatus: project?.healthStatus ?? 'UNKNOWN',
    state: item.state,
    reason: item.reason,
    runId: item.runId ?? null,
    availableActions: item.availableActions
  }
}

// Type guard mirroring the legacy isResearchMissionWorkItem this migration
// replaces -- same purpose (split one combined work list back into its two
// real kinds for rendering), narrower input type (the snapshot's own real
// OwnerWorkItem, not the generic AnyWorkItem the legacy one accepted).
export function isResearchWorkItem(
  item: OwnerWorkItem
): item is OwnerWorkItem & ResearchMissionWorkItem {
  return item.kind === 'RESEARCH_MISSION'
}

export function projectWorkCards(snapshot: OperatorSnapshot): OperatorWorkCard[] {
  const byId = new Map(snapshot.projects.map((p) => [p.id, p]))
  return snapshot.work
    .filter((item) => !isResearchWorkItem(item))
    .map((item) => toOperatorWorkCard(item, item.projectId ? byId.get(item.projectId) : undefined))
}

export function researchWorkItems(snapshot: OperatorSnapshot): OwnerWorkItem[] {
  return snapshot.work.filter(isResearchWorkItem)
}

// The owner-facing "needs your attention" grouping -- NEEDS_YOU (includes
// legacy-blocked, already reconciled to the same word by owner-work-
// model.mjs) and FAILED (the real equivalent of the legacy `stalled`
// bucket, per Stage 1C's own RUN_FEED_TO_OWNER_STATE mapping) and READY
// (a real adoption decision is itself something that needs the owner) all
// land in one combined list, exactly like HQPage's own legacy
// buildHomeNeedsYouItems already folded needsYou+stalled+blocked+
// readyForAdoption together.
const NEEDS_YOU_STATES: ReadonlySet<OwnerWorkItem['state']> = new Set([
  'NEEDS_YOU',
  'FAILED',
  'READY'
])

export function needsYouCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => NEEDS_YOU_STATES.has(c.state))
}

export function readyForAdoptionCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.state === 'READY')
}

export function verifyingCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.state === 'VERIFYING')
}

// PLANNING/WORKING/PAUSED render under "Active work" -- WAITING is
// deliberately excluded here (its own "Waiting for resources" section,
// see waitingCards below), matching legacy RUN_FEED_SECTION exactly
// (PLANNING/WORKING/WAITING were all 'active' there, but HQPage's own
// pre-migration JSX already separately re-filtered WAITING out into its
// own section).
const ACTIVE_STATES: ReadonlySet<OwnerWorkItem['state']> = new Set([
  'PLANNING',
  'WORKING',
  'PAUSED'
])

export function activeCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => ACTIVE_STATES.has(c.state))
}

export function waitingCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.state === 'WAITING')
}

export function recentlyCompletedCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.state === 'DONE')
}

// A real, confirmed divergence this migration must preserve, not smooth
// over: legacy RESEARCH_PHASE_SECTION bucketed a research mission's own
// WAITING_FOR_RESOURCES phase into 'active' (no separate research waiting
// section exists), while a Keep Going run's WAITING gets its own
// "Waiting for resources" section (waitingCards above). PAUSED is
// excluded (the real production meaning is an operator cancel, which
// legacy RESEARCH_PHASE_SECTION bucketed under 'blocked', not 'active' --
// see owner-work-model.mjs's own BLOCKED reasoning).
const ACTIVE_RESEARCH_STATES: ReadonlySet<OwnerWorkItem['state']> = new Set([
  'PLANNING',
  'WORKING',
  'WAITING'
])

// Narrower parameter/return type than the other bucket helpers above
// (their own callers -- HQPage -- get an already-research-narrowed array
// straight out of `snapshot.work.filter(isResearchWorkItem)`, and every
// consumer of THESE results is ResearchMissionCard.tsx, which needs the
// research-only fields, not the wider OwnerWorkItem shape).
type ResearchWorkItem = OwnerWorkItem & ResearchMissionWorkItem

export function activeResearchItems(items: ResearchWorkItem[]): ResearchWorkItem[] {
  return items.filter((i) => ACTIVE_RESEARCH_STATES.has(i.state))
}

export function needsYouResearchItems(items: ResearchWorkItem[]): ResearchWorkItem[] {
  return items.filter((i) => i.state === 'NEEDS_YOU')
}

export function recentlyCompletedResearchItems(items: ResearchWorkItem[]): ResearchWorkItem[] {
  return items.filter((i) => i.state === 'DONE')
}
