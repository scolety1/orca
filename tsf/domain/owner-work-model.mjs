// TSF_PRE_UI_PLATFORM_COHERENCE_V1, Stage 3: ONE owner-facing Work
// projection. Reconciles the rich, subsystem-specific states
// (live-work-feed.mjs's 9-value run vocabulary, research-mission.mjs's
// phase vocabulary) into the owner's own smaller, stable vocabulary --
// never re-derives a classification these modules already own, only
// re-labels their real output. React/UI code must consume THIS, never
// independently infer "this probably means waiting" from a raw subsystem
// state -- that inference belongs here, in one place, so every owner
// surface reads the same answer.
//
// QUEUED is deliberately absent: work-feed-summary.mjs's own `queued`
// bucket is permanently empty (no real domain signal backs it, confirmed
// and asserted by its own test) -- omitted rather than fabricated, per
// this mission's own explicit instruction.
import { compareStateToGoal } from './keep-going.mjs'
import { projectLiveWorkFeedState } from './live-work-feed.mjs'
import { computeResearchMissionPhase } from './research-mission.mjs'

export const OWNER_WORK_STATES = Object.freeze([
  'PLANNING',
  'WORKING',
  'WAITING',
  'VERIFYING',
  'NEEDS_YOU',
  'READY',
  'DONE',
  'FAILED',
  'PAUSED'
])

// live-work-feed.mjs's own 9-value vocabulary, reconciled down to the
// owner's -- PLANNING/WORKING/WAITING/VERIFYING/NEEDS_YOU already share the
// same word and pass through unchanged.
const RUN_FEED_TO_OWNER_STATE = Object.freeze({
  REVISION: 'VERIFYING', // a further wave is pending on verification feedback -- still a verification-driven state, not a new one
  STALLED: 'FAILED', // "something needs an operator decision because it stopped making progress" -- the real equivalent of FAILED in this vocabulary (established and tested in Stage 1C's cross-projection-parity.test.mjs)
  READY_FOR_ADOPTION: 'READY',
  COMPLETED: 'DONE'
})

// research-mission.mjs's own phase vocabulary, reconciled down to the
// owner's.
const RESEARCH_PHASE_TO_OWNER_STATE = Object.freeze({
  DRAFT: 'PLANNING',
  CREATED: 'PLANNING',
  EXECUTING: 'WORKING',
  WAITING_FOR_RESOURCES: 'WAITING',
  WAITING_NEEDS_INPUT: 'NEEDS_YOU',
  COMPLETE: 'DONE',
  // BLOCKED's one real production path is cancelResearchMissionDurable
  // (research-mission-driver.mjs), itself only ever invoked as a genuine
  // OPERATOR-INITIATED cancel (reason OPERATOR_CANCELLED/
  // OPERATOR_CHAT_CANCEL, confirmed by reading every real caller) -- a
  // deliberate stop, not a failure of the mission's own progress. The
  // real analog is a PAUSED Keep Going run (owner-initiated, not itself
  // needing further attention), not FAILED.
  BLOCKED: 'PAUSED'
})

// `advancedEntry`: work-feed-summary.mjs's own real-adoption-awareness
// evidence (project-canonical-base-store.mjs's ADVANCED history, keyed by
// missionId === run.id) -- passed in, never re-derived here, so this stays
// the ONE real check for "has this exact run already been adopted"
// (finding #11's own precedent). `run.state === 'PAUSED'` is checked BEFORE
// consulting the live-feed classifier, because projectLiveWorkFeedState
// collapses PAUSED/resource-wait/dispatch-tick-lock into the same WAITING
// word -- the owner model needs PAUSED to stay its own distinct state.
export function keepGoingRunWorkItem(run, { gap = null, advancedEntry = null } = {}) {
  let state
  let reason
  if (advancedEntry) {
    state = 'DONE'
    reason = 'a real adoption merge landed for this run'
  } else if (run.state === 'PAUSED') {
    state = 'PAUSED'
    reason = 'run state is PAUSED'
  } else {
    const feed = projectLiveWorkFeedState(run, gap)
    state = RUN_FEED_TO_OWNER_STATE[feed.state] ?? feed.state
    reason = feed.reason
  }
  return {
    id: `run:${run.id}`,
    projectId: run.projectId,
    goalId: null, // reserved for Stage 6 (Goal -> Work hierarchy) -- not fabricated
    kind: 'KEEP_GOING_RUN',
    parentId: null,
    state,
    reason,
    progress: { wavesCompleted: run.waves.length },
    startedAt: run.createdAt,
    updatedAt: advancedEntry?.at ?? run.updatedAt,
    availableActions: keepGoingAvailableActions(run, state),
    // HQ Snapshot Migration (finish item A): `run.id` verbatim -- a real
    // field a caller building a deep link needs (e.g. the existing
    // projectDeepLinkTo(id, {tab, runId})), not something a caller should
    // ever parse back out of `id` above (that string's exact prefix shape
    // is this module's own internal id-uniqueness convention, not a public
    // contract).
    runId: run.id
  }
}

