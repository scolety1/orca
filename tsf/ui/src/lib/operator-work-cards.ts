import type { ProjectCard, ResearchMissionWorkItem } from './types'
import type { OwnerWorkItem, OwnerPrimaryState, OperatorSnapshot } from './operator-snapshot-types'

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
  // TSF UI FINDINGS #2-#16 RECONCILE & UPGRADE, Finding #5/#6/#7: the
  // settled 4-word model, straight off the canonical OwnerWorkItem -- the
  // bucket helpers below (activeCards/waitingCards/needsYouCards) key off
  // THIS, never `state`, so a paused or held project can never render
  // under "Active work" again.
  primaryState: OwnerPrimaryState
  primaryReasonLabel: string | null
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
    primaryState: item.primaryState,
    primaryReasonLabel: item.primaryReasonLabel,
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

// TSF UI FINDINGS #2-#16 RECONCILE & UPGRADE, Finding #5/#6/#7: the
// owner-facing "needs your attention" grouping now keys off primaryState,
// not the richer `state` -- NEEDS_YOU/FAILED/READY all collapse to
// primaryState NEEDS_YOU (owner-primary-state.mjs), exactly matching the
// prior NEEDS_YOU_STATES set UNLESS the project is also under a real
// execution hold, in which case the hold wins (primaryState WAITING) --
// consistent with the settled model's own priority ("a hold always wins"),
// and with Finding #6's own worked example (a held project reads WAITING,
// never NEEDS_YOU, even if it would otherwise need a decision).
export function needsYouCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.primaryState === 'NEEDS_YOU')
}

// Unchanged: a real, MORE SPECIFIC sub-state than the primary model
// collapses to -- HQ's own dedicated "Ready for adoption" tile needs the
// literal READY state, not just "this is some flavor of NEEDS_YOU".
export function readyForAdoptionCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.state === 'READY')
}

export function verifyingCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.state === 'VERIFYING')
}

// Finding #7's exact fix: "Active work" now means ONLY primaryState
// WORKING -- TSF genuinely progressing the work right now. A PAUSED run
// (or ANY run under a real execution hold, regardless of its own
// mechanical state) no longer renders here; it moves to waitingCards below
// instead, per the settled model's own explicit "Move it into WAITING and
// show the reason."
export function activeCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.primaryState === 'WORKING')
}

// Broadened from a literal `state === 'WAITING'` check to primaryState --
// now also covers PAUSED, an active execution hold, and PLANNING (see
// owner-primary-state.mjs's own mapping table for the full list and
// reasoning for each). `primaryReasonLabel` on each card is what lets the
// UI show WHY a given card is here (Paused / Execution hold / Resources /
// Preparing), matching the settled model's own secondary-label
// requirement. VERIFYING is deliberately excluded even though it also
// collapses to primaryState WAITING -- HQ already has its own dedicated
// "Verification / Adoption" section (verifyingCards above) for it; without
// this exclusion a verifying item would double-render in both sections.
export function waitingCards(cards: OperatorWorkCard[]): OperatorWorkCard[] {
  return cards.filter((c) => c.primaryState === 'WAITING' && c.state !== 'VERIFYING')
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
