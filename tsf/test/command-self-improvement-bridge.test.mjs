import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifySelfImprovementIntent,
  respondSelfImprovementCommand,
  shouldRouteToSelfImprovementBridge
} from '../server/command-self-improvement-bridge.mjs'
import { createFinding, transitionFinding } from '../domain/self-improvement-finding.mjs'
import { applyAutofixEligibility } from '../domain/self-improvement-autofix-eligibility.mjs'
import { completeRun, createOvernightRun } from '../domain/keep-going.mjs'

const CLOCK = () => new Date('2026-09-07T00:00:00.000Z')

function rawFinding(overrides = {}) {
  return {
    sourceDetector: 'GOLDEN_PATH_EVAL',
    severity: 'P1',
    affectedSurface: 'platform-golden-path',
    evidence: [{ note: 'test fixture' }],
    reproduction: { command: 'node --test tsf/test/example.test.mjs' },
    confidence: 0.9,
    verificationMethod: 'REPRODUCED_VIA_TEST',
    candidateFixScope: { kind: 'BOUNDED_CODE_DEFECT', description: 'example bounded defect', filesHint: ['tsf/server/example.mjs'] },
    ...overrides
  }
}

test('classifySelfImprovementIntent recognizes the real trigger phrasings', () => {
  assert.equal(classifySelfImprovementIntent('what did TSF find?'), 'SELF_IMPROVEMENT_ALL_FINDINGS')
  assert.equal(classifySelfImprovementIntent('what is it fixing?'), 'SELF_IMPROVEMENT_IN_PROGRESS')
  assert.equal(classifySelfImprovementIntent('what fixed itself successfully?'), 'SELF_IMPROVEMENT_RESOLVED')
  assert.equal(classifySelfImprovementIntent('what is ready for adoption?'), 'SELF_IMPROVEMENT_READY_FOR_ADOPTION')
  assert.equal(classifySelfImprovementIntent("why wasn't this auto-fixed?"), 'SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED')
  assert.equal(classifySelfImprovementIntent('what failed verification?'), 'SELF_IMPROVEMENT_FAILED_VERIFICATION')
})

test('classifySelfImprovementIntent does not hijack ordinary chat', () => {
  assert.equal(classifySelfImprovementIntent("what's the status?"), null)
  assert.equal(classifySelfImprovementIntent('what did the research find?'), null)
})

// Operator Polish + Tech Debt Closeout V1, Wave A, Phase 5: 3 of the 4
// mission-requested phrasings broaden an EXISTING intent's trigger regex
// (no new intent, no duplicated handler); the 4th ("what's ready for
// adoption?") already matched before this change.
test('classifySelfImprovementIntent: broadened phrasing "What did TSF fix by itself?" now classifies as SELF_IMPROVEMENT_RESOLVED', () => {
  assert.equal(classifySelfImprovementIntent('What did TSF fix by itself?'), 'SELF_IMPROVEMENT_RESOLVED')
  assert.equal(classifySelfImprovementIntent('what did tsf fix on its own?'), 'SELF_IMPROVEMENT_RESOLVED')
  assert.equal(classifySelfImprovementIntent('what did tsf fix itself?'), 'SELF_IMPROVEMENT_RESOLVED')
})

test('classifySelfImprovementIntent: old SELF_IMPROVEMENT_RESOLVED phrasing still classifies correctly (no regression)', () => {
  assert.equal(classifySelfImprovementIntent('what fixed itself successfully?'), 'SELF_IMPROVEMENT_RESOLVED')
  assert.equal(classifySelfImprovementIntent('self-fixed?'), 'SELF_IMPROVEMENT_RESOLVED')
})

// The broadened SELF_IMPROVEMENT_RESOLVED trigger must not hijack a message
// that merely mentions research or an unrelated PR fix.
test('classifySelfImprovementIntent: the broadened "what did TSF fix" trigger does not hijack unrelated messages', () => {
  assert.equal(classifySelfImprovementIntent('what did the research find?'), null)
  assert.equal(classifySelfImprovementIntent('what did you fix in the PR?'), null)
})

test('classifySelfImprovementIntent: broadened phrasing "What needs approval?" now classifies as SELF_IMPROVEMENT_READY_FOR_ADOPTION', () => {
  assert.equal(classifySelfImprovementIntent('What needs approval?'), 'SELF_IMPROVEMENT_READY_FOR_ADOPTION')
})

test('classifySelfImprovementIntent: old SELF_IMPROVEMENT_READY_FOR_ADOPTION phrasings still classify correctly (no regression)', () => {
  assert.equal(classifySelfImprovementIntent('what is ready for adoption?'), 'SELF_IMPROVEMENT_READY_FOR_ADOPTION')
  assert.equal(classifySelfImprovementIntent("what's ready to adopt?"), 'SELF_IMPROVEMENT_READY_FOR_ADOPTION')
})

