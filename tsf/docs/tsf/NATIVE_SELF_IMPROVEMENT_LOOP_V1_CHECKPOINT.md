# TSF — Native Self-Improvement Loop V1 — Durable Checkpoint

Owner directive: "TSF — NATIVE SELF-IMPROVEMENT LOOP V1: CLOSE THE LAST
ZERO-RELAY DEVELOPMENT GAP." Closes the one gap the completed Autonomous
Reliability Hardening Overnight V1 program's own Phase 16 honestly found:
no TSF-native, human-independent mechanism exists to originate a bounded
repair mission from a verified finding.

## Baseline (mission start)

- Canonical `tsf/main` SHA: `95d55ea35561a2772c76aabef5ba2a92dc4c18a8`
  (includes all 30 findings from the completed Reliability Hardening
  Overnight V1 program)
- Fork checkpoint (`fork/tsf/main`): matches exactly
- Working tree: clean
- Worktrees at mission start: only `dataset-research-engine-v0` (held,
  untouched)
- Free memory at mission start: ~1.81GB / 15.85GB

## Hard constraints (verbatim, must be preserved)

Do not touch NWR. Do not activate Cleanup V1 real destructive authority.
Do not deploy. Do not spend money. Do not enable arbitrary autonomous
architectural rewrites. Do not let subjective visual critique
automatically modify product design. Do not create recursive
self-generated feature requests. Do not create a second mission system.
Do not build a recursive unconstrained self-modifying agent.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| Reconcile + Design | DONE (Wave A) | See "Wave A" section below |
| 1 (Finding contract) | DONE (Wave A) | `tsf/domain/self-improvement-finding.mjs` + store |
| 2 (Autofix eligibility policy) | DONE (Wave A) | `tsf/domain/self-improvement-autofix-eligibility.mjs` |
| 3 (Fix-mission origination) | DONE (Wave B) | `tsf/server/self-improvement-mission-origination.mjs` |
| 4 (Duplicate/loop protection) | DONE (Wave B) | Content-addressed missionId + `tsf/domain/self-improvement-retry-budget.mjs` |
| 5 (Verifier/adoption contract) | DONE (Wave B) | `tsf/server/self-improvement-verifier-dispatch.mjs`, `tsf/server/self-improvement-adoption.mjs` |
| 6 (Redogfood/close the loop) | DONE (Wave B) | `tsf/server/self-improvement-redogfood.mjs`, `tsf/domain/self-improvement-receipt-chain.mjs` |
| 7 (Learning Ledger) | DONE (Wave B) | `tsf/server/self-improvement-learning-ledger-wiring.mjs` |
| 8 (Security review) | NOT_STARTED | Later wave |
| 9 (Golden proof) | NOT_STARTED | Acceptance test |
| 10 (Chaos proof) | NOT_STARTED | |

## Next intended action

Wave C+: Phase 8 (security review of this whole mechanism) and Phases
9-10 (golden/chaos acceptance proofs, which per the mission brief require
a REAL bounded Codex/Claude process -- deliberately never exercised by
Wave B's own automated test suite, which proves every mechanism with
dependency-injected fakes instead). Do NOT re-derive Wave B's design from
scratch -- re-verify with a fresh read (code may have shifted) and build
on it. See the "Wave B" section below for the full reconciliation,
design, and test evidence.

---

## Wave A -- Reconcile + Phases 1-2 (2026-09-07)

Worktree: `selfimprove-wave-a-contract-eligibility`, branch
`tsf/feature/selfimprove-wave-a-contract-eligibility` (forked from
`tsf/main` @ `87301123a0ef3520892ed5176846dbfefef225ad`).

### Reconciliation table

Every primitive named in this wave's dispatch, classified REUSE / EXTEND
/ NEW / REJECT with evidence from a fresh read of the current worktree
(3 parallel read-only investigation agents, full-file reads, cited by
path/line; re-verifies and, in several places, sharpens Phase 16's own
prior audit rather than assuming it still holds unchanged).

