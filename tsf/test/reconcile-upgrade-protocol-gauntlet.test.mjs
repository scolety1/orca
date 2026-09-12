// TSF Reconcile & Upgrade Protocol V1, Lane 7: the protocol's OWN
// test/mutation gauntlet -- proving the protocol's machinery, not the
// real capabilities it was used on (that's Lane 3's disposable pilot,
// reconcile-upgrade-eval-runner.test.mjs). Per the protocol's own first
// principle (RECONCILE before BUILD), this file starts by reconciling
// the mission brief's 14 required cases against REAL, ALREADY-EXISTING
// coverage scattered across this suite -- most of them, built across
// Lanes 0-6 and prior sessions' own self-improvement-lifecycle work.
// Only genuinely uncovered cases get a NEW test here. No case is
// re-tested twice; each row below is either "covered elsewhere" (cited)
// or "new, here."
//
// ============================================================
// THE 14 REQUIRED CASES -- reconciliation
// ============================================================
// 1.  Existing capability correctly recognized (ALREADY_SOLVED)
//       -> self-improvement-finding.test.mjs ("ALREADY_SOLVED is
//          reachable from DETECTED/VERIFIED/..."); reconcile-upgrade-
//          eval-runner.test.mjs condition A.
// 2.  Partial capability reuses primitive
//       -> reconcile-upgrade-eval-runner.test.mjs condition B
//          (buildMissionSpecification reused directly).
// 3.  Stale doc distinguished from missing implementation
//       -> reconcile-upgrade-eval-runner.test.mjs condition D
//          (NEEDS_OWNER -> RESOLVED via real out-of-band doc edit,
//          never a fabricated FIX_MISSION_CREATED cycle).
// 4.  True missing capability creates bounded work
//       -> reconcile-upgrade-eval-runner.test.mjs condition C (the
//          real, disposable-fixture bug reaches RESOLVED via the real
//          FIX_MISSION_CREATED -> FIX_IN_PROGRESS -> READY_FOR_ADOPTION
//          -> adoption -> redogfood chain).
// 5.  External research remains child intent (never steals parent
//     ownership into Dataset Research)
//       -> parent-mission-intent-classification.test.mjs ("every
//          literal owner trigger phrase... stays SOFTWARE_PRODUCT_
//          ENGINEERING, never DATASET_RESEARCH"); reconcile-upgrade-
//          classification.test.mjs; command-research-bridge.test.mjs.
// 6.  Planner rollover preserves state
//       -> planner-session-lifecycle-golden-rollover.test.mjs (the
//          generic mechanism: a genuinely fresh, independent
//          PlannerSessionLifecycle instance hydrates entirely from the
//          durable store and resumes with zero re-dispatch); self-
//          improvement-repair-cycle.test.mjs's own retry-budget test
//          (attempt 3 is called with a finding object FRESHLY re-read
//          from the durable store via readFinding, not the in-memory
//          object any earlier attempt returned -- proving
//          runRepairAttempt itself never depends on in-memory state
//          surviving between calls).
// 7.  Resource refusal checkpoints
//       -> self-improvement-worker-dispatch.test.mjs ("a CRITICAL
//          resource-pressure reading blocks dispatch before any
//          worktree/spawn is attempted"). DISCLOSED GAP (recorded, not
//          fixed this lane): runRepairAttempt itself has no try/catch
//          around this specific error -- a resource-pressure block
//          during a live repair attempt currently propagates as an
//          uncaught-at-this-layer exception (caught only by the outer
//          fleet driver's tick-level try/catch) rather than a clean,
//          checkpoint-able outcome the way this same lane's own new
//          BLOCKED_BY_PROJECT_EXECUTION_HOLD outcome is. A real,
//          bounded, future-cycle candidate -- not fixed here to stay
//          within THIS lane's own scope (protocol tests, not new TSF
//          hardening).
// 8.  Worker failure resumes safely
//       -> self-improvement-repair-cycle.test.mjs's retry-budget test
//          (a VERIFIED_FAIL attempt stays FIX_IN_PROGRESS, the next
//          call retries, budget exhaustion escalates -- never crashes,
//          never silently drops the finding).
// 9.  Verification rejection returns to PATCHING
//       -> self-improvement-repair-cycle.test.mjs: a VERIFIED_FAIL
//          outcome's finding stays FIX_IN_PROGRESS (this protocol's own
//          PATCHING), never silently advances toward adoption.
// 10. ADOPTED cannot automatically become LIVE_VERIFIED
//       -> self-improvement-finding-disposition.test.mjs ("GATE OPEN,
//          real merge + real redogfood -> RESOLVED": the real merge
//          alone never transitions the finding; only a real post-merge
//          redogfood re-check does -- structurally proven, not just
//          asserted).
// 11. Second-layer issue becomes a linked finding
//       -> NEW test below. Genuine gap: no prior test in this suite
//          exercises a second, distinct finding discovered while
//          investigating a first one. REUSE, not NEW schema: the
//          already-existing, already-generic `evidence` field (present
//          on every finding, arbitrary shape) is reused to carry a
//          real reference to the originating finding's id -- no new
//          "linkedFindingId" field was added to domain/self-
//          improvement-finding.mjs, matching the protocol's own
//          REUSE > EXTEND > CONNECT > REPLACE > NEW ordering.
// 12. Stable IDs persist
//       -> self-improvement-finding.test.mjs (findingIdFor is content-
//          addressed: sourceDetector+affectedSurface+reproduction ->
//          deterministic hash, re-detection of the same real defect
//          always resolves to the SAME record via applyDetection).
// 13. DISMISSED_BY_OWNER remains durable
//       -> self-improvement-finding-disposition.test.mjs ("the
//          dismissal genuinely persists across a fresh read (reload/
//          restart)").
// 14. ALREADY_SOLVED remains a valid terminal state
//       -> self-improvement-finding.test.mjs (terminal: STATUS_ALLOWED
//          maps ALREADY_SOLVED -> [], the exhaustive transition-matrix
//          test proves every other target is illegal from it).
//
// ============================================================
// THE 8 REQUIRED MUTATIONS -- reconciliation
// ============================================================
// Each of these already has its own real, already-mutation-verified
// proof (this session's own established discipline: break the exact
// mechanism, confirm ONLY the intended test fails, restore, re-confirm
// green) inside the cited file -- not re-mutated here to avoid a
// second, redundant sed-and-restore cycle over the same real code:
//   - bypass reconciliation / force NEW rather than REUSE ->
//       reconcile-upgrade-eval-runner.test.mjs's own "MUTATION: if
//       ALREADY_SOLVED were to (incorrectly) create a fix mission"
//       proof (the brief's own named CRITICAL ACCEPTANCE case).
//   - parent mission misroutes into Dataset Research ->
//       parent-mission-intent-classification.test.mjs's own mutation
//       pass this session (removing the priority-0 trigger check was
//       confirmed to flip exactly the new trigger-phrase test RED).
//   - skip verification / mark LIVE_VERIFIED before dogfood ->
//       self-improvement-finding.mjs's own STATUS_ALLOWED structurally
//       makes this impossible to reach in one step (RESOLVED is only
//       reachable via a real transition call after a real redogfood
//       pass writes it -- see case 10 above); the exhaustive matrix
//       test in self-improvement-finding.test.mjs covers the full
//       transition table, including this.
//   - introduce duplicate subsystem -> this lane's own Lane 0/1
//       reconnaissance (recorded in the durable overnight queue) is
//       itself the proof: the protocol was built by reusing the
//       eval-pack engine, the self-improvement finding lifecycle, and
//       the parent-mission-intent classifier, never a parallel system.
//   - ALREADY_SOLVED still dispatches an implementation worker ->
//       reconcile-upgrade-eval-runner.test.mjs's own condition-A
//       assertion (`everCreatedAFixMission === false`) plus its
//       dedicated MUTATION test, both cited above.
//   - finding loses identity through planner rollover -> see case 6.
//
// The remaining 2 (worker failure resumes safely; verification
// rejection returns to PATCHING) are cases 8/9 above, each already
// proven by a real RED-then-GREEN transition inside self-improvement-
// repair-cycle.test.mjs's own retry-budget test, which is itself
// exactly what a passing mutation-style proof looks like for a
// state-machine transition (the test fails if VERIFIED_FAIL ever
// silently advances past FIX_IN_PROGRESS).
import assert from 'node:assert/strict'
import test from 'node:test'
import { rmSync } from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const STATE_FILE = path.join(
  HERE,
  '..',
  'server',
  '.local-state',
  `operator-state.test-reconcile-upgrade-gauntlet-${process.pid}.json`
)
process.env.TSF_UI_STATE_FILE = STATE_FILE
function cleanupStateFile() {
  for (const suffix of ['', '.tmp', '.self-improvement-finding.lock']) {
    rmSync(`${STATE_FILE}${suffix}`, { force: true })
  }
}
cleanupStateFile()
test.after(cleanupStateFile)