// "What's ready for adoption?" already matched before this change --
// verified with no code change needed for this specific phrasing.
test("classifySelfImprovementIntent: \"What's ready for adoption?\" already matches SELF_IMPROVEMENT_READY_FOR_ADOPTION", () => {
  assert.equal(classifySelfImprovementIntent("What's ready for adoption?"), 'SELF_IMPROVEMENT_READY_FOR_ADOPTION')
})

// "What needs approval?" must never collide with command-scope-classifier's
// own NEEDS_YOU_QUERY phrasing ("what needs me") -- distinct anchors.
test('classifySelfImprovementIntent: the broadened "what needs approval" trigger does not collide with "what needs me"', () => {
  assert.equal(classifySelfImprovementIntent('what needs me?'), null)
})

test('classifySelfImprovementIntent: broadened phrasing "Why didn\'t TSF fix this?" now classifies as SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED', () => {
  assert.equal(classifySelfImprovementIntent("Why didn't TSF fix this?"), 'SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED')
  assert.equal(classifySelfImprovementIntent("why didn't tsf fix that?"), 'SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED')
  assert.equal(classifySelfImprovementIntent("why didn't tsf fix it?"), 'SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED')
})

test('classifySelfImprovementIntent: old SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED phrasing still classifies correctly (no regression)', () => {
  assert.equal(classifySelfImprovementIntent("why wasn't this auto-fixed?"), 'SELF_IMPROVEMENT_WHY_NOT_AUTOFIXED')
})

test('shouldRouteToSelfImprovementBridge mirrors classifySelfImprovementIntent', () => {
  assert.equal(shouldRouteToSelfImprovementBridge('what did TSF find?'), true)
  assert.equal(shouldRouteToSelfImprovementBridge('hello'), false)
})

test('respondSelfImprovementCommand returns null for a non-matching message (falls through to normal chat)', async () => {
  assert.equal(await respondSelfImprovementCommand({ message: 'what is running right now?' }), null)
})

test('REQUIRED PROOF: an empty store is reported honestly, never fabricated', async () => {
  const result = await respondSelfImprovementCommand({ message: 'what did TSF find?', deps: { readAllFindings: () => ({}) } })
  assert.match(result.text, /No self-improvement findings recorded yet/)
  assert.equal(result.live, true)
})

