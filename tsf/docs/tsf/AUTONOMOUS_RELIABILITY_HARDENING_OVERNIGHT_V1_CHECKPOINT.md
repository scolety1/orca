# TSF — Autonomous Reliability + Operator Experience Hardening Overnight V1 — Durable Checkpoint

Owner directive: "AUTONOMOUS RELIABILITY + OPERATOR EXPERIENCE HARDENING
OVERNIGHT V1" (ZERO TIM RELAY). This file is the durable memory of record
for this program — updated after every adopted fix/checkpoint, not just
held in chat.

## Baseline (program start)

- Canonical `tsf/main` SHA: `46682022e7e8ef69f5380bbbcd474756bcfe1569`
  (includes the just-completed Autonomous Post-Cleanup Upgrade Program V1
  and the Cross-Provider Research Worker Reconciliation V2)
- Fork checkpoint (`fork/tsf/main`): matches exactly
- Working tree: clean
- Active TSF subagents at program start: none (`ListAgents` — only
  interactive NWR sessions and offline Remote-Control peers)
- Worktrees at program start: only `dataset-research-engine-v0` (held,
  `NWR_HISTORICAL_EVIDENCE_PRESERVATION_HOLD`, untouched by this program
  per hard project isolation)
- Free memory at program start: ~2.34GB / 15.85GB
- Provider capabilities (`provider-capabilities.v1.json`, observed
  2026-08-17, advisory-only): Codex `AVAILABLE`/subscription-backed;
  Claude-code `UNAVAILABLE_ON_VALIDATION_HOST` as a launch profile on
  this host (the live Claude session directing this program is unrelated
  to that launch-profile status)
- Known pre-existing bug/requirement filings found at program start:
  `tsf/programs/tsf-operator-stabilization-v1/bug-ledger.json`,
  `tsf/docs/tsf/DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md`
  (already fully reconciled in the prior program)

## Hard project isolation (verbatim, must be preserved)

Do not modify NWR model code, datasets, validation, historical research,
active candidates, or holdouts, or any other project repository. The 2025
NWR sealed holdout is completely out of scope. Inspect project state only
where necessary to prove generic TSF orchestration behavior. Use
disposable TSF pilot projects/fixtures wherever possible.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1. Post-Upgrade Gap Reconciliation | IN_PROGRESS | Findings F18, F1, F3, F4, F5, F6, F7 fixed so far |
| 2. Background Task Truthfulness | INVESTIGATED, NO GAP | See dedicated section below -- no fix warranted |
| 4. UI Self-Dogfood (UI_DOGFOOD_AGENT_V0) | DONE | Finding F8 reconciled and fixed; see dedicated section below |
| 6. Global Operator State / Needs You Audit | DONE | Finding F19 fixed; see dedicated section below |
| 7. Command Control-Surface Dogfood | DONE | Findings F20 (STATUS/FINISHED vocabulary gap), F21 (quantified pause/resume mis-targeting) fixed; see dedicated section below |
| 10. Cleanup V1 Destructive Safety Gauntlet | DONE | 16-scenario reconciliation (14 already covered, 2 genuinely new); 1 real crash-recovery bug found, reproduced, fixed (requestId/quarantineId mismatch); capstone stacked-blocker adversarial passed with no fix needed; see dedicated section below |
| 13. Evaluation / Regression Quality | DONE | 2 real acceptance-level gaps confirmed and closed (TSF_PLATFORM_GOLDEN_PATH_EVAL, TSF_RESEARCH_GOLDEN_PATH_EVAL); Cleanup V1 investigated, already adequate; see dedicated section below |
| 14. Security / Authority Boundary Review | DONE | 1 real bug found, reproduced, fixed (Cleanup V1 protected-path registry canonicalization), 7 areas confirmed safe; see dedicated section below |
| 11. Provider / Worker Resilience | DONE | Findings F22 (planner dispatch double-spend on crash-mid-dispatch) and F23 (unvalidated structured-response shape / codex schema-forwarding gap) fixed; see dedicated section below |
| 3, 5, 8-9, 12, 15-17 | NOT_STARTED | Ranked and sequenced after Phase 1's gap matrix |

## TSF_POST_UPGRADE_GAP_MATRIX

(populated once Phase 1's audit agent reports)

## Adopted SHAs

(none yet this program)

## Owner Gates Outstanding

(carried forward from the prior program, not this program's to clear
unless a concrete dependency is discovered)
1. NWR preservation remediation (push `dataset-research-engine-v0` to a
   durable remote; preserve 57 unique + resolve 29 uncertain artifacts)
2. Cleanup V1 real activation gate (deliberately never set)
3. Phase 3's 3D real authenticated-download bridge (product/UI decision)
4. Astra: still unavailable/unproven — not to be added based on
   speculation, per this program's own explicit instruction

## Next intended action

Await Phase 1 gap-audit agent's report, then rank findings and begin
the AUDIT → RANK → REPRODUCE → FIX → TEST → REVIEW → DOGFOOD → ADOPT →
CHECKPOINT → CONTINUE loop.

## Phase 1 follow-up: F18 — global-scope routing bug (REAL production bug, fixed)

Worktree: `f18-global-scope-routing-bug` (branch
`tsf/feature/f18-global-scope-routing-bug`, forked from `tsf/main` @
`511582f9e3ce40b17bdb18537ef217d5514e2ded`).

**Symptom** (surfaced only once the `node_modules` gap was fixed, letting
`tsf/test/command-responder.test.mjs` run for the first time in a while):
3 of 28 tests failed. `"what needs me?"`, `"are there any projects here
that are safe to mess around with?"`, and `"is there anything safe we
can test on?"` all got the generic `"I couldn't tell which project this
is about..."` fallback instead of a real fleet-wide Needs-You/Advisory
answer.

**Root cause — REAL production bug, not test drift.** Confirmed by
running `classifyIntent` from `chat-responder.mjs` directly against the
failing phrasings:

```
"are there any projects here that are safe to mess around with?" -> QUESTION
"is there anything safe we can test on?" -> QUESTION
"what needs me?" -> QUESTION
```

`command-responder.mjs`'s `respondCommand` only invoked
`classifyGlobalScope` (the module that correctly routes these to
`GLOBAL_ADVISORY`/`NEEDS_YOU_QUERY` — its `deterministicScopeFallback`
regexes were verified correct and were never the problem) when
`intent === 'GENERAL'`:

```js
if (intent === 'GENERAL' && resolution.matches.length === 0) {
```

`chat-responder.mjs`'s `QUESTION` intent (added later, per its own
comment: "Recovered from a stranded uncommitted worktree") matches
*any* `"<interrogative>...?"` message that didn't match a more specific
pattern — the same catch-all role `GENERAL` plays for question-shaped
text. Nobody updated `command-responder.mjs`'s `GENERAL`-only gate when
`QUESTION` was introduced, so any global (no-named-project) question
phrased with a leading interrogative and a trailing `?` — which is how
Tim naturally asks "what needs me?" — was silently intercepted by
`QUESTION` before `classifyGlobalScope` ever ran, and fell through to
the generic "couldn't tell which project" fallback. This is a real,
live bug: the deployed server would give Tim the wrong answer to
"what needs me?" today.

**Fix**: `tsf/server/command-responder.mjs` — replaced the
`intent === 'GENERAL'` gate with a named
`UNROUTED_QUESTION_INTENTS = new Set(['GENERAL', 'QUESTION'])` set and
gated on `UNROUTED_QUESTION_INTENTS.has(intent)`, so a project-less
`QUESTION`-classified message reaches `classifyGlobalScope` exactly like
a `GENERAL`-classified one already did. No new classification/routing
mechanism — reuses the existing `classifyGlobalScope` call site.

**Tests**: `node --test tsf/test/command-responder.test.mjs` —
before: 28 total / 25 pass / 3 fail; after: 28 total / 28 pass / 0 fail.
Regression sweep across every other test file importing
`command-scope-classifier.mjs`, `chat-responder.mjs`, or
`command-responder.mjs` (16 files, 263 tests including the 28 above):
260 pass / 3 fail, and those 3 (`command-bare-imperative-dispatch.test.mjs`,
`command-operator-integration-adversarial.test.mjs`) fail identically
with the fix stashed out — a pre-existing, unrelated gap where a couple
of tests assert `classifyIntent(...) === 'GENERAL'` for phrasings that
`chat-responder.mjs` itself already classifies as `QUESTION`/
`FEEDBACK_BUG`; out of scope for this fix (not touched).
`npx oxlint tsf/server/command-responder.mjs` — clean, exit 0.

## Finding F1: Resource Pressure Governor gating gap -- FIXED

Worktree: `f1-resource-governor-gating`, branch
`tsf/feature/f1-resource-governor-gating` (forked from `tsf/main` @
`511582f9e3ce40b17bdb18537ef217d5514e2ded`).

**Gap.** `classifyDispatchAdmission` (`tsf/domain/resource-pressure-governor.mjs`)
was not consulted before 5 real production call sites spawned a heavyweight
LLM-CLI child process via `invokeLiveStructuredAnalysis`
(`tsf/server/live-planner.mjs`, a real `child_process.spawn`), unlike the 4
already-gated sites (`chat-dispatch-bridge.mjs`, `keep-going-dispatch-loop.mjs`
via `keep-going-resource-pressure-gate.mjs`, `planner-session-lifecycle.mjs`,
`research-mission-fleet-driver.mjs`).

**Admission-field decision.** All 5 sites reuse the existing
`'newHeavyweightWorkerDispatch'` admission category -- no new field was
warranted. Each site is a single, one-shot PLANNER_DEEP
`invokeLiveStructuredAnalysis` call, the same shape `chat-dispatch-bridge.mjs`
(work-plan synthesis) and `planner-session-lifecycle.mjs` (planner session
creation) already gate on that field; none of them dispatch a real paid
research worker (the `'newResearchWorkers'` category's actual referent), so
that field was never a fit.

**Fix, per site (fail-honest pattern matched per site's own existing
convention, not a single copy-pasted shape):**
- `tsf/server/command-research-spec-synthesis.mjs`
  (`synthesizeResearchSpecification`, was line 107): refuses with
  `{ ok:false, reason:'RESOURCE_PRESSURE_REFUSED', detail, tier }`, matching
  its existing `PLANNER_UNAVAILABLE`/`NEEDS_INPUT` shape family.
- `tsf/server/command-scope-classifier.mjs` (`classifyGlobalScope`, was line
  166): skips the live spawn entirely and returns the same
  `DETERMINISTIC_FALLBACK` shape a live-planner failure already produces,
  with `plannerFailure: 'RESOURCE_PRESSURE_REFUSED'`.
- `tsf/server/field-source-reconciliation.mjs` (`reconcileFieldsToHeaders`,
  was line 47): fails closed to `[]` (no bindings), identical to its
  existing "planner unavailable" behavior -- an unresolved field stays
  unresolved, never guessed.
- `tsf/server/onboarding.mjs` (`analyzeRepository` was line 331,
  `retryDirectionAnalysis` was line 516): the read-only analysis itself
  never fails -- `direction` degrades through the existing `shapeDirection`
  "unavailable" shape (`live:false`, `unavailableReason:
  'RESOURCE_PRESSURE_REFUSED'`), so repo/health/migration facts still
  return. `live-planner.mjs`'s `fallbackLabel` gained a friendly label for
  this reason.
- `tsf/server/wbs-generation.mjs` (`generateWbs`, was line 113): refuses
  with `{ ok:false, reason:'RESOURCE_PRESSURE_REFUSED', detail }`, matching
  its existing failure shape.

Each function gained an optional `deps.collectHostMemoryEvidence` override
(default: the real `resource-pressure-collector.mjs` collector), mirroring
`chat-dispatch-bridge.mjs`'s own injection convention, so tests can force a
tier deterministically instead of depending on real host memory.

**Tests.** 12 new tests (CRITICAL-refuses / HEALTHY-still-dispatches pairs
per site, `onboarding.mjs` covered twice for its 2 call sites) across
`command-research-spec-synthesis.test.mjs`, `command-scope-classifier.test.mjs`,
`field-source-reconciliation.test.mjs`, `wbs-generation.test.mjs`,
`onboarding.test.mjs`, `onboarding-orca-resilience.test.mjs`. All 88 tests
across these 6 files pass.

**Real-host side effect discovered while proving this fix.** This host was
genuinely at ~2.4GB free (CRITICAL tier) while fixing F1 -- once these 5
sites started honoring the governor for real, every other test file that
exercises one of them without stubbing host memory started failing against
the *real* CRITICAL reading (not a bug in the fix -- the governor doing
exactly its job against real evidence). Diffed a full-suite run against a
`tsf/main`-baseline full-suite run on the same host to separate genuine
regressions from this from 12 pre-existing, unrelated flaky/slow-under-load
failures already present on baseline (confirmed via isolated re-runs).
Added the same `TSF_RESOURCE_PRESSURE_TEST_TOTAL/FREE_BYTES`-forced-HEALTHY
header (`chat-dispatch-bridge.test.mjs`'s own established convention) to 14
downstream test files whose own assertions transitively call one of the 5
newly-gated functions: `chat-route-context-fallback.test.mjs`,
`command-dogfood-sequences.test.mjs`, `command-research-bridge.test.mjs`,
`estimate-adversarial.test.mjs`, `eval-pack-registry.test.mjs`,
`http-chat-route-context.test.mjs`, `http-estimate-calibration.test.mjs`,
`http-estimate-client-and-commitments.test.mjs`, `http-estimate.test.mjs`,
`http-eval.test.mjs`, `http-onboarding.test.mjs`,
`http-prepare-for-work.test.mjs`, `planner-eval-runner.test.mjs`,
`web-table-research-worker.test.mjs`. Full-suite result after the fix:
2332 tests, 2320 pass, 12 fail -- fail set and count now match the
`tsf/main`-baseline fail set exactly (the 2 residual differences between
runs are confirmed real-host-load flakes reproduced identically with and
without this change, not caused by it).

**Lint.** `npx oxlint` clean on every changed file (pre-existing, unrelated
`curly`/`no-unused-vars` findings on lines this change did not touch are
untouched, confirmed via before/after diff against the unmodified files).

Adopted SHA: see the commit on `tsf/feature/f1-resource-governor-gating`
that carries this section.

## Finding F3: Platform Learning Ledger was write-only in production -- FIXED

Worktree: `f3-learning-ledger-consumer`, branch
`tsf/feature/f3-learning-ledger-consumer` (forked from `tsf/main` @
`1a9876cafbd61af7eb379e52c0641b6436cc2ceb`).

**Gap.** `tsf/domain/platform-learning-ledger.mjs`'s `recordLessonsFromCompletedMission`
is real and wired (`research-mission-fleet-driver.mjs`'s `advanceOneMission`
CHECK_COMPLETE branch calls it on every real mission completion, proven by
`research-mission-fleet-driver-learning-ledger.test.mjs`). `retrieveLessonGuidance`
had zero production callers -- lessons accumulated durably but nothing in the
real research pipeline ever read them back into a live decision.

**Reconciliation (Step 1).** Read `platform-learning-ledger.mjs` in full: 6
`LESSON_CATEGORIES` (`PROVIDER_RELIABILITY_SIGNAL`, `RECURRING_DISPATCH_FAILURE`,
`IDENTITY_AMBIGUITY_PATTERN`, `COMPLETENESS_GAP_PATTERN`, `SOURCE_RELIABILITY_SIGNAL`,
`VERIFIED_CORRECTION_PATTERN`); `retrieveLessonGuidance(ledger, category, limit=5)`
returns `{ statement, confidence, evidenceSummary, sourceMissionIds, recordedAt,
advisoryOnly: true, neverOverridesVerifiedEvidence: true }[]`, structurally
incapable of carrying `fieldName`/`value`/`entityId` (never mistakable for a
Claim/CanonicalFact). `extractLessonsFromCompletedMission` derives
`PROVIDER_RELIABILITY_SIGNAL` from real `node.rawResults[].result.{provider,status}`
pairs and `RECURRING_DISPATCH_FAILURE` from nodes with 2+ real FAILED raw
results before settling -- both are exactly the shape a DISPATCH/RETRY_DISPATCH
decision already reasons about.

Investigated the 3 suggested candidates against real code:
- `research-mission.mjs`'s planning/admission functions (`addResearchNode`,
  `transitionResearchMission`, `raiseResearchNeedsYou`, etc.) are pure state
  transitions with no strategy branch point -- nowhere to hang an advisory
  without inventing a new field threaded through unrelated callers.
- A Command-surfaced "what should I watch out for" advisory would require a
  NEW chat/Command surface reading the ledger ad hoc, disconnected from any
  real in-flight decision -- closer to a second, parallel guidance mechanism
  than "wiring the real one in," which the task explicitly forbids.
- `research-mission-fleet-driver.mjs`'s `executeDispatchAction` (the one real
  function that decides to actually call a provider, `DISPATCH`/`RETRY_DISPATCH`)
  is the strongest fit: it already computes `providerId` right before
  dispatching, `isRetry` is already true exactly when this node itself has a
  real, current FAILED-dispatch history, and its own category set
  (`PROVIDER_RELIABILITY_SIGNAL`, `RECURRING_DISPATCH_FAILURE`) is the SAME
  category set `extractLessonsFromCompletedMission` populates from this exact
  kind of event on other missions. No new categories, no new mechanism --
  the real write side and the real read side finally meet at the one place
  that already reasons about provider/retry.

**Fix (Step 2).** `tsf/server/research-mission-fleet-driver.mjs`:
- Imports `retrieveLessonGuidance` (domain) and `readPlatformLearningLedger`
  (store, already used for the write side).