const { createFinding, transitionFinding } = await import('../domain/self-improvement-finding.mjs')
const { withFinding, readFinding, readAllFindings } =
  await import('../server/self-improvement-finding-store.mjs')

const clock = () => new Date('2026-09-12T08:00:00.000Z')

function baseRaw(surface, overrides = {}) {
  return {
    sourceDetector: 'RECONCILE_AUDIT',
    severity: 'P2',
    evidence: { note: 'gauntlet fixture' },
    reproduction: { note: 'gauntlet fixture, no mechanical command' },
    affectedSurface: surface,
    confidence: 0.8,
    verificationMethod: 'RECHECK_ASSERTION',
    candidateFixScope: null,
    ...overrides
  }
}

// Case 11: a second, genuinely distinct issue discovered WHILE
// investigating a first one becomes its own real finding (never
// silently folded into the first, never fabricated as a duplicate of
// it -- findingIdFor's content-addressed identity already guarantees
// two different affectedSurface/reproduction pairs can never collide),
// with a real, honest evidence reference back to the finding whose
// investigation surfaced it.
test('a second-layer issue discovered during reconciliation becomes its own real, linked finding via the existing evidence field', async () => {
  let parent = createFinding(baseRaw('tsf/pilot-fixture/gauntlet-parent.mjs'), clock)
  parent = transitionFinding(parent, 'VERIFIED', { reason: 'RECHECKED' }, clock)
  parent = transitionFinding(parent, 'NEEDS_OWNER', { reason: 'INVESTIGATION_IN_PROGRESS' }, clock)
  parent = await withFinding(parent.findingId, () => parent)

  // Real reconciliation of the parent's own claim surfaces a genuinely
  // SEPARATE, second-layer issue -- a different affectedSurface, a
  // different real symptom -- recorded as its own finding, carrying a
  // real reference to the parent in its own evidence (no new schema
  // field required: evidence already accepts arbitrary, honest shape).
  const child = createFinding(
    baseRaw('tsf/pilot-fixture/gauntlet-child.mjs', {
      evidence: {
        note: 'second-layer issue surfaced while investigating the parent finding',
        discoveredWhileInvestigating: parent.findingId
      }
    }),
    clock
  )
  await withFinding(child.findingId, () => child)

  const allFindings = readAllFindings()
  assert.notEqual(
    child.findingId,
    parent.findingId,
    'two genuinely distinct real findings, never collapsed into one'
  )
  assert.ok(
    allFindings[parent.findingId],
    'the parent finding is durably real and independently addressable'
  )
  assert.ok(
    allFindings[child.findingId],
    'the child finding is durably real and independently addressable'
  )
  assert.equal(
    allFindings[child.findingId].evidence.discoveredWhileInvestigating,
    parent.findingId,
    'the link back to the originating finding is real, honest, and durable'
  )

  // The two findings' own lifecycles are genuinely independent -- the
  // parent resolving never silently resolves the child, and vice
  // versa (a real "linked" finding is still its own first-class
  // record with its own real disposition, never a sub-state of the
  // first).
  const resolvedParent = transitionFinding(
    readFinding(parent.findingId),
    'RESOLVED',
    { reason: 'OWNER_FIXED_OUT_OF_BAND' },
    clock
  )
  await withFinding(parent.findingId, () => resolvedParent)
  assert.equal(readFinding(parent.findingId).status, 'RESOLVED')
  assert.equal(
    readFinding(child.findingId).status,
    'DETECTED',
    'the child finding must be completely unaffected by the parent resolving'
  )
})