test('REQUIRED PROOF: each of the 6 real questions reads the correct real finding-store slice', async () => {
  const detected = createFinding(rawFinding({ affectedSurface: 'surface-detected' }), CLOCK)

  const verified = transitionFinding(
    createFinding(rawFinding({ affectedSurface: 'surface-in-progress' }), CLOCK),
    'VERIFIED',
    { reason: 'REPRODUCED' },
    CLOCK
  )
  const eligible = applyAutofixEligibility(verified, CLOCK)
  assert.equal(eligible.status, 'ELIGIBLE_FOR_AUTOFIX')
  const inProgress = transitionFinding(eligible, 'FIX_MISSION_CREATED', { reason: 'MISSION_ORIGINATED' }, CLOCK)

  const readyBase = applyAutofixEligibility(
    transitionFinding(createFinding(rawFinding({ affectedSurface: 'surface-ready' }), CLOCK), 'VERIFIED', { reason: 'REPRODUCED' }, CLOCK),
    CLOCK
  )
  const ready = transitionFinding(
    transitionFinding(
      transitionFinding(readyBase, 'FIX_MISSION_CREATED', { reason: 'MISSION_ORIGINATED' }, CLOCK),
      'FIX_IN_PROGRESS',
      { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED' },
      CLOCK
    ),
    'READY_FOR_ADOPTION',
    { reason: 'VERIFIER_PASSED' },
    CLOCK
  )

  const resolved = transitionFinding(
    (() => {
      const readyForResolve = applyAutofixEligibility(
        transitionFinding(createFinding(rawFinding({ affectedSurface: 'surface-resolved' }), CLOCK), 'VERIFIED', { reason: 'REPRODUCED' }, CLOCK),
        CLOCK
      )
      return transitionFinding(
        transitionFinding(
          transitionFinding(readyForResolve, 'FIX_MISSION_CREATED', { reason: 'MISSION_ORIGINATED' }, CLOCK),
          'FIX_IN_PROGRESS',
          { reason: 'FIRST_REPAIR_ATTEMPT_DISPATCHED' },
          CLOCK
        ),
        'READY_FOR_ADOPTION',
        { reason: 'VERIFIER_PASSED' },
        CLOCK
      )
    })(),
    'RESOLVED',
    { reason: 'OWNER_ADOPTED' },
    CLOCK
  )

  // Eligibility-level rejection -- low confidence, never dispatched a repair worker.
  const notEligible = applyAutofixEligibility(
    transitionFinding(
      createFinding(rawFinding({ affectedSurface: 'surface-not-eligible', confidence: 0.2 }), CLOCK),
      'VERIFIED',
      { reason: 'REPRODUCED' },
      CLOCK
    ),
    CLOCK
  )
  assert.equal(notEligible.status, 'NEEDS_OWNER')
  assert.equal(notEligible.authorityRequired, 'LOW_CONFIDENCE')

  // Retry-budget-exhausted escalation -- a real repair was attempted and kept
  // failing verification. Its own distinct affectedSurface, not `eligible`'s
  // -- findingId is content-addressed from sourceDetector/affectedSurface/
  // reproduction only (never status), so reusing `eligible` here would
  // silently collide with `inProgress`'s own findingId in the store below.
  const eligibleForFailedVerification = applyAutofixEligibility(
    transitionFinding(
      createFinding(rawFinding({ affectedSurface: 'surface-failed-verification' }), CLOCK),
      'VERIFIED',
      { reason: 'REPRODUCED' },
      CLOCK
    ),
    CLOCK
  )
  const failedVerification = transitionFinding(
    transitionFinding(eligibleForFailedVerification, 'FIX_MISSION_CREATED', { reason: 'MISSION_ORIGINATED' }, CLOCK),
    'NEEDS_OWNER',
    { reason: 'REPAIR_RETRY_BUDGET_EXCEEDED', evidence: [{ missionId: 'repair:example', attemptsSoFar: 3 }] },
    CLOCK
  )

  const store = {
    [detected.findingId]: detected,
    [inProgress.findingId]: inProgress,
    [ready.findingId]: ready,
    [resolved.findingId]: resolved,
    [notEligible.findingId]: notEligible,
    [failedVerification.findingId]: failedVerification
  }
  // Operator Attention V1, Wave 2: SELF_IMPROVEMENT_READY_FOR_ADOPTION now
  // goes through buildFleetAttentionItems, which also needs a fleet
  // snapshot (never a real read in a test) -- projects/keepGoingRuns/etc.
  // explicitly empty so this stays exactly as isolated as before.
  const deps = { readAllFindings: () => store, projects: [], keepGoingRuns: {}, researchMissions: {}, plannerMissionRecords: {} }

  const all = await respondSelfImprovementCommand({ message: 'what did TSF find?', deps })
  assert.equal(all.text.split('\n').filter((l) => l.startsWith('-')).length, 6)

  const fixing = await respondSelfImprovementCommand({ message: 'what is it fixing?', deps })
  assert.match(fixing.text, /surface-in-progress/)
  assert.doesNotMatch(fixing.text, /surface-ready/)

  const selfFixed = await respondSelfImprovementCommand({ message: 'what fixed itself successfully?', deps })
  assert.match(selfFixed.text, /surface-resolved/)
  assert.doesNotMatch(selfFixed.text, /surface-in-progress/)

  const readyForAdoption = await respondSelfImprovementCommand({ message: 'what is ready for adoption?', deps })
  assert.match(readyForAdoption.text, /surface-ready/)
  assert.match(readyForAdoption.text, /nothing here has been auto-merged/)

  const whyNot = await respondSelfImprovementCommand({ message: "why wasn't this auto-fixed?", deps })
  assert.match(whyNot.text, /surface-not-eligible/)
  assert.match(whyNot.text, /LOW_CONFIDENCE/)
  assert.doesNotMatch(whyNot.text, /surface-in-progress/)

  const failedVerif = await respondSelfImprovementCommand({ message: 'what failed verification?', deps })
  assert.match(failedVerif.text, /surface-failed-verification/)
  assert.doesNotMatch(failedVerif.text, /surface-not-eligible/)
})

// Operator Attention V1, Wave 2: real gap this closes -- a project-level
// (non-self-improvement) Keep Going run that reached COMPLETE is a real
// READY_FOR_ADOPTION candidate (buildFleetAttentionItems' own
// readyForAdoptionItems), previously invisible to this chat question since
// it only ever read the self-improvement finding store.
test('SELF_IMPROVEMENT_READY_FOR_ADOPTION: a project-level (non-self-improvement) readyForAdoption item now also appears through this same chat question', async () => {
  const run = completeRun(
    createOvernightRun({ id: 'run-1', projectId: 'proj-1', originalGoal: 'Fix it.', acceptanceCriteria: ['X'] }, CLOCK),
    CLOCK
  )
  const result = await respondSelfImprovementCommand({
    message: 'what is ready for adoption?',
    deps: {
      readAllFindings: () => ({}),
      projects: [{ id: 'proj-1', displayName: 'Project One', mission: { state: 'ONBOARDED', id: null, blockedReason: null }, candidate: null, receipts: { chain: [] } }],
      keepGoingRuns: { 'proj-1': run },
      researchMissions: {},
      plannerMissionRecords: {}
    }
  })
  assert.match(result.text, /Project One/)
  assert.match(result.text, /nothing here has been auto-merged/)
})
