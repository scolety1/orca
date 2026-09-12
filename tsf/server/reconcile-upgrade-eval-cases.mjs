// TSF Reconcile & Upgrade Protocol V1, Lane 3: the disposable protocol
// pilot. Five seeded conditions, each driving the SAME real self-
// improvement-finding.mjs/adoption machinery every other finding on this
// platform goes through -- no hand-typed stand-in state machine, no real
// project touched.
//
// Adversarial-review finding (P1, honest scope correction, not a code
// bug): `RECONCILE_AUDIT` is a directed, protocol-driven audit (a human
// or agent following this protocol), not one of the 7 mechanical/
// automated detectors -- so, unlike e.g. condition C's REAL_BUG case
// (which drives a real reproduction/verifier/adoption/redogfood chain
// end to end), conditions A/B/D/E cannot exercise an automated
// "did reconciliation classify this correctly" judgment, because no such
// automated judgment exists or should exist for a directed audit -- that
// judgment IS the human/agent doing the reconciliation. What these cases
// DO prove, honestly: once a real, correctly-classified finding reaches
// a given status, the durable lifecycle enforces the right invariants
// from there (e.g. condition A: ALREADY_SOLVED's own transition history
// can structurally never contain a FIX_MISSION_CREATED entry -- see its
// own STATUS_ALLOWED matrix test in self-improvement-finding.test.mjs
// for the exhaustive proof of that same guarantee). This pack does not
// claim to prove reconciliation itself is ever performed correctly.
export const RECONCILE_UPGRADE_PILOT_PACK = {
  packId: 'reconcile-upgrade-disposable-pilot',
  version: 1,
  category: 'RECONCILE_UPGRADE',
  description:
    'Drives the real self-improvement finding lifecycle/adoption machinery through 5 seeded conditions (ALREADY_SOLVED, PARTIALLY_SOLVED, REAL_BUG, STALE_DOC, UPGRADE_OPPORTUNITY) to their real, expected disposition. Proves the lifecycle enforces the right invariants once a finding is correctly classified into a condition -- does not, and cannot, prove reconciliation itself (a directed, human/agent judgment call for RECONCILE_AUDIT findings) was performed correctly.',
  cases: [
    {
      id: 'condition-a-already-solved-creates-zero-unnecessary-code',
      description:
        "Given a finding already classified ALREADY_SOLVED (that classification judgment is the reconciliation step itself, made by whoever is following the protocol -- not something this case can mechanically verify), its durable transition history can never contain a FIX_MISSION_CREATED entry -- the critical acceptance the mission brief itself names, enforced by the real lifecycle's own transition rules.",
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