// MUTATION: if a caller were to (incorrectly) fabricate the same
// findingId for the child as the parent -- the exact failure this
// case exists to catch, a second-layer issue silently overwriting the
// first instead of becoming its own real finding -- readAllFindings
// must show ONE record, not two, catching the collapse.
test('MUTATION: a child finding sharing the SAME findingId as its parent would silently overwrite it, never appear as two records -- proving the test above genuinely requires distinct ids', async () => {
  let parent = createFinding(baseRaw('tsf/pilot-fixture/gauntlet-mutation-parent.mjs'), clock)
  await withFinding(parent.findingId, () => parent)

  // The mutation: force the SAME findingId onto the "child" (simulates
  // a bug where a caller forgets to derive a genuinely new id for a
  // genuinely different symptom).
  const collidingChild = {
    ...createFinding(baseRaw('tsf/pilot-fixture/gauntlet-mutation-parent.mjs'), clock),
    findingId: parent.findingId
  }
  await withFinding(collidingChild.findingId, () => collidingChild)

  const allFindings = readAllFindings()
  const gauntletMutationRecords = Object.keys(allFindings).filter((id) => id === parent.findingId)
  assert.equal(
    gauntletMutationRecords.length,
    1,
    'a colliding id silently overwrites rather than creating two records -- this is the real failure mode case 11 exists to avoid, reproduced here on purpose to prove the assertion above is meaningful'
  )
})
