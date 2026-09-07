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
| 3-8 (Mission origination through Security review) | NOT_STARTED | Wave B's job |
| 9 (Golden proof) | NOT_STARTED | Acceptance test |
| 10 (Chaos proof) | NOT_STARTED | |

## Next intended action

Wave B: mission origination from an `ELIGIBLE_FOR_AUTOFIX` finding. Do
NOT re-derive the reconciliation below from scratch -- re-verify with a
fresh read (code may have shifted) and build on it. The composable,
production-wired primitive to reuse for dispatch is
`chat-dispatch-bridge.mjs`'s `planAndDispatchFromChat` (structured,
non-chat-text callable given `{project, placement, identity}` -- its one
free-text input, `message`, still goes through a live LLM planner call).
`PlannerSessionLifecycle` (`planner-session-lifecycle.mjs`) remains
test-only/unwired to any production entrypoint as of this wave -- confirm
this is still true before relying on either path being "already wired."

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
