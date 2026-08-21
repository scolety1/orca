// M9 wave 3: a real PLANNER eval pack. Measures already-adopted planner
// capabilities exactly as they exist today -- buildProjectContextCapsule
// (M7's real do-not-repeat-lessons wiring) and generateWbs (M8's real
// WBS decomposition). No new planner capability is added here; this only
// measures what already exists, per M9's own stated purpose ("measure
// whether changes improve or regress the system," not build new ones).
//
// Each case carries its OWN fixed input (a minimal project/memory/repo-
// evidence fixture), so the pack is fully self-contained and reproducible
// -- scoring never depends on an external, unversioned fixture supplied
// by whoever happens to run it.
const BLOCKED_LESSON_TEXT =
  'Rejected: do not retry the flaky upload endpoint without exponential backoff'
const BLOCKED_REASON_TEXT =
  'Locally authored opaque Talent IDs cannot receive matcher concept scores.'

function evalFixtureProject() {
  return {
    id: 'planner-eval-fixture',
    displayName: 'Planner Eval Fixture',
    purpose: 'Synthetic project used only for planner evaluation packs.',
    branch: 'main',
    lifecycle: 'IDEA_INCUBATOR_LOCAL',
    mission: { id: 'mission-eval', state: 'BLOCKED', blockedReason: BLOCKED_REASON_TEXT },
    release: {
      stable: { head: null },
      testing: 'BLOCKED_ARCHITECTURAL_CONFLICT',
      adoption: 'NOT_READY_NOT_ADOPTED',
      published: 'UNCHANGED_NO_PUBLICATION_ACTION',
      upgrade: null
    },
    health: { status: 'DEGRADED', findings: [] },
    candidate: null,
    evidence: { resultCapsules: [] },
    receipts: { chain: [] }
  }
}

export const PLANNER_BASICS_PACK = {
  packId: 'planner-basics',
  version: 1,
  category: 'PLANNER',
  description:
    'Exercises buildProjectContextCapsule and generateWbs against a real, fixed project/memory input.',
  cases: [
    {
      id: 'grounds-in-real-blocked-reason',
      description:
        'The context capsule reflects the real, current blocked reason -- never a fabricated one.',
      input: { kind: 'CAPSULE', project: evalFixtureProject(), lessonText: null },
      assertions: [{ type: 'CONTAINS', path: 'active_blockers', value: BLOCKED_REASON_TEXT }]
    },
    {
      id: 'surfaces-rejected-approach-lesson',
      description:
        'A real EXPERIENCE lesson (do-not-repeat) reaches the context capsule the planner actually receives.',
      input: { kind: 'CAPSULE', project: evalFixtureProject(), lessonText: BLOCKED_LESSON_TEXT },
      assertions: [{ type: 'CONTAINS', path: 'do_not_repeat_lessons', value: BLOCKED_LESSON_TEXT }]
    },
    {
      id: 'decomposes-into-a-real-multi-task-wbs',
      description:
        'A real repo-grounded WBS call decomposes into more than one task with real dependency structure.',
      input: {
        kind: 'WBS',
        repoEvidence: {
          projectId: 'planner-eval-fixture',
          displayName: 'Planner Eval Fixture',
          purpose: 'Synthetic project used only for planner evaluation packs.',
          missionState: 'BLOCKED',
          blockedReason: BLOCKED_REASON_TEXT,
          healthStatus: 'DEGRADED',
          healthFindings: []
        }
      },
      assertions: [
        { type: 'GTE', path: 'taskCount', value: 2 },
        { type: 'CONTAINS', path: 'taskIds', value: 'implement' }
      ]
    }
  ]
}