// Mirrors the real, already-shipped KeepGoingPanel.tsx's own canPause/
// canResume gates exactly (run.state === 'ACTIVE'/'NEEDS_YOU'/'STALLED' can
// pause; run.state === 'PAUSED' can resume) -- never a second, independently-
// derived policy. HOLD/RELEASE_HOLD are always offered (a hold is
// orthogonal to the run's own mechanical state, per Stage 1C's own HELD
// parity finding); ADOPT only once genuinely READY.
function keepGoingAvailableActions(run, ownerState) {
  const actions = []
  if (['ACTIVE', 'NEEDS_YOU', 'STALLED'].includes(run.state)) {
    actions.push('PAUSE')
  }
  if (run.state === 'PAUSED') {
    actions.push('RESUME')
  }
  if (ownerState === 'READY') {
    actions.push('ADOPT')
  }
  actions.push('HOLD', 'RELEASE_HOLD')
  return actions
}

// Reconciliation note (not fixed here, out of this bounded stage's scope):
// research-mission.mjs also defines a real mission.state === 'PAUSED' and a
// real pauseResearchMission mutator, but computeResearchMissionPhase has no
// branch for it (falls through to the resource-wait/DRAFT/CREATED/EXECUTING
// checks) -- a real, pre-existing gap. Currently unreachable in production:
// grep confirms pauseResearchMission has NO real caller anywhere (same
// "domain-layer-only" shape as keep-going.mjs's own resolveNeedsYou, see
// this mission's own Stage 2 Phase 4/5 reconciliation). If a future stage
// wires a real "pause research" caller, computeResearchMissionPhase needs a
// mission.state === 'PAUSED' branch (owner state: PAUSED, matching BLOCKED's
// own reasoning below) before this function can honestly report it.
export function researchMissionWorkItem(mission) {
  const phase = computeResearchMissionPhase(mission)
  const state = RESEARCH_PHASE_TO_OWNER_STATE[phase]
  if (!state) {
    throw new Error(`owner-work-model: unknown research mission phase ${phase}`)
  }
  return {
    id: `research:${mission.id}`,
    projectId: mission.projectId ?? null,
    goalId: null,
    kind: 'RESEARCH_MISSION',
    parentId: null,
    state,
    reason: researchMissionReason(mission, phase),
    progress: { nodeCount: mission.nodes.length },
    startedAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    availableActions: researchAvailableActions(mission.state),
    // HQ Snapshot Migration (finish item A): the SAME real passthrough
    // fields work-feed-summary.mjs's own researchMissionWorkItem already
    // carries -- ResearchMissionCard.tsx (the one real, already-shared
    // renderer for a research item on HQ/Work/Project-detail) reads these
    // directly; `phase` alongside the owner `state` above rather than
    // instead of it, since ResearchMissionCard's badge vocabulary is the
    // subsystem phase, not the owner-reconciled word, and duplicating that
    // renderer's own contract here would be a real second implementation,
    // not a reuse.
    missionId: mission.id,
    phase,
    researchQuestion: mission.specification?.researchQuestion ?? null,
    entityType: mission.specification?.entityType ?? null,
    expectedCount: mission.expectedUniverse?.expectedCount ?? null,
    freePathOnly: (mission.specification?.budget?.maxCostUsd ?? 0) === 0
  }
}

function researchMissionReason(mission, phase) {
  if (phase === 'WAITING_FOR_RESOURCES') {
    const cp = mission.checkpoints.at(-1)
    return `waiting for host resources: ${cp?.note ?? cp?.reason ?? 'resource pressure'}`
  }
  if (phase === 'BLOCKED') {
    return mission.transitions?.at(-1)?.reason ?? 'mission was cancelled'
  }
  return `research mission phase is ${phase}`
}

// Mirrors research-mission.mjs's own real MISSION_ALLOWED transition
// table (ACTIVE -> NEEDS_YOU/PAUSED/COMPLETE/BLOCKED) -- CANCEL_RESEARCH
// only offered from a non-terminal state (COMPLETE/BLOCKED have no
// outgoing transition at all).
function researchAvailableActions(missionState) {
  return ['COMPLETE', 'BLOCKED'].includes(missionState) ? [] : ['CANCEL_RESEARCH']
}

// Overnight Completion, finish item A: work-feed-summary.mjs's own
// legacyActive/legacyReadyForAdoption/legacyRecentlyCompleted -- the
// classification for a project with NO real Keep Going run at all,
// unchanged from the original pre-Keep-Going summarizeWork (see that
// module's own header). Without this, a run-less onboarding-time project
// (freshly onboarded and ACTIVE, or already ADOPTED through the legacy
// candidate flow, with no run ever created) silently disappeared from
// buildOwnerWorkItems entirely -- a real, disclosed gap this mission's own
// Stage 5/operator-snapshot work would otherwise have quietly regressed
// once HQ stopped also independently fetching /api/work. Reuses the SAME
// two real fields (`project.mission.state`, `project.candidate?.state`)
// work-feed-summary.mjs checks, never a new classification.
const LEGACY_MISSION_STATE_TO_OWNER_STATE = Object.freeze({
  ACTIVE: 'WORKING',
  PLANNING: 'PLANNING',
  REVIEW: 'VERIFYING'
})

