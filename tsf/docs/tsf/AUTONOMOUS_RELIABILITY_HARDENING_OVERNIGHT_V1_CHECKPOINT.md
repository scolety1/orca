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
| 1. Post-Upgrade Gap Reconciliation | IN_PROGRESS | Audit agent dispatched |
| 2-17 | NOT_STARTED | Ranked and sequenced after Phase 1's gap matrix |

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
