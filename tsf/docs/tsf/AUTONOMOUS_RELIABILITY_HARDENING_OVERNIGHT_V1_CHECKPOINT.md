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
| 1. Post-Upgrade Gap Reconciliation | IN_PROGRESS | Findings F18, F1, F3, F4 fixed so far |
| 2. Background Task Truthfulness | INVESTIGATED, NO GAP | See dedicated section below -- no fix warranted |
| 3-17 | NOT_STARTED | Ranked and sequenced after Phase 1's gap matrix |

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