function legacyMissionStateWorkItem(project) {
  const state = LEGACY_MISSION_STATE_TO_OWNER_STATE[project.mission.state]
  if (state) {
    return {
      id: `legacy-mission:${project.id}`,
      projectId: project.id,
      goalId: null,
      kind: 'PROJECT',
      parentId: null,
      state,
      reason: `legacy mission state is ${project.mission.state} (no Keep Going run exists yet)`,
      progress: null,
      startedAt: null,
      updatedAt: null,
      availableActions: []
    }
  }
  if (project.mission.state === 'ADOPTED') {
    return {
      id: `legacy-mission:${project.id}`,
      projectId: project.id,
      goalId: null,
      kind: 'PROJECT',
      parentId: null,
      state: 'DONE',
      reason: 'adopted (legacy candidate flow)',
      progress: null,
      startedAt: null,
      updatedAt: project.receipts?.chain?.at(-1)?.timestamp ?? null,
      availableActions: []
    }
  }
  return null
}

// Independent of the mission-state check above (a real, disclosed
// possibility work-feed-summary.mjs's own loop already allows: a run-less
// project can be simultaneously legacyActive AND legacyReadyForAdoption --
// `mission.state` and `candidate.state` are different fields) -- a
// distinct id so both can coexist for the same project, exactly like
// work-feed-summary.mjs's own project appearing in two buckets at once.
function legacyCandidateReadinessWorkItem(project) {
  if (project.candidate?.state !== 'READY_FOR_ADOPTION') {
    return null
  }
  return {
    id: `legacy-candidate:${project.id}`,
    projectId: project.id,
    goalId: null,
    kind: 'PROJECT',
    parentId: null,
    state: 'READY',
    reason: 'candidate is ready for your adoption decision (no Keep Going run exists yet)',
    progress: null,
    startedAt: null,
    updatedAt: null,
    availableActions: ['ADOPT']
  }
}

// work-feed-summary.mjs's own `blocked` bucket -- the one legacy
// classification that is NOT gated on "no run exists" (a project can be
// legacy-BLOCKED and have an active Keep Going run at the same time; see
// that module's own header and BUG-14's real, independently-confirmed
// overlap finding). Mapped to NEEDS_YOU, the same treatment HQPage.tsx's
// own buildHomeNeedsYouItems already gives it today (folded into the same
// "needs you" list as needsYou/stalled/readyForAdoption) -- re-labeled,
// never re-derived: the underlying check is the identical real
// `mission.state.startsWith('BLOCKED')` test work-feed-summary.mjs uses.
function legacyBlockedWorkItem(project) {
  if (!(project.mission.state ?? '').startsWith('BLOCKED')) {
    return null
  }
  return {
    id: `legacy-blocked:${project.id}`,
    projectId: project.id,
    goalId: null,
    kind: 'PROJECT',
    parentId: null,
    state: 'NEEDS_YOU',
    reason: project.mission.blockedReason ?? `legacy mission state is ${project.mission.state}`,
    progress: null,
    startedAt: null,
    updatedAt: null,
    availableActions: []
  }
}

// The one real aggregation entry point -- mirrors work-feed-summary.mjs's
// own iteration shape (fleetWorkStatus's per-project loop +
// Object.values(researchMissions)) exactly, so a future caller (Stage 5's
// operator snapshot) gets the SAME two real durable collections this
// module already reads elsewhere, projected through the two functions
// above rather than a third, independently-written loop. `canonicalBases`:
// project-canonical-base-store.mjs's real ADVANCED history, same shape
// work-feed-summary.mjs's own summarizeWorkFromRuns already takes -- optic
// for "has this exact run already been adopted" (DONE vs READY).
export function buildOwnerWorkItems(
  projects,
  keepGoingRuns = {},
  researchMissions = {},
  canonicalBases = {},
  clock = () => new Date()
) {
  const items = []
  for (const project of projects) {
    const run = keepGoingRuns[project.id]
    if (run) {
      const gap =
        run.state === 'ACTIVE' ? compareStateToGoal(run, { verifiedSatisfied: [] }, clock) : null
      const advancedEntry = (canonicalBases[project.id]?.history ?? []).find(
        (h) => h.action === 'ADVANCED' && h.missionId === run.id
      )
      items.push(keepGoingRunWorkItem(run, { gap, advancedEntry }))
    } else {
      const legacyMission = legacyMissionStateWorkItem(project)
      if (legacyMission) {
        items.push(legacyMission)
      }
      const legacyCandidate = legacyCandidateReadinessWorkItem(project)
      if (legacyCandidate) {
        items.push(legacyCandidate)
      }
    }
    const legacyBlocked = legacyBlockedWorkItem(project)
    if (legacyBlocked) {
      items.push(legacyBlocked)
    }
  }
  for (const mission of Object.values(researchMissions)) {
    items.push(researchMissionWorkItem(mission))
  }
  return items
}