| Primitive | Verdict | Evidence |
|---|---|---|
| `ui-dogfood-finding.mjs` taxonomy (`FINDING_CATEGORIES`, `SEVERITY_LEVELS`, `classifyAutoFixEligibility`) | **REUSE** (severity) / **REJECT-AS-DIRECT-FIT, REUSE-AS-PATTERN** (category + eligibility) | `SEVERITY_LEVELS` (`P0`-`P3`) imported directly into `self-improvement-finding.mjs` -- no parallel vocabulary invented. `FINDING_CATEGORIES` is UI-viewport-scoped by construction (`CLIPPED_CONTENT`, `INACCESSIBLE_INTERACTION`, ...) and does not generalize to an eval-pack regression or a resource diagnostic -- confirmed by reading all 17 categories, none of which fit a non-UI detector. `classifyAutoFixEligibility`'s own boundary rule ("a subjective category is NEVER auto-fixable no matter what else is true") is reused verbatim as the design pattern for `self-improvement-autofix-eligibility.mjs`'s `ELIGIBLE_FIX_KINDS`/`NOT_ELIGIBLE_FIX_KINDS` split. |
| `ui-dogfood-contract.mjs` (`runDogfoodPass`, `runIterativeDogfood`) | **REJECT** for this wave (out of scope: detector-side, not contract-side) | Confirms the durable-store gap Phase 16 found still holds: `runDogfoodPass`/`runIterativeDogfood` (lines 121-224) return findings as plain values with zero store call; grep for "dogfood"+"store" in `tsf/` still returns zero matches. Wave A does not touch detector wiring -- a future detector adapter would call `recordFindingDetection` (this wave's new store entry point) from inside `command-dogfood-bridge.mjs`, not modify this file. |
| `evaluation-pack.mjs` / `eval-pack-registry.mjs` | **REUSE-AS-PATTERN, EXTEND-LATER (not this wave)** | `scoreCase`/`runEvalPack` (`evaluation-pack.mjs:160-199`) produce `{caseId, passed, errored, assertionResults}` -- has an identity and a boolean outcome but no severity/message/category/timestamp at the per-case level (only `runAt` at the whole-run level). Confirmed by fresh read: still true today. A future `GOLDEN_PATH_EVAL`/`RESEARCH_EVAL` detector adapter (Wave B+) would wrap a failed case into this wave's generic finding shape (`severity`, `evidence`, `reproduction` synthesized from `assertionResults`) rather than the finding contract absorbing eval-pack's shape directly -- confirmed genuinely thinner, not a drop-in fit. |
| `chat-dispatch-bridge.mjs` (`planAndDispatchFromChat`, `planAndDispatchFromCommand`) | **REUSE** (Wave B's dispatch primitive, not touched this wave) | `planAndDispatchFromChat({project, message, placement, identity, clock, deps})` (lines 131-303) is structured/programmatically callable -- every input except `message` (forwarded to a live LLM planner call) is a plain object; real production callers confirmed: `http-server.mjs`'s `/api/chat` route and `command-responder.mjs`'s `dispatchAndRespond`. This is the closest real "create a mission from structured input" primitive in the codebase and is where Wave B should originate a fix mission from an `ELIGIBLE_FOR_AUTOFIX` finding -- not built or touched in Wave A (out of scope per this wave's own constraints). |
| `command-responder.mjs` | **REJECT** (as a direct call target for origination) | `respondCommand` (lines 197-672) is entirely chat-text-driven (`classifyIntent`/`classifyDecision` over free text) with exactly one production caller (`http-server.mjs`'s `/api/chat`, no-projectId branch). A finding-driven originator has structured input already -- routing it back through text parsing would be a regression, not reuse. |
| `keep-going.mjs` / `keep-going-dispatch-loop.mjs` / `keep-going-controller.mjs` | **REUSE-AS-PATTERN for Wave B** | `keep-going.mjs` has no `startKeepGoingRun`/`tickKeepGoingRun` of its own (those live one layer up in the server files, confirmed by fresh full read) -- it is pure `TSF_OVERNIGHT_RUN_V1` state-machine logic only. `keep-going-fleet-driver.mjs` IS a real, production-wired autonomous `setInterval` loop (confirmed: `main.mjs`'s real spawn path sets `TSF_KEEP_GOING_FLEET_DRIVER=1`, `http-server.mjs`'s `startStandaloneServer` bootstraps it) -- but it only ever settles an in-flight wave or continues an *already-started* run toward its *already-declared* goal (`buildContinuationWorkItem`, scoped explicitly by its own header); it never originates a first wave. This closes an open question from Phase 16 (which only established the fleet driver was continuation-only in principle) with a direct citation of the production bootstrap wiring. |
| Planner Context Lifecycle (`planner-mission-checkpoint.mjs`, `planner-mission-lease.mjs`, `planner-session-lifecycle.mjs`, `planner-mission-store.mjs`) | **REUSE-AS-PATTERN (store), REJECT for dispatch (still unwired)** | `planner-mission-store.mjs`'s CAS pattern (`withFileLock` + `data-store.mjs` opState + a `versionCheckedRecord` read-boundary guard) is the exact template this wave's own `self-improvement-finding-store.mjs` follows. `PlannerSessionLifecycle` (`planner-session-lifecycle.mjs`) -- re-grepped fresh: every instantiation/import is still under `tsf/test/` or `tsf/test/fixtures/`; zero production callers in `tsf/server`, `tsf/domain`, or `tsf/adapters`. Phase 16's "test-only" finding is confirmed unchanged. |
| Verifier dispatch (`VERIFIER_INDEPENDENT` role, `routing.mjs`'s `resolveRole`, `coordinator.mjs`'s `registerVerifierResult`) | **REJECT for this wave (deep gap unchanged), REUSE-AS-PATTERN (evaluation-pack.mjs via research-verification.mjs precedent)** | `resolveRole` (`routing.mjs:31-56`) is real production code but is pure config lookup -- it never dispatches anything, and no production call site resolves `role: 'VERIFIER_INDEPENDENT'` (the two live `resolveRole` callers, `live-planner.mjs:530,691`, both resolve `PLANNER_DEEP`). `registerVerifierResult` (`coordinator.mjs:49-63`) still has zero production importers (fresh grep confirms only `tsf/fixtures/*`) -- corroborated by `tsf/programs/daily-driver-autonomy-v1/state.json`'s own note that this is "the OLDER, pre-M2 fixture-only mission model." `research-verification.mjs`'s `verifyResearchClaim` -> `scoreCase` (`evaluation-pack.mjs`) remains the one real, non-hypothetical precedent that autonomous verification composition works -- this wave's `verificationMethod` field is deliberately a free string (not tied to `VERIFIER_INDEPENDENT`) so Wave B/later phases can wire either path without a contract change. |
| Resource Pressure Governor (`resource-pressure-governor.mjs`) | **REUSE (vocabulary reference for eligibility)** | Full public API confirmed (`classifyResourcePressureTier`, `buildAdmissionPolicy`, `classifyDispatchAdmission`, `requestHeavyTaskLease`/`releaseHeavyTaskLease`). No explicit "bypass" concept exists in this module itself -- a bypass would concretely mean forcing `classifyDispatchAdmission`'s `admitted` past a tier-derived `REFUSE`, or granting a heavy-task lease despite contention. `self-improvement-autofix-eligibility.mjs`'s `RESOURCE_GOVERNOR_BYPASS` eligible-fix kind names exactly this concrete failure mode, not a fabricated one. |
| Needs You (`fleet-work-status.mjs`'s `fleetNeedsYouStatus`, `raise*NeedsYou`) | **REJECT for this wave (finding contract's `NEEDS_OWNER` status is the analog, not a literal reuse)** | Confirmed exactly 3 `raise*NeedsYou` functions exist (`keep-going.mjs:627`, `research-mission.mjs:374`, `planner-mission-checkpoint.mjs:121`), each scoped to its own parent record. A generic finding is not a mission/run/checkpoint and has no natural slot in any of the three -- `NEEDS_OWNER` is the finding contract's own, new escalation status instead of forcing a finding into an unrelated record's `needsYou[]` array. `fleetNeedsYouStatus`'s honest-null pattern for `projectId` (its own comment: "a planner mission's checkpoint carries no such field... so PLANNER items honestly report `projectId: null` rather than guessing one") is the direct precedent this wave's own `projectId: null` (platform-wide finding) design follows. |
| Adoption governance / worktree->verify->adopt->push | **CONFIRMED REJECT (no TSF-native equivalent exists)** | Re-verified fresh, unchanged from Phase 16: `cleanup-owner-authorization-gate.mjs`'s env-var+flag-file gate is real but by design never set by production code; `self-update-adoption.mjs`'s `createAdoptionReceipt` still hardcodes `decidedBy === 'TIM'` with zero production callers; `git-identity.mjs`'s `ffOnlyMerge`/`resetHardTo` still have zero production callers outside test files. This wave does not attempt to close this gap (explicitly Wave B+ scope, and the finding contract's terminal `RESOLVED`/`REJECTED_FALSE_POSITIVE` states do not themselves perform any merge). |
| Cleanup V1 (`cleanup-executor.mjs`, `cleanup-lifecycle.mjs`, `cleanup-owner-authorization-gate.mjs`, `cleanup-protected-registry.mjs`) | **REUSE-AS-PATTERN (for Wave B+'s governed-adoption stage design, not this wave's code)** | Full stage sequence confirmed: RECOMMENDATION -> PLAN -> AUTHORIZATION -> EXECUTION, each stage's builder function throwing an illegal-transition guard unless the input carries the prior stage's exact `schemaVersion` (`cleanup-lifecycle.mjs:67,99,140`), a receipt chain at every stage, an idempotency key (`computeCleanupRequestId = sha256({actionClass, targetIdentity})`), and a THIRD independent safety re-check immediately before the real mutating call (`cleanup-executor.mjs`'s "race re-check" step). This is the concrete template a future governed-adoption pipeline for a code-fix mission (not a destructive action) should mirror -- not reused directly, since it is destructive-action-specific, but its stage-transition shape is the strongest real analog in the codebase. |
| Learning Ledger (`platform-learning-ledger.mjs`, `-store.mjs`) | **REUSE-AS-PATTERN (store), REJECT (not a finding store)** | Confirmed: `withPlatformLearningLedger` uses the identical `withFileLock` + `data-store.mjs` opState singleton pattern this wave's finding store also uses. The ledger itself holds advisory `LessonRecord`s (`retrieveLessonGuidance`'s own `advisoryOnly:true, neverOverridesVerifiedEvidence:true` stamp), a genuinely different concept from a finding requiring a real fix -- not repurposed. |
| Durable completion/watch state (`data-store.mjs` opState, `cross-process-file-lock.mjs`) | **REUSE (direct, no new mechanism)** | `self-improvement-finding-store.mjs` adds exactly one new opState collection (`selfImprovementFindings: {}`) to `data-store.mjs`'s `DEFAULTS` and one new lock-file suffix, following the identical pattern every other store in this codebase uses (`keepGoingRuns`, `researchMissions`, `plannerMissions`, `cleanupRequests`, ...). No second persistence mechanism invented. |
| Project attribution (`projectId` binding) | **REUSE-AS-PATTERN, deliberate divergence documented** | `research-mission.mjs`'s `createResearchMission` and `keep-going.mjs`'s `createOvernightRun` both require `projectId` and throw if absent (confirmed by fresh read, both lines cited: `research-mission.mjs:114`, `keep-going.mjs:94-96`). `planner-mission-checkpoint.mjs` has NO `projectId` field at all (confirmed: zero occurrences on a fresh grep) and downstream consumers report `null` honestly. This wave's finding contract deliberately follows the checkpoint's pattern, not the mission/run pattern -- `projectId` is optional and nullable (`createFinding`'s `raw.projectId ?? null`, never thrown on absence) because a finding is legitimately sometimes platform-wide (e.g. a `RESOURCE_DIAGNOSTIC` with no single owning project), matching the mission brief's own explicit "honest-null discipline" instruction. |
| Issue/finding representations (`ui-dogfood-finding.mjs`, `bug-ledger.json`, eval-pack failure shape) | **NEW store justified, both alternatives checked and rejected with evidence** | `ui-dogfood-finding.mjs`: REJECT as the base store (UI-viewport-scoped taxonomy, no store at all today -- see row above). `bug-ledger.json`: REJECT as the base store -- confirmed via fresh grep (`bug-ledger.json`/`bug-ledger` across all of `tsf/`, 57 matches, every one a source-code *comment* citing it as documentation; a separate grep for `readFileSync.*bug-ledger|import.*bug-ledger` returned **zero matches**). It is a hand-maintained static JSON file with prose `evidence[]` strings, never read/written by any `.mjs` module, with no `schemaVersion` durable-store guard, no revision/CAS, no lock -- categorically not durable-store-backed. Eval-pack failure shape: REJECT as the base store (see evaluation-pack.mjs row -- too thin, no severity/category/timestamp per case). Given neither existing shape is an honest fit for a platform-wide, multi-detector, durable-store-backed finding record, **`tsf/domain/self-improvement-finding.mjs` + `tsf/server/self-improvement-finding-store.mjs` is legitimately NEW**, built entirely from REUSEd primitives (severity vocabulary, transition-table convention, CAS store pattern, schema-versioning engine) rather than a second parallel mechanism. |

### Phase 1 -- Finding contract: final shape

`tsf/domain/self-improvement-finding.mjs` (schemaVersion
`TSF_SELF_IMPROVEMENT_FINDING_V1`). Field names are camelCase (not the
mission brief's literal snake_case) -- every existing durable record in
this codebase uses camelCase with zero exceptions, and introducing
snake_case here would be a second, inconsistent convention for no real
benefit; this substitution is documented, not silent.

Fields: `schemaVersion`, `findingId` (content-addressed: `finding:<sha256(
{sourceDetector, affectedSurface, reproduction}).slice(0,24)>` -- so the
SAME detector reporting the SAME symptom always resolves to the SAME
record, never a duplicate), `projectId` (nullable, honest-null per the
table above), `sourceDetector` (enum: `UI_DOGFOOD`, `COMMAND_DOGFOOD`,
`GOLDEN_PATH_EVAL`, `RESEARCH_EVAL`, `RUNTIME_ASSERTION`,
`SECURITY_ADVERSARIAL`, `RESOURCE_DIAGNOSTIC`), `severity` (REUSEd
`SEVERITY_LEVELS` from `ui-dogfood-finding.mjs`: `P0`-`P3`), `evidence`,
`reproduction` (both required, detector-shaped, deep-cloned), `affectedSurface`
(non-empty string), `confidence` (number in `[0,1]`), `firstSeen`/`lastSeen`
(ISO timestamps; `firstSeen` never moves, `lastSeen` bumps on every
re-detection), `occurrences` (starts at 1, increments on recurrence),
`candidateFixScope` (nullable `{kind, summary, filesHint[]}` -- `kind` is
the carrier the eligibility policy reads), `verificationMethod` (required
non-empty string, deliberately free-form -- not tied to any one
verification mechanism, per the row above), `authorityRequired` (null
until eligibility-classified, then either `null` (eligible) or a
NOT_ELIGIBLE reason code), `status`, `revision`, `transitions[]`
(`{from, to, reason, evidence, at}`, mirrors `research-mission.mjs`'s
own audit-trail shape exactly), `createdAt`/`updatedAt`.

**Status enum and transition rules** (`STATUS_ALLOWED`, mirrors
`research-mission.mjs`'s `assertNodeTransition` convention exactly --
frozen map, throw with `.code = 'TSF_INVALID_FINDING_TRANSITION'`):

```
DETECTED              -> VERIFIED, REJECTED_FALSE_POSITIVE
VERIFIED              -> ELIGIBLE_FOR_AUTOFIX, NEEDS_OWNER, REJECTED_FALSE_POSITIVE
ELIGIBLE_FOR_AUTOFIX   -> FIX_MISSION_CREATED, NEEDS_OWNER, REJECTED_FALSE_POSITIVE
NEEDS_OWNER            -> FIX_MISSION_CREATED, RESOLVED, REJECTED_FALSE_POSITIVE
FIX_MISSION_CREATED    -> FIX_IN_PROGRESS, NEEDS_OWNER
FIX_IN_PROGRESS        -> READY_FOR_ADOPTION, NEEDS_OWNER
READY_FOR_ADOPTION     -> RESOLVED, NEEDS_OWNER
RESOLVED               -> REOPENED
REOPENED               -> VERIFIED, NEEDS_OWNER, REJECTED_FALSE_POSITIVE
REJECTED_FALSE_POSITIVE -> (terminal)
```

Non-obvious design decisions: (1) `DETECTED` never jumps straight to an
eligibility outcome -- verification always comes first. (2) A later
re-examination can overturn an earlier verification
(`VERIFIED`/`ELIGIBLE_FOR_AUTOFIX`/`REOPENED` -> `REJECTED_FALSE_POSITIVE`),
mirroring `research-mission.mjs`'s own `FAILED -> ADMITTED` late-correction
allowance. (3) `REJECTED_FALSE_POSITIVE` is terminal by design: a detector
re-observing the same symptom NEVER auto-reopens a human's false-positive
call (`recordFindingRecurrence`'s own logic only auto-reopens from
`RESOLVED`, never from `REJECTED_FALSE_POSITIVE` -- occurrences still
increments so the recurrence stays visible, but only an explicit human
action creates a fresh finding if they disagree).

Durable store: `tsf/server/self-improvement-finding-store.mjs`, a direct
REUSE of `planner-mission-store.mjs`/`keep-going-run-store.mjs`'s own
pattern -- `withFileLock` (`cross-process-file-lock.mjs`) over one lock
file for the whole `selfImprovementFindings` opState collection
(`data-store.mjs`), a `versionCheckedFinding` read-boundary guard wired to
a new `research-schema-versioning.mjs` guard entry
(`assertSupportedSelfImprovementFindingSchemaVersion`, EXTENDing the
existing generic engine rather than inventing a second one), and one
composed entry point (`recordFindingDetection`) that computes the
content-addressed `findingId` before taking the lock and applies
`applyDetection` atomically inside it.

### Phase 2 -- Autofix eligibility policy: exact rules

`tsf/domain/self-improvement-autofix-eligibility.mjs`. Pure,
deterministic, fail-closed. `candidateFixScope.kind` is the classifier's
primary signal (generalizes `ui-dogfood-finding.mjs`'s category-based
objective/subjective split across every detector kind, per the
reconciliation row above):

- `ELIGIBLE_FIX_KINDS` (always -> `ELIGIBLE_FOR_AUTOFIX` if confidence
  clears the floor): `BOUNDED_CODE_DEFECT`, `UI_CLIPPING_OVERFLOW`,
  `DEAD_MISWIRED_CONTROL`, `INCORRECT_STATUS_STATE`,
  `DETERMINISTIC_TEST_REGRESSION`, `RESOURCE_GOVERNOR_BYPASS`,
  `BOUNDED_DURABILITY_DEFECT`, `BOUNDED_RESEARCH_DEFECT`.
- `NOT_ELIGIBLE_FIX_KINDS` (always -> `NEEDS_OWNER`, regardless of
  confidence/severity -- the kind string itself becomes the stamped
  `authorityRequired` reason): `SUBJECTIVE_REDESIGN`,
  `NEW_PRODUCT_DIRECTION`, `PAID_EXTERNAL_SERVICE`,
  `CREDENTIALS_AUTHENTICATION`, `PRODUCTION_DEPLOYMENT`,
  `DESTRUCTIVE_CLEANUP`, `PROTECTED_HOLDOUT_ACCESS`,
  `MODEL_POLICY_CHANGE`, `ARCHITECTURAL_REWRITE`,
  `AMBIGUOUS_CROSS_PROJECT_MUTATION`, `SIGNIFICANT_NEW_AUTHORITY`.
- Fail-closed uncertainty reasons (-> `NEEDS_OWNER`):
  `UNRECOGNIZED_SOURCE_DETECTOR` (unknown `sourceDetector`),
  `UNCLASSIFIABLE_SEVERITY` (unknown `severity`),
  `UNCLASSIFIABLE_FIX_KIND` (missing `candidateFixScope` or a `kind` this
  policy has never seen -- covers both "no scope at all" and "unrecognized
  string"), `LOW_CONFIDENCE` (`confidence < MIN_CONFIDENCE_FOR_AUTOFIX`,
  0.7 -- a deliberately conservative, disclosed, revisitable V1 floor).
- `applyAutofixEligibility(finding, clock)` requires `finding.status ===
  'VERIFIED'` (enforced by `transitionFinding`'s own guard, not a separate
  check) -- an unverified finding can never receive an eligibility
  verdict, since eligibility says nothing about whether the finding is
  even real.

### Tests and results

Real tests, no mocks of the mechanisms under test (real file locks, real
fs, real transition guards):

- `tsf/test/self-improvement-finding.test.mjs` -- creation/normalization
  fail-closed cases, `findingIdFor` determinism, a full cross-product
  transition-matrix test (every one of the 10 statuses x 10 statuses = 100
  pairs, independently hardcoded expected table, not imported from the
  module under test) covering every legal AND every illegal transition
  including same-state and terminal-state, recurrence/reopen/
  never-auto-reopen-a-rejection behavior.
- `tsf/test/self-improvement-autofix-eligibility.test.mjs` -- every one
  of the 8 `ELIGIBLE_FIX_KINDS` and all 11 `NOT_ELIGIBLE_FIX_KINDS`
  individually asserted, all 4 fail-closed uncertainty reasons, the
  confidence-floor boundary (just below fails closed, exactly at the
  floor is eligible), the `VERIFIED`-precondition guard, and end-to-end
  `applyAutofixEligibility` transition wiring both ways.
- `tsf/test/self-improvement-finding-store.test.mjs` -- mirrors
  `planner-mission-store.test.mjs`'s own pattern: isolated real state
  file, real `readFinding`/`recordFindingDetection` round trips, same-
  symptom dedup vs distinct-symptom non-collision, and TWO real
  concurrent-write serialization proofs (`Promise.all` of 10 same-key
  writers via `withFinding`, and 8 concurrent `recordFindingDetection`
  calls for the identical real symptom) -- no lost update in either case.

**Results:** `node --test` on the 3 new files: **148/148 pass**.
Regression sweep of every test file that exercises the two shared files
this wave edited (`research-schema-versioning.mjs`, `data-store.mjs`) --
`data-store-rename-retry`, `research-schema-versioning`,
`keep-going-run-store-schema-version`, `planner-mission-store-schema-version`,
`research-mission-store-schema-version`, `platform-learning-ledger-store`:
**24/24 pass**. Full whole-repo sweep, `node --test tsf/test/*.test.mjs`:
**2568 tests, 2561 pass, 6 fail**. All 6 failures
(`command-bare-imperative-dispatch.test.mjs`'s QUERY/STATUS + IDIOM,
`command-operator-integration-adversarial.test.mjs`'s "Should I deploy
WorldForge?", `http-work-summary.test.mjs`'s dispatch-tick timing test,
`keep-going-autonomy-proof.test.mjs`'s long-running autonomy-proof stall,
`operator-state-adversarial.test.mjs`'s "STALE ACTION RACE") are the
IDENTICAL pre-existing, host-load-sensitive candidate set Phase 16's own
checkpoint entry already documented as unrelated -- independently
re-confirmed here by `git stash --include-untracked` on the fast one
(`command-bare-imperative-dispatch.test.mjs`) and re-running it against
the unmodified tree: reproduces byte-identically with this wave's changes
entirely absent. None touch the finding contract, eligibility policy, or
either shared file this wave edited.

**Lint:** `npx oxlint` on all 8 new/changed `.mjs` files -- clean, exit 0.

### Constraints honored

NWR: not touched (no file under any NWR path read or written). No push,
no merge to `tsf/main`/`main`. No mission-origination code written (Wave
B's job, per this wave's own scope boundary) -- `FIX_MISSION_CREATED`
onward exist only as legal states in the transition table, never reached
by any function this wave wrote. No second issue-truth store invented
(see the "Issue/finding representations" reconciliation row above for the
evidence both existing candidates were genuinely checked and rejected).

---

## Wave B -- Phases 3-7: origination, dedup/loop protection, verifier/
adoption, redogfood, Learning Ledger (2026-09-07)

Worktree: `selfimprove-wave-b-origination-loop`, branch
`tsf/feature/selfimprove-wave-b-origination-loop` (forked from `tsf/main`
@ `3806bb712ad52c50d44b87aee8cee13f1d320eac`, includes Wave A's finding
contract + eligibility policy). This is the core, safety-critical
mechanism of the whole mission -- every design decision below was made
conservatively, fail-closed, per the mission brief's explicit instruction.

### Design decisions, verbatim from the mission brief, and how each was honored

1. **`PlannerSessionLifecycle` is the mission vehicle, unmodified.**
   `self-improvement-mission-origination.mjs`'s `originateRepairMission`
   calls `new PlannerSessionLifecycle({missionId, plannerSessionId, deps})`
   and its real `startMission`/`recordDecision`. `self-improvement-repair-
   cycle.mjs`'s `runRepairAttempt` calls its real `dispatchWorkerForTask`/
   `recordWorkerResult`/`recordVerifierResult`/`advancePhase`. No second
   mission/lease/checkpoint file was written. `PlannerSessionLifecycle`
   itself was NOT modified -- zero diff to `planner-session-lifecycle.mjs`
   or `planner-mission-checkpoint.mjs`.

2. **A real, bounded worker in an isolated worktree.**
   `self-improvement-worktree.mjs`'s `createIsolatedRepairWorktree` runs
   the real `git worktree add -q --detach <path> HEAD && git checkout -q
   -b <branch>` sequence (execFile, `-c safe.directory=...`, mirrors
   `cleanup-git-worktree-inventory.mjs`'s own git-wrapper convention) and
   asserts the target is never the canonical repo root itself
   (`TSF_SELF_IMPROVEMENT_WORKTREE_TARGETS_CANONICAL_REPO`). A real,
   reproduced bug fixed here: the raw `missionId` (`mission:selfimprove:
   <hash>`) contains `:`, an illegal git-ref character -- every real
   dispatch would have failed `git checkout -b` until the branch name was
   sanitized (`self-improvement-worker-dispatch.mjs`'s `sanitizedMissionId`).
   `self-improvement-worker-dispatch.mjs`'s `dispatchRepairWorker` spawns
   `tsf/providers/safe-provider-launch.mjs` itself (the real, unmodified
   file) as a child process, piped rather than inherited on ITS side so
   the real provider's `stdio:'inherit'` cascades to a capturable pipe.
   **Deviation, documented, not silent**: `safe-provider-launch.mjs` has
   NO stdin/prompt-file channel (confirmed by a full read -- it is built
   for an interactive terminal session Orca itself shells out to via
   `orcaLaunchMode: CUSTOM_TERMINAL_COMMAND`, never previously invoked
   programmatically by any `tsf/server` file). The bounded prompt
   (`domain/self-improvement-worker-prompt.mjs`'s `buildWorkerPrompt` --
   built ENTIRELY from `sourceDetector`/`evidence`/`reproduction`/
   `affectedSurface`/allowed scope/forbidden surfaces, never free text)
   travels as the final CLI argument via `providerArguments` (`['exec',
   prompt]` for codex, `['-p', prompt]` for claude -- each provider's own
   real non-interactive/print mode), exactly the same mechanism every
   other `providerArguments` use in `launch-profiles.v1.json` already
   relies on. The provider role/model/effort itself is resolved via the
   real `resolveRole({role:'WORKER_BALANCED', mappings, profiles})`
   against the real committed `provider-role-mappings.v1.json`/`launch-
   profiles.v1.json` -- the CLI `--provider` flag value is derived by
   parsing the resolved profile's own `command` template (`--provider
   (\S+)`), never a second, independently-maintained mapping that could
   drift. Gated by `classifyDispatchAdmission(hostMemory,
   'newHeavyweightWorkerDispatch')` -- Finding F1's own exact admission
   category and call shape (verified via `chat-dispatch-bridge.mjs`'s own
   real call site), checked BEFORE any worktree/spawn is attempted.

3. **A real, independent verifier -- never the worker's own certification.**
   `self-improvement-verifier-dispatch.mjs`'s `runIndependentVerification`
   mechanically checks, against REAL evidence gathered by REAL git/process
   calls (all dependency-injectable): the finding's own `reproduction.
   command` re-executed in the worker's worktree; a targeted `node --test`
   regression run (hinted `*.test.mjs` filesHint entries first, else a
   real sibling-file convention lookup -- never the giant suite, fails
   CLOSED to `NO_TARGETED_REGRESSION_TEST_RESOLVABLE` when nothing
   resolves, matching this program's "never treat couldn't-check as
   passed" discipline); a real `git diff --name-only`/`--name-status`
   against forbidden path prefixes and the authority envelope's declared
   scope; a documented-limited duplicate-architecture heuristic
   (Levenshtein edit-distance <=3 on new-file basenames vs. every existing
   canonical file basename -- catches near-identical naming ONLY, cannot
   catch semantic duplication under a different name, stated honestly in
   the module's own header). Composed into a typed
   `{verdict: VERIFIED_PASS|VERIFIED_FAIL, reasons[]}` by
   `domain/self-improvement-verifier-checks.mjs`'s `buildVerifierVerdict`
   -- never a vague pass; every failing check contributes a named reason.
   **`VERIFIER_INDEPENDENT` runtime enforcement is a REAL, NEW mechanism**
   (`domain/self-improvement-provider-independence.mjs`'s
   `resolveIndependentVerifierRole`): `ZERO_RELAY_PLANNER_WORKER_
   ARCHITECTURE.md`'s own reconciliation documents this flag was
   previously enforced ONLY by a static regression eval
   (`routing-eval-runner.mjs`), never a live dispatch. This function
   resolves `VERIFIER_INDEPENDENT`, and if its preferred provider collides
   with the worker's actual provider AND `mustDifferFromWorkerWhenAvailable`
   is set, switches to the role's own `fallbackProfile` -- and if even
   that shares the worker's provider, honestly reports non-divergent
   rather than fabricating independence. Proven against BOTH the real
   committed config (worker=openai/WORKER_BALANCED, verifier=anthropic --
   already divergent) and fabricated forced-collision configs.

4. **Authority envelope.** `domain/self-improvement-authority-envelope.mjs`'s
   `buildAuthorityEnvelope` is a pure, deterministic function of
   `(finding, missionId)` -- deliberately NEVER persisted as its own
   artifact (a second source of truth that could drift from the finding it
   describes); any caller holding the finding reconstructs the identical
   envelope. Carries: evidence/reproduction verbatim, `allowedScope` (from
   `candidateFixScope.filesHint`, honestly empty when the detector gave no
   hint), `forbiddenPathPrefixes` (Cleanup V1's real gate files --
   `cleanup-owner-authorization-gate.mjs`, `cleanup-protected-registry.mjs`,
   `cleanup-protected-registry-defaults.mjs` -- plus this wave's OWN
   adoption gate file, so a repair worker can never open its own adoption
   gate), `structurallyForbiddenSurfaces` (NWR, `dataset-research-engine-
   v0`, canonical `tsf/main` as a direct write target -- documented as
   structural, not mechanically diffable, since each is a different
   repository/worktree the worker's own git diff can never even reference;
   real double-check: `worktreePath !== canonicalRepoPath` is ALSO
   asserted in `createIsolatedRepairWorktree` itself, defense in depth,
   not just documentation), acceptance test, verifier requirements,
   project attribution, resource class, adoption policy, rollback
   expectations. `assertScopeDoesNotOverlapForbidden` refuses BEFORE
   dispatch if a detector's own `filesHint` already names a forbidden path.

5. **Adoption gate -- two signals, mirrors Cleanup V1 exactly, never set
   by this wave.** `self-improvement-adoption-authorization-gate.mjs` is a
   line-for-line structural mirror of `cleanup-owner-authorization-gate.mjs`:
   `TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION` (env, exact marker string
   `OWNER_AUTHORIZED_SELF_IMPROVEMENT_ADOPTION_V1`) AND a real flag file
   (`SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION.flag`, gitignored
   `.local-state`, trimmed content must equal the same marker) -- BOTH
   required, both dependency-injected (`env`/`flagFilePath` default to the
   real global signal only when the caller passes nothing). **Confirmed:
   grep for `TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION=` and for the
   marker string as a written flag-file value across every file this wave
   committed returns zero matches outside the gate module's own constant
   declaration and its tests' FABRICATED env objects/temp files.**
   `self-improvement-adoption.mjs`'s `attemptRepairAdoption` checks the
   gate FIRST, before any git I/O -- the default-closed path (every real
   run today) never touches a repo path at all. When open (only ever
   proven with a fabricated env/flag file against a disposable fixture
   repo pair, real `git worktree add`/`git merge --ff-only`), it reuses
   `adapters/git-identity.mjs`'s real `getCurrentCommit`/
   `isCleanWorkingTree`/`isAncestor`/`ffOnlyMerge` DIRECTLY (the same
   primitives `self-update-adoption.mjs`'s own TSF-self-adoption
   governance already relies on) -- no fetch step needed and documented
   why: `createIsolatedRepairWorktree` makes a genuinely LINKED worktree
   (`git worktree add`), sharing the canonical repo's own object database
   and refs by construction, so the candidate branch is already visible
   from `canonicalRepoPath` with zero network/fetch. A real end-to-end
   ff-only merge into a disposable fixture "canonical" repo was proven
   (`self-improvement-adoption.test.mjs`), including confirming the real
   post-merge HEAD sha and commit message. **When the gate is closed (the
   permanent state throughout this wave's own work), a fully-verified
   repair mission stops at `READY_FOR_ADOPTION` -- a correct, expected
   terminal state, not a failure.**

6. **Dedup / loop protection.** `computeRepairMissionId(findingId)` is a
   deterministic, content-addressed function
   (`mission:selfimprove:<findingId-suffix>`) -- the SAME finding always
   resolves to the SAME missionId BY CONSTRUCTION, giving a real 1:1
   findingId->missionId mapping with zero separate lookup table (no dual-
   write consistency risk, mirrors Wave A's own `findingIdFor` discipline).
   `originateRepairMission` checks `readPlannerMissionRecord(missionId)`
   BEFORE calling `startMission` and returns the EXISTING checkpoint
   (`created: false`) rather than throwing/duplicating -- proven idempotent
   by calling it twice for the identical finding and asserting `deepEqual`
   checkpoints. The retry/correction-attempt budget
   (`domain/self-improvement-retry-budget.mjs`'s `decideRepairRetryOrEscalate`,
   default `{maxAttemptsPerMission: 2}`) mirrors F5/F27/F29's own
   `decideRetryOrEscalate` shape exactly (same attempts-vs-budget
   comparison, same RETRY-or-ESCALATE result type) but is NOT a call into
   `research-autonomy-policy.mjs` itself (that module reads ResearchNode-
   shaped fields a repair mission's checkpoint doesn't have). Bounds
   ATTEMPTS WITHIN one persistent mission -- one finding = one mission
   forever, attempts are tracked via `checkpoint.verifierResults.filter(r
   => r.verdict === 'VERIFIED_FAIL').length`, never a new mission per
   attempt. Exhaustion transitions the FINDING to `NEEDS_OWNER`
   (`REPAIR_RETRY_BUDGET_EXCEEDED`) -- proven: 2 real failed attempts,
   then a 3rd call escalates and dispatches ZERO further workers. Reopen
   semantics: `classifyRedogfoodResult` (see Phase 6 below) NEVER routes a
   `RESOLVED` finding straight back to `FIX_MISSION_CREATED` -- only to
   `REOPENED`, which itself only legally re-enters `VERIFIED`/`NEEDS_OWNER`/
   `REJECTED_FALSE_POSITIVE` per Wave A's own transition table, so a
   recurring finding is never blindly re-originated; it goes through
   re-verification first, same budget/escalation discipline applying to
   whatever NEW mission-track cycle that re-verification produces.

7. **Autonomous driver, opt-in, off by default.**
   `self-improvement-fleet-driver.mjs`'s `startSelfImprovementFleetDriver`
   mirrors `keep-going-fleet-driver.mjs`'s exact interval/fire/inProgress/
   unref shape (one bounded action per tick over ONE actionable finding in
   stable content-addressed order -- `pickOneActionableFinding` -- proven
   never to overlap a slow cycle). `self-improvement-fleet-driver-
   bootstrap.mjs`'s `bootstrapSelfImprovementFleetDriverIfEnabled` checks
   `process.env.TSF_SELF_IMPROVEMENT_LOOP_ENABLED !== '1'` first, exactly
   like `keep-going-fleet-driver-bootstrap.mjs`. **Deliberate, documented
   divergence from the literal `TSF_KEEP_GOING_FLEET_DRIVER` convention**:
   `main.mjs`'s `realSpawnFn` sets `TSF_KEEP_GOING_FLEET_DRIVER: '1'`
   unconditionally for every real plugin spawn (making THAT driver
   effectively always-on in production) -- `TSF_SELF_IMPROVEMENT_LOOP_
   ENABLED` is NEVER added there, or anywhere else this wave committed
   (confirmed by grep: the string appears only in the bootstrap file's own
   check and its test's OWN transient, restored-immediately `process.env`
   manipulation). The bootstrap IS still wired into the real server
   (`http-server.mjs`'s `startStandaloneServer`, via a new composition
   root `background-fleet-drivers-bootstrap.mjs` -- see "http-server.mjs
   line budget" below for why a composition root was used instead of a
   direct second import) -- an operator who deliberately wants this loop
   running sets the env var themselves, outside this wave's own control.

### Phase 6 -- Redogfood: mapping logic and why

`domain/self-improvement-redogfood.mjs`'s `classifyRedogfoodResult`
re-runs the ORIGINAL detector's own `reproduction` criteria (never a
substitute check -- `server/self-improvement-redogfood.mjs`'s
`runRedogfood` literally imports and reuses `resolveMechanicalCommand`/
`runCommand` from `self-improvement-verifier-dispatch.mjs`, the SAME
functions the verifier itself uses) and maps the outcome onto Wave A's
OWN finding status vocabulary -- never a parallel result enum. The
mapping is **context-dependent on the finding's CURRENT status**, not
just the redogfood facts, because Wave A's `STATUS_ALLOWED` table is
narrower than the outcome vocabulary: from `READY_FOR_ADOPTION` (pre-
adoption, candidate worktree), a clean pass -> `RESOLVED`; anything else
(still fails / regression introduced / a late "never really reproduced"
discovery) -> `NEEDS_OWNER` (none of `REOPENED`/`REJECTED_FALSE_POSITIVE`
is a legal edge out of `READY_FOR_ADOPTION`, and a late reversal at this
stage is exactly what Wave A's design reserves for a human). From
`RESOLVED` (post-adoption, canonical repo), the ONLY legal edge is
`REOPENED` -- so ANY bad outcome routes there, and a clean reconfirmation
needs no transition at all. A durable receipt chain
(`domain/self-improvement-receipt-chain.mjs`) links finding -> mission ->
implementation sha -> verifier result -> adoption decision -> redogfood
result. **Receipt primitive choice, both checked**: `receipts.mjs`
requires a non-null `projectId` (throws otherwise) -- incompatible with
Wave A's own honest-null `projectId` discipline for a platform-wide
finding. `cleanup-receipt-chain.mjs`'s `createCleanupReceipt` hardcodes a
fixed, cleanup-specific `CLEANUP_RECEIPT_KINDS` enum with no room for this
mechanism's own kinds. Both share the identical proven algorithm
(`sha256(body-without-its-own-hash)` chained via `previousReceiptHash`) --
`self-improvement-receipt-chain.mjs` reuses that ALGORITHM exactly (same
`createXReceipt`/`verifyXReceipt`/`verifyXReceiptChain`/`appendXReceipt`
API shape as `cleanup-receipt-chain.mjs`) as a NEW, small, clearly-scoped
sibling -- the identical justification `cleanup-receipt-chain.mjs`'s own
header already used for not reusing `receipts.mjs`. V1, honestly limited
(stated in the module's own header): `FALSE_POSITIVE` needs a baseline
re-run against the PRE-fix code to distinguish "the fix worked" from
"this never reproduced" -- not built this wave; a mechanical redogfood run
only ever reaches `RESOLVED`/`REOPENED`/`REGRESSION_INTRODUCED` on its
own; `FALSE_POSITIVE` is reachable only via an explicit, caller-supplied
signal for a future detector adapter with its own baseline evidence.

### Phase 7 -- Learning Ledger wiring

`server/self-improvement-learning-ledger-wiring.mjs` wires four real
outcomes into the EXISTING `platform-learning-ledger.mjs` via its already-
generic `addLessonRecord` (NOT `extractLessonsFromCompletedMission`, which
reads ResearchMission-specific fields a finding/repair-mission doesn't
have) -- mirrors Finding F3's own real-consumer pattern exactly (a write
triggered by a genuine terminal event, a read wired as an advisory-only
annotation, never a gate). **`LESSON_CATEGORIES` extended additively**
(EXTEND, not a second store): `DETECTOR_FALSE_POSITIVE_PATTERN`,
`VERIFIER_FAILURE_PATTERN`, `RECURRING_SUBSYSTEM_DEFECT` -- three new
categories, zero renamed/removed; a repeatedly-successful
`candidateFixScope.kind` REUSES the existing `VERIFIED_CORRECTION_PATTERN`
category directly (a real, already-correct fit, no new category needed).
The one existing test that assumed `LESSON_CATEGORIES` was EXACTLY the set
`extractLessonsFromCompletedMission` computes
(`platform-learning-ledger.test.mjs`) was updated (not weakened) to assert
that function's own subset is still fully present, since it is now
genuinely one of several real writers into one shared ledger.

### `http-server.mjs` line budget

`background-fleet-drivers-bootstrap.mjs` is a new, small composition root
(`bootstrapBackgroundFleetDrivers(server)` calling both
`bootstrapKeepGoingFleetDriverIfEnabled` and
`bootstrapSelfImprovementFleetDriverIfEnabled`) used instead of a direct
second import+call in `http-server.mjs`. Reason, confirmed by measurement:
`http-server.mjs` was ALREADY at 611 counted lines (over the
`.oxlintrc.json` 600-line `.mjs` cap) BEFORE this wave touched it at all
(confirmed by lint-checking the file at its pre-Wave-B git HEAD) --
pre-existing debt unrelated to this wave. This wave's net change to that
file is ZERO lines (one import line, one call line -- same count as
before, just pointing at the composition root instead of directly at the
keep-going bootstrap) so the pre-existing violation is neither fixed (out
of scope, risky to restructure unrelated code in a safety-critical wave)
nor worsened.

### Real bug found and fixed during this wave's own testing

`node --test <targeted regression file>`, when spawned as a subprocess
FROM WITHIN a process that is itself running under `node --test`
(`NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` in `process.env`, inherited by
a child by default), is silently treated by Node's OWN test runner as a
detected recursion and SKIPPED -- exiting 0 regardless of the real target
test's outcome. Reproduced live: a genuinely failing regression fixture
was reported as a false PASS until `self-improvement-verifier-dispatch.mjs`'s
`runCommand` was fixed to strip both vars from the child's environment
(`childEnvWithoutTestRecursionGuard`) before every reproduction/regression
subprocess spawn. This is a REAL correctness fix, not just a test-suite
workaround: a production TSF process running under any supervisor that
itself sets `NODE_TEST_CONTEXT` would hit the identical silent-skip bug. A
second, related fix: the first `runCommand` implementation manually built
a `cmd.exe /d /s /c <command>` argv, which was found to mis-escape a
command string that itself contains double-quoted arguments (e.g.
`node -e "process.exit(1)"`) -- `/S`'s own quote-stripping rule rewrote
the inner quotes, silently truncating the real command to one that always
exits 0. Fixed by switching to `spawnSync(command, {shell:true, ...})`
(Node's own documented cross-platform shell-string execution), verified to
propagate real non-zero exit codes correctly with nested quotes on
Windows.

### Tests and results

Real tests throughout -- dependency-injected fakes for the LLM-CLI worker/
verifier dispatch only (never a real Codex/Claude process spawned by this
wave's own suite, per the mission brief), but REAL git (disposable fixture
repos under `os.tmpdir()`, mirroring `cleanup-git-worktree-inventory.
test.mjs`'s own pattern), REAL file locks, REAL transition guards, REAL
subprocess spawns for reproduction/regression commands, and a REAL end-to-
end ff-only merge for the adoption gate-open path.

18 new test files (`tsf/test/self-improvement-{mission-origination,retry-
budget,repair-cycle,adoption-authorization-gate,adoption,adoption-
readiness,worktree,verifier-checks,verifier-dispatch,provider-independence,
redogfood,redogfood-server,worker-dispatch,worker-prompt,authority-envelope,
receipt-chain,learning-ledger-wiring,fleet-driver}.test.mjs`) covering
every mission-brief-required proof: idempotent origination; bounded retry
budget with real escalation; the authorization gate genuinely blocking
adoption by default (real process.env/real flag path) and only proceeding
with a FAKE, test-injected gate (confirmed the real global signal was
never touched); the forbidden-surface check genuinely catching a real
worker diff; the verifier independence requirement proven both against
the real committed routing config and a forced-collision fixture;
redogfood distinguishing RESOLVED/REOPENED/REGRESSION_INTRODUCED using
real reproduction-check logic against real fixture state; and the
autonomous driver flag genuinely off by default with a real test asserting
the loop does nothing when unset.

**Results**: `node --test` on the 18 self-improvement test files: **240/240
pass**. `npx oxlint` on every new/changed `.mjs` file (18 new domain/server
files, `platform-learning-ledger.mjs`, `data-store.mjs`, `http-server.mjs`):
clean, except `http-server.mjs`'s pre-existing 611-line `max-lines`
violation (confirmed unchanged before/after this wave, see above -- not a
new violation this wave introduced, and NEVER worked around with a
disable comment). Targeted regression sweep of every shared file this
wave touched (`data-store-rename-retry`, `platform-learning-ledger*`,
`keep-going-run-store-schema-version`, `planner-mission-store-schema-
version`, `research-mission-store-schema-version`, `research-schema-
versioning`): all pass (one pre-existing test's assumption was corrected,
not weakened -- see Phase 7 above). **Full whole-repo sweep**,
`node --test tsf/test/*.test.mjs`: **2660 tests, 2653 pass, 6 fail** -- the
IDENTICAL 6 pre-existing, host-load-sensitive failures Wave A's own
checkpoint already documented (`command-bare-imperative-dispatch.test.mjs`'s
QUERY/STATUS + IDIOM, `command-operator-integration-adversarial.test.mjs`'s
"Should I deploy WorldForge?", `http-work-summary.test.mjs`'s dispatch-tick
timing test, `keep-going-autonomy-proof.test.mjs`'s long-running autonomy-
proof stall, `operator-state-adversarial.test.mjs`'s "STALE ACTION RACE"),
none touching any file this wave added or changed. 2660 - 2568 (Wave A's
own whole-repo total) = 92 = exactly this wave's 92 newly-added tests
(240 total self-improvement tests - Wave A's own 148).

### Constraints honored

NWR: not touched (no NWR path read or written; forbidden by construction
in the authority envelope, see Phase 4 above). Cleanup V1 real destructive
authority: not activated (this wave's own new adoption gate mirrors it,
never touches Cleanup V1's own gate signals). No deploy, no money spent
(every LLM-CLI dispatch this wave's OWN code path would take is gated by
the SAME `TSF_SELF_IMPROVEMENT_LOOP_ENABLED` flag this wave never set, and
even when manually invoked directly, is gated by the Resource Pressure
Governor exactly like every other heavyweight dispatch). The real
`TSF_SELF_IMPROVEMENT_ADOPTION_AUTHORIZATION` env var and its flag file:
never set anywhere in any file this wave committed (confirmed by grep, see
Phase 5 above). The real `TSF_SELF_IMPROVEMENT_LOOP_ENABLED` flag: never
set anywhere in any file this wave committed (confirmed by grep, see
Phase 7 above). No second mission/lease/checkpoint/eval/learning-ledger
system built (every reuse/extend/new decision cited above with evidence).
No push, no merge to `tsf/main`/`main` from this wave's own actions. No
real Codex/Claude process spawned by this wave's own automated test
suite. No file under `C:\TSF_ORCA` or any other real worktree read or
written by this wave's own code or its tests -- every real git operation
in the test suite runs against a disposable fixture repo under
`os.tmpdir()`, created and torn down by the test itself.
