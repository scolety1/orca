// TSF Final Pre-UI P1 Closure V1, P1 #2: ONE owner-facing Goal projection.
// A REAL read-model completion, not a new durable store -- every OwnerGoal
// here is derived, live, from a real durable authority that already
// exists (a Keep Going run's own originalGoal, a ResearchMission's own
// specification), never stored separately. Mirrors owner-work-model.mjs's
// own established pattern exactly (reconcile existing state, project it
// through one canonical shape, never invent new persistence).
//
// Identity: `goal:run:${run.id}` / `goal:research:${mission.id}` -- derived
// from the real durable RUN/MISSION id, never from the goal's own mutable
// text. This is deliberate: Keep Going's own real replaceGoal (this file's
// own domain neighbor, keep-going.mjs) lets Tim authorize a genuinely new
// goal statement/acceptanceCriteria for the SAME run -- deriving identity
// from run.id (not from the statement text) means that replacement keeps
// the SAME OwnerGoal.id while its content honestly reflects the new
// authorized goal, exactly the invariant the mission brief requires
// ("same durable run -> same OwnerGoal identity, while goal content
// reflects the new authorized goal"). A hash of the goal TEXT
// (keep-going.mjs's own missionSpec.missionSpecId, a real, different,
// pre-existing field) would silently mint a NEW identity on every
// replaceGoal call -- the wrong invariant for this purpose, so
// deliberately not used here.
//
// Scope, honestly: this is a real Project -> Goal -> Work projection where
// each Work item's own goal is 1:1 with the item itself (the run/mission
// IS the goal's one real execution). Reconciliation (this mission's own
// archaeology) confirmed no real, durable, cross-Work goal-SHARING
// mechanism exists anywhere in this codebase yet (no stable id a second,
// distinct Work item could reference to say "this serves the same goal")
// -- inventing one would mean a new durable Goal record, exactly the "new
// storage system" this task is scoped to avoid. A run-less legacy project
// (no Keep Going run, no ResearchMission) has no real goal authority at
// all -- honestly unscoped (no OwnerGoal, no goalId), never a fabricated
// "General work"/"Project goal" placeholder.
export function keepGoingRunGoal(run) {
  return {
    id: `goal:run:${run.id}`,
    projectId: run.projectId,
    kind: 'KEEP_GOING_RUN',
    title: run.originalGoal.statement,
    description: null,
    criteria: run.originalGoal.acceptanceCriteria,
    sourceId: run.id,
    updatedAt: run.updatedAt
  }
}

export function researchMissionGoal(mission) {
  return {
    id: `goal:research:${mission.id}`,
    projectId: mission.projectId ?? null,
    kind: 'RESEARCH_MISSION',
    title: mission.specification?.researchQuestion ?? null,
    description: null,
    criteria: null,
    sourceId: mission.id,
    updatedAt: mission.updatedAt
  }
}

// The one real aggregation entry point -- mirrors owner-work-model.mjs's
// own buildOwnerWorkItems iteration shape exactly (the same two real
// durable collections), so a Work item's goalId (see owner-work-model.mjs)
// always has a matching entry here for the SAME run/mission.
export function buildOwnerGoals(keepGoingRuns = {}, researchMissions = {}) {
  const goals = []
  for (const run of Object.values(keepGoingRuns)) {
    goals.push(keepGoingRunGoal(run))
  }
  for (const mission of Object.values(researchMissions)) {
    goals.push(researchMissionGoal(mission))
  }
  return goals
}