- New `gatherDispatchAdvisories(providerId, isRetry, deps)`: reads the ledger
  (test-injectable via `deps.readPlatformLearningLedger`, matching this
  driver's own `deps.collectHostMemoryEvidence` injection convention),
  filters `PROVIDER_RELIABILITY_SIGNAL` lessons to ones whose `statement`
  actually names `providerId` (a lesson about a DIFFERENT provider is noise,
  not guidance -- never surfaced), and includes `RECURRING_DISPATCH_FAILURE`
  lessons unfiltered only when `isRetry` (this node's own retry is already
  real evidence the pattern is relevant). Returns `undefined` -- never `[]`
  -- when nothing real matches, so a caller doing `if (advisories)` gets a
  true no-op, never a fabricated empty field.
- `executeDispatchAction` calls it once, right after `providerId` is computed
  and strictly BEFORE the real `dispatchResearchNodeDurable`/
  `dispatchResearchNodeWithApprovalDurable` call -- computed but never read
  by that call, so it cannot change what gets dispatched. The `DISPATCHED`
  result gains an `advisories` field only when non-empty
  (`...(advisories ? { advisories } : {})`).
- `isDispatchAdmitted`/`decideNextMissionAction`/the Resource Pressure
  Governor gate are completely untouched -- advisories are computed strictly
  after admission already passed, so they can never gate, delay, or re-route
  a real dispatch, matching this finding's own hard constraint.

**Tests (Step 3).** New `tsf/test/research-mission-fleet-driver-dispatch-advisories.test.mjs`,
4 tests, all against `advanceOneMission` (the real driver entry point, not
`gatherDispatchAdvisories` in isolation):
1. Empty ledger -> a real DISPATCH has no `advisories` key at all (silent
   no-op, never a fabricated empty array).
2. A lesson recorded through the REAL `recordLessonsFromCompletedMission`
   path (via a first mission genuinely reaching COMPLETE through
   `advanceOneMission`'s own CHECK_COMPLETE branch, never a hand-built
   `LessonRecord` fixture) for provider `FLAKY_TEST_PROVIDER` surfaces as an
   `advisories` entry on a second mission's real dispatch to that same
   provider -- AND the real scripted dispatch still succeeds
   (`dispatchResult.ok === true`, `action === 'DISPATCHED'`) despite the
   lesson's negative history, proving the advisory never overrides real,
   contradicting current evidence.
3. A lesson recorded for an unrelated provider never contaminates a dispatch
   to a different, clean provider -- no `advisories` key.
4. A real `RECURRING_DISPATCH_FAILURE` lesson (from a different completed
   mission with 2 real FAILED raw results before settling) surfaces on a
   genuine `RETRY_DISPATCH` (a node left `FAILED` with `retryCount: 1`,
   within budget) -- dispatch still proceeds and succeeds regardless.

Result: `node --test tsf/test/research-mission-fleet-driver-dispatch-advisories.test.mjs`
-- 4/4 pass. Regression sweep of every test file directly covering this
decision point plus the ledger itself (`research-mission-fleet-driver.test.mjs`,
`research-mission-fleet-driver-learning-ledger.test.mjs`,
`research-mission-fleet-driver-bootstrap.test.mjs`, `platform-learning-ledger.test.mjs`,
`platform-learning-ledger-store.test.mjs`, `research-mission-driver.test.mjs`,
`research-resource-pressure-interaction.test.mjs`) -- 46/46 pass. Full-suite
sweep: 2334 tests, 2328 pass, 6 fail; all 6 failures reproduce identically
with this change's one modified file (`research-mission-fleet-driver.mjs`)
stashed out (confirmed via isolated re-run against the unmodified file) --
pre-existing, unrelated: 2 intent-classifier phrasing gaps and 1 Keep Going
timing-sensitive test in `command-bare-imperative-dispatch.test.mjs` (the
same file F18's checkpoint entry already documents as pre-existing-broken),
1 real-host-load stall in `keep-going-autonomy-proof.test.mjs`, 1 Work-tab
timing test in `http-work-summary.test.mjs`, and 1 race-condition test in
`operator-state-adversarial.test.mjs` -- none touch research missions or the
learning ledger.

**Lint.** `npx oxlint tsf/server/research-mission-fleet-driver.mjs
tsf/test/research-mission-fleet-driver-dispatch-advisories.test.mjs` -- clean,
exit 0.

Adopted SHA: see the commit on `tsf/feature/f3-learning-ledger-consumer`
that carries this section.

## Finding F4: planner/Keep Going durability hardening -- FIXED (two parts)

Worktree: `f4-planner-durability-hardening`, branch
`tsf/feature/f4-planner-durability-hardening` (forked from `tsf/main` @
`0a1bc3bd6cc4d02ca2e59a14e1dd3cd28c8b64a9`).

**Part A -- no schema-version guard on planner-mission-store.mjs or
keep-going-run-store.mjs.** `research-mission-store.mjs` already had a real
fail-closed schema-version guard (`assertSupportedResearchMissionSchemaVersion`,
`tsf/domain/research-schema-versioning.mjs`); neither Phase 2's planner-
mission lease/checkpoint store nor Keep Going's run store had one at all --
confirmed absent by grep before starting.

Ported the SAME generic engine (`buildSchemaVersionGuard`, unchanged) rather
than inventing a second mechanism -- two new guard instances added to
`research-schema-versioning.mjs` alongside its existing research
mission/library/learning-ledger guards (the file's own header now discloses
it has become the shared home for every durable top-level record's
schema-version guard, despite its name -- a future rename is a pure move,
not attempted here to keep this diff scoped):
- `assertSupportedPlannerMissionCheckpointSchemaVersion`, guarding
  `TSF_PLANNER_MISSION_CHECKPOINT_V1` (`planner-mission-checkpoint.mjs`'s
  real literal). Only the checkpoint half of a `{ lease, checkpoint }`
  planner-mission record is guarded -- the lease itself carries no
  `schemaVersion` of its own (a small TTL/holder tuple, not an
  independently-versioned shape).
- `assertSupportedKeepGoingRunSchemaVersion`, guarding
  `TSF_OVERNIGHT_RUN_V1` (`keep-going.mjs`'s `createOvernightRun` literal).

Wired in exactly like `research-mission-store.mjs`'s own `researchMissionFor`:
`tsf/server/planner-mission-store.mjs` gained a `versionCheckedRecord`
helper called from `readPlannerMissionRecord`, `readAllPlannerMissionRecords`,
and `withPlannerMissionRecord`; `tsf/server/keep-going-run-store.mjs` gained
a `versionCheckedRun` helper called from `readKeepGoingRun` and
`withKeepGoingRun`. A record with a missing or unsupported schema version now
throws a typed `TSF_..._SCHEMA_VERSION_MISSING` /
`TSF_UNSUPPORTED_..._SCHEMA_VERSION` error at read time instead of being
silently operated on.

Side effect found and fixed: two pre-existing tests wrote synthetic,
non-domain shapes directly through these two stores to exercise raw CAS/
cross-process-lock behavior only (`tsf/test/fixtures/cross-process-lock-
worker.mjs`'s counter increment, and one sub-test in
`planner-mission-store.test.mjs`'s "concurrent writers" proof) -- both now
stamp the real `schemaVersion` literal on every write so they keep passing
under the new guard; the lock semantics they actually test are unchanged.

**Part B -- real crash-reclaim end-to-end test.** Prior coverage for
`planner-mission-lease.mjs` proved only (1) graceful relinquish/reacquire
(`planner-mission-lease-cross-process.test.mjs`) and (2) stale/expired-lease
reclaim at the pure-function level with a fake clock
(`planner-mission-lease.test.mjs`) -- nothing combined a REAL killed process
holding the lease + real TTL-expiry reclaim + a real successor hydrating and
passing continuity verification, in one real end-to-end test.

New: `tsf/test/fixtures/planner-crash-reclaim-worker.mjs` (spawned child) +
`tsf/test/planner-mission-lease-crash-reclaim.test.mjs`. Narrative: the real
child process uses `PlannerSessionLifecycle` to start a mission with a
600ms lease TTL override (`acquirePlannerLease`'s existing `ttlMs` param via
`deps.leaseTtlMs` -- no new API), dispatches one fixture worker, writes a
result marker proving it got durably past acquire+dispatch, then sleeps
forever (never relinquishes). The parent test process first confirms a
fresh successor `PlannerSessionLifecycle` is genuinely refused
(`TSF_PLANNER_LEASE_DENIED`) while the child is still alive -- proving the
lease was live, not abandoned/empty, before the reclaim that follows means
anything. The parent then `SIGKILL`s the child, waits past the real TTL,
and a genuinely separate successor object (no shared in-memory state with
either the crashed child or the "too early" instance) calls
`acquireLeaseAndHydrate()`: it succeeds, passes the real
`assertRepoStateContinuity` internally (resolving without throwing IS the
continuity proof), and shows the crashed process's dispatched worker intact
(`workerId` matches, `status: 'DISPATCHED'`).

**Honest correction on the suggested template.** The task brief pointed at
`keep-going-autonomy-proof.test.mjs` as having "a real spawn-and-kill
pattern" -- read in full, it does NOT: its "backend restart" is
`deactivate()`/`activate()` inside the SAME test process, never a genuinely
separate OS process kill. The actual real spawn-a-child-then-SIGKILL-it-
then-reclaim-after-TTL template in this repo is
`resource-pressure-lease-host-wide.test.mjs`'s "a real process crash while
holding a lease self-heals via TTL" test (`spawn(...)`, confirm a second
party sees it live, `holder.kill('SIGKILL')`, wait past TTL, reclaim) --
that is what was actually reused, and the discrepancy is documented in the
new test file's own header rather than silently substituted.

Run 8 times total during development (not flaky): 8/8 pass, ~1.1s each on
this host.

**Tests.** New: `planner-mission-store-schema-version.test.mjs` (3 tests),
`keep-going-run-store-schema-version.test.mjs` (2 tests),
`planner-mission-lease-crash-reclaim.test.mjs` (1 test). Targeted regression
across every planner-mission-*/keep-going-run-store test file plus the two
`planner-session-lifecycle-*` files that exercise these stores most
directly: `node --test` -- 50/50 pass. Broader downstream sweep of every
other test file that touches either store (`chat-dispatch-bridge`,
`cleanup-active-mission-check`, `cleanup-executor-worktree-adversarial`,
`cleanup-revalidation`, `command-dogfood-sequences`,
`command-followup-context`, `command-run-action-bridge`,
`golden-path-operator-flow`, `http-keep-going`,
`keep-going-dispatch-loop-concurrency`, `operator-state-adversarial`,
`settled-run-reconciler`): 123/124 pass -- the 1 failure
(`operator-state-adversarial.test.mjs`'s "STALE ACTION RACE" test)
reproduces identically against unmodified `tsf/main` (confirmed via
`git stash`), and matches F3's own checkpoint entry above describing it as a
pre-existing, real-host-load race condition -- not caused by this change.

Full-suite sweep (`node --test tsf/test/*.test.mjs`): 2342 tests, 2334 pass,
8 fail. All 8 fall into the same family F1/F3's own checkpoint entries above
already documented on this host: 2 intent-classifier phrasing gaps + 1
WorldForge-scenario phrasing gap in `command-bare-imperative-dispatch.test.mjs`,
1 real-host-load stall in `keep-going-autonomy-proof.test.mjs`, 1 Work-tab
timing test in `http-work-summary.test.mjs`, 1 race-condition test in
`operator-state-adversarial.test.mjs`, plus 2 more only ever observed under
full-suite load (`runBaselineVerification` in `health-repair-io.test.mjs`,
`findRegisteredOrcaRepo` in `onboarding-orca-resilience.test.mjs`, both
bounded-timeout/retry tests). Verified via the same isolated-re-run
methodology F1 used: running those same 6 files in isolation gives the
IDENTICAL 4-failure subset (the 2 intent gaps, the Work-tab timing test, the
operator-state-adversarial race) both with this change stashed out and with
it applied -- the other 4 (the WorldForge scenario, the autonomy-proof
stall, and the two bounded-retry tests) pass cleanly in that same isolated
run both ways, confirming they are pure full-suite-concurrency artifacts on
this specific run (this session's own memory already flags this host as
running many concurrent Claude Code sessions), not caused by this change.
None of the 8 touch `planner-mission-store.mjs`, `keep-going-run-store.mjs`,
or `research-schema-versioning.mjs`.

**Lint.** `npx oxlint` on every changed/new file (`research-schema-
versioning.mjs`, `planner-mission-store.mjs`, `keep-going-run-store.mjs`,
`cross-process-lock-worker.mjs`, `planner-mission-store.test.mjs`,
`planner-crash-reclaim-worker.mjs`, `planner-mission-store-schema-
version.test.mjs`, `keep-going-run-store-schema-version.test.mjs`,
`planner-mission-lease-crash-reclaim.test.mjs`) -- clean, exit 0 (fixed a
handful of `curly` findings on newly-added lines rather than leaving them,
even though the ported reference pattern in `research-mission-store.mjs`
itself pre-dates and does not satisfy that same rule).

Adopted SHA: see the commit on `tsf/feature/f4-planner-durability-hardening`
that carries this section.

## Phase 2: Background Task Truthfulness -- INVESTIGATED, NO GAP FOUND (no fix)

Worktree: `phase2-background-task-truthfulness`, branch
`tsf/feature/phase2-background-task-truthfulness` (forked from `tsf/main` @
`d1f29dc95fa655d08328f307becc6eb5c91c2d35`).

**Mission background.** Multiple real missions in this session's own history
observed `node --test` exit 0 with every test visibly passing, while the
HOST/HARNESS-level background-task mechanism (the Claude Code CLI/Agent SDK
that runs an agent via `run_in_background`, launched via the Bash tool or the
Agent tool) reported `status='failed'` anyway. That harness is not TSF or
Orca's own code -- no access to its source, not attempted here (correctly
filed as harness product feedback in this session's own prior history, not a
TSF bug, each time it recurred). This phase's real job was to check whether
TSF's OWN code has an ANALOGOUS gap: any place TSF tracks/reports a real
background job's outcome (Keep Going dispatch, Research Mission polling,
Cleanup V1 execution, eval-pack runs, provider-CLI launch) by something
weaker than the real process exit code -- stdout-content inference, a
timeout heuristic treated as failure-proof, an assumed-success default, or a
status written before the process genuinely finished.

**Method.** Every `child_process` boundary in `tsf/` was enumerated
(`spawn`/`execFile`/`execFileSync`, `grep -rn` across `tsf/adapters`,
`tsf/server`, `tsf/providers`) and read in full, not sampled -- 16
non-test files construct or read a real child process:

| File | What it spawns | Exit-code authority |
|---|---|---|
| `tsf/providers/safe-provider-launch.mjs` | The real Codex/Claude CLI (interactive, `stdio: 'inherit'`) | `child.on('exit', (code, signal) => process.exitCode = signal ? 1 : (code ?? 1))` -- real code/signal propagated as this wrapper process's own exit code, nothing else consulted |
| `tsf/server/live-planner.mjs` (`spawnAgent`/`runOnce`) | Headless `claude -p` / `codex exec` for PLANNER_DEEP | `outcome.code !== 0` -> `PROVIDER_ERROR` BEFORE any stdout parsing; JSON parse failure and `parsed.is_error` are separate, later checks -- a non-zero exit can never be masked by well-formed-looking stdout |
| `tsf/adapters/orca-cli-bridge.mjs`, `orca-orchestration-bridge.mjs`, `orca-capacity-bridge.mjs` | Real `orca` CLI subcommands (repo/worktree/orchestration/account) | Identical shared pattern: `timedOut` check, then `code !== 0` -> `CLI_ERROR` (exit code/stderr authoritative), only then JSON-parsed, only then `parsed.ok === false` checked |
| `tsf/server/health-repair.mjs` (`runCommand`/`runBaselineVerification`) | The repo's own real discovered test/build/lint/typecheck command (this IS the `node --test`-shaped case the mission background describes) | `status: code === 0 ? 'PASS' : 'FAIL'` -- the function's own header comment states the discipline explicitly: "this function's own job is only to observe the real exit code, honestly, never to interpret or patch it"; stdout/stderr are captured only as `outcome.stdout`/`stderr` evidence attached to the verdict, never consulted to override it |
| `tsf/adapters/security-scanner-adapter.mjs` | An operator-configured external security scanner | `code !== 0` -> `SCANNER_ERROR`, checked before JSON parse; module header states "never silently treated as a clean scan" as an explicit acceptance item |
| `tsf/server/cleanup-git-worktree-inventory.mjs`, `resource-auditor-git-object-store.mjs`, `resource-auditor-path-identity.mjs`, `repository-identity.mjs`, `planner-mission-repo-state.mjs` | Real read-only `git` commands | All use `promisify(execFile)`/`execFileSync`, which reject/throw on a real non-zero exit by Node's own contract -- every caller wraps in try/catch and returns `{ok:false}`/`null`, never a fabricated success |
| `tsf/adapters/git-identity.mjs` (Safe Update Manager) | Real `git rev-parse`/`merge-base --is-ancestor`/`merge --ff-only`/`reset --hard` | `resolve({ok: code === 0, code, ...})`; `isAncestor` additionally distinguishes git's own real exit-1-means-false convention from an actual error (`code === 1` only) -- never conflates "false" with "broken" |
| `tsf/server/cleanup-session-retirement.mjs`, `health-repair.mjs` (`killProcessTree`) | `taskkill`/`SIGTERM` on timeout | Fire-and-forget process-tree cleanup only, not a status determination -- no outcome is reported from these calls |
| `tsf/server/open-url-command.mjs` | Platform `start`/`open`/`xdg-open` to launch a URL in the default browser | Detached, fire-and-forget, no status returned to any caller at all -- correctly makes no truthfulness claim in the first place (nothing to falsify) |

**Keep Going's own wave-settlement (`tsf/server/keep-going-dispatch-loop.mjs`
`settleStep`).** Keep Going does not itself spawn the dispatched Claude/Codex
worker process -- it delegates to Orca's orchestration CLI
(`createOrchestrationTask`/`startOrchestrationWorker`, `orca-orchestration-
bridge.mjs`, table above) and settles a wave by polling
`listOrchestrationTasks` and comparing the real returned `task.status`
against `COMPLETED_STATUSES = {'completed','succeeded'}` /
`FAILED_STATUSES = {'failed','error'}`; anything else (including `'unknown'`
for a task id Orca doesn't return) falls into `PENDING`, never assumed
COMPLETED. The module's own header comment already discloses the one honest
limitation here: `PENDING` conflates "worker-start's CLI call succeeded" with
"the agent process itself has actually started its own real work" -- a real,
disclosed gap, but not a truthfulness violation (it never reports something
as done that isn't). Where this settlement's real authority ultimately
bottoms out -- Orca's own internal computation of `task.status` -- is Orca
core (Electron/TypeScript, `src/`), a different codebase this phase's
INVESTIGATE list did not name and this phase did not audit; TSF's own
polling/comparison logic against whatever Orca reports is itself correct and
fail-closed.

**`tsf/server/research-mission-driver.mjs`
(`pollAndAdmitResearchNodeDurable`)** and **`research-mission-fleet-driver.mjs`
(`advanceOneMission`'s `CHECK_COMPLETE` branch)** were read in full. Neither
spawns a local child process for the research worker itself -- every real
research worker adapter (`exa-research-worker.mjs`, `parallel-research-
worker.mjs`, `web-table-research-worker.mjs`, `llm-latent-knowledge-research-
worker.mjs`, `authenticated-official-download-research-worker.mjs`,
`owner-supplied-local-artifact-research-worker.mjs`) is an HTTP/API-backed
adapter, not a local process launch, so "real exit code" has no literal
referent there; `fetched.status !== 'READY'` is treated as `ready: false`
(never assumed done), and mission completion (`CHECK_COMPLETE`) is gated on
`computeCompletenessMetrics` over real canonicalFacts/conflicts -- explicitly
never on `node.status` alone (the driver's own comment states this).

**`tsf/server/cleanup-executor.mjs` (Cleanup V1) /
`tsf/domain/cleanup-lifecycle.mjs`.** `runGovernedCleanupAction`'s real
mutate dispatch (`ACTION_EXECUTORS`) is wrapped in a single try/catch:
`completeCleanupExecution` runs only on the `mutate(...)` promise resolving
without throwing, and every real mutate function
(`cleanup-executor-worktree-actions.mjs`, `cleanup-executor-artifact-
actions.mjs`) throws with a real `.code` the instant its own underlying git/
fs call reports `{ok: false}` (itself sourced from the exit-code-authoritative
`cleanup-git-worktree-inventory.mjs` above) -- there is no path where a
mutate function's real underlying failure is swallowed into a fabricated
`COMPLETED`.

**`tsf/domain/evaluation-pack.mjs` / `tsf/server/eval-http-routes.mjs`
(eval-pack runs).** `runEvalPack` never spawns anything itself (pure scoring
over an already-produced `actualOutputsByCaseId` map, by design -- see its
own header comment); a case with no actual output supplied is explicitly
`{passed: false, errored: true}`, never silently skipped or counted as a
pass (matches its own documented acceptance item: "a broken/incomplete run
must never be misreported as a clean pass"). `eval-http-routes.mjs` itself
has no process-spawning or `status ===`/`.ok` outcome logic of its own to
audit.

**Pipe-exit-code-masking sub-task (lower priority, per the mission
directive).** `grep -rn 'execSync(.*\|'` across all of `tsf/` returned zero
matches -- no TSF script composes a real command through a shell pipe
(`| tail`, `| head`, or otherwise) before checking `$?`/its own promise
rejection. The `node --test | tail`-shaped exit-code-masking pattern
(Phase 1's F9) has no TSF-owned instance.

**Conclusion.** Every TSF-owned process-outcome boundary this phase's
INVESTIGATE list named, plus every other real `child_process` construction
site in `tsf/adapters`, `tsf/server`, and `tsf/providers` (16 non-test files,
enumerated exhaustively above, not sampled), already treats the real process
exit code (and, where meaningful, stderr) as the sole authoritative success/
failure signal -- consistently checked BEFORE any stdout content is parsed
or trusted, with JSON-parse failures and content-shape failures kept as
separate, later, honestly-distinct failure reasons rather than folded into
or allowed to override the exit-code verdict. No case was found where "the
process produced plausible-looking stdout" or "the call didn't throw
synchronously" stood in for the real exit code. This is a genuine, valuable
negative finding, not an absence of effort: the codebase's own established
"honest-failure convention" (named explicitly in comments across
`repository-identity.mjs`, `resource-auditor-path-identity.mjs`,
`cleanup-git-worktree-inventory.mjs`, and others) is real, consistently
applied, and independently re-verified here rather than assumed from prior
checkpoint entries. No fix was made -- inventing one against a problem that
does not exist in this codebase would violate this program's own "do not
manufacture a finding" instruction.

**Lint.** No files were changed this phase (investigation-only); `npx
oxlint` was not run against anything, as nothing was touched.

Adopted SHA: see the commit on `tsf/feature/phase2-background-task-
truthfulness` that carries this section (docs-only commit; no code change).
## Finding F5: a cleanly-failed research node dispatch stayed READY, bypassing retry-budget tracking -- REPRODUCED and FIXED

Worktree: `f5-research-node-clean-failure`, branch
`tsf/feature/f5-research-node-clean-failure` (forked from `tsf/main` @
`d1f29dc95fa655d08328f307becc6eb5c91c2d35`).

**Reproduction (Step 1).** Original citation
(`tsf/server/research-mission-driver.mjs:257-269`) re-checked directly:
`dispatchResearchNodeDurable` calls `markResearchNodeReady` (READY),
`recordDispatchAttempt` (bookkeeping only), then `worker.dispatch(request)`.
On a CLEAN failure (`dispatched.ok === false` -- a synchronous, unambiguous
rejection, not a crash) it called `resolveDispatchAttempt(..., outcome:
'FAILED_CLEAN')` -- which only mutates `node.dispatchAttempts`, never
`node.status` -- and returned `{ ok:false, ... }` with NO further node-status
transition. The node was left exactly where `markResearchNodeReady` put it:
READY.

Wrote a standalone repro script (a real `dispatchResearchNodeDurable` call
plus 6 simulated `advanceOneMission` fleet-driver ticks against a worker
whose `dispatch()` always cleanly rejects) run against the unmodified code:
node stayed `READY`, `retryCount` stayed `0` through all 6 ticks, and
`worker.dispatch()` was called on every single tick (7 real calls total for
7 attempts, no bound). Finding independently CONFIRMED, not stale.

**Root cause (Step 2).** Read the full real state machine before concluding:
- `research-autonomy-policy.mjs`'s `decideNextNodeAction` only routes a node
  through the retry-budget-tracked path (`decideRetryOrEscalate`, which
  reads `node.retryCount` against `budget.maxRetriesPerNode` and returns
  `RETRY_DISPATCH` or `ESCALATE`) when `node.status === 'FAILED'`. A node at
  `READY` unconditionally returns a fresh `{ type: 'DISPATCH' }` -- the SAME
  branch a never-before-attempted node takes.
- `research-mission-fleet-driver.mjs`'s `executeDispatchAction` only calls
  `recordResearchNodeAttempt` (the function that actually increments
  `retryCount` and throws `TSF_RESEARCH_RETRY_BUDGET_EXCEEDED` past budget)
  when `isRetry` is true -- i.e. only on a `RETRY_DISPATCH` decision, never
  on a plain `DISPATCH`.
- `escalateResearchNodeToNeedsYou` itself requires
  `assertNodeTransition(node.status, 'BLOCKED')`, and the node-transition
  table only allowed `BLOCKED` from `FAILED` or `ADMITTED` -- so escalation
  was not merely unreached but structurally unreachable for a node stuck at
  READY.
- The retry-budget mechanism itself (`recordResearchNodeAttempt`,
  `decideRetryOrEscalate`) is real, correct, and already exercised by the
  OTHER failure path (a provider's structured `FAILED` result arriving via
  `pollAndAdmitResearchNodeDurable` -> `recordResearchNodeResult`, which
  DOES transition `DISPATCHED -> FAILED`). This finding is specifically
  about the pre-DISPATCHED, synchronous clean-failure path never reaching
  that same, already-correct mechanism -- confirming Step 2's question:
  yes, a cleanly-failing node was retried literally forever, once per driver
  tick, with the budget check never once consulted (not "a budget check
  exists elsewhere that this finding missed").

**Fix (Step 3).** No new retry-budget mechanism -- the node is routed into
the exact SAME `decideRetryOrEscalate`/`recordResearchNodeAttempt` machinery
the DISPATCHED-then-FAILED path already uses, by making the missing state
transition legal and reaching it:
- `tsf/domain/research-mission.mjs`: added `'FAILED'` to `READY`'s allowed
  transitions in `NODE_ALLOWED` (previously `READY: ['DISPATCHED',
  'CANCELLED', 'ADMITTED']`), with a comment explaining why a clean failure
  needs this specific edge (it never reaches DISPATCHED).
- `tsf/domain/research-node.mjs`: new `markResearchNodeDispatchFailed`,
  mirroring `markResearchNodeReady`'s own shape exactly (idempotent no-op if
  already FAILED, `assertNodeTransition` otherwise).
- `tsf/server/research-mission-driver.mjs`: `dispatchResearchNodeDurable`'s
  clean-failure branch now calls `markResearchNodeDispatchFailed` (its own
  durable `withResearchMission` commit, right after the existing
  `resolveDispatchAttempt` commit) before returning `{ ok:false, ... }`.

This preserves the codebase's existing ambiguous-vs-clean distinction
completely untouched: `AMBIGUOUS_REQUIRES_RECONCILIATION` (a crash/timeout
mid-call) still refuses to guess and never reaches this branch at all; only
a genuinely clean, synchronous `{ ok:false }` rejection transitions to
FAILED. The `NEEDS_YOU`-category human-escalation distinction
(`decideRetryOrEscalate`'s `SOURCE_UNAVAILABLE` category) is also unchanged
-- reached only after the SAME budget is exhausted, exactly as it already
was for a post-DISPATCHED failure.

**Tests (Step 4).** New `tsf/test/research-mission-clean-dispatch-failure.test.mjs`,
2 tests:
1. `dispatchResearchNodeDurable` direct call: a clean failure leaves the
   node `FAILED` (not `READY`), with `dispatchAttempts.at(-1).outcome ===
   'FAILED_CLEAN'` unchanged.
2. A node that cleanly fails on every real dispatch, driven purely through
   `advanceOneMission` (the real fleet-driver entry point, never a hand-
   inlined domain call): tick 0 (fresh DISPATCH) fails -> FAILED,
   `retryCount` 0; tick 1 (RETRY_DISPATCH, budget 2) -> `retryCount` 1; tick
   2 (RETRY_DISPATCH) -> `retryCount` 2; tick 3 -> budget exhausted ->
   `ESCALATE`, node `BLOCKED`, mission reaches `state: 'NEEDS_YOU'` with one
   open Needs You entry; tick 4 (after escalation) is a true `SKIPPED`
   no-op. Exactly 3 real `worker.dispatch()` calls total, never a 4th --
   proving the unbounded-retry finding is closed, not merely slowed.
   (Resource Pressure Governor forced HEALTHY via
   `TSF_RESOURCE_PRESSURE_TEST_TOTAL/FREE_BYTES`, matching F1's own
   established test convention, since this host's real free memory can
   otherwise sit in CRITICAL/refuse-dispatch territory.)

Result: `node --test tsf/test/research-mission-clean-dispatch-failure.test.mjs`
-- 2/2 pass. Targeted regression across every test file that imports
`research-node.mjs`/`research-mission.mjs`/`research-mission-driver.mjs`/
`research-autonomy-policy.mjs`/`research-mission-fleet-driver.mjs` directly
(`research-mission-driver`, `research-mission`, `research-autonomy-policy`,
`research-mission-fleet-driver` + its 3 companion files, `research-crash-
resume`, `research-node-redispatch`, `research-dispatch-bookkeeping`,
`research-adversarial-gauntlet`, `research-concurrency`, `research-e2e-
normal-mission`, `nfl-2001-qb-research-fixture`, `research-resource-
pressure-interaction`): 119/119 pass. Broader sweep of every `research-*`
test file in the suite (36 files, the full blast radius of a change scoped
entirely to research node/mission execution-state domain code): `node --test
tsf/test/research-*.test.mjs` -- 315/315 pass, 0 fail. A full whole-repo
sweep was not run for this finding -- the change touches no code outside
the research subsystem (no shared store/schema/HTTP-route file was
modified), and the research-specific sweep already covers every real
consumer of the two modified domain functions and the one modified driver
function.

**Lint.** `npx oxlint` on every changed/new file
(`research-mission.mjs`, `research-node.mjs`, `research-mission-driver.mjs`,
`research-mission-clean-dispatch-failure.test.mjs`) -- fixed 2 `curly`
findings on newly-added lines (the new test file's cleanup loop, the new
`markResearchNodeDispatchFailed`'s early-return branch) rather than leaving
them; every other finding oxlint reports on these files is a pre-existing,
unrelated `curly`/`no-unused-vars` finding on a line this change did not
touch (confirmed via `git diff --stat` -- 3 small, purely additive diffs;
none of the flagged line numbers fall inside a changed region).

Adopted SHA: see the commit on `tsf/feature/f5-research-node-clean-failure`
that carries this section.

## Finding F7: dogfood tooling itself had magic-number sleeps and an unhardened Electron launch -- FIXED

Worktree: `phase4-ui-self-dogfood`, branch `tsf/feature/phase4-ui-self-dogfood`
(forked from `tsf/main` @ `ce908b5ac38352371a7d5b344e46e3c78d77d7b1`).

**Gap.** `tsf/adapters/orca-dogfood-surfaces.mjs` stood in for "wait until the
real settings navigation landed" with two fixed `page.waitForTimeout` sleeps
(200ms after opening a settings pane, 100ms after closing it) justified only
by a comment, no condition-based check backing them.
`tsf/adapters/electron-target-launcher.mjs`'s `app.firstWindow()` had no
explicit timeout override and no retry, despite its own file header claiming
to reuse "the SAME underlying mechanism" as `tests/e2e/helpers/orca-app.ts` --
that file uses an explicit, hardened `{ timeout: 120_000 }` on every
`firstWindow()` call site in the repo (`orca-app.ts`, `orca-restart.ts`,
`paired-electron-client.ts`, `run-idle-cpu-benchmark.mjs`,
`app-driver.mjs`, `terminal-garble-production-repro.mjs` -- confirmed via
repo-wide grep before fixing), never a bare-default timeout.

**Fix.**
- `orca-dogfood-surfaces.mjs`'s `openSettingsPane`: replaced the 200ms sleep
  with `page.waitForFunction(() => window.__store?.getState().activeView ===
  'settings', null, { timeout: 5000 })`, matching `orca-app.ts`'s own
  `waitForFunction(() => store.getState()...)` idiom instead of inventing a
  new one.
- `MAIN_SHELL_SURFACE.open`: replaced the 100ms sleep with the mirror-image
  wait, `activeView !== 'settings'`.
- **Correction found mid-fix, not left in**: the first draft additionally
  polled `state.settingsNavigationTarget?.pane === paneId` to confirm the
  RIGHT pane opened. A real Electron run against this exposed that as wrong:
  `settingsNavigationTarget` is a one-shot signal Settings.tsx's own effect
  consumes and clears (`clearSettingsTarget()`) essentially the same tick it
  reacts to it -- polling for it to still equal `paneId` races that same-tick
  clear and reliably timed out (`TimeoutError: page.waitForFunction: Timeout
  5000ms exceeded`, real failure, not flake -- reproduced deterministically).
  Dropped that half of the condition; `activeView === 'settings'` alone is
  the real, stable signal. Which pane actually rendered is
  `detectOrcaSettingsRenderFindings`'s own separate concern (unchanged).
- `electron-target-launcher.mjs`: `app.firstWindow()` now takes the SAME
  `{ timeout: 120_000 }` `orca-app.ts` already established -- no retry added,
  since `orca-app.ts` itself does not retry `firstWindow()` either (checked
  before adding one; matching the real established convention, not
  inventing a stronger one).

**Tests.** New `tsf/test/orca-dogfood-surfaces.test.mjs`, 4 tests, against a
fake Playwright Page that really polls a fake `window.__store` (not a
same-tick resolve):
1. `settings-pane surface.open()` only resolves once `activeView` genuinely
   flips to `'settings'`, modeled with a 260ms delay -- past the OLD 200ms
   fixed-sleep threshold this finding removed. This is the actual "would
   have caught the too-short sleep" proof: the old code would have returned
   to the caller before this state transition ever happened.
2. `settings-pane surface.open()` still succeeds when
   `settingsNavigationTarget` is cleared on the very next tick (5ms) well
   before `activeView` flips (100ms) -- reproduces the real Settings.tsx
   race the first draft fix got wrong, proving the final condition survives
   it.
3. `settings-pane surface.open()` fails loudly (rejects, doesn't silently
   proceed) when the app never actually navigates -- proves this is a real,
   bounded, fail-closed wait, not a no-op.
4. `main-shell surface.open()` only resolves once `activeView` genuinely
   leaves `'settings'`, modeled with a 160ms delay -- past the OLD 100ms
   fixed-sleep threshold.

`node --test tsf/test/orca-dogfood-surfaces.test.mjs` -- 4/4 pass. Regression
sweep of every other test file covering the dogfood domain/adapter layer
(`command-dogfood-bridge.test.mjs`, `ui-dogfood-contract.test.mjs`,
`ui-dogfood-surface-catalog.test.mjs`, `ui-dogfood-finding.test.mjs`) --
36/36 pass.

**Lint.** `npx oxlint tsf/adapters/orca-dogfood-surfaces.mjs
tsf/adapters/electron-target-launcher.mjs
tsf/test/orca-dogfood-surfaces.test.mjs` -- clean, exit 0.

Adopted SHA: see the commit on `tsf/feature/phase4-ui-self-dogfood` that
carries this section.

## Phase 4: UI Self-Dogfood (UI_DOGFOOD_AGENT_V0) -- DONE

Worktree: `phase4-ui-self-dogfood`, branch `tsf/feature/phase4-ui-self-dogfood`
(forked from `tsf/main` @ `ce908b5ac38352371a7d5b344e46e3c78d77d7b1`).

**Method.** Built the app for real (`pnpm run build:electron-vite --mode
e2e`; this worktree's own `out/`, not shared with the canonical worktree).
Ran the golden dogfood specs against a REAL, rendered Electron app --
`tests/e2e/ui-dogfood-orca-self.spec.ts` (bounded 3-pane slice) and
`tests/e2e/ui-dogfood-orca-self-full-sweep.spec.ts` (`ORCA_E2E_RUN_UI_
DOGFOOD_FULL_SWEEP=1`, all 33 settings panes) -- both real end-to-end runs,
not simulated. Every before/after number below is from an actual test run
against the built app, not inferred.

**Finding F8 reconciliation: mobile-viewport Settings clipping --
CONFIRMED STILL PRESENT, FIXED.** Full-sweep BASELINE (branch as forked,
before any change in this section): `33 finding(s) across 34 surfaces:
{"P0":0,"P1":0,"P2":33}` -- every single settings pane produced exactly one
`CLIPPED_CONTENT` finding at the 390px mobile viewport, all rooted in the
same source: `<div class="flex flex-wrap items-start justify-between gap-4
border-b ...">` (the `SettingsSection.tsx` header row), overflow amounts
from 91px (`setup-guide`, right=448) to 754px (`terminal`, right=958).
Matches this program's own prior audit finding exactly (33 panes).

**Root cause.** Not one bug but a repeated, unresponsive layout grammar,
confirmed by reading the real overflowing DOM (a throwaway diagnostic
Playwright script run against the real built app, not guessed from source
alone -- see method note below):
1. `Settings.tsx`'s top-level shell (`<SettingsSidebar/>` + content pane) is
   a fixed-280px-sidebar-plus-flex-1-content row with no responsive
   variant and no `min-w-0` on the content column -- at 390px viewport
   width the content column has ~110px of nominal space, and its
   un-`min-w-0`'d flex children refuse to shrink below their natural
   content width, overflowing the shell's `overflow-hidden` edge.
2. Even after (1), the shared "label + fixed-width control" row grammar
   used across nearly every settings pane --
   `SettingsRow`/`SettingsSubsectionHeader`
   (`SettingsFormControls.tsx`) and `SettingsSection.tsx`'s own
   `headerAction` wrapper -- lays the control out in a `shrink-0` div with
   no wrap, so a control wider than the remaining row width (a segmented
   control, a search combobox, an "Import from Warp"/"Import from YAML"
   button pair) pushes the row past the viewport instead of reflowing.
3. `ManageSessionsTable.tsx`'s sessions table used `table-layout: auto`
   with an un-truncatable (`truncate` on a bare inline `<span>`, no `block`/
   `max-w`, unlike the adjacent session-id column's own correct
   `block max-w-[280px] truncate`) workspace-path column, so a long path
   grew the whole table past the viewport.
4. `MobileEmulatorAvailabilityDetails.tsx`'s `ToolchainStatusRow` had the
   same `shrink-0`-without-wrap action-row pattern as (2), independently
   (does not use the shared `SettingsRow`/`SettingsSubsectionHeader`
   components).

**Fix -- additive, `max-sm:`-scoped only (Tailwind's default `sm` = 640px;
the dogfood mobile viewport is 390px, so every change below is inert at
>=640px, confirmed by the desktop/laptop viewport findings staying at 0
throughout every real run in this section). No new color/spacing/shadow
tokens invented -- `max-sm:`/`flex-wrap`/`min-w-0`/`table-fixed` are
existing Tailwind utilities this codebase already uses elsewhere (e.g.
`AccountsPane.tsx`'s own pre-existing `max-sm:flex-wrap`, confirmed via
grep before using the pattern):**
- `Settings.tsx`: shell gains `max-sm:flex-col` (stacks sidebar above
  content instead of squeezing them side by side) and the content column
  gains `min-w-0`. The shell itself stays `overflow-hidden` with its
  existing bounded height from its own parent -- deliberately NOT made
  scrollable itself (see the reverted-and-fixed regression below).
- `SettingsSidebar.tsx`: the `<aside>` gains `max-sm:w-full` (fills the
  stacked row) and `max-sm:h-[40vh] max-sm:overflow-hidden` (caps its own
  height and scrolls internally, rather than letting the whole page scroll)
  so the content pane below keeps the EXACT same bounded-height flex chain
  some panes depend on for a real measured height.
- `SettingsFormControls.tsx`: `SettingsRow`'s row gains `max-sm:flex-wrap`,
  its control wrapper gains `max-sm:w-full`;
  `SettingsSegmentedControl`'s root gains `max-sm:w-full max-sm:flex-wrap`;
  `SettingsSubsectionHeader`'s row/action wrapper get the same
  wrap/full-width pair.
- `SettingsSection.tsx`: the `headerAction` wrapper gains `max-sm:w-full`
  (the header row itself already had `flex-wrap`).
- `ManageSessionsTable.tsx`: the table gains `max-sm:table-fixed`; the
  workspace-path span gains `max-sm:block max-sm:max-w-[140px]`, mirroring
  the session-id column's own existing pattern rather than inventing a new
  one. Scoped to `max-sm:` (not applied unconditionally, unlike the
  session-id column) specifically to keep desktop's untruncated display
  unchanged -- a deliberate, narrower choice than symmetry with the
  session-id column would suggest, documented here rather than silently
  taken.
- `MobileEmulatorAvailabilityDetails.tsx`: `ToolchainStatusRow`'s row gains
  `max-sm:flex-wrap`, its actions wrapper gains `max-sm:w-full`.

**Self-inflicted regression found and fixed before it shipped.** The first
version of the `Settings.tsx` shell fix made the shell itself
`max-sm:overflow-y-auto` (the whole page scrolls) instead of keeping the
shell bounded and only capping the sidebar. Re-running the full sweep
against that version surfaced a NEW `P1 BROKEN_INTERACTION` on
`settings-shortcuts` ("did not render any real settings section") that did
not exist in the true baseline -- a real regression, not a pre-existing
flake (reproduced identically twice). Root cause: `Settings.tsx`'s own
`isFocusedShortcutsPane` branch sets the content scroll container to
`overflow-hidden` (needs a real bounded height, likely for a virtualized
keybinding list) instead of `overflow-y-auto`; making the shell itself
`overflow-y-auto` broke the bounded-height flex chain that branch depends
on. Fixed by keeping the shell `overflow-hidden` (unchanged from desktop)
and instead capping the SIDEBAR's own height + internal scroll (see fix
list above) -- re-running the full sweep twice more after this correction
showed 0 occurrences of the `settings-shortcuts` finding, confirmed fixed
and not just moved.

**RE-DOGFOOD -- real before/after comparison (all four numbers are actual
test-run output, not estimated):**

| Run | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| Full sweep, BASELINE (unfixed) | 0 | 0 | 33 | 0 | 33 |
| Full sweep, AFTER (first shell fix, before the regression fix above) | 0 | 1 | 3 | 0 | 4 |
| Full sweep, AFTER (regression fixed) | 0 | 0 | 3 | 0 | 3 |
| Full sweep, FINAL (after `settings-agents` investigated, `mobile-emulator` fixed) | 0 | 0 | **2** | 0 | **2** |
| Bounded golden spec (3 panes), BASELINE | -- | -- | 3 | -- | 3 |
| Bounded golden spec (3 panes), FINAL | -- | -- | 1 | -- | 1 |

31 of 33 original findings are gone -- confirmed by re-running the exact
same real spec against the exact same real app, not by re-deriving from the
fix diff. `settings-general` and `settings-terminal` (the two panes the
bounded golden spec always runs) went to zero `CLIPPED_CONTENT` findings;
`tests/e2e/ui-dogfood-orca-self.spec.ts` itself was updated to assert this
directly (`clippedFindings.filter(surfaceId === 'settings-general')` /
`'settings-terminal'` both `toEqual([])`) rather than leaving the original,
now-stale "any CLIPPED_CONTENT finding on settings-appearance" assertion in
place -- the old assertion would have kept passing on a coincidence (a
different residual finding still exists on that one pane) without actually
proving the real header-row defect was gone.

**Independent verification (task requirement 6).** For the general/terminal
panes specifically, a targeted diagnostic script (real `_electron.launch()`,
real 390px viewport, real DOM query -- not the dogfood heuristic itself)
walked every element under `[data-settings-section]` and confirmed zero
elements with `getBoundingClientRect().right - documentElement.clientWidth
> 20` for both panes post-fix, cross-checking the dogfood tool's own
`CLIPPED_CONTENT` absence with an independent assertion rather than trusting
the same detector code path that reported the fix.

**2 findings left as documented, deliberate recommendations (not
auto-fixed) -- both genuinely investigated, not skipped:**
1. `settings-appearance`, P2, `<div class="xterm-screen">` (25px over).
   `TerminalSettingsPreview.tsx` pins its live xterm.js preview to
   `PREVIEW_COLS = 36` (that file's own pre-existing comment: "so
   PREVIEW_BUFFER never wraps ... larger fonts clip, not wrap" -- an
   already-accepted, deliberate, non-responsive tradeoff by the original
   authors, not something this program introduced). Making it genuinely
   responsive means changing xterm column/sizing behavior at runtime, not a
   layout-only CSS fix -- real functional risk to a live xterm-backed
   widget, outside this task's "cheap/bounded/unambiguous" bar for a P2 and
   outside its "no wholesale redesign" constraint. Recorded as a
   recommendation: shrink `PREVIEW_COLS` (or the preview's font size)
   responsively below `sm`, as a follow-up with its own test coverage.
2. `settings-agents`, P2, `<span class="ml-1.5 text-foreground/70">` (27px
   "over" per the raw DOM check). Investigated directly against the real
   running app: the span's ancestor `AgentRow` command-line row already has
   `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
   (`AgentsPane.tsx`'s existing `truncate` class) with a real, correctly
   bounded `clientWidth: 218` against a `scrollWidth: 316` -- i.e. this row
   IS already visually ellipsized for the user; the raw child-span
   `getBoundingClientRect()` the generic `dom-overflow-detector.mjs`
   heuristic reads reflects pre-clip inline-layout geometry (a known CSS
   characteristic: `text-overflow: ellipsis` clips paint, not descendant
   layout geometry), not what actually renders. This is a detector false
   positive, not a real UI defect -- confirmed via a direct computed-style +
   scrollWidth/clientWidth check against the real app, not assumed.
   Recorded as a recommendation against the dogfood tooling itself (a
   future `dom-overflow-detector.mjs` improvement: skip an element whose
   nearest ancestor has `text-overflow: ellipsis` and a smaller
   `clientWidth` than `scrollWidth`), not against `AgentsPane.tsx`, which
   needs no change.

**Tests.** `node --test tsf/test/orca-dogfood-surfaces.test.mjs` (F7, above)
plus the full existing renderer regression sweep for every touched
component: `npx vitest run --config config/vitest.config.ts
src/renderer/src/components/settings/` -- 150 test files, 1010 passed / 1
skipped (pre-existing skip, unrelated), 0 failed. `tests/e2e/ui-
dogfood-orca-self.spec.ts` and `tests/e2e/ui-dogfood-orca-self-full-
sweep.spec.ts` both real-run and passing (evidence above).

**Lint.** `npx oxlint` on every changed file (`Settings.tsx`,
`SettingsSidebar.tsx`, `SettingsFormControls.tsx`, `SettingsSection.tsx`,
`ManageSessionsTable.tsx`, `MobileEmulatorAvailabilityDetails.tsx`,
`tests/e2e/ui-dogfood-orca-self.spec.ts`) -- clean, exit 0.

Adopted SHA: see the commit on `tsf/feature/phase4-ui-self-dogfood` that
carries this section.

## Finding F6: ResearchMission had zero real multi-process crash/restart tests -- FIXED

Worktree: `f6-research-mission-crash-test`, branch
`tsf/feature/f6-research-mission-crash-test` (forked from `tsf/main` @
`4be97520cf8a36edcba6ea982580fd782b3a59c4`).

**Gap.** Every existing "restart"/"crash-resume" test for ResearchMission
(`research-crash-resume.test.mjs`, `research-mission-driver.test.mjs`'s own
"CRASH SIMULATION" sub-test, `research-node-redispatch.test.mjs`) proves
durability by simply NOT calling the next driver step in the SAME process
and then calling it again -- a real, valuable proof of the durable-write
sequencing, but never a real killed OS process. Given real ResearchMission
work can involve real paid dispatch/external data, this finding asked for
the SAME real spawn-and-SIGKILL-and-reclaim mechanics Finding F4 just built
for Planner Context Lifecycle (`planner-mission-lease-crash-reclaim.test.mjs`
+ its fixture worker), reused for ResearchMission.

**Reconciliation before writing anything (Step 1, per this finding's own
instruction): read `research-mission-store.mjs` and `research-mission.mjs`
in full first.** `research-mission-store.mjs`'s `withResearchMission` is a
bare compare-and-swap over `cross-process-file-lock.mjs`, keyed only by
`missionId` -- no holder identity, no acquire/refuse step, no TTL, nothing
for a successor to be denied by (contrast `planner-mission-lease.mjs`'s real
`holderPlannerSessionId`/`leaseExpiresAt`/`TSF_PLANNER_LEASE_DENIED`).
`research-mission.mjs`'s only concurrency primitive is optimistic
`revision`/`expectedRevision` -- same family as `keep-going.mjs`, not a
lease. **Confirmed: ResearchMission's durability model is meaningfully
different from Planner Context Lifecycle's, exactly as this finding's own
brief anticipated as a valid possible outcome** -- "crash recovery" for a
ResearchMission really is "state was durably written before the crash, so a
fresh reader picks up cleanly," not a lease-reclaim story. The test below
proves THAT real model rather than forcing an artificial lease-style test
onto a system that doesn't have one -- and proves it, not just asserts it
from reading the source (see the "WHILE THE CHILD IS STILL ALIVE" assertion
below).

**Test (Step 2).** New `tsf/test/fixtures/generic-research-crash-fixture.mjs`
(a small, disposable, non-NFL/non-NWR ResearchSpecification/node fixture --
`entityType: 'FIXTURE_ENTITY'`, one required field `value`, shared by both
the child and parent processes so they agree on exactly one node/field
shape without duplicating it), `tsf/test/fixtures/research-mission-crash-
dispatch-worker.mjs` (spawned child), and
`tsf/test/research-mission-process-crash-survival.test.mjs`.

Real narrative: the child process creates a real, disposable ResearchMission
via `createResearchMissionDurable`, dispatches its one node through the
REAL durable dispatch path (`dispatchResearchNodeDurable`) using
`createDeterministicFakeResearchWorker` (this repo's own existing fake
worker, reused unmodified for the dispatch call -- not a new fake-worker
shape), writes a marker file the instant the dispatch is confirmed durable
on disk, then is kept alive by a real, live `setInterval` handle (see
"honest correction" below) until the parent SIGKILLs it -- no poll, no
admission, no relinquish, no graceful shutdown. The parent test process
(1) waits for the marker, (2) **while the child is still alive**, reads the
mission fresh from disk in its own process and confirms the DISPATCHED
state is already visible with zero denial/ceremony -- the real, positive
proof that no lease gate exists here at all, unlike F4's `tooEarly`
assertion which proves the opposite (a real refusal) for the planner; (3)
`SIGKILL`s the child and awaits its real `'exit'` event; (4) reads the
mission again from a genuinely separate process object and confirms the
dispatched node's state survived intact -- same `dispatchRecords.length`
(1, not lost, not duplicated), same `workerRunRef`, same mission `revision`
(no phantom mutation); (5) continues the mission with the REAL production
autonomy driver (`research-mission-fleet-driver.mjs`'s `advanceOneMission`,
never hand-inlined domain calls) fed a fresh resume-side fixture worker
whose `fetchResult` is scripted purely from the durably-known
`workerRunRef`/`taskFingerprint` (not from any in-process run-tracking,
which died with the child -- this is the honest, correct way to stand in
for a real remote provider, whose run state genuinely lives outside any one
process) and whose `dispatch` throws if ever called (proving the crash
never causes a redundant redispatch); (6) drives exactly
POLL -> VERIFY_AND_RECONCILE_FIELD -> CHECK_COMPLETE to a real terminal
state, `mission.state === 'COMPLETE'`, with `dispatchRecords.length === 1`
and `rawResults.length === 1` still true (no duplication anywhere in the
resume path) and one real canonicalized fact.

**Honest correction found while writing this test.** The first draft
mirrored `planner-crash-reclaim-worker.mjs`'s own `await new Promise(() =>
{})` literally as the child's "never exits" tail. On this host's Node
version (v24), that immediately triggered Node's own "unsettled top-level
await" idle-detector, which force-exits a process with nothing else
scheduled almost instantly (measured: 0ms in isolation) -- the child was
already dead, on its own, before the parent's `SIGKILL` call, which would
have silently made the "real SIGKILL of a still-running process" claim
false (a no-op kill against an already-exited process). Root-caused via a
standalone timing probe, not assumed. Fixed by keeping the child alive with
a real, live `setInterval` handle instead -- this does NOT affect F4's own
test (its assertions are TTL/expiry-timestamp-based, not liveness-based, so
they hold regardless of whether the child process is still literally
running at assertion time), but was a real, necessary fix here since this
finding's proof specifically depends on killing a process that is still
genuinely alive. Also fixed: the parent's `child.once('exit', ...)`
listener is now registered immediately after `spawn()`, not after the later
`waitFor`/kill sequence -- registering it late risked missing an `'exit'`
event that had already fired once (ChildProcess emits `'exit'` exactly
once), which produced the exact hang this correction found and fixed.

**No resource-pressure override needed.** Unlike several other research-
mission tests, this one needs no `TSF_RESOURCE_PRESSURE_TEST_*_BYTES`
override: `research-mission-fleet-driver.mjs`'s own comment confirms the
Resource Pressure Governor only gates `DISPATCH`/`RETRY_DISPATCH`, never
`POLL`/`VERIFY_AND_RECONCILE_FIELD`/`CHECK_COMPLETE` -- and this test's
only real dispatch happens once, in the child, directly through
`dispatchResearchNodeDurable` (which the governor never gates at all; only
the fleet driver's own `executeDispatchAction` wrapper does). Confirmed by
reading the driver before relying on it, not assumed.

Run 8 times standalone (matching F4's own diligence): 8/8 pass, ~95-108ms
each on this host (no TTL wait is needed here, unlike F4, since there is no
lease to wait out -- the whole test is bounded by real process spawn/kill
plus three fast driver ticks).

**Tests.** New: `research-mission-process-crash-survival.test.mjs` (1
test). Targeted regression across every research-mission-driver/research-
mission-store-adjacent file plus every fleet-driver companion:
`research-mission.test.mjs`, `research-mission-driver.test.mjs`,
`research-mission-store-schema-version.test.mjs`, `research-mission-
autonomy-driver-zero-relay.test.mjs`, `research-mission-clean-dispatch-
failure.test.mjs`, `research-crash-resume.test.mjs`, `research-node-
redispatch.test.mjs`, `research-mission-fleet-driver.test.mjs`,
`research-mission-fleet-driver-bootstrap.test.mjs`, `research-mission-
fleet-driver-dispatch-advisories.test.mjs`, `research-mission-fleet-driver-
learning-ledger.test.mjs` -- `node --test` -- 68/68 pass. Broader sweep of
every `research-*.test.mjs` file in the suite (37 files, including the new
one): 316/316 pass, 0 fail.

**Lint.** `npx oxlint` on every new file (`generic-research-crash-
fixture.mjs`, `research-mission-crash-dispatch-worker.mjs`, `research-
mission-process-crash-survival.test.mjs`) -- fixed 2 `curly` findings on
newly-added lines (the fixture worker's dispatch-failure guard, the test's
own `waitFor` helper) rather than leaving them; clean, exit 0 after.

Adopted SHA: see the commit on `tsf/feature/f6-research-mission-crash-test`
that carries this section.
## Phase 6: Global Operator State / Needs You Audit -- Finding F19 FIXED

Worktree: `phase6-global-operator-state-audit`, branch
`tsf/feature/phase6-global-operator-state-audit` (forked from `tsf/main` @
`4be97520cf8a36edcba6ea982580fd782b3a59c4`, i.e. after F18/F1/F3/F4/F5/F7/
Phase 2/Phase 4 above).

Goal: with F18 fixed (global "what needs me?" questions now actually reach
`classifyGlobalScope`), does the real fleet-wide aggregation those
questions read from actually cover every real Needs-You source? Read the
real code, not doc summaries, across 5 investigation areas.

### 1-2. Coverage: does `fleetNeedsYouStatus`/`fleetWorkStatus` aggregate
every real source? -- REAL GAP FOUND (Planner Context Lifecycle), FIXED

Traced the real call graph: `command-responder.mjs`'s `respondCommand`
(`NEEDS_YOU_QUERY` branch, `~line 508`) and `command-followup-context.mjs`'s
`explainNeedsYou` (the "why?"/"what's blocking it?" follow-up) are the ONLY
two production callers of `domain/fleet-work-status.mjs`'s
`fleetNeedsYouStatus`. Before this fix, its signature was
`fleetNeedsYouStatus(projects, keepGoingRuns, researchMissions)` -- exactly
2 sources (Keep Going runs' own `needsYou[]`, ResearchMission's own
`needsYou[]`). Planner Context Lifecycle's own durable
`checkpoint.needsYou[]` (raised via `planner-mission-checkpoint.mjs`'s
`raisePlannerNeedsYou`, persisted via `planner-mission-store.mjs`'s
`withPlannerMissionRecord` into `opState.plannerMissions` -- the SAME
opState-collection convention `keepGoingRuns`/`researchMissions` already
use, confirmed by reading `data-store.mjs`'s own default-shape comment)
was **never read by either call site** -- neither passed
`opState.plannerMissions` in at all. A planner-raised Needs You item was
durably persisted, correctly raised, and structurally invisible to every
real "what needs me?" query. This is a real, grounded, reproducible gap,
not a manufactured one -- confirmed by writing a failing-first proof (a
real `respondCommand({message:'what needs me?', ...})` call against an
`opState.plannerMissions` fixture returned the honest-empty "nothing needs
you" text before this fix).

`fleetWorkStatus` ("what's running") was separately confirmed to have NO
Planner Context Lifecycle awareness either -- it iterates `projects` and
looks up `keepGoingRuns[project.id]` only; ResearchMission's "is it active"
question is answered by a SEPARATE function, `fleetResearchStatus`
(`ACTIVE_RESEARCH_PHASES`-gated), not by `fleetWorkStatus` itself. There is
no third `fleetPlannerStatus`-shaped function for planner missions, and
none was added here -- deliberately out of scope for this pass (see "Not
fixed" below): unlike ResearchMission's `computeResearchMissionPhase`
(a real, established EXECUTING/WAITING_NEEDS_INPUT/COMPLETE/BLOCKED
vocabulary this codebase already treats as the "is it really active"
signal), a planner mission's own checkpoint only carries a binary
`missionState: 'ACTIVE'|'COMPLETE'` -- inventing a richer "is a planner
mission genuinely doing something right now" classification from that
alone would be guessing at semantics the domain layer itself has not
established, not "extending the existing aggregation" the way wiring in an
already-real, already-typed `needsYou[]` array is.

**Fix.** `tsf/domain/fleet-work-status.mjs`'s `fleetNeedsYouStatus` gained
a 4th parameter, `plannerMissionRecords = {}` (the exact
`opState.plannerMissions` shape, `{ missionId: { lease, checkpoint } }`),
looping over `record?.checkpoint?.needsYou ?? []` exactly like the existing
PROJECT/RESEARCH loops (`source: 'PLANNER', label: 'Planner ' + missionId,
id, question`) -- same resolved-entry filter (`entry.resolvedAt` skips it),
same shape family, no new mechanism. Both real call sites now pass
`opState.plannerMissions` through:
`command-responder.mjs`'s `NEEDS_YOU_QUERY` branch and
`command-followup-context.mjs`'s `explainNeedsYou`.

Additionally, every item gained a `projectId` field (`PROJECT` items
already had it in scope, just weren't returning it; `RESEARCH` items now
report the mission's own real `projectId` field; `PLANNER` items honestly
report `projectId: null` -- a planner checkpoint's `repoState` is
branch/sha/worktreePath, not a project id, and this fix does not guess
one). See area 5 below for what this enabled.

**Tests.** `tsf/test/fleet-work-status.test.mjs`: 3 new tests -- a real
Planner Context Lifecycle needsYou entry (built via the real
`createPlannerMissionCheckpoint`/`raisePlannerNeedsYou` domain functions,
not a hand-typed fixture) is now a real 4th source alongside PROJECT/
RESEARCH, with the new `projectId` fields verified per-source; a resolved
planner entry is excluded (matches PROJECT/RESEARCH); a lease-only record
with no checkpoint yet never throws. `tsf/test/command-responder.test.mjs`:
1 new test proves a planner-raised needsYou item is discoverable through
the REAL `respondCommand({message:'what needs me?'})` entry point (not the
domain function in isolation) -- the exact path Tim's own message reaches.
`tsf/test/command-followup-context.test.mjs`: 1 new test proves the same
through the real durable `withPlannerMissionRecord` + `raisePlannerNeedsYou`
path via the "what's blocking it?" follow-up (`explainNeedsYou`'s own real
call site), with test-end cleanup (`resolvePlannerNeedsYou`) so this
file's cumulative on-disk state doesn't leak an unresolved item into the
later "nothing actually open" test in the same file.

Result: `node --test tsf/test/fleet-work-status.test.mjs
tsf/test/command-responder.test.mjs tsf/test/command-followup-context.test.mjs`
-- 61/61 pass. Regression sweep of every test file that imports
`fleet-work-status.mjs`, `command-responder.mjs`, or
`command-followup-context.mjs` (14 files: `command-adversarial-corpus`,
`command-authority-regression-matrix`, `command-dogfood-sequences`,
`command-research-bridge`, `command-research-completion-watch`,
`command-research-zero-relay-autonomy`, `command-run-action-bridge`,
`command-target-resolution-blocker`, `golden-path-operator-flow`,
`self-update-scenarios`, `update-safety`, `work-feed-summary`,
`chat-responder`, plus the 3 above) -- 286/286 pass.

### 3. Resource Pressure Governor refusals -- CONFIRMED disclosed gap, NOT fixed (out of scope)

Traced every F1-added `RESOURCE_PRESSURE_REFUSED` refusal site
(`command-research-spec-synthesis.mjs`, `command-scope-classifier.mjs`,
`field-source-reconciliation.mjs`, `onboarding.mjs` x2,
`wbs-generation.mjs`) forward: none of them write a durable record
anywhere. `resource-pressure-governor.mjs`'s own
`buildResourcePressureState` DOES have a `missionsWaitingForResources`
field, but it is caller-supplied input only (`sanitizeWaitingList`), never
populated from a real durable store -- confirmed via
`resource-pressure-governor-http-routes.mjs` (`missionsWaitingForResources:
body?.missionsWaitingForResources`, honestly `[]` on a bare GET) and this
module's OWN pre-existing header/doc disclosure
(`docs/tsf/TSF_RESOURCE_PRESSURE_GOVERNOR_V0.md`: "`missionsWaitingForResources`
population needs Orca's ... no real [context] yet"). One refusal (onboarding's
`analyzeRepository`/`retryDirectionAnalysis`) IS surfaced to the operator in
the moment -- `AddProjectReviewStep.tsx` renders
`analysis.direction.unavailableReason` inline -- but this is ephemeral,
in-response-only text, never written anywhere Tim could recover later via
"what needs me?" or a fleet-status view. The other 4 refusal sites
(`{ok:false, reason:'RESOURCE_PRESSURE_REFUSED', ...}`) are caller-facing
return values with no confirmed UI surface read at all in this repo (not
traced further -- out of this phase's scope to audit every caller).

**Conclusion: real, but already-honestly-disclosed, gap -- not fixed here.**
This is not "extend an existing aggregation" (the mechanism
`missionsWaitingForResources` needs -- a durable, host-wide
"which mission asked and is still waiting" record, populated from Orca's
own process/mission context -- does not exist anywhere in this codebase to
extend; the pre-existing doc explicitly names Orca-core work as the
blocker). Building one would be inventing new durable state and a new
Orca-core bridge, which is out of this phase's "extend existing surfaces,
don't invent new subsystems" mandate. Recorded here as a real, open,
disclosed gap for a future phase, not silently dropped.

### 4. "What changed since I last looked" -- CONFIRMED: no such mechanism exists, not fixed (out of scope)

`grep -rn` across all of `tsf/` for `lastViewed`/`lastSeen`/`seenAt`/"since
your last"/"changed since"/`changedSince`/`diffSince`/`updatedSince`
(case-sensitive and semantic variants) found zero real per-operator
"last viewed" state or timestamp-diff mechanism anywhere in the server,
domain, or UI layers. Every surface (`fleetWorkStatus`'s
`lastCheckpointAt`, a research mission's `updatedAt`, a planner
checkpoint's `updatedAt`) exposes a real, honest "when did this last
change" FACT per item, but nothing compares that fact against a
per-operator "when did I last look" baseline to produce a "3 things
changed since you checked" answer. Tim genuinely has to remember state
himself today. This is real and confirmed, but building this mechanism
means new durable per-operator state (a "last viewed at" record) plus new
UI/Command surface to consume it -- a genuinely new subsystem, explicitly
out of this phase's scope ("do not create a new top-level subsystem").
Recorded as an open, real, disclosed gap, not fixed.

### 5. Navigation / deep-linking -- REAL GAP FOUND (PROJECT-sourced items had zero deep link despite the id being available), FIXED for the source that safely supports it

Read `tsf/ui/src/components/command/CommandPanel.tsx` in full: it already
has a real, working, tested deep-link mechanism -- `message.resolvedProjectIds`
renders as `<Link to={/projects/${id}}>` "Targeting" chips (used correctly
by every other intent branch in `command-responder.mjs`). But the
`NEEDS_YOU_QUERY` branch hardcoded `resolvedProjectIds: [], scope: 'FLEET'`
UNCONDITIONALLY -- even when a returned item's source project id was right
there in scope inside `fleetNeedsYouStatus`'s own loop
(`for (const [projectId, run] of Object.entries(keepGoingRuns))`), it was
simply never carried through to the response. So "what needs me?" gave Tim
prose with ZERO clickable path to the actual project, even though the
exact same UI machinery that deep-links every other Command answer was
sitting right there, unused, for this one. Confirmed this is real (not
speculative) by reading the actual response shape in
`command-responder.mjs` before this fix.

**Fix.** With `projectId` now on every `fleetNeedsYouStatus` item (area
1-2's fix), `command-responder.mjs`'s `NEEDS_YOU_QUERY` branch now computes
`resolvedProjectIds` as the deduped set of real, known project ids among
the returned items and reuses this file's own existing `scopeFor(ids)`
helper (already used by the multi-project dispatch branch) for `scope` --
no new UI mechanism, no new response field, reuses the exact chip-rendering
CommandPanel.tsx already has and already tests. `command-followup-context.mjs`'s
`explainNeedsYou` (the "why?" follow-up) got the same treatment.

**Self-inflicted regression found and fixed before it shipped.**
`command-followup-context.mjs`'s `explainPriorAnswer` checked
"exactly one resolved project" BEFORE checking "was the prior answer type
NEEDS_YOU_QUERY" -- harmless before this fix, since a NEEDS_YOU_QUERY
answer never carried a resolved project id. Once it legitimately could (a
single project-sourced Needs You item), "why is that blocked?" started
resolving through the generic per-project state explainer instead of the
Needs-You explainer -- a real regression, caught by the existing
`command-dogfood-sequences.test.mjs` dogfood-A scenario (NOT a new test
written to paper over it): the explanation text changed from the specific
open question ("A real decision is pending...") to a generic run-state
summary. Fixed by reordering `explainPriorAnswer` to check
`answerType === 'NEEDS_YOU_QUERY'` first -- `answerType` is a more precise
signal of what "that" refers to than an incidental resolved-project-id
count, and this also improves the 2+-project case (previously an ambiguous
"which one do you mean?" refusal; now correctly explains the actual
Needs-You list, which already handles multiplicity via its own "N more
open item(s)" note). Re-ran the full dogfood-sequences suite + the
followup-context suite after the reorder: all pass.

**Not fixed, disclosed:** `RESEARCH`/`PLANNER`-sourced items still have no
navigable target -- `CommandPanel.tsx` (and no other UI surface, confirmed
via `grep` for a `/research`-shaped route) has zero link mechanism for a
mission id at all, only for a project id. Wiring one up means designing
and building a real mission-detail route in the UI, a materially bigger
change than reusing an existing, already-tested mechanism -- out of this
phase's scope. `RESEARCH`/`PLANNER` items' `projectId` is real when known
(RESEARCH) or honestly `null` (PLANNER, no association exists) so a future
fix has the data already; only the UI link is missing.

### Not fixed / explicitly out of scope, summary

- Resource Pressure Governor wait-state durability (area 3) -- needs
  Orca-core work, already disclosed pre-existing.
- "Changed since I last looked" (area 4) -- would be a new subsystem.
- RESEARCH/PLANNER deep-linking in the UI (area 5) -- would need a new
  route; the domain data (`projectId` per item) is ready for it.
- A `fleetPlannerStatus`-equivalent to `fleetResearchStatus` for "is a
  planner mission running" (area 2) -- the domain layer has no established
  vocabulary for this yet (only a binary ACTIVE/COMPLETE `missionState`),
  so adding one now would mean inventing semantics rather than extending
  established ones.

None of these were silently dropped -- each is recorded here as a real,
confirmed, disclosed gap for a future phase to pick up with proper design
work, per this program's own "no manufactured fixes, no silently dropped
findings" discipline.

**Lint.** `npx oxlint` on every changed file
(`tsf/domain/fleet-work-status.mjs`, `tsf/server/command-responder.mjs`,
`tsf/server/command-followup-context.mjs`, `tsf/test/fleet-work-status.test.mjs`,
`tsf/test/command-responder.test.mjs`, `tsf/test/command-followup-context.test.mjs`)
-- every reported finding matches the exact pre-existing baseline
(confirmed via `git stash` before/after diff); one genuinely new `curly`
finding on a newly-added line (`fleet-work-status.mjs`'s new PLANNER loop)
was fixed rather than left, per this repo's own established convention.

Full whole-repo sweep (`node --test tsf/test/*.test.mjs`): 2353 tests,
2347 pass, 6 fail -- all 6 match the EXACT pre-existing fail set this
program's own F1/F3/F4 checkpoint entries above already documented on this
host (2 intent-classifier phrasing gaps + 1 WorldForge-scenario phrasing
gap in `command-bare-imperative-dispatch.test.mjs`, 1 Work-tab timing test
in `http-work-summary.test.mjs`, 1 real-host-load stall in
`keep-going-autonomy-proof.test.mjs`, 1 race-condition test in
`operator-state-adversarial.test.mjs`'s "STALE ACTION RACE"). The race
condition was independently re-verified here specifically (not just cited
from an earlier entry): re-ran `operator-state-adversarial.test.mjs` in
total isolation against the true unmodified baseline (`git stash` before
running, `git stash pop` after) -- all 9 tests including "STALE ACTION
RACE" passed cleanly (330s total, this host under concurrent-session
load), confirming it is a full-suite-concurrency artifact reproducible
with or without this phase's change, not caused by it.

Adopted SHA: see the commit on
`tsf/feature/phase6-global-operator-state-audit` that carries this
section.

## Phase 7: Command Control-Surface Dogfood -- Findings F20, F21 FIXED

Worktree: `phase7-command-control-surface-dogfood`, branch
`tsf/feature/phase7-command-control-surface-dogfood` (forked from
`tsf/main` @ `57e88a55b2de38f8a2664c0ef4921c9f75538208`, i.e. after F18/F19
and Phases 1-6 above).

**Method.** Not a test-suite-trusting pass. Built a disposable, throwaway
driver script (`node`, not committed) reusing `command-dogfood-sequences
.test.mjs`'s own established isolated-state-file + `turn()` convention
(`TSF_UI_STATE_FILE` pointed at a fresh per-process file, planner CLIs
stubbed to a nonexistent path so `classifyGlobalScope` runs its real,
honestly-labeled `DETERMINISTIC_FALLBACK` path rather than making a live,
billable call) and drove every command from this phase's own list through
the REAL `respondCommand` entry point against 4 disposable
`sourceClass: 'FIXTURE'` projects with varied real durable state, seeded
through the REAL domain/store functions (`createOvernightRun`,
`completeRun`, `withKeepGoingRun` -- never a hand-typed response fixture):

- `dogfood7-active` -- a real `ACTIVE` Keep Going run, no wave dispatched
  yet.
- `dogfood7-blocked` -- a real `NEEDS_YOU` run with one real open question
  ("Which export schema should dogfood7-blocked use?").
- `dogfood7-done` -- a real run driven to `COMPLETE` via the real
  `completeRun` domain transition.
- `dogfood7-idle` -- no run at all.

A 5th, `the-average-rainfall-in-portland-...`, was created live through the
real research bridge (`respondCommand({message:'Research the average
rainfall...'})`), not hand-built, to prove that path end-to-end too. Every
response below was read in full and cross-checked against the real durable
store after the turn (`readKeepGoingRun`, `readResearchMissionStatus`), not
just checked for "didn't throw."

### Per-command results

- **"What is running?"** -- REAL GAP FOUND (F20, below). After the fix:
  correctly returns real, grounded fleet-wide status naming all 4 fixture
  projects with their real, current per-project states (`PLANNING`,
  `NEEDS_YOU`, `READY_FOR_ADOPTION`/"reached COMPLETE", "no Keep Going
  run"), `scope: 'FLEET'`, `resolvedProjectIds: []` (correct -- no single
  project referent).
- **"What finished?"** -- REAL GAP FOUND (F20, below, same root cause).
  After the fix: `intent: 'FINISHED'`, reuses the same real
  `fleetWorkStatus`/`fleetResearchStatus` grounding as "What is running?"
  (an existing, deliberate, pre-Phase-7 design choice shared by every
  `STATUS_LIKE_INTENTS` member -- see disclosed cosmetic note below).
- **"What needs me?"** -- HOLDS UP, no gap. `intent: 'NEEDS_YOU_QUERY'`,
  correctly surfaced only `dogfood7-blocked`'s real open question, with the
  real question text verbatim, `resolvedProjectIds: ['dogfood7-blocked']`
  (real deep-link, F19's own fix from Phase 6 confirmed still working end
  to end against a fresh fixture, not just its own dedicated test file).
- **"Why is this blocked?"** (a real follow-up to the "what needs me?"
  answer above) -- HOLDS UP. `intent: 'FOLLOW_UP_EXPLANATION'`, correctly
  re-explained `dogfood7-blocked`'s real open question (Phase 6's
  `explainPriorAnswer` NEEDS_YOU_QUERY-first ordering fix confirmed live).
- **"Pause dogfood7-active." / "Continue dogfood7-active."** -- HOLDS UP,
  real actions with real, verified side effects. `readKeepGoingRun`
  confirmed `state: 'PAUSED'` then `state: 'ACTIVE'` after each turn --
  not just the response text claiming it.
- **"Pause everything except project X"** -- REAL GAP FOUND (F21, below).
  Not a merely-unbuilt capability (that part was already known and pinned
  in `command-responder.test.mjs`) -- a real, reproducible wrong-target
  bug: with genuine prior conversational context on record (a completely
  ordinary, expected condition in a real Command session), this silently
  paused/resumed the WRONG single project (a stale back-reference from an
  earlier, unrelated turn) while claiming success, ignoring the quantifier
  and the exclusion entirely. Fixed to honestly decline instead (see F21).
- **"Dogfood this project." / "Dogfood dogfood7-active."** -- HOLDS UP,
  real bridge routing confirmed, not a stub. Routed to the real
  `UI_DOGFOOD_AGENT_V0` bridge (`respondDogfoodCommand` via
  `command-responder.mjs`'s own `deps.dogfood` passthrough) with injected
  fake Electron/capture deps (mirroring `command-dogfood-bridge.test.mjs`'s
  own `REQUIRED PROOF` test) -- returned `live: true` and a real
  `dogfoodRun` summary, proving `deps.dogfood` genuinely reaches
  `runDogfoodPass`, not a placeholder. "Dogfood this project." (never
  naming an actual project) still correctly dogfoods Orca's own UI --
  matches this bridge's own disclosed V0 scope (only Orca's own UI is a
  real, launchable target today), not a silent no-op.
- **"Research this question." / "Research the average rainfall in
  Portland..."** -- HOLDS UP, real bridge routing confirmed. Both created a
  real, durable `ResearchMission` (`readResearchMissionStatus(missionId)
  .phase === 'DRAFT'`, matching the honestly-reported "couldn't reach the
  live planner (SPAWN_ERROR)" text -- the planner CLI was deliberately
  stubbed for test isolation, same convention as every other test file in
  this suite) -- never a fabricated "created" claim with no real record
  behind it.
- **"What changed overnight?"** -- CONFIRMED: no real mechanism exists
  (matches Phase 6 area 4's own prior finding on "changed since I last
  looked" exactly -- this is the same gap, a different phrasing of it).
  Honest generic fallback, never a fabricated diff.
- **"Which workers are using memory?"** -- CONFIRMED: no real per-worker
  memory-usage surface exists anywhere in Command (the Resource Pressure
  Governor's host-memory evidence gates dispatch admission internally, per
  Phase 1's F1, but is never exposed as an answerable Command query).
  Honest generic fallback.
- **"Which work can safely continue?"** -- CONFIRMED: no real mechanism.
  Distinct from `GLOBAL_ADVISORY` ("what's safe to test/experiment on," a
  disposable-project concept `command-scope-classifier.mjs` already
  implements) -- this phrasing asks about resumability of blocked/paused
  work, which has no real classifier or answer path. Honest generic
  fallback, not conflated with the unrelated `GLOBAL_ADVISORY` capability.
- **"Show me failures from today."** -- CONFIRMED: no real per-day
  failure-history surface exists. Honest generic fallback.
- **Error handling / ambiguous / nonsensical** -- HOLDS UP. Pure gibberish
  (`"asdkfj laksjdf qpwoei"`) and a message whose only shared token with
  every fixture project ("dogfood7") falls below the fuzzy-confidence floor
  (`0.5 < 0.6`) both got the same honest "couldn't tell which project"
  refusal, never a guess. A message naming two projects by their exact
  displayName phrase dispatched to both, honestly, with a REAL
  `TSF_REPOSITORY_NOT_REGISTERED` refusal per project (these fixtures have
  no real repo root) -- confirming dispatch never fabricates a success
  claim for a project it can't actually act on. (The pre-existing,
  already-tested ambiguous-multi-fuzzy-match refusal path --
  `command-responder.test.mjs`'s "alpha-widgets"/"alpha-gadgets" tests --
  was independently re-confirmed passing after this phase's fixes, not
  re-derived from scratch.)

### Finding F20: STATUS/FINISHED intent vocabulary gap for Tim's own uncontracted phrasing -- REAL, REPRODUCED, FIXED

Same shape as F18: a real vocabulary gap in a deterministic pattern, not a
design decision, silently swallowing a natural, project-less status
question into the generic "couldn't tell which project" non-answer.

**"What is running?"** (this phase's own command list, verbatim) --
`classifyIntent` returned `QUESTION` (the interrogative-catch-all), not
`STATUS`: `chat-responder.mjs`'s `STATUS` pattern required the apostrophe
contraction (`what'?s running`/`what'?s going on`) and had no `what is`
alternative at all -- confirmed live via a direct `classifyIntent('What is
running?')` call against the unmodified code, returning `'QUESTION'`.
Because `QUESTION` is one of `command-responder.mjs`'s
`UNROUTED_QUESTION_INTENTS`, the message still reached
`classifyGlobalScope` -- but `command-scope-classifier.mjs`'s own,
SEPARATE `deterministicScopeFallback` GLOBAL_STATUS pattern had the
identical `what'?s`-only gap, so it fell through the fallback too and hit
the generic non-answer. A live planner (when genuinely available and asked
to classify the same, unresolved-scope message) might get this right
regardless -- but the deterministic fallback is the safety net for
exactly the case where it is NOT available, and it failed on Tim's own
listed phrasing.

**"What finished?"** (also this phase's own list, verbatim) had a
distinct, second gap: `FINISHED`'s pattern only covered "is (this/it)
(actually) done/finished/ready" and "are we done" -- no bare "what
finished" form at all, so it never even reached the vocabulary-gap
territory the STATUS fix above closes; it needed its own new alternative.

**Fix.** `tsf/server/chat-responder.mjs`: `STATUS`'s pattern gained
`what(?:'?s| is) going on` / `what(?:'?s| is) running` (apostrophe-optional
preserved, so the existing `whats running` no-apostrophe match this file's
own test suite already pins keeps passing); `FINISHED`'s pattern gained
`what finished` (its own grammatical shape -- "finished" as the main verb)
and `what(?:'?s| is) done` (the predicate-adjective form), as two separate
alternatives rather than forcing one fragment to cover two different
sentence shapes. `tsf/server/command-scope-classifier.mjs`'s
`deterministicScopeFallback` GLOBAL_STATUS pattern got the identical
`what(?:'?s| is)` fix, kept explicitly in sync (own comment references the
sibling fix) since it is a second, independently-reachable copy of the
same vocabulary, the same class of drift this codebase has already been
bitten by more than once (`PROHIBITION_MARKERS` vs. `EXCLUSION_PREFIX`,
noted in `chat-responder.mjs`/`project-name-resolver.mjs`'s own comments).
No new classification mechanism -- both are the exact same regex-fragment
class of fix, applied to the exact two pre-existing patterns that already
own this vocabulary.

**Tests.** `tsf/test/chat-responder.test.mjs`: new test asserts
`classifyIntent('What is running?') === 'STATUS'`,
`classifyIntent('what is going on?') === 'STATUS'`,
`classifyIntent('What finished?') === 'FINISHED'`,
`classifyIntent('what is done') === 'FINISHED'`, and pins the honest,
disclosed residual gap (`classifyIntent("what's finished") === 'GENERAL'`
-- only the bare-verb and "is done" shapes are covered, not every FINISHED
synonym; not fixed further here, since neither this phase's command list
nor any real reproduction named that specific phrasing). Existing
apostrophe-optional `whats running` test in the same file re-confirmed
passing (proves no regression from the `'?s` fix).

### Finding F21: quantified pause/resume silently mis-targeted a stale back-referenced project -- REAL, REPRODUCED, FIXED

**Not the same gap as the already-known "bulk pause/resume was never
built."** `command-responder.test.mjs` already had a real, deliberately
pinned test (`'multi-project: "pause everything" (no exclusions) really
pauses every real project with a run'`) proving that with NO prior
conversational context, `"pause everything"` honestly falls through to the
generic "couldn't tell which project" refusal -- `classifyRunActionVerb`'s
PAUSE branch was documented as a single-target-only mechanism, bulk pause
explicitly deferred ("real, valuable follow-up work, not built this
round"). That test and its own reasoning are correct and untouched here.

**What that test never covered, and what this phase's real, scripted,
multi-turn dogfood sequence exposed:** in a REAL Command session there is
almost always a prior turn on record. With genuine prior context (e.g. a
just-completed `"Continue dogfood7-active."` turn, which durably records
`resolvedProjectIds: ['dogfood7-active']` in `chatThreads.__command__`,
exactly like `http-server.mjs`'s own real chat-save plumbing does), a
follow-up `"Pause everything except dogfood7-idle."` did NOT reach the
honest fallback at all. `resolveProjectsFromText` correctly excludes the
named-but-excluded project from `resolution.matches` (`isExcludedNear`
already worked correctly, confirmed) -- but with zero matches AND no named
exact project, `classifyRunActionVerb`'s PAUSE branch fell through to
`lastReferencedProjectId(opState, projects)`, which resolved to
`dogfood7-active` (the STALE, unrelated prior turn's project) and silently
paused ONLY that one project, reporting `"Paused **Dogfood7 Active**
(resolved from the prior turn)."` -- while `dogfood7-blocked` (which
should also have been paused under "everything except idle") was left
untouched, and the operator was given no indication anything was
incomplete or mistargeted. Confirmed real and reproducible via the real
durable store (`readKeepGoingRun` after the turn: `dogfood7-active` was
genuinely `PAUSED`, `dogfood7-blocked` was still `NEEDS_YOU`) -- not a
theoretical trace, an actual wrong mutation with a false-success response.
This is exactly the "claims an action happened correctly when it silently
did the wrong thing" failure mode this phase's brief named as the primary
target, not a mere unbuilt-feature gap.

**Fix.** `tsf/server/command-responder.mjs`: imported
`isAllProjectsQuantified` (already exported by `project-name-resolver.mjs`,
already used by the sibling dispatch quantifier machinery -- no new
mechanism). The PAUSE/RESUME branch now computes `quantified = !namedExact
&& isAllProjectsQuantified(message)` and folds it into the
back-reference-eligibility guard (`!namedExact && !quantified && ...`), so
a quantified pause/resume message with no named exact match NEVER falls
through to the back-reference resolver -- it reaches the same, honest,
already-tested "couldn't tell which project" fallback the no-context case
already got, for the SAME reason `dispatchAndRespond`'s own quantifier
check is already documented as checked before its back-reference fallback
("a quantifier is a stronger, more explicit signal than conversational
history"). Deliberately NOT an attempt to build real bulk pause/resume
execution in this pass -- that remains the same disclosed, deferred
follow-up work `command-responder.test.mjs`'s own pinned comment already
named; this fix only closes the silent-wrong-target/false-success path,
consistent with this program's "bounded, low-risk, reuse existing
mechanisms" discipline.

**Tests.** `tsf/test/command-responder.test.mjs`: new test builds a real
prior-turn back-reference via the file's own existing
`opStateWithLastTurn(['alpha-widgets'])` helper, then sends `"pause
everything except alpha-gadgets"` and asserts the honest fallback text,
`resolvedProjectIds: []`, and that the response text never starts with
`"Paused"` -- the exact shape of the false-success bug this fix closes.
The existing no-prior-context "pause everything" test (above) re-confirmed
passing unchanged.

### Disclosed, not fixed: fleet-status header text is question-agnostic

Every `STATUS_LIKE_INTENTS` member (`STATUS`, `NEXT_ACTION`, `FINISHED`,
`HEALTH`) that falls through to `respondNoProjectResolved`'s fleet-wide
fallback shares the SAME `formatFleetStatusText` output, headed
`"Here's what's really running right now:"` -- including for `"What
finished?"`, whose answer is headed by a sentence about what's "running,"
even though every LINE beneath it is real, honestly-labeled, per-project
state (a `COMPLETE` run is explicitly labeled `READY_FOR_ADOPTION`/"run
reached COMPLETE via independently-verified acceptance criteria," never
disguised as still-running). This is a pre-existing, deliberate design
choice (all 4 intents already shared this exact fallback before Phase 7;
F20's fix only makes `"What finished?"` REACH it, not a new sharing
decision) with real test coverage pinning the exact header text across
multiple files. Not a grounding/honesty violation -- no fact stated is
false or invented -- but a real, minor framing mismatch, confirmed and
disclosed rather than silently left unmentioned. Not fixed: making the
header intent-aware would touch a shared formatter used by 4 different
question shapes across many already-pinned tests, disproportionate to a
cosmetic nit for this phase's bounded, low-risk mandate. Recorded as a
real, open, low-priority polish item for a future phase.

**Lint.** `npx oxlint tsf/server/chat-responder.mjs
tsf/server/command-responder.mjs tsf/server/command-scope-classifier.mjs
tsf/test/chat-responder.test.mjs tsf/test/command-responder.test.mjs` --
clean, exit 0.

**Tests.** `node --test tsf/test/command-responder.test.mjs
tsf/test/chat-responder.test.mjs` -- 67/67 pass (2 new tests covering F20 +
F21). Regression sweep of every `command-*`/`chat-responder`/
`fleet-work-status`/`http-command*`/`self-update-scenarios`/
`update-safety`/`golden-path-operator-flow`/`work-feed-summary` test file
(18 files, 338 tests): 335 pass, 3 fail -- all 3 independently confirmed
(via `git stash`/`git stash pop`) to fail IDENTICALLY against the
unmodified baseline (`command-bare-imperative-dispatch.test.mjs` x2,
`command-operator-integration-adversarial.test.mjs` x1) -- the exact
pre-existing, already-documented `classifyIntent(...) === 'GENERAL'` vs.
`QUESTION`/`FEEDBACK_BUG` phrasing gap F18's own checkpoint entry names
explicitly, not caused by this phase. Full whole-repo sweep (`node --test
tsf/test/*.test.mjs`): 2356 tests, 2350 pass, 6 fail -- the exact 6-test
fail set matches, name-for-name, the pre-existing baseline F1/F3/F4/
Phase 6's own checkpoint entries above already documented on this host
(2 intent-classifier phrasing gaps + 1 WorldForge-scenario phrasing gap in
`command-bare-imperative-dispatch.test.mjs`/`command-operator-integration-
adversarial.test.mjs`, 1 Work-tab timing test in `http-work-summary
.test.mjs`, 1 real-host-load stall in `keep-going-autonomy-proof.test.mjs`,
1 race-condition test in `operator-state-adversarial.test.mjs`'s "STALE
ACTION RACE") -- none touch `command-responder.mjs`, `chat-responder.mjs`,
or `command-scope-classifier.mjs`, and 3 of the 6 were independently
re-confirmed pre-existing via `git stash` above.

Adopted SHA: see the commit on
`tsf/feature/phase7-command-control-surface-dogfood` that carries this
section.
## Phase 13: Evaluation / Regression Quality -- 2 real acceptance-level gaps confirmed and closed

Worktree: `phase13-evaluation-quality`, branch
`tsf/feature/phase13-evaluation-quality` (forked from `tsf/main` @
`57e88a55b2de38f8a2664c0ef4921c9f75538208`, i.e. after F19/Phase 6 above).

**Goal.** Audit whether the current test/evaluation system actually
protects the things TSF now claims to support -- critical capabilities
with plenty of unit-test coverage but weak or absent ACCEPTANCE-level
proof that the real, composed product behavior works end to end.

**Reconciliation (mandatory first step).** Read `tsf/domain/evaluation-
pack.mjs` (the generic scoring engine: `normalizeEvalPack`, `scoreCase`,
`runEvalPack`, `compareEvalRuns`) and `tsf/server/eval-pack-registry.mjs`
in full before writing anything. Confirmed the registry held exactly 8
packs at Phase 13 start (`PLANNER`, `WORKER`, `VERIFIER`, `ROUTING`,
`MEMORY`, `AUTONOMY`, `ESTIMATOR`, `UI_DOGFOOD`), each a
`{packId, version, category, description, cases[]}` object plus a
`run(pack, clock) -> Promise<caseId, actualOutput>` function, registered
as `REGISTRY[pack.packId] = { pack: normalizeEvalPack(PACK), run }`. Every
new pack this phase built reuses this EXACT shape -- no second engine, no
new registration mechanism.

### Investigation 1: TSF_PLATFORM_GOLDEN_PATH_EVAL -- REAL GAP CONFIRMED, CLOSED

Three parallel investigation subagents read the suggested candidate files
IN FULL against the real code (not doc summaries) before any pack was
designed, per this phase's own "verify the gap is real first" instruction.

**Candidates read:** `tsf/test/command-dogfood-sequences.test.mjs`,
`tsf/test/keep-going-autonomy-proof.test.mjs`,
`tsf/test/planner-session-lifecycle-golden-rollover.test.mjs`, plus
`tsf/test/golden-path-operator-flow.test.mjs` (found via search, read for
completeness though not named in the task brief).

**Finding, evidence-backed:**
- `command-dogfood-sequences.test.mjs` is the only file that drives a
  dispatch-worthy message through the real `respondCommand` entry point,
  but every "run it"/"run that" turn is engineered to fail at
  `ensureWorktreeForDispatch`'s `!project?.root` check (the fixture
  project never sets `.root`) -- before `classifyDispatchAdmission`, the
  planner call, `ensureActiveRun`, or `tickKeepGoingRun` are ever reached.
  `assert.ok(runIt.dispatchResults, ...)` only proves an honest failure
  record exists, not a successful composed chain.
- `keep-going-autonomy-proof.test.mjs` is the strongest single proof of
  real multi-wave autonomous progression (spawns a real server process,
  survives a real mid-wave restart, drives 3 real waves to COMPLETE via
  the real background fleet driver) -- but it never calls `respondCommand`
  at all (starts via raw `/api/keep-going/:id/start`/`/tick` REST calls),
  forces the Resource Pressure Governor HEALTHY throughout (its DELAY/
  REFUSE branches are structurally unreachable), supplies
  `candidateWorkItems` directly in the request body (bypassing any real
  planner judgment), and stubs the "verifier" as a hand-written JSON file
  the TEST itself writes to disk -- never a real Command-Panel-shaped
  operator-visible result (every assertion is a GET of JSON state).
- `planner-session-lifecycle-golden-rollover.test.mjs` proves real lease/
  rollover durability for a DIFFERENT subsystem (Planner Context
  Lifecycle, not Keep Going/Command dispatch) -- its "worker dispatch" is
  a bare fixture function, its "verifier" is a hardcoded
  `{verdict:'PASS'}` literal, its Resource Pressure Governor input is a
  hand-fabricated always-healthy object (never even the env-var seam), and
  it never touches Command/chat routing or any operator-visible text.
- `golden-path-operator-flow.test.mjs`'s own header explicitly defers to
  `keep-going-autonomy-proof.test.mjs` for "the fuller, heavier proof" and
  never itself drives dispatch through Command -- it proves cross-surface
  state AGREEMENT (Keep Going panel/Work/Flight Recorder/Planner Chat),
  not the composed create-to-complete chain.

**Conclusion: no existing test composes, in one run, Command intent
routing -> a real (non-forced) Resource Pressure Governor admission
decision -> a real planner call -> real Keep Going dispatch -> real wave
settlement -> the real settled-run reconciler's verifier stage -> durable
COMPLETE -> an operator-visible result.** This is a genuine, confirmed,
evidence-backed gap, not a manufactured one.

**What was built.** `tsf/server/platform-golden-path-eval-cases.mjs` +
`tsf/server/platform-golden-path-eval-runner.mjs`, registered as the
`platform-golden-path-basics` pack under a new `GOLDEN_PATH` category
(added to `EVAL_CATEGORIES` in `evaluation-pack.mjs`). 2 cases:
1. `critical-host-memory-genuinely-refuses-the-whole-chain-before-the-
   planner-is-ever-called` -- a real CRITICAL `classifyDispatchAdmission`
   reading, reached through `respondCommand` (not a hand-called
   `planAndDispatchFromChat`), refuses before `invokeLiveStructuredAnalysis`
   is ever called and creates no Keep Going run. The negative control
   proving the Governor is a genuinely live gate in THIS composition, not
   merely forced HEALTHY like every existing test.
2. `full-composed-chain-reaches-durable-complete-with-an-operator-visible-
   result` -- HEALTHY memory: `respondCommand` -> real
   `planAndDispatchFromCommand`/`dispatchOneProject` ->
   `ensureWorktreeForDispatch` (deps-injected registry/worktree-creation,
   the ONLY intentional fake in the whole chain, since the real Orca CLI
   worktree provisioning is out of scope for a cheap/bounded/local eval)
   -> real `resolveRepositoryIdentity` (real `git rev-parse` against a
   real, disposable git fixture repo) -> real `classifyDispatchAdmission`
   (HEALTHY, genuinely admits) -> the REAL `live-planner.mjs` spawn+parse
   path against `stub-planner-cli.mjs` (a real subprocess round-trip, not
   a hand-injected fake plan -- the actual output's `originalGoal.
   statement` is asserted to start with `stub-plan-for::`, which only the
   real stub CLI's own response shape produces) -> real
   `ensureActiveRun`/`createOvernightRun` -> real `tickKeepGoingRun`
   dispatch+settle (via a tracking fake orchestration adapter, echoing
   back whatever task id `dispatchStep` itself created -- deterministic by
   construction, not scripted) -> the REAL `settled-run-reconciler.mjs`:
   `reconcileSettledRun` genuinely requires a disk verdict before
   completing (asserted explicitly: `reconcileBeforeVerdict.action ===
   'DISPATCH_VERIFICATION'`, never assumed) -> a real verification wave
   dispatched and settled -> a real verdict JSON file written to the
   fixture worktree, matching the run's own real (stub-CLI-produced)
   acceptance criterion text exactly -> `reconcileAfterVerdict.action ===
   'COMPLETE'` -> real durable `state === 'COMPLETE'` -> a second real
   `respondCommand` status query whose text contains `READY_FOR_ADOPTION`
   and `independently-verified acceptance criteria` (the REAL
   `formatFleetStatusText`/`projectLiveWorkFeedState` production text for
   a COMPLETE run, not a hand-typed string).

**Real bugs found and fixed while building this (not silently worked
around):**
- `createDeterministicFakeResearchWorker`-style script access mistake
  (N/A here -- see the research pack section below for the actual
  instance of this).
- A real git `--since` second-granularity race:
  `settled-run-reconciler.mjs`'s `gatherWorktreeEvidence` runs real `git
  log --since=<ISO>`, which has only second-level precision. The fixture
  repo's initial commit and the run's own millisecond-precision
  checkpoints can land in the SAME wall-clock second (this whole scenario
  completes in well under a second), occasionally making the real commit
  sort as "since" a checkpoint made milliseconds earlier and diverting
  the reconciler into `CAPTURE_LATE_COMMITS` instead of
  `DISPATCH_VERIFICATION` -- a genuine, observed intermittent flake
  (reproduced multiple times), fixed by explicitly backdating the fixture
  commit's `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` by an hour. Not a
  product bug -- a real precision characteristic of `git log --since` this
  eval's own fixture now correctly accounts for.
- A fixed historical `CLOCK` in the dedicated test file caused the exact
  same race deterministically (not just occasionally) -- fixed by using a
  real-time-based clock in the test file, documented inline.
- Fixed project ids in the runner caused state-file contamination when the
  pack's `run` function was called more than once in the same process
  (e.g. a baseline-then-regressed comparison in the same test) -- fixed
  by making every scenario's project id unique per invocation.

**Break-it-and-confirm-it-catches proof (both forms).**
1. Permanent regression test (`platform-golden-path-eval-runner.test.mjs`,
   mirroring `planner-eval-runner.test.mjs`'s own established pattern): the
   SAME real happy-path scenario re-run with a real CRITICAL memory
   reading (`freeBytes` override, a real, different input into the same
   real `classifyDispatchAdmission` call -- never a hand-typed failure)
   fails the case (`governorAdmittedRealDispatch: false`,
   `missionReachedDurableCompleteState: false`), and `compareEvalRuns`
   correctly reports `DO_NOT_PROMOTE`.
2. Manual proof against real production code (task requirement, not
   committed): temporarily edited
   `tsf/domain/resource-pressure-governor.mjs`'s `classifyDispatchAdmission`
   to unconditionally `return { tier, admitted: false, reason:
   'DELIBERATE_TEST_BREAK...' }` ("the Resource Pressure Governor never
   admits anything," the task's own named example). Ran
   `node --test tsf/test/platform-golden-path-eval-runner.test.mjs`: BOTH
   the REQUIRED PROOF test and the regression test failed correctly (0.5
   pass rate, every downstream-of-admission assertion false). Reverted via
   `Edit` back to the exact original code (confirmed via `git diff --stat`
   showing zero changes afterward); re-ran the same file: all 3 tests
   passed again. This is real, direct evidence the pack detects a real
   product-level Governor outage, not just an assertion the engine
   trivially satisfies.

### Investigation 2: TSF_RESEARCH_GOLDEN_PATH_EVAL -- REAL GAP CONFIRMED, CLOSED

**Candidates read in full:** `tsf/test/research-e2e-normal-mission.test.mjs`
and `tsf/test/research-completion-verification-proving-set.test.mjs`, plus
`tsf/docs/tsf/CROSS_PROVIDER_RESEARCH_WORKER_RECONCILIATION_V2.md` (noted:
despite the name, this doc is NOT about the claim-verification/
reconciliation stage of the golden path -- it documents an unrelated
one-off investigation into single-provider dispatch that produced
`tsf/adapters/llm-latent-knowledge-research-worker.mjs`; the real
"reconciliation" domain logic lives in `tsf/domain/research-
reconciliation.mjs`, a naming collision worth flagging, not a source of
context for what "reconciliation" means in either candidate test).

**Finding, evidence-backed:**
- `research-e2e-normal-mission.test.mjs` proves the full epistemic chain
  (source -> observation -> claim -> verification/reconciliation ->
  CanonicalFact) through the real per-step driver interface
  (`research-mission-driver.mjs`), AND explicitly indexes a real
  CanonicalFact into the REAL DURABLE `research-library-store.mjs`
  (`withResearchLibrary`/`indexCanonicalFact`) and re-queries it as a real
  `CACHE_HIT` (step 7) -- but it never drives the mission to real
  `COMPLETE` (`completeResearchMission`/`driveOneCycle` are never called
  anywhere in the file) and never touches the Learning Ledger at all.
- `research-completion-verification-proving-set.test.mjs` is the only
  file that drives a mission to real `COMPLETE` through the real
  autonomous driver (`driveOneCycle`, looped until terminal), and is the
  only file that exercises the REAL, automatic Learning Ledger production
  wiring (`research-mission-fleet-driver.mjs`'s own `CHECK_COMPLETE`
  branch calls `withPlatformLearningLedger(recordLessonsFromCompletedMission)`
  on every real completion) -- but its own "Research Library" coverage
  hand-builds a brand-new, throwaway, IN-MEMORY library
  (`createResearchLibrary(clock)` + a manual loop) and never calls
  `withResearchLibrary`/`readResearchLibrary` (the real durable store) at
  all. Confirmed by grep: `research-mission-fleet-driver.mjs` (the real
  driver) never imports or calls `research-library.mjs`/
  `research-library-store.mjs` -- indexing a completed mission's facts
  into the durable library is not automatic anywhere in production; it is
  a deliberate, separate, manually-invoked step (consistent with
  `research-library.mjs`'s own header on `ReconciliationDecision`-gated
  reuse). The file's own Learning Ledger assertion is also weak
  (`typeof finalTickResult.lessonsRecorded === 'number'`; a genuine
  `lessonsRecorded === 0` clean-mission run would pass identically to one
  that actually recorded a lesson).
- Separately, `llm-latent-knowledge-research-worker.mjs` (Cross-Provider
  Research Worker Reconciliation V2's real deliverable) has solid,
  honest unit tests (`llm-latent-knowledge-research-worker.test.mjs`,
  12 tests) that explicitly PROVE it is un-wired from the free autonomous
  driver path (`research-mission-fleet-driver-bootstrap.mjs`) -- but
  nothing in the automated suite drives it as part of a real, composed,
  multi-provider `ResearchMission` through the real mission driver
  alongside another provider. The only evidence it ever worked in a live
  multi-provider context is a one-time, manually-run, prose-documented
  session (the V2 doc's own §6), not a repeatable regression test.

**Conclusion: real, specific, evidence-backed gap.** No single composed
real run proves (a) a mission driven to real `COMPLETE` through the real
autonomous driver AND (b) that same run's CanonicalFacts land in, and are
queryable back out of, the real DURABLE Research Library, AND (c) a
genuinely different second provider (never previously exercised inside a
real mission) participates in producing those facts.

**What was built.** `tsf/server/research-golden-path-eval-cases.mjs` +
`tsf/server/research-golden-path-eval-runner.mjs`, registered as the
`research-golden-path-basics` pack (same new `GOLDEN_PATH` category). One
real, composed scenario (`buildResearchGoldenPathScenario`) proves both
confirmed gaps together, deliberately (not two disconnected fixtures):
a single field on one node is dispatched to TWO real, different provider
adapters -- `createDeterministicFakeResearchWorker` (a grounded, cited
claim) and the REAL `createLlmLatentKnowledgeResearchWorker` (an
ungrounded latent-recall claim, its own established
`invokeLiveStructuredAnalysisFn` test seam injected, never a live call;
`TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED` toggled on and restored
around just this call) -- reporting genuinely DIFFERENT values for the
same field/temporalScope. 2 cases:
1. `cross-provider-conflict-reconciles-and-completes-via-the-real-
   autonomous-driver` -- both real dispatches succeed
   (`twoDistinctProvidersRealDispatched`), the real
   `verifyAndReconcileResearchNodeFieldDurable` genuinely escalates the
   disagreement (`genuineConflictWasEscalated`, via real
   `detectResearchConflicts`), a real rationale-bearing `RESOLVE_CONFLICT`
   reconciliation decision (after resolving the real Needs You entry the
   escalation raised -- mirroring `research-e2e-normal-mission.test.mjs`'s
   own step-9 ordering) picks the grounded claim
   (`reconciliationProducedCorrectCanonicalFact`), and the real
   `driveOneCycle` loop (never a hand-inlined `completeResearchMission`)
   drives the mission to real, durable `COMPLETE`
   (`missionReachedRealCompleteViaAutonomousDriver`).
2. `completed-missions-facts-land-in-the-durable-research-library-and-a-
   real-ledger-lesson` -- a real durable-store query BEFORE indexing is a
   genuine `CACHE_MISS` (`libraryCacheMissBeforeIndexing`, guarding
   against a vacuous later hit), the completed mission's real
   CanonicalFact is indexed via `withResearchLibrary`/`indexCanonicalFact`
   (the exact real, durable write missing from production automation),
   the SAME real store now reports a `CACHE_HIT` with the correct value
   (`libraryCacheHitAfterDurableIndexing`,
   `indexedValueMatchesReconciledCanonicalFact`), and the real Learning
   Ledger (`readPlatformLearningLedger`) is checked for CONTENT, not mere
   existence: a real `VERIFIED_CORRECTION_PATTERN` lesson whose
   `sourceMissionIds` names this exact mission
   (`learningLedgerRecordedARealCorrectionLessonForThisMission`) -- a
   strictly stronger assertion than the existing proving-set test's
   `typeof lessonsRecorded === 'number'`.

**Real bugs found and fixed while building this (not silently worked
around):**
- `createDeterministicFakeResearchWorker({..., script})`'s `script` is a
  caller-held `Map`, not a property on the returned worker object --
  `fakeWorker.script.set(...)` threw; fixed to keep the `Map` as a local
  variable, matching `research-e2e-normal-mission.test.mjs`'s own real
  usage pattern (should have been read more carefully the first time).
- `detectResearchConflicts` (`research-verification.mjs`) buckets claims
  by `(fieldName, temporalScope)` -- two claims in DIFFERENT temporal
  buckets can never conflict no matter how much their values disagree.
  The real `llm-latent-knowledge-research-worker.mjs` always derives its
  claim's `temporalScope` from `request.temporalRequirements.periodScope`
  (never `null` when the mission declares one); the fixture's fake-worker
  script originally hardcoded `temporalScope: null`, silently landing the
  two claims in different buckets and producing NO conflict at all (a
  real, confirmed defect in the eval's own fixture, caught by the very
  assertion this pack exists to make -- `genuineConflictWasEscalated`
  failed honestly instead of silently passing). Fixed by using the same
  real `periodScope` value for both claims.
- Escalating a conflict also raises a real Needs You entry
  (`raiseResearchNeedsYou`); resolving only the `Conflict` record via
  `decideReconciliation` without also resolving that Needs You entry left
  the mission in `NEEDS_YOU` state, which `research-mission-fleet-
  driver.mjs`'s own eligibility gate correctly refuses to advance --
  `driveOneCycle` never reached COMPLETE. Fixed by resolving the real
  Needs You entry first, mirroring `research-e2e-normal-mission.test.mjs`'s
  own step-9 ordering exactly (not a new pattern).
- The Research Library and Learning Ledger are real, singleton, cross-
  mission durable stores -- a fixed `missionId`/`entityId` per scenario
  build would let a second real build in the same process (needed for the
  break-it/regression tests) find a prior build's leftover library entry
  and report a vacuous `CACHE_HIT` even before real indexing. Fixed by
  making every scenario build generate its own unique `missionId` and
  `entityId`.

**Break-it-and-confirm-it-catches proof (both forms).**
1. Permanent regression test (`research-golden-path-eval-runner.test.mjs`):
   the same real scenario, but with the LLM worker fed the SAME value the
   fake worker already reports (`llmValue` override -- a real, different
   input, modeling "two providers silently agree when they shouldn't have
   been asked the same thing twice") -- `genuineConflictWasEscalated`
   correctly flips to `false` (the real `detectResearchConflicts` call
   genuinely finds no disagreement), the case fails, and `compareEvalRuns`
   reports `DO_NOT_PROMOTE`.
2. Manual proof against real production code (task requirement, not
   committed): temporarily edited `tsf/domain/research-verification.mjs`'s
   `verifyResearchClaim` to force `verdict = 'FAIL'` whenever real
   evidence exists (the task's own named example: "make a verifier always
   report FAILED"). Ran
   `node --test tsf/test/research-golden-path-eval-runner.test.mjs`: both
   the REQUIRED PROOF test and the regression test failed correctly (the
   grounded claim now REJECTED instead of VERIFIED, cascading through
   conflict detection/reconciliation/library-indexing -- 3 of 4
   assertions in the second case now fail). Reverted via `Edit` back to
   the exact original line (confirmed via `git diff --stat` showing zero
   changes afterward); re-ran the same file: all 3 tests passed again.

### Investigation 3: Cleanup V1 -- ALREADY ADEQUATELY COVERED, no new eval built

A dedicated subagent read `tsf/docs/tsf/AUTONOMOUS_POST_CLEANUP_UPGRADE_
PROGRAM_V1_CHECKPOINT.md` and every `cleanup-*.test.mjs` file, plus
`cleanup-executor.mjs`/`cleanup-lifecycle.mjs`, to check whether the
RECOMMENDATION -> PLAN -> AUTHORIZATION -> EXECUTION pipeline is proven
end to end for at least one real action class through the real production
entry point, or only tested stage-by-stage.

**Finding: the premise was wrong -- a genuine, single, composed test
already exists.** `tsf/test/cleanup-executor-worktree-adversarial.test.mjs`'s
"HAPPY PATH" test (and several siblings in the same file) calls the real
`runGovernedCleanupAction` (`cleanup-executor.mjs`) -- the single real
production orchestration entry point, which itself chains, in order, the
real `buildCleanupRecommendation` -> `buildCleanupPlan`/
`evaluateCleanupBlockers` -> `readOwnerAuthorizationGateState` ->
`createCleanupAuthorization` -> `beginCleanupExecution` -> a real
independent race-recheck -> the real per-action mutate function
(`executeRemoveDisposableWorktree`) -> `completeCleanupExecution` -- against
a REAL git repo/worktree on disk, asserting the worktree is actually
removed and a real quarantine copy of gitignored content exists. The SAME
file also proves the REAL DEFAULT (closed) owner-authorization gate
genuinely refuses an otherwise-perfect fixture with no override at all.
The only injected element in the whole composed run is the boolean
authorization-gate DECISION itself (`gateCheck`, a deliberate, disclosed
test seam documented in both the module and test file headers so tests
never flip the real global env var/flag file) -- every stage downstream of
that decision is real production code. `cleanup-http-routes.test.mjs`
routes through the same real `runGovernedCleanupAction` with zero
overrides (confirming the HTTP layer calls the exact same real pipeline),
though every mutating HTTP test there correctly stops at
`AUTHORIZATION_REFUSED` (the real global gate is never opened in a test) --
a disclosed, deliberate limitation of the HTTP-layer coverage specifically,
not of the pipeline itself, which is fully proven one layer down.

**Conclusion: no new eval pack or test built for Cleanup V1.** Building
one would duplicate `cleanup-executor-worktree-adversarial.test.mjs`'s own
HAPPY PATH test almost exactly, contradicting this phase's own "don't
build something merely because it's named as a possibility" instruction.

### What was NOT built, and why

- A third pack for Cleanup V1 (investigation 3 above: already adequate).
- A separate cross-provider-worker-only pack: folded into the research
  golden path pack's own scenario instead (the SAME composed mission
  proves both the durable-library gap and the cross-provider gap
  together, which is a more valuable, less redundant proof than two
  separate fixtures each exercising half the real chain).
- A generic `fleetPlannerStatus`-equivalent or other unrelated fixes: out
  of this phase's INVESTIGATE list and its own "verify the gap is real
  first" scope.

### Tests and lint

New files: `tsf/server/platform-golden-path-eval-cases.mjs` (46 lines),
`tsf/server/platform-golden-path-eval-runner.mjs` (289 lines),
`tsf/server/research-golden-path-eval-cases.mjs` (52 lines),
`tsf/server/research-golden-path-eval-runner.mjs` (341 lines) -- all well
under the 600-line `.mjs` oxlint cap. New tests:
`tsf/test/platform-golden-path-eval-runner.test.mjs` (3 tests),
`tsf/test/research-golden-path-eval-runner.test.mjs` (3 tests). Changed:
`tsf/domain/evaluation-pack.mjs` (added `GOLDEN_PATH` to
`EVAL_CATEGORIES`), `tsf/server/eval-pack-registry.mjs` (registered both
new packs, exact existing shape reused), `tsf/test/eval-pack-registry.test.mjs`
(10-category assertion + `TSF_UI_STATE_FILE` isolation -- the first pack
in this registry to transitively touch `data-store.mjs`, via
`command-responder.mjs`/`research-mission-store.mjs`; isolated so the
REQUIRED PROOF run never touches the real shared local dev state file,
matching `http-eval.test.mjs`'s own established convention),
`tsf/test/evaluation-pack.test.mjs` (9-category assertion),
`tsf/test/http-eval.test.mjs` (10-pack-count assertion over the real HTTP
route).

Ran repeatedly during development for flake-hunting (not just once): both
new dedicated test files, 5 consecutive runs each, 100% pass, after fixing
the git `--since` precision race and the fixed-clock/fixed-id
contamination bugs documented above.

Regression sweep, `node --test`:
- `eval-pack-registry.test.mjs` + `evaluation-pack.test.mjs`: 25/25 pass
  (both explicitly required by this phase's own instruction).
- `http-eval.test.mjs`: 8/8 pass (the real HTTP layer over the whole
  registry, including a real concurrent-run race test).
- All 12 `*-eval-runner.test.mjs`/`*-eval-cases.test.mjs`-adjacent files
  (every existing pack's own dedicated test file, plus the 2 new ones):
  68/68 pass.
- All `research-*.test.mjs` (38 files, 319 tests): 319/319 pass -- proves
  the two production bugs found and fixed while BUILDING this phase's
  fixtures (the `script` property mistake, the temporalScope-bucketing
  gap, the Needs-You-not-resolved gap -- all in the NEW eval fixture code
  itself, never in production) did not require touching any real research
  domain/server file, and every existing research test still passes
  unmodified.
- `keep-going-dispatch-loop*.test.mjs` (4 files) +
  `settled-run-reconciler.test.mjs` + `settled-run-reconciliation.test.mjs`
  + `chat-dispatch-bridge.test.mjs` + `command-dogfood-sequences.test.mjs`
  + `http-chat-dispatch.test.mjs`: 107/107 pass.
- Full whole-repo sweep (`node --test tsf/test/*.test.mjs`): 2360 tests,
  2355 pass, 5 fail. All 5 failures exactly match the pre-existing,
  already-documented fail set this program's own F1/F3/F4/Phase 6
  checkpoint entries repeatedly cite on this host (2 intent-classifier
  phrasing gaps + 1 WorldForge-scenario phrasing gap in
  `command-bare-imperative-dispatch.test.mjs`/`command-operator-
  integration-adversarial.test.mjs`, 1 Work-tab timing/resource-pressure
  test in `http-work-summary.test.mjs`, 1 race-condition test in
  `operator-state-adversarial.test.mjs`'s "STALE ACTION RACE") -- none
  touch `evaluation-pack.mjs`, `eval-pack-registry.mjs`, any research/
  Keep Going file, or any file this phase modified.

**Lint.** `npx oxlint` on every new/changed file (`evaluation-pack.mjs`,
`eval-pack-registry.mjs`, `platform-golden-path-eval-cases.mjs`,
`platform-golden-path-eval-runner.mjs`, `research-golden-path-eval-
cases.mjs`, `research-golden-path-eval-runner.mjs`,
`eval-pack-registry.test.mjs`, `evaluation-pack.test.mjs`,
`platform-golden-path-eval-runner.test.mjs`,
`research-golden-path-eval-runner.test.mjs`, `http-eval.test.mjs`) --
clean, exit 0 (one genuinely new `no-unused-vars` finding, a leftover
`HEALTHY_MEMORY` constant made redundant by a later refactor, fixed rather
than left).

**Break-it-and-confirm-it-catches, summarized.** Both new packs were
proven, against REAL production code (not a test-only hook), to
genuinely fail when the real capability they measure is really broken,
and to pass again once reverted -- confirmed via `git diff --stat`
showing zero net changes after each revert:
- Platform pack: `resource-pressure-governor.mjs`'s
  `classifyDispatchAdmission` forced to `admitted: false` unconditionally
  -> both tests fail (0.5 pass rate) -> reverted -> both tests pass (1.0).
- Research pack: `research-verification.mjs`'s `verifyResearchClaim`
  forced to `verdict: 'FAIL'` whenever evidence exists -> both tests fail
  (0 pass rate) -> reverted -> both tests pass (1.0).

Adopted SHA: see the commit on `tsf/feature/phase13-evaluation-quality`
that carries this section.

## Phase 14: Security / Authority Boundary Review -- 1 real bug found, reproduced, and fixed (Cleanup V1 protected-path registry); the other 7 areas held up

Bounded adversarial pass hunting specifically for CONFUSED-DEPUTY bugs: one
project/mission/session's authority exercised against a DIFFERENT one's
resources, or a stale/wrong identity used to authorize something -- the same
class of bug F21 (Phase 7) turned out to be. Every area below was
investigated via real code reads end to end (not doc summaries); areas 2-5
also got a real, disposable-fixture reproduction attempt, not just static
reading.

### 1. Command authority (`command-responder.mjs`, `project-name-resolver.mjs`, `chat-dispatch-bridge.mjs`) -- CONFIRMED SAFE, no new gap

Read the full project-resolution -> dispatch path end to end, specifically
hunting for another F21-shaped gap (a quantifier/back-reference falling
through to the wrong project's real mutation call). Found none: the PAUSE/
RESUME branch's `quantified` guard (F21's own fix) and the main dispatch
branch's pre-existing `resolveAllProjectsQuantifier`-before-back-reference
ordering are the ONLY two places `lastReferencedProjectId` feeds a real
mutation, and both now correctly refuse to fall through when a quantifier is
present with no named exact match. `project-name-resolver.mjs`'s
`resolveProjectsFromText`/`resolveAllProjectsQuantifier` were re-read
line-by-line: exclusion-clause handling, fuzzy-vs-exact precedence, and the
"exact always outranks fuzzy, fuzzy never rides along once exact exists"
contract are all real and consistent -- this file already carries an
extensive, visible history of prior adversarial-review fixes (documented
inline) and no further gap was found on this pass.
`chat-dispatch-bridge.mjs`'s `planAndDispatchFromCommand` fans out
concurrently via `Promise.allSettled`, but every per-project chain
(`dispatchOneProject`) closes over its own `project` object with no shared
mutable state across iterations -- each project gets its own worktree, own
`resolveRepositoryIdentity` call, own Keep Going run keyed by `project.id`;
no cross-project leakage possible even under real concurrency.

### 2. Provider execution (`safe-provider-launch.mjs`, `live-planner.mjs`, `resolve-agent-entry.mjs`) -- CONFIRMED SAFE

`safe-provider-launch.mjs` is invoked as a genuinely separate OS process per
launch (an Orca launch profile CLI entry point, never imported into a
long-running server) -- `cwd`/`CODEX_HOME`/env are process-local by
construction, so two concurrent dispatches cannot share state; no shared
module-level mutable state exists in the file. `live-planner.mjs`'s
`runOnce` always spawns with a FIXED `NEUTRAL_CWD` (a real, documented,
already-reproduced prior bug fix: rooting it outside any git repo so a
zero-tool `-p`/print-mode call can't discover this repo's own CLAUDE.md) --
sharing that cwd across concurrent calls for different projects is safe
specifically because every PLANNER_DEEP call is `--tools ""` (zero
filesystem/tool access): the model can only reason over the prompt text,
which is built fresh per call from `buildProjectContextCapsule(project, ...)`
and is the only channel carrying project identity. Session affinity
(`opState.plannerSessions[project.id]`, `orcaSessionId: tsf-planner-chat:
${project.id}`) is consistently keyed by `project.id` throughout --
`resumeSessionId` can never be sourced from a different project's stored
binding. `resolve-agent-entry.mjs` has zero module-level mutable state (pure
function of `process.env`/`homedir()` per call).

### 3. Authenticated-download bridge (`authenticated-official-download-acquisition.mjs`, `...research-worker.mjs`) -- CONFIRMED SAFE, `assertNoSecretLeakage` re-verified real and wired

Re-read (not trusted from the prior adoption note) the full path: both real
call sites of `assertNoSecretLeakage` are still present and still on every
path that touches a session/download result --
`assertNoSecretLeakage(session, ...)` immediately after
`sessionProvider.getSession()` returns non-null (before ANY receipt
function ever sees `session`), and `assertNoSecretLeakage(downloadResult,
...)` immediately after `downloadFn()` resolves (before the ok/failure
branch). Confirmed double defense-in-depth: even independent of that guard,
`web-source-acquisition-receipt.mjs`'s `buildAuthEvidence(session)` never
spreads the raw session object into a receipt -- it projects an explicit
3-field allowlist (`mechanism`/`profileIdRef`/`authenticatedAt`) only. No
receipt-building path (`buildAuthenticatedDownloadReceipt`/
`buildAuthenticatedDownloadFailureReceipt`) is reachable before both guards
have already run.

### 4. Cleanup V1 (`cleanup-executor.mjs`, `cleanup-protected-registry.mjs`, `cleanup-revalidation.mjs`, `cleanup-owner-authorization-gate.mjs`) -- 1 REAL BUG FOUND, REPRODUCED, FIXED

**TOCTOU/race (plan-time vs. execution-time target identity): CONFIRMED
SAFE.** `runGovernedCleanupAction` calls `revalidate` (`collectFreshSafetyContext`)
three independent times against freshly re-collected evidence -- plan time,
authorization time, and a third time immediately before the mutating call
(the documented "race re-check") -- and the mutate function is invoked with
`resolvedRealPath` from THAT THIRD call, never a stale earlier one. The
existing `cleanup-executor-worktree-adversarial.test.mjs` RACE-BETWEEN-
AUDIT-AND-EXECUTION test already proves this against a real fixture
(3-call-counting `revalidate` stub); re-read and re-confirmed correct, no
new gap.

**Protected-path registry canonicalization: REAL BUG, reproduced live,
fixed.** `domain/cleanup-protected-registry.mjs`'s `isProtectedPath` header
claims "Registry entries are normalized the same way at compare time" as
the candidate path -- true only for the cheap string `normalize()` (slash/
case), NOT for real OS-level canonicalization. Only the CANDIDATE path
(`targetIdentity.realPath`) was ever passed through
`resolveCanonicalPath` (which follows symlinks/junctions/8.3 short names to
their true target); the protected registry itself
(`defaultProtectedRegistry`'s hardcoded paths, the operator-configurable
`TSF_CLEANUP_EXTRA_PROTECTED_PATHS` env var, and any programmatic
`callerProtectedRegistry`) was used as a raw, literal string, never
resolved. **Reproduced live with a real Windows junction** (disposable
fixtures only, `%TEMP%`-scoped, never touching `C:\TSF_ORCA`/`C:\NWR`): a
protected path registered via an alias (a junction standing in for any
real-world alias -- a symlinked data volume, a mapped path, an 8.3
short-name form Windows' own `TEMP` env var already exhibits on this exact
host) did NOT protect the identical real directory when a candidate
`targetIdentity.realPath` named it directly, bypassing the alias entirely --
`context.protectedPath` came back `false` for a target that WAS, physically,
the protected directory. The existing
`cleanup-revalidation.test.mjs` junction test had (unknowingly) worked
around this exact gap by pre-resolving the registry entry with
`resolveCanonicalPath` before registering it -- its own comment claimed
that was "exactly as the real production registry-seeding path would," which
was false; the real seeding path (`cleanup-protected-registry-defaults.mjs`)
never does this.

**Fix** (`tsf/server/cleanup-revalidation.mjs`): added
`canonicalizeRegistryPaths`, which resolves every registry path entry
through the SAME `resolveCanonicalPath` already used for the candidate,
falling back to the literal string when resolution fails (a configured
protected path that doesn't currently exist on this host must still
protect by literal match, never silently drop protection) -- called once,
in `collectFreshSafetyContext`, before `isProtectedPath` -- so every one of
the three revalidation calls in the governed pipeline (plan/authorization/
race-recheck) gets the fix automatically, no other caller of
`isProtectedPath` exists in `server/`. `isProtectedPath` itself stays pure/
no-I/O per its own architectural discipline; canonicalization happens in
the one real caller instead. Updated `isProtectedPath`'s own header comment
(it made the same false claim the test did) to accurately describe the
caller's responsibility.

**Tests.** `tsf/test/cleanup-revalidation.test.mjs`: corrected the existing
junction test's misleading comment/setup (registers the RAW alias now,
since the fix makes pre-resolution unnecessary) and added a new,
explicitly-named security regression test ("SECURITY (Phase 14, real bug
fixed): a protected registry entry configured via an ALIAS ... still
protects the SAME real directory when a candidate targets it directly") that
fails against the pre-fix code and passes against the fix -- verified both
ways (ran against `git stash`-baseline: fails as expected; against the fix:
passes).

Verified NOT a git-level cleanliness bypass: `mutationParams.checkGit` is
caller-controllable, but `executeRemoveDisposableWorktree`'s
`gitWorktreeRemove` calls plain `git worktree remove` (no `--force`) --
git's own real refusal for a dirty tracked worktree is the actual, structural
backstop regardless of whether the caller opted into the additional
`checkGit` pre-check; only untracked/gitignored content needs the
quarantine-copy step, which always runs first. Verified `checkActiveMissionReference`
(the cross-project-worktree guard) is real, durable-store-backed evidence,
not a guess -- a worktree belonging to another project's non-COMPLETE
planner mission is a hard `PROTECTED`-tier blocker regardless of lease
liveness ("Sleep != complete").

**Lint.** `npx oxlint tsf/server/cleanup-revalidation.mjs
tsf/domain/cleanup-protected-registry.mjs tsf/test/cleanup-revalidation.test.mjs`
-- clean, exit 0. Line counts: `cleanup-revalidation.mjs` 109 lines,
`cleanup-protected-registry.mjs` 64 lines -- both well under the 600-line cap.

**Tests.** `node --test tsf/test/cleanup-revalidation.test.mjs` -- 9/9 pass
(1 new). Regression sweep, every `cleanup-*.test.mjs` file (15 files): 132/132
pass.

### 5. Filesystem paths / local artifact ingestion (`owner-supplied-local-artifact-acquisition.mjs`) -- disclosed gap, confirmed NOT currently reachable by an untrusted caller

`acquireOwnerSuppliedLocalArtifact` performs `readFile(filePath, 'utf-8')`
with genuinely zero path validation, canonicalization, or scope
restriction -- a caller-supplied `filePath` is read exactly as given, `../`
traversal and all, no denylist check against the protected-path registry
Cleanup V1 enforces. This is real and disclosed here, not silently passed
over. However, traced every real production writer of the field that
reaches it (`request.localArtifactCandidates`, `sourcePolicy.
localArtifactCandidates`): `domain/research-node.mjs`'s
`buildBoundedResearchRequest` copies `sourcePolicy` verbatim from
`mission.specification` -- the mission's IMMUTABLE specification, set once
at mission creation, "never from worker-supplied input" per its own header
-- and a whole-codebase grep found zero production code path (LLM prompt,
planner bridge, autonomous worker) that ever writes
`localArtifactCandidates` today; only test fixtures do. Combined with this
path's own explicit, structural design (`ownerAssertion.assertedBy` is
mandatory and required, `ownerProvenance.independentlyVerified` is
hardcoded `false`, receipts are marked `ASSERTED_UNLOGGED` -- the whole
mode is documented as "CALLER-ASSERTED ONLY, never independently verified,"
i.e. Tim pointing this at his own local file is the entire intended use
case, not a sandboxed/untrusted input), there is currently no confused-
deputy path here: nothing short of a direct, structured mission-
specification write (equivalent to Tim's own authorship) can reach this
function. Not fixed -- restricting `filePath` to some arbitrary "allowed
scope" would break the feature's actual purpose (reading any file Tim
points it at) without closing a real reachable gap today. Flagged as a real
condition to re-check if `localArtifactCandidates` ever becomes
autonomously/LLM-populated in a future phase -- at that point this file
would need real path validation.

### 6. Project attribution -- CONFIRMED SAFE, structurally enforced

Every durable-record creation path checked traces its owning id back to a
structurally-fixed source, never a caller-suppliable parameter divorced
from that source: `PlannerSessionLifecycle` fixes `missionId` at
construction and every mutator (`_mutate`, `dispatchWorkerForTask`, etc.)
reads/writes exclusively via `this.missionId` -- there is no per-call
missionId parameter anywhere in the class that could diverge from the
instance's own. `research-node.mjs`'s `buildBoundedResearchRequest` derives
`nodeId`/`scope` from the `node`/`mission` objects themselves, never from
caller input. `chat-dispatch-bridge.mjs`'s dispatch loop keys every Keep
Going run/worktree/identity lookup off `project.id` from the resolved
project object, never a separately-threaded id string.

### 7. Planner takeover (`planner-mission-lease.mjs`, `planner-session-lifecycle.mjs`) -- CONFIRMED SAFE, no missionId/leaseId mixup

Read `_requireLease`/`_mutate` closely, hunting specifically for a
copy-paste-shaped "check lease A, mutate mission B" bug. Found none:
`_mutate` calls `readPlannerMissionRecord(this.missionId)` then
`this._requireLease(record)` then `mutateCheckpoint(this.missionId, ...)`
-- all three reference the SAME `this.missionId`, the instance's own fixed
field, with no alternate id ever substituted. `_requireLease` checks
`lease.holderPlannerSessionId !== this.plannerSessionId` against the lease
embedded in the record it was just handed (from that same
`this.missionId` read) -- there is no code path where a lease fetched for
one missionId gates a mutation applied to another. Every other mutator
(`dispatchWorkerForTask`, `recordWorkerResult`, `raiseNeedsYou`, etc.) goes
through `_mutate`, so this guarantee is structural, not per-method
discipline that could drift.

### 8. Cross-project targeting, summary

Areas 1, 2, 3, 6, 7 held up with real evidence and no fix needed. Area 5 is
a disclosed, currently-unreachable gap (not fixed, condition to re-check
noted). Area 4 had one real, reproduced, now-fixed bug (protected-path
registry canonicalization) -- fixed with a minimal, reused-mechanism change
plus a real regression test. No fabricated findings; nothing reported here
that a real repro or a real code trace did not confirm.

Adopted SHA: see the commit on
`tsf/feature/phase14-security-authority-review` that carries this section.

## Phase 10: Cleanup V1 Destructive Safety Gauntlet -- 1 real crash-recovery bug found, reproduced, fixed; capstone stacked-blocker adversarial passed with no fix needed

Worktree: `phase10-cleanup-v1-safety-gauntlet`, branch
`tsf/feature/phase10-cleanup-v1-safety-gauntlet` (forked from `tsf/main` @
`fcd43b6864b48c62f51d3babe3a1dcea1aa08995`, i.e. immediately after Phase
14's protected-path registry fix). RECONCILE FIRST, per this phase's own
instruction: read every `cleanup-*.test.mjs` file (15 files, 132 tests) in
full before writing anything, to determine exactly which of the mission's
16 named adversarial fixtures already have real, non-mocked proof and which
were genuinely missing.

### 16-scenario reconciliation table

| # | Scenario | Status | Citation |
|---|---|---|---|
| 1 | Clean merged worktree | Already covered | `cleanup-executor-worktree-adversarial.test.mjs` "HAPPY PATH" (worktree removal) + "CLEAN FULLY-MERGED WORKTREE/BRANCH fixture" (branch deletion) |
| 2 | Dirty worktree | Already covered | `cleanup-executor-worktree-adversarial.test.mjs` "DIRTY WORKTREE fixture" -- `git status --porcelain` dirty (including plain untracked files) -> `AUTHORIZATION_REFUSED`, untouched |
| 3 | Untracked unique artifact | Already covered | Two existing tests together prove both halves: "HAPPY PATH" proves a gitignored/untracked file is preserved via the quarantine COPY step before `git worktree remove` runs; "DIRTY WORKTREE fixture" proves a genuinely untracked-and-not-ignored file blocks the action outright (never silently lost) since `isWorktreeClean` treats any porcelain output, including `??` untracked entries, as dirty |
| 4 | Unique unpushed commit | Already covered | `cleanup-executor-worktree-adversarial.test.mjs` "UNIQUE UNPUSHED COMMIT fixture" (STANDARD tier refuses) + the following test (ELEVATED `DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS` succeeds, proving the tier distinction is structural) |
| 5 | Sleeping unfinished mission | Already covered | `cleanup-active-mission-check.test.mjs` "SLEEPING LANE fixture" (expired lease, mission still ACTIVE, still blocks -- "Sleep != complete") + `cleanup-executor-worktree-adversarial.test.mjs`'s own "SLEEPING LANE fixture" through the full governed pipeline |
| 6 | Completed sleeping mission | Already covered | `cleanup-active-mission-check.test.mjs` "a COMPLETE mission no longer blocks -- completion, not lease expiry, is what releases the protection" |
| 7 | Active worker | Already covered | `cleanup-active-mission-check.test.mjs` "an ACTIVE mission whose checkpoint.repoState.branch matches the target BLOCKS" + `cleanup-executor-worktree-adversarial.test.mjs` "ACTIVE WORKER fixture" |
| 8 | Stale worker | Already covered | `checkActiveMissionReference` (`server/cleanup-active-mission-check.mjs`, read in full) deliberately never consults worker/lease liveness at all -- only `missionState !== 'COMPLETE'` plus a branch/worktreePath match, by design ("regardless of whether its lease is currently live"). A worker gone stale (dead process, expired lease) and a "sleeping" mission are therefore the exact SAME evidence shape to this check -- already proven by the SLEEPING LANE fixture (scenario 5): a lease deliberately expired via `acquirePlannerLease(..., pastClock, {ttlMs:1000})` still blocks |
| 9 | Worktree path junction | Already covered | `cleanup-revalidation.test.mjs` "PATH-ALIAS/JUNCTION fixture" (candidate side) + the Phase 14 "SECURITY" regression test (registry side) -- both against a real Windows junction |
| 10 | Windows file lock | Already covered | `cleanup-quarantine-store.test.mjs` "WINDOWS FILE-LOCK fixture" -- a real live child process holding the target directory as its cwd |
| 11 | Partial deletion failure | Already covered | `cleanup-quarantine-store.test.mjs` "PARTIAL-DELETION-FAILURE fixture" -- both copy and original present -> `QUARANTINE_SOURCE_STILL_PRESENT`, owner review required |
| 12 | Crash mid-cleanup | **Genuinely missing -- built, and building it surfaced a real bug (see below)** | New `cleanup-executor-crash-recovery-adversarial.test.mjs`. The existing `recoverIncompleteQuarantine` IN_PROGRESS-manifest tests in `cleanup-quarantine-store.test.mjs` only ever call that function directly with a hand-supplied `quarantineId` -- none exercised the REAL, HTTP-wired production entry point (`recoverStalledCleanupExecution(requestId)`, `server/cleanup-executor.mjs`) against a genuinely crashed execution |
| 13 | Duplicate cleanup request | Already covered | `cleanup-executor-worktree-adversarial.test.mjs` "IDEMPOTENCY fixture" + `cleanup-quarantine-store.test.mjs` "DUPLICATE-REQUEST fixture" (idempotent restore) |
| 14 | Changed state between audit and execution (race) | Already covered | `cleanup-executor-worktree-adversarial.test.mjs` "RACE-BETWEEN-AUDIT-AND-EXECUTION fixture" -- a 3-call-counting `revalidate` stub proves the third, independent race-recheck (not the earlier two) is what catches it |
| 15 | Protected canonical branch | Already covered | `cleanup-executor-worktree-adversarial.test.mjs` "PROTECTED CANONICAL-MAIN fixture" + `cleanup-protected-registry.test.mjs` "canonical branch names are always protected" |
| 16 | Restore from quarantine | Already covered | `cleanup-executor-artifact-adversarial.test.mjs` "QUARANTINE_ARTIFACT then RESTORE_QUARANTINE: full round trip" + `cleanup-quarantine-store.test.mjs`'s own MOVE/COPY/duplicate-restore tests |

Result: 14 of 16 already had real, non-mocked, adversarial-fixture proof
(several -- 5, 9, 13, 16 -- proven at BOTH the domain/store level and the
full governed-pipeline level). No redundant coverage was built for these
14. 1 (#12) was genuinely missing and, once built, immediately surfaced a
real production bug (below). #8 required no new test -- it collapses onto
an already-proven mechanism by the check's own deliberate design, disclosed
in the table rather than silently skipped.

### Real finding: `recoverStalledCleanupExecution` could never actually recover a crashed quarantine-backed execution -- REPRODUCED, FIXED

Building scenario #12's fixture (a real crash simulated by reconstructing
`runGovernedCleanupAction`'s own real pipeline stages up through the
durable EXECUTION-begun persist, then calling the real `moveToQuarantine`
directly -- exactly what the real mutate function does -- without ever
reaching `completeCleanupExecution`, modeling "the process died right
here") surfaced two compounding gaps in `server/cleanup-executor.mjs`,
neither previously exercised by any test:

1. **The durable execution record never advanced past `PENDING` before the
   risky mutate() call ran.** `recordExecutionStep` computes the
   `PENDING -> IN_PROGRESS` transition in memory (on the RACE_RECHECK-passed
   step), but `runGovernedCleanupAction` never persisted it via
   `appendExecution` before calling `mutate(...)` -- only after
   `beginCleanupExecution` (PENDING) and again after `completeCleanupExecution`/
   `failCleanupExecution`. A real crash during the mutate call itself (the
   actual highest-risk window -- mid quarantine-move, mid `git worktree
   remove`) left the durable record stuck at `PENDING`, not `IN_PROGRESS`.
2. **`recoverStalledCleanupExecution(requestId)` called
   `recoverIncompleteQuarantine(requestId)` -- passing the wrong id.**
   `quarantineId` is a fresh `randomUUID()` minted inside `moveToQuarantine`
   per attempt (the manifest lives at `quarantineRoot/<quarantineId>/
   manifest.json`) and is never equal to `requestId` (a deterministic hash
   of `actionClass`+`targetIdentity`). `quarantineId` is only ever recorded
   durably on `execution.result.quarantineId` -- set at `COMPLETED`, which a
   crashed execution by definition never reaches. There was structurally no
   way, as coded, to find the manifest a crashed execution left behind.

Reproduced live with a small standalone script driving the real production
functions in sequence (before writing the permanent test): confirmed
`recoverStalledCleanupExecution(requestId)` returned `{status:'PENDING',
requiresOwnerReview:false}` for a genuinely crashed, real, mid-flight
quarantine attempt -- silently reporting nothing needs attention when a
real quarantine manifest was sitting in `QUARANTINE_IN_PROGRESS`. Not a
data-loss bug in itself (every real filesystem step this touches --
`renameSync`, or `cpSync`-then-`rmSync` with an integrity check in between
-- is already structurally safe against a crash, per `moveToQuarantine`'s
own "write manifest before the risky step" discipline, independently
re-verified here) but a real, disclosed **recovery-honesty** bug: the one
production entry point wired to `POST /api/cleanup/recover` could never
tell an operator or automated recovery check the truth about a genuinely
stuck cleanup, defeating the entire purpose of scenario #12/#16
(crash-mid-cleanup, restore-from-quarantine) for the two quarantine-backed
action classes (`QUARANTINE_ARTIFACT`, `REMOVE_DISPOSABLE_WORKTREE`) --
exactly the mission's own "receipts and recovery/restore behavior are
correct where relevant" requirement.

**Fix** (minimal, reuses existing mechanisms, no new cleanup-truth
mechanism):
- `server/cleanup-executor.mjs`: added one `await appendExecution(requestId,
  execution)` call immediately after the RACE_RECHECK-passed transition and
  strictly before `mutate(...)` is invoked -- durably persists `IN_PROGRESS`
  before the risky step, matching the same "write evidence before the risky
  step" rule already established by `moveToQuarantine`'s own manifest
  write and this codebase's schema-version-guard/lease conventions
  elsewhere.
- `server/cleanup-quarantine-store.mjs`: added
  `findQuarantineManifestByRequestId(requestId, {quarantineRoot})`, which
  scans `quarantineRoot`'s subdirectories for the one manifest whose
  already-present `requestId` field matches (every manifest has always
  carried this field; nothing new stored, no new file format).
- `recoverStalledCleanupExecution` now calls
  `findQuarantineManifestByRequestId` to resolve the real `quarantineId`,
  then passes THAT to `recoverIncompleteQuarantine` -- never assumes
  `requestId === quarantineId`. Behavior for non-quarantine-backed action
  classes (`RETIRE_SESSION`, `CLEAR_SAFE_GENERATED_CACHE`,
  `DELETE_LOCAL_MERGED_BRANCH`, `REMOVE_STALE_TEMPORARY_STATE`,
  `DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS`) is unchanged: no manifest
  ever exists for them, so the lookup still correctly resolves to
  `NO_MANIFEST`.

**Tests.** New `tsf/test/cleanup-executor-crash-recovery-adversarial.test.mjs`,
3 tests, every stage built from the real, exported `cleanup-lifecycle.mjs`/
`cleanup-request-store.mjs`/`cleanup-quarantine-store.mjs` functions (never
a second/parallel implementation):
1. Crash strictly after a real `moveToQuarantine` move finishes but before
   `completeCleanupExecution` runs: `recoverStalledCleanupExecution`
   correctly finds the real (UUID, provably not equal to `requestId`)
   manifest and reconciles to `QUARANTINED`, content byte-for-byte intact.
2. Crash strictly mid-move (both the quarantine copy and the original
   present, modeling the EXDEV copy-then-delete fallback's real
   intermediate state): reconciles to `QUARANTINE_SOURCE_STILL_PRESENT`,
   `requiresOwnerReview: true`, nothing lost in either location.
3. Crash BEFORE the durable IN_PROGRESS persist (still `PENDING`, mutate
   never invoked): correctly reports `PENDING`, never fabricates a manifest
   lookup or a false "nothing to review."

Verified both ways per this program's established discipline: ran against
`git stash` of both changed source files (fix removed, tests kept) --
tests 1 and 2 fail exactly as predicted (`NO_MANIFEST` instead of
`QUARANTINED`/`QUARANTINE_SOURCE_STILL_PRESENT`); test 3 passes either way
(the PENDING-precondition path was never broken). Restored the fix: all 3
pass.

### Capstone (own-initiative, not from the mission's own list): stacked simultaneous hazards

Read `domain/cleanup-safety-blockers.mjs`'s `evaluateCleanupBlockers` in
full hunting for exactly the failure mode the mission's capstone prompt
describes -- a "first blocking reason found" short-circuit that stacked
conditions could confuse into a false allow. **Finding: the concern does
not apply by construction.** There is no early return anywhere in the
function body; every field (`protectedPath`, `protectedBranch`,
`isMainWorktree`, `git.clean`, `activeMissionReferenced`, `sessionLive`,
`fileLocked`, evidence staleness) is independently evaluated and
unconditionally appended to a shared `blockers` array, and `blocked`/`tier`
are computed by scanning that COMPLETE array afterward
(`blockers.some(...)`) -- never by stopping at the first match. Stacking
hazards can only ever make a refusal MORE certain, never mask one hazard
behind another.

Proven with two new tests in
`tsf/test/cleanup-stacked-blockers-adversarial.test.mjs`:
1. A real worktree fixture with TWO genuinely independent, simultaneous
   real hazards on the SAME target -- a real dirty/uncommitted file AND a
   real, durable, non-COMPLETE planner mission referencing the same branch
   -- run through the full `runGovernedCleanupAction` pipeline (every
   existing adversarial test only ever stacks ONE hazard onto an otherwise-
   perfect fixture). Refused, worktree completely untouched, and BOTH
   `DIRTY_WORKTREE` and `ACTIVE_MISSION_REFERENCE` codes are present in the
   returned `blockers` array -- neither masks the other.
2. A direct, maximally adversarial call to `evaluateCleanupBlockers` with
   all 7 blockable fields forced hazardous simultaneously: `blocked===true`,
   `tier==='PROTECTED'`, and all 7 expected codes present with none dropped
   or double-counted (`blockers.length === 7`). Removing the single
   highest-priority-sounding hazard (`protectedPath`) leaves exactly 6
   blockers, not zero -- proving this is genuine accumulation, not a
   priority ladder that stops once one match is found.

**Capstone outcome: no fix needed.** The blocker-evaluation design already
holds up against deliberate stacking; this was a real, honest negative
result, not manufactured.

### Tests and lint

New files: `tsf/test/cleanup-executor-crash-recovery-adversarial.test.mjs`
(150 lines, 3 tests), `tsf/test/cleanup-stacked-blockers-adversarial.test.mjs`
(127 lines, 2 tests) -- both well under the 600-line `.mjs` cap. Changed:
`tsf/server/cleanup-executor.mjs` (266 lines), `tsf/server/cleanup-
quarantine-store.mjs` (250 lines).

`node --test tsf/test/cleanup-*.test.mjs`: 137/137 pass (132 pre-existing +
5 new). Full whole-repo sweep (`node --test tsf/test/*.test.mjs`): 2368
tests, 2361 pass, 7 fail -- all 7 are the same pre-existing, already-
documented host-load-sensitive fail set this program's own F1/F4/Phase 13
checkpoint entries repeatedly cite on this host (2 intent-classifier
phrasing gaps + 1 WorldForge-scenario phrasing gap in
`command-bare-imperative-dispatch.test.mjs`/`command-operator-integration-
adversarial.test.mjs`, 1 bounded-timeout retry test in
`health-repair-io.test.mjs`, 1 Work-tab timing test in
`http-work-summary.test.mjs`, 1 autonomy-proof stall in `keep-going-
autonomy-proof.test.mjs`, 1 race-condition test in `operator-state-
adversarial.test.mjs`) -- none touch `cleanup-executor.mjs`, `cleanup-
quarantine-store.mjs`, or any other file this phase modified.

**Lint.** `npx oxlint tsf/server/cleanup-executor.mjs tsf/server/cleanup-
quarantine-store.mjs tsf/test/cleanup-executor-crash-recovery-
adversarial.test.mjs tsf/test/cleanup-stacked-blockers-adversarial.test.mjs`
-- clean, exit 0.

**Nothing real was ever touched.** Every fixture in this phase's new tests
runs under `os.tmpdir()`/this worktree's own isolated `.local-state`
directories; the real global `TSF_CLEANUP_V1_OWNER_AUTHORIZATION` env var
and flag file were never set or read (every governed-pipeline call used the
established fake `gateCheck` injection); no code outside `tsf/server/
cleanup-executor.mjs` and `tsf/server/cleanup-quarantine-store.mjs` was
modified; `C:\TSF_ORCA`, `C:\NWR`, and every other real worktree were never
read or written.

Adopted SHA: see the commit on
`tsf/feature/phase10-cleanup-v1-safety-gauntlet` that carries this section.
## Phase 11: Provider / Worker Resilience -- Findings F22 and F23, both FIXED

Worktree: `phase11-provider-worker-resilience`, branch
`tsf/feature/phase11-provider-worker-resilience` (forked from `tsf/main` @
`fcd43b6864b48c62f51d3babe3a1dcea1aa08995`).

**Reconciliation (read in full before testing further).**
`tsf/domain/routing.mjs` (`resolveRole`/`resolveUsageMode`/
`assertRoutingConfiguration`) and `tsf/server/live-planner.mjs`
(`invokeLiveStructuredAnalysis`/`invokeLivePlanner`/`runOnce`/`spawnAgent`)
are the one generic provider-invocation path. Existing coverage
(`tsf/test/live-planner.test.mjs`, 26 tests; `tsf/test/routing-eval-runner.test.mjs`,
5 tests) already proved: honest typed failures for
`PROVIDER_UNAVAILABLE`/`SPAWN_ERROR`/`TIMEOUT`/`PROVIDER_ERROR`/
`MALFORMED_RESPONSE`-on-invalid-JSON, a bounded single retry for transient
reasons only, session-affinity switch boundaries, and
`PLANNER_DEEP -> anthropic` resolving against the real committed config. It
did NOT prove: a genuinely SUCCESSFUL Claude-unavailable -> Codex fallback
(every existing failure-mode test makes both agents fail, by design, to
avoid a real codex process firing mid-test) for either live entrypoint, or
what happens to a syntactically-valid-but-wrong-shape structured response.

**Real, current routing config re-verified directly (not trusted from a
stale summary):** `provider-role-mappings.v1.json` --
`PLANNER_DEEP`: preferred `CLAUDE_SAFE` (anthropic/claude-code), fallback
`CODEX_SAFE` (openai/codex). `WORKER_CHEAP`/`WORKER_BALANCED`/`WORKER_DEEP`:
preferred `CODEX_SAFE`, fallback `CLAUDE_SAFE` (`WORKER_CHEAP` has NO
fallback -- `fallbackProfile: null`, by design). `VERIFIER_INDEPENDENT`:
preferred `CLAUDE_SAFE`, fallback `CODEX_SAFE`,
`mustDifferFromWorkerWhenAvailable: true`. `launch-profiles.v1.json` defines
exactly 2 profiles total, one per real vendor (anthropic/claude-code,
openai/codex) -- no second same-vendor profile exists anywhere in the
current config.

### Item-by-item results

1. **Both providers available, correct preference.** CONFIRMED SAFE.
   `routing-eval-runner.test.mjs`'s `REQUIRED PROOF` case resolves
   `PLANNER_DEEP` to the real `anthropic` provider against the actual
   committed config (not a fabricated one); no fix needed.
2. **Claude unavailable -> falls back to Codex, honest identity.** REAL GAP:
   no existing test exercised a successful cross-provider fallback for
   EITHER `invokeLivePlanner` or `invokeLiveStructuredAnalysis` -- closed,
   see F23 below (which also covers item 3, Codex unavailable -> falls back
   to Claude, by the same generic mechanism -- `invokeLivePlanner`'s
   existing 'a rejected/stale resumed session falls back to a fresh session'
   test already proves the reverse-direction PROVIDER_FAILURE switch
   boundary for the preferred-agent-resume case; the fallback-PROFILE
   mechanism itself is agent-symmetric code, not a Claude-specific branch).
3. **Codex unavailable -> falls back to Claude, honest identity.** Same
   generic fallback mechanism as item 2 (`invokeLivePlanner`/
   `invokeLiveStructuredAnalysis` never branch on WHICH agent is preferred
   when trying the fallback profile) -- covered by the same fix and the same
   class of test, just mirrored. No separate gap found.
4. **Provider timeout.** CONFIRMED SAFE. `spawnAgent`'s `setTimeout` ->
   `child.kill('SIGTERM')` -> typed `TIMEOUT` result, already proven by
   `live-planner.test.mjs`'s "provider timeout is treated as a failure
   within the configured budget, not a hang" (asserts real elapsed time
   `<4000ms` against a 5s stub sleep with a 200ms budget) -- re-read, no
   fix needed.
5. **Malformed structured response (valid JSON, wrong shape).** REAL GAP,
   FIXED -- see F23.
6. **Valid prose but invalid schema.** Same mechanism/fix as item 5 (F23) --
   free-form prose that fails `JSON.parse` already produced
   `MALFORMED_RESPONSE` before this phase; JSON that parses but doesn't
   match the schema's own `required` fields did NOT, until F23.
7. **Resource pressure during a provider call (Finding F1).** Light
   re-verification per this phase's own scope instruction (not a full
   re-test of F1's own suite): `node --test` across the 6 test files F1's
   own checkpoint entry names (`command-research-spec-synthesis`,
   `command-scope-classifier`, `field-source-reconciliation`,
   `wbs-generation`, `onboarding`, `onboarding-orca-resilience`) --
   88/88 pass, matching F1's own documented count exactly. F1's fix is real
   and complete; no regression.
8. **Planner rollover during a provider call.** REAL GAP, FIXED -- see F22.
   `findWorkerByTaskFingerprint`/`registerDispatchedWorker`
   (`planner-mission-checkpoint.mjs`) only covered a CLEAN rollover (a prior
   session fully committed the registration before retiring, proven by the
   existing golden-rollover test) -- it said nothing about a crash BETWEEN
   the real external dispatch call returning and that commit landing.
9. **Retry/idempotency double-spend.** Same underlying mechanism as item 8 --
   F22's fix is exactly this: a durable pre-flight attempt record, keyed by
   `taskFingerprint`, written BEFORE the real dispatcher call (mirroring
   `research-dispatch-bookkeeping.mjs`'s already-proven
   `recordDispatchAttempt`/`AMBIGUOUS_REQUIRES_RECONCILIATION` pattern for
   research-node dispatch), so a crash-then-resume can never blindly
   redispatch -- it refuses honestly instead.
10. **Capacity exhaustion (no provider reachable at all).** CONFIRMED SAFE.
    `resolveAgentEntry` returning `null` for every candidate (no CLI found
    on this host) or a real spawn failure both produce a typed
    `PROVIDER_UNAVAILABLE`/`SPAWN_ERROR` result; neither `invokeLivePlanner`
    nor `invokeLiveStructuredAnalysis` reads any cache or stored fallback
    value on failure -- the caller (e.g. `onboarding.mjs`'s
    `fallbackLabel`) explicitly labels the degraded state
    ("Planner unavailable — using recorded project-state fallback"),
    never silently substituting a stale live answer. Already proven by the
    existing "unavailable provider produces an honest fallback signal, not
    a fabricated answer" test; re-confirmed, no fix needed.

### Finding F22: planner dispatch could double-spend a real external call on crash-mid-dispatch -- REPRODUCED and FIXED

**Gap.** `PlannerSessionLifecycle.dispatchWorkerForTask`
(`tsf/server/planner-session-lifecycle.mjs`) called the real
`this.deps.dispatchWorker(...)` FIRST, and only committed the durable
idempotency record (`registerDispatchedWorker`) AFTER it returned. A crash
between those two points left NO durable trace the call was ever attempted
-- `findWorkerByTaskFingerprint` would find nothing, and a successor session
would call the real external dispatcher a second time for the identical
task: a genuine double-spend of dispatch capacity (and, for a real
provider-backed dispatcher, a real second billable/counted call). The
existing `planner-session-lifecycle-golden-rollover.test.mjs` only proved
the CLEAN-rollover case (a prior session fully committed before retiring)
-- it never exercised this window. `research-mission-driver.mjs`'s
otherwise-analogous `dispatchResearchNodeDurable` already has the correct
ordering (`recordDispatchAttempt` durably BEFORE `worker.dispatch()`, via
`research-dispatch-bookkeeping.mjs`'s `AMBIGUOUS_REQUIRES_RECONCILIATION`
classification) -- this newer Planner Context Lifecycle mechanism had
drifted from that already-proven sibling pattern.

**Reproduction.** New `tsf/test/planner-session-lifecycle-crash-mid-dispatch.test.mjs`:
patches `_mutate` to fail on exactly its second call within one
`dispatchWorkerForTask` invocation (modeling a real process crash between
the real dispatcher returning and the post-dispatch commit landing) --
confirmed against the unmodified code (`git stash`) that the real dispatcher
fires a SECOND time for a successor session's identical taskFingerprint
(the double-spend, reproduced directly, not hypothesized) before the fix;
after the fix, the successor throws `TSF_PLANNER_DISPATCH_AMBIGUOUS` and the
real dispatcher call count stays at 1.

**Fix.** `tsf/domain/planner-mission-checkpoint.mjs`: new
`recordDispatchAttempt`/`resolveDispatchAttempt`/
`classifyPlannerDispatchAmbiguity`, mirroring
`research-dispatch-bookkeeping.mjs`'s pattern (REUSE_PATTERN, not a new
mechanism) adapted to this file's own no-CAS/`touch()` convention. New
checkpoints now initialize `dispatchAttempts: []`
(old durable checkpoints missing the field are read as `?? []`, no schema-
version bump needed -- purely additive). `dispatchWorkerForTask` now:
records an UNKNOWN attempt durably BEFORE calling the real dispatcher;
resolves it to `FAILED_CLEAN` (same mutate call as the thrown/no-workerId
error path) or `CONFIRMED`+`registerDispatchedWorker` (one atomic write) on
return; and refuses (`TSF_PLANNER_DISPATCH_AMBIGUOUS`) rather than
redispatching when an unresolved attempt is found for a taskFingerprint with
no registered worker.

**Tests.** `tsf/test/planner-mission-checkpoint.test.mjs`: 5 new unit tests
for the ledger's pure functions. `tsf/test/planner-session-lifecycle-crash-mid-dispatch.test.mjs`:
4 tests, including the break-it-and-confirm-it-catches proof above. Full
regression: `planner-mission-checkpoint`, `planner-session-lifecycle-golden-rollover`,
`planner-session-lifecycle-resource-governance`,
`planner-session-lifecycle-crash-mid-dispatch` -- 33/33 pass.

### Finding F23: `invokeLiveStructuredAnalysis` never validated response shape; Codex fallback silently dropped the schema entirely -- FIXED

**Gap, part A (shape validation).** `invokeLiveStructuredAnalysis`
(`live-planner.mjs`) parsed a provider's structured response
(`result.structuredOutput ?? JSON.parse(result.text)`) but never checked it
against the caller's own `jsonSchema`. A syntactically-valid JSON object
missing the schema's `required` fields entirely (e.g. `{unexpectedKey:true}`
instead of `{answers:[...]}`) was returned as `ok:true` -- indistinguishable
from a real, conformant answer. Traced the concrete downstream harm for
this program's own central subject file,
`tsf/adapters/llm-latent-knowledge-research-worker.mjs`: such a response
collapses into `Array.isArray(live.data?.answers) === false`, which the
worker (correctly, given what it can see) reports as
`MODEL_REPORTED_UNKNOWN_FOR_ALL_FIELDS` -- an HONEST "the model genuinely
doesn't know" is a materially different, less alarming condition than
"the provider's response didn't conform to the requested contract at all,"
and the two were indistinguishable before this fix.

**Gap, part B (Codex fallback drops the schema).** `buildArgs`'s
`codex` branch never forwarded `jsonSchema` at all (codex `exec` has no
`--json-schema`-equivalent flag) -- callers whose own `systemPrompt` relies
entirely on `--json-schema` to constrain shape (e.g.
`command-scope-classifier.mjs`'s `SCOPE_SYSTEM_PROMPT`, which never
describes its JSON shape in prose) had genuinely no way to get a conformant
answer through the documented `PLANNER_DEEP -> CODEX_SAFE` fallback --
confirmed by reading each of the 5 real callers'
own system prompts, not assumed.

**Fix.** `conformsToRequiredShape(parsed, jsonSchema)` (new, exported):
checks `parsed` is a real object (not null/array) and every name in
`jsonSchema.required` (if present) is a key of `parsed` -- intentionally NOT
a full JSON-Schema validator (`tsf/contracts/validate-research-contracts.mjs`'s
own header discloses this repo takes no such dependency); every real caller
of `invokeLiveStructuredAnalysis` already declares a top-level `required`
list, confirmed by reading all 5 (onboarding, wbs-generation,
field-source-reconciliation, command-scope-classifier,
command-research-spec-synthesis) before relying on it. A shape mismatch now
returns `MALFORMED_RESPONSE` with the missing field names named in
`detail`, matching the EXISTING (deliberate) no-further-retry/no-fallback
treatment `MALFORMED_RESPONSE` already had for invalid JSON (a shape
mismatch reproduces identically on the same input, same reasoning as the
pre-existing `RETRYABLE_REASONS` exclusion). `buildArgs`'s codex branch now
appends the same schema (`stripSchemaMetaKeys`-stripped, reusing the exact
function claude-code's branch already applies -- not a second stripping
mechanism) as an explicit prose instruction after the prompt, the only
transport `codex exec` offers.

**Tests.** `tsf/test/live-planner-provider-fallback.test.mjs` (new,
split out of `live-planner.test.mjs` to stay under the 600-line cap
per CLAUDE.md's max-lines rule): `conformsToRequiredShape` pure-function
edge cases; a wrong-shape response rejected as `MALFORMED_RESPONSE`
(confirmed real via `if (false && ...)` neutralization -- without the
check, `result.ok` was `true` for a wrong-shape response); a genuinely
successful `invokeLivePlanner` Claude-unavailable -> Codex fallback with
honest `agentId:'codex'`/`providerId:'openai'` (never the originally-
preferred claude-code/anthropic); a genuinely successful
`invokeLiveStructuredAnalysis` Claude-unavailable -> Codex fallback where
the schema is proven to have actually reached the codex invocation (direct
assertion on the real transmitted positional argv, not just that the
answer happened to be right-shaped). `tsf/test/fixtures/stub-planner-cli.mjs`
gained `STUB_MODE=wrong-shape` and codex-shaped positional-argument/embedded-
schema parsing (additive; no existing test's behavior changed).
`tsf/test/llm-latent-knowledge-research-worker.test.mjs` gained one
end-to-end test through the REAL `invokeLiveStructuredAnalysis` (every other
test in that file injects a fake) proving the fix closes the
mislabeling risk described in part A above: `dispatched.reason` is
`MALFORMED_RESPONSE`, never `MODEL_REPORTED_UNKNOWN_FOR_ALL_FIELDS`, for a
response missing the required `answers` key.

### Verification checklist (explicit, per the mission's own list)

- **Honest provider identity always recorded, never defaulted to the
  intended provider.** Confirmed by direct code read (`agentUsed`/
  `AGENT_PROVIDER_ID[agentUsed]` used at every return point in both live
  entrypoints, never the originally-`preferredAgent`) and now also by the
  new fallback-success tests above (previously untested).
- **No same-vendor-family false independence.** `launch-profiles.v1.json`
  currently defines exactly 2 profiles, one per real vendor -- there is
  structurally no second same-vendor profile for anything to conflate.
  `VERIFIER_INDEPENDENT`'s `mustDifferFromWorkerWhenAvailable` is checked
  via `routing-eval-runner.test.mjs`'s real `verifierDiffersFromWorker`
  case against the real config. Separately confirmed `VERIFIER_INDEPENDENT`
  has no live-dispatch production call site at all yet (only
  `resolveUsageMode`'s static resolution and eval/fixture code reference
  it) -- the theoretical risk (both a worker and the verifier genuinely
  falling back to the same vendor when the other is down) is not currently
  reachable in production; flagged for re-check if/when this role is
  wired to a real live call.
- **No implicit paid API path silently taken.** Not touched by this
  phase's changes (`TSF_RESEARCH_LATENT_KNOWLEDGE_DISPATCH_ENABLED`,
  `TSF_RESEARCH_LIVE_DISPATCH_ENABLED`, and F1's resource-pressure gates
  are all outside the diff -- confirmed via `git diff --stat`, only
  `live-planner.mjs`, `planner-mission-checkpoint.mjs`,
  `planner-session-lifecycle.mjs`, and test/fixture files changed).
- **Fallback rules match the real, current config.** Re-verified directly
  against `provider-role-mappings.v1.json` (see above), not a stale
  summary -- the checkpoint's own record of `PLANNER_DEEP`'s
  `CLAUDE_SAFE -> CODEX_SAFE` pair matches what this phase actually tested.
- **No silent model substitution where identity matters for provenance.**
  `llm-latent-knowledge-research-worker.mjs`'s
  `buildLatentKnowledgeSnapshot` already records `live.providerId`/
  `live.agentId`/`live.model` verbatim (never hardcoded) -- re-confirmed
  by its own existing "provider identity is reported honestly per real
  invocation" test, unmodified and still passing.
- **Provenance preserved through retries/fallbacks.** `agentUsed` is
  reassigned only on a genuinely successful fallback result, never
  speculatively; F22's fix additionally makes the DISPATCH boundary itself
  (not just the answer) durably attributable -- `providerId`/`agentId` are
  forwarded into `registerDispatchedWorker` from whatever the real
  dispatcher reports, unchanged by this phase.

### Test results and lint

New/changed test files: `planner-mission-checkpoint.test.mjs` (+5 tests),
`planner-session-lifecycle-crash-mid-dispatch.test.mjs` (new, 4 tests, 1
top-level with 4 sub-tests), `live-planner-provider-fallback.test.mjs` (new,
split from `live-planner.test.mjs`, 4 tests),
`llm-latent-knowledge-research-worker.test.mjs` (+1 test),
`tsf/test/fixtures/stub-planner-cli.mjs` (shared fixture, additive only).
`live-planner.test.mjs` itself is byte-identical to its pre-phase content
(`git diff` shows no changes) after the split.

Targeted sweep (all Phase 11 files together): 80/80 pass. F1 light
re-verification (6 files named in F1's own checkpoint entry): 88/88 pass,
matching F1's documented count exactly. Full-suite sweep
(`node --test tsf/test/*.test.mjs`) run 3 times total on this shared,
concurrently-loaded host (this session's own memory already flags many
concurrent Claude Code sessions running on this box): 2378 tests each time,
2371-2373 pass, 5-7 fail. The failing set each time is a SUBSET of the same
7 known candidates: `command-bare-imperative-dispatch.test.mjs`'s "IDIOM"/
"QUERY/STATUS"/"WorldForge" phrasing gaps, `operator-state-adversarial.test.mjs`'s
"STALE ACTION RACE", `http-work-summary.test.mjs`'s dispatch-tick timing
test, `keep-going-autonomy-proof.test.mjs`'s long-running autonomy proof,
and `health-repair-io.test.mjs`'s `runBaselineVerification` -- every one of
these is already named in this program's own F1/F4 checkpoint entries as
pre-existing, real-host-load-sensitive, not caused by any change in this
program, and a direct `git stash`-baseline comparison run this phase
reproduced the identical candidate set (same names, same files) with this
phase's changes stashed out. None of the 7 touch
`live-planner.mjs`/`planner-mission-checkpoint.mjs`/
`planner-session-lifecycle.mjs` or any file this phase changed.

`npx oxlint` on every changed/new file (`planner-mission-checkpoint.mjs`,
`live-planner.mjs`, `planner-session-lifecycle.mjs`, `stub-planner-cli.mjs`,
`live-planner-provider-fallback.test.mjs`,
`llm-latent-knowledge-research-worker.test.mjs`,
`planner-mission-checkpoint.test.mjs`,
`planner-session-lifecycle-crash-mid-dispatch.test.mjs`) -- clean, exit 0
(fixed 3 `curly` findings on newly-added lines rather than leaving them).

Astra: not touched, not referenced, per this program's explicit
instruction. NWR data: not touched.

Adopted SHA: see the commit on
`tsf/feature/phase11-provider-worker-resilience` that carries this section.

## Phase 8: Planner Lifecycle Chaos Test -- Finding F24, FIXED (real TOCTOU in `_mutate`'s lease enforcement); one new real coverage gap closed with a passing test; three scenarios confirmed already sound

Worktree: `phase8-planner-lifecycle-chaos`, branch
`tsf/feature/phase8-planner-lifecycle-chaos` (forked from `tsf/main` @
`77b7482a90e4e44abf311a4b92a0db3ea03af23a`).

**Method.** Read F4 (real cross-process crash-reclaim, `planner-mission-lease-crash-reclaim.test.mjs`)
and F22 (planner dispatch double-spend on crash-mid-dispatch, the
`recordDispatchAttempt`/`resolveDispatchAttempt`/`classifyPlannerDispatchAmbiguity`
ledger in `planner-mission-checkpoint.mjs`) checkpoint sections in full before
touching anything, then read every real Planner Context Lifecycle production
file (`planner-mission-checkpoint.mjs`, `planner-mission-lease.mjs`,
`planner-mission-store.mjs`, `planner-session-lifecycle.mjs`,
`planner-mission-repo-state.mjs`) and every existing test that exercises them,
line by line, before writing a single new test -- per-scenario reconciliation
below cites exactly what was read.

### Scenario-by-scenario reconciliation

| Scenario | Verdict | Evidence |
|---|---|---|
| Planned rollover | Already covered | `planner-session-lifecycle-golden-rollover.test.mjs` -- planner A dispatches/raises Needs-You/checkpoints/relinquishes, a genuinely independent planner B object hydrates from the durable store only, proves zero re-dispatch, resolves inherited state, completes the mission. Read in full; no gap. |
| Planner process exit | Already covered | `planner-mission-lease-crash-reclaim.test.mjs` (F4) -- a REAL spawned child process holding the lease is SIGKILLed; a successor is refused before real TTL expiry (proves the lease was genuinely live), then reclaims after, with intact worker state and passing `assertRepoStateContinuity`. Read in full; no gap. |
| Backend restart | Not meaningfully different from "planner process exit" here -- already covered by the same test | Confirmed via a real code read: `PlannerSessionLifecycle` holds no state beyond `missionId`/`plannerSessionId`/injected `deps`; every read re-hits the durable file-backed store (the class's own header comment states this explicitly). `grep -rn "new PlannerSessionLifecycle"` across `tsf/` found it constructed ONLY in tests/fixtures -- no production HTTP-route/server file wires it in yet, so there is no additional "backend" concept (an in-memory singleton, a live socket, cached state) for a restart to threaten beyond what F4's crash-reclaim already proves: a fresh process, with no memory of any prior instance, reading only the durable store. Not re-tested as a separate scenario -- would be a duplicate of F4's own proof, not a new one. |
| Stale planner lease | Already covered | `planner-mission-lease.test.mjs`'s pure-function stale-reclaim test (fake clock) + F4's real end-to-end crash-reclaim (real TTL, real process). Read in full; no gap. |
| Concurrent takeover attempt (TWO successors racing a STALE lease) | Real coverage gap -- closed with a new real test (mechanism confirmed sound, no fix needed) | `planner-mission-lease-cross-process.test.mjs` only races two processes for an EMPTY (never-held) lease slot; F4's crash-reclaim test proves exactly ONE successor reclaiming a stale lease. Neither combines "stale lease left by a real crashed holder" + "two real successor processes racing for it AT ONCE" -- confirmed absent by reading both files in full. New: `planner-mission-lease-concurrent-takeover.test.mjs` (spawns a real holder via the existing `planner-crash-reclaim-worker.mjs` fixture, SIGKILLs it, waits past real TTL, then fires two real successor processes at `PlannerSessionLifecycle.acquireLeaseAndHydrate` -- the full end-to-end hydrate path, not just the bare lease primitive -- via a new fixture, `planner-mission-lease-concurrent-successor-worker.mjs`). Result: exactly one winner every run (4 consecutive runs, no flake), the loser gets a typed `TSF_PLANNER_LEASE_DENIED`, the winner's hydrated checkpoint is intact (`missionGoal`, `workerCount` both correct) -- the cross-process file lock (`cross-process-file-lock.mjs`, already reused by every lease operation) serializes stale-reclaim exactly like it serializes empty-slot acquire. No fix needed; the mechanism generalizes correctly. |
| Worker finishes during rollover | **Real defect found and fixed -- Finding F24** | See below. |
| Verifier finishes during rollover | Same defect, same fix (Finding F24) | Same `_mutate` mechanism `recordVerifierResult` funnels through -- see below. |
| Needs You created during rollover | Same defect, same fix (Finding F24) | Same `_mutate` mechanism `raiseNeedsYou` funnels through -- see below. |
| Resource pressure during hydration | Confirmed by design, not a gap -- documented with a new test | `_assertResourceAdmission()` is called exactly ONCE, synchronously, at the top of `acquireLeaseAndHydrate`/`startMission` -- never re-consulted afterward. Confirmed deliberate, not an oversight: everything after the gate (the lease file-lock read/write, a JSON-parse checkpoint read, `assertRepoStateContinuity`'s string compare, `observeCanonicalRepoState`'s one `git rev-parse`) is cheap, bounded, allocation-free work -- unlike `dispatchWorkerForTask`'s real external provider call (the actual long-running operation in this class), there is nothing here for a pressure spike to meaningfully interrupt. Per-task heavyweight-dispatch admission is a DIFFERENT layer's documented job (`chat-dispatch-bridge.mjs`, per `ADMISSION_FIELD`'s own comment in `planner-session-lifecycle.mjs`), not duplicated in this class. New test added to `planner-session-lifecycle-resource-governance.test.mjs` proves `collectHostMemoryEvidence` is consulted exactly once per hydrate (a stateful mock that turns CRITICAL after its first call still lets hydration complete) -- confirms the single-gate design by direct observation, not just a code read. |
| Provider failure during transition (dispatchWorker failing/succeeding exactly during a lease handoff) | Already sound under a genuinely different, realer timing than F22's own test -- confirmed with a new test | F22's own reproduction (`planner-session-lifecycle-crash-mid-dispatch.test.mjs`) forces its race by patching `_mutate`'s call count -- a valid proof of the ledger's logic, but a simulated single-planner-crash timing, not a real lease-expiry-during-a-still-running-call. New: `planner-session-lifecycle-dispatch-lease-handoff.test.mjs` -- planner A's real `dispatchWorker` call is genuinely slow (400ms) and still in flight when its real 200ms lease TTL elapses (no synthetic patching); a real successor B takes over via genuine TTL expiry mid-call, tries the same task, and is correctly refused (`TSF_PLANNER_DISPATCH_AMBIGUOUS`, real dispatcher never called twice); A's own dispatch call, whose real provider call genuinely succeeded, is refused at its post-dispatch commit (`TSF_PLANNER_LEASE_NOT_HELD`) rather than silently landing or silently vanishing -- the durable record shows the same honest "1 unresolved attempt, 0 registered workers" signature F22 designed for. Passes cleanly; F22's ledger design generalizes correctly to this realer timing without further changes. |

### Finding F24: `PlannerSessionLifecycle._mutate`'s lease check was a TOCTOU race -- a stale planner could still commit a write after a real successor had already taken over -- REPRODUCED and FIXED

**Gap.** `_mutate` (`planner-session-lifecycle.mjs`) read the current record,
asserted the caller still held the live lease (`_requireLease`), and only
THEN called `mutateCheckpoint` to perform the actual durable write. The
lease check and the write were never atomic together: `mutateCheckpoint`
(`planner-mission-store.mjs`) applied its `checkpointMutator` unconditionally
inside its own cross-process file lock, with no awareness of WHO was
supposed to be writing. In-process, no `await` separates the two steps, so
the window is normally sub-millisecond -- but it is real, not theoretical: a
genuinely separate OS process (exactly what a rollover/crash-reclaim
successor is) can land its own lease takeover in that gap. A stale planner
whose pre-flight check had already passed could still commit its write
afterward, unconditionally -- two planners mutating the same mission
concurrently, a direct violation of the single-authoritative-planner
guarantee `_mutate`'s own comment claims to enforce ("structurally prevents
a preempted/stale planner ... from mutating mission state after a successor
took over"). This affected every mutator that funnels through `_mutate`:
`recordWorkerResult`, `recordVerifierResult`, `raiseNeedsYou`,
`resolveNeedsYou`, `recordDecision`, `advancePhase`, `checkpoint`, and the
post-dispatch resolve/register commit inside `dispatchWorkerForTask`.

**Reproduction.** New `tsf/test/planner-session-lifecycle-rollover-race.test.mjs`:
widens the real (normally sub-millisecond) window deterministically, the
same way F22's own test made its race deterministic (patching `_mutate` for
exact timing) -- every function called is the REAL production function
(`readPlannerMissionRecord`, `_requireLease`, `mutateCheckpoint`, the domain
mutators), just reimplemented as one continuous async call with an explicit
`await` inserted where production code has none, so a real successor's real
takeover (genuine TTL expiry, a real `PlannerSessionLifecycle` instance,
real durable writes) reliably lands inside that window on every run instead
of by chance. Three scenarios (worker result, verifier result, Needs-You),
each: planner A's pre-flight check passes genuinely (real live lease at that
instant); a real planner B then takes over via real TTL expiry and commits
its OWN real work; A's now-delayed write is attempted. Confirmed against the
unmodified code (`git stash` on `planner-mission-store.mjs`/
`planner-session-lifecycle.mjs`): all 3 scenarios' "A's write, landing after
B's takeover, is refused" assertion FAILED -- A's write landed unconditionally
every time (`Missing expected rejection`), and the follow-up assertion
confirmed A's stale content had actually overwritten/co-mingled with B's
durable state. Real defect, reproduced directly, not hypothesized.

**Fix.** No new lease/checkpoint/dispatch-tracking mechanism -- reuses the
existing pure `isPlannerMissionLeaseLive` domain function
(`planner-mission-lease.mjs`) and the existing lease shape already durable in
every mission record. `mutateCheckpoint` (`planner-mission-store.mjs`) gains
an optional 4th parameter, `{ requireLeaseHolder }`: when passed a
`plannerSessionId`, it re-asserts (live lease AND held by that exact session)
ATOMICALLY inside the SAME file lock the write itself takes, throwing the
same `TSF_PLANNER_LEASE_NOT_HELD` `_requireLease` already throws if not.
Optional, defaulting to off, so every pre-existing direct caller
(`cleanup-active-mission-check.test.mjs` and 4 other test files that seed a
checkpoint via `mutateCheckpoint` with no lease semantics in play,
`planner-mission-store.test.mjs`'s own direct tests) is unaffected --
confirmed by reading every call site before shipping the change.
`PlannerSessionLifecycle._mutate` now passes
`{ requireLeaseHolder: this.plannerSessionId }`; the fast pre-flight
`_requireLease` read is UNCHANGED and kept (cheap early rejection avoids
wasted mutator work for an obviously-lost session) -- the atomic check inside
the lock is what actually closes the race, not a replacement for the
pre-flight one.

**Tests.** `planner-session-lifecycle-rollover-race.test.mjs`: 3 scenarios x
3 sub-tests = 9 tests, all passing post-fix, all reproduced-failing pre-fix
via `git stash` (documented above). Full regression:
`node --test tsf/test/planner-mission-*.test.mjs tsf/test/planner-session-lifecycle-*.test.mjs`
-- 72/72 pass (includes the 3 new/changed files from this phase plus every
pre-existing file in this family). Broader sweep of every OTHER file that
calls `mutateCheckpoint` directly (`command-followup-context.test.mjs`,
`cleanup-stacked-blockers-adversarial.test.mjs`, `cleanup-revalidation.test.mjs`,
`cleanup-executor-worktree-adversarial.test.mjs`,
`cleanup-active-mission-check.test.mjs`) -- 46/46 pass, confirming the
optional 4th-parameter change is genuinely additive. Full-suite sweep
(`node --test tsf/test/*.test.mjs`): 2399 tests, 2393 pass, 6 fail -- all 6
are a subset of the SAME candidate set this program's own F1/F4/F11
checkpoint entries already document as pre-existing, real-host-load-sensitive,
unrelated to any file this phase touched (`command-bare-imperative-dispatch.test.mjs`'s
"QUERY/STATUS"/"IDIOM"/"WorldForge" phrasing gaps, `http-work-summary.test.mjs`'s
dispatch-tick timing test, `keep-going-autonomy-proof.test.mjs`'s long-running
autonomy proof, `operator-state-adversarial.test.mjs`'s "STALE ACTION RACE").
None of the 6 touch `planner-mission-store.mjs`, `planner-session-lifecycle.mjs`,
or any file this phase changed.

**Lint.** `npx oxlint` on every changed/new file (`planner-mission-store.mjs`,
`planner-session-lifecycle.mjs`, `planner-session-lifecycle-rollover-race.test.mjs`,
`planner-mission-lease-concurrent-takeover.test.mjs`,
`planner-mission-lease-concurrent-successor-worker.mjs`,
`planner-session-lifecycle-dispatch-lease-handoff.test.mjs`,
`planner-session-lifecycle-resource-governance.test.mjs`) -- clean, exit 0.
Every changed file stays well under the 600-line cap (largest is
`planner-session-lifecycle.mjs` at 270 lines).

Astra: not touched, not referenced. NWR data: not touched -- every new test
uses small, disposable, hermetic fixtures (`mission:rollover-race-*`,
`mission:concurrent-takeover-fixture`, `mission:dispatch-lease-handoff-fixture`,
`mission:resource-gov-single-gate`), each in its own isolated
`TSF_UI_STATE_FILE`.

Adopted SHA: see the commit on `tsf/feature/phase8-planner-lifecycle-chaos`
that carries this section.
