// TSF Reconcile & Upgrade Protocol V1, Lane 3: the disposable protocol
// pilot. Five seeded conditions, each proving the real classification
// lands on the real, expected disposition through the real self-
// improvement-finding.mjs/adoption machinery -- never a hand-typed
// stand-in, never a real project. See reconcile-upgrade-eval-runner.mjs
// for what each case actually drives.
export const RECONCILE_UPGRADE_PILOT_PACK = {
  packId: 'reconcile-upgrade-disposable-pilot',
  version: 1,
  category: 'RECONCILE_UPGRADE',
  description:
    'Proves the TSF Reconcile & Upgrade protocol against 5 seeded conditions (ALREADY_SOLVED, PARTIALLY_SOLVED, REAL_BUG, STALE_DOC, UPGRADE_OPPORTUNITY), each reaching its real, expected disposition through the real self-improvement finding lifecycle -- never fabricated.',
  cases: [
    {
      id: 'condition-a-already-solved-creates-zero-unnecessary-code',
      description:
        'A finding whose claim is real but reconciliation discovers it is already fixed reaches ALREADY_SOLVED with ZERO FIX_MISSION_CREATED transitions ever recorded in its history -- the critical acceptance the mission brief itself names.',
      input: { kind: 'ALREADY_SOLVED' },
      assertions: [
        { type: 'EQUALS', path: 'finalStatus', value: 'ALREADY_SOLVED' },
        { type: 'EQUALS', path: 'everCreatedAFixMission', value: false },
        { type: 'EQUALS', path: 'transitionCount', value: 2 }
      ]
    },
    {
      id: 'condition-b-partially-solved-reuses-the-existing-primitive-no-duplicate-subsystem',
      description:
        "An existing primitive (domain/mission-specification.mjs's real buildMissionSpecification) is discovered and REUSED directly, never re-implemented -- the real output carries the real, existing schema, proving no duplicate subsystem was invented.",
      input: { kind: 'PARTIALLY_SOLVED' },
      assertions: [
        { type: 'EQUALS', path: 'reusedExistingPrimitive', value: true },
        {
          type: 'EQUALS',
          path: 'missionSpec.schemaVersion',
          value: 'TSF_MISSION_SPECIFICATION_V1'
        },
        { type: 'EQUALS', path: 'newSubsystemCreated', value: false }
      ]
    },
    {
      id: 'condition-c-real-bug-reproduced-patched-verified-adopted-redogfooded',
      description:
        'A real, disposable code defect: reproduced RED, preregistered proof, a real fix candidate merged through the real, unmodified canonical adoption path (attemptRepairAdoption), then a real post-adoption redogfood re-check confirms the fix -- reaching genuine RESOLVED, never claimed early.',
      input: { kind: 'REAL_BUG' },
      assertions: [
        { type: 'EQUALS', path: 'reproducedRedBeforeFix', value: true },
        { type: 'EQUALS', path: 'realMergeHappened', value: true },
        { type: 'EQUALS', path: 'redogfoodOutcome', value: 'RESOLVED' },
        { type: 'EQUALS', path: 'finalStatus', value: 'RESOLVED' }
      ]
    },
    {
      id: 'condition-d-stale-doc-corrected-without-fabricating-a-code-feature',
      description:
        'A stale-documentation finding is corrected out-of-band (a real doc edit, not a fake code feature) and resolves via the existing NEEDS_OWNER -> RESOLVED edge -- never routed through a fabricated FIX_MISSION_CREATED/worker cycle for a documentation-only change.',
      input: { kind: 'STALE_DOC' },
      assertions: [
        { type: 'EQUALS', path: 'finalStatus', value: 'RESOLVED' },
        { type: 'EQUALS', path: 'everCreatedAFixMission', value: false },
        { type: 'EQUALS', path: 'docContentCorrected', value: true }
      ]
    },
    {
      id: 'condition-e-upgrade-opportunity-recorded-honestly-not-autonomously-implemented',
      description:
        'A real upgrade opportunity is recorded and evaluated (NEEDS_OWNER) but is NEVER autonomously implemented -- reaching FIX_MISSION_CREATED requires the SAME real ownerAuthorized:true flag Manual Self-Improvement Finding Disposition V1 already built, proving accepted evidence (an explicit owner decision), not automatic action, is what justifies implementation.',
      input: { kind: 'UPGRADE_OPPORTUNITY' },
      assertions: [
        { type: 'EQUALS', path: 'stayedAtNeedsOwnerWithoutAuthorization', value: true },
        { type: 'EQUALS', path: 'requiredOwnerAuthorizationToProceed', value: true }
      ]
    }
  ]
}
