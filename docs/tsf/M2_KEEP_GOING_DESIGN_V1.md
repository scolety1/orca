# M2 — Keep Going / Overnight V1 — Design

## Architecture decision: Orca's CLI already is the execution substrate

`orca` (installed at `C:\TSF_FOUNDATION_EVAL\installed\orca\resources\bin\orca.exe`,
runtime reachable, app 1.4.185) exposes a full native orchestration graph
through `orca orchestration <cmd>` and `orca automations <cmd>` that was not
previously inventoried in `docs/tsf/TSF_OVERLAY_ARCHITECTURE.md` (that doc's
"plugin API v1 does not yet expose the complete Run/task/dispatch graph"
statement is about the sandboxed *plugin* API specifically — the CLI is a
separate, fuller supported surface). Per the program's implementation
hierarchy, this sits above "TSF overlay module" and must be used instead of
a parallel scheduler:

| M2 need | Orca-native primitive |
|---|---|
| A run/mission namespace | `orchestration run-create/run-list/run-show` |
| Bounded work items | `orchestration task-create/task-list/task-update` |
| Dispatch a work item to a worker | `orchestration dispatch`, `orchestration worker-start` |
| Worker heartbeat / resource accounting | `orchestration worker-list` (`--terminal-state`) |
| Stall handling — fence without claiming success | `orchestration worker-abandon` |
| Clean stop of a dispatch | `orchestration worker-stop` |
| Needs You / human decision gate | `orchestration gate-create/gate-resolve/gate-list` |
| Inter-agent messaging (planner ↔ worker) | `orchestration send/check/ask/reply/inbox` |
| Genuinely scheduled/recurring overnight trigger | `automations create --trigger cron|rrule|preset [--precheck <cmd>] [--workspace-mode existing|new-per-run]`, `automations run`, `automations runs` |

`tsf/adapters/orca-cli-bridge.mjs` already establishes the pattern (spawn
`orca ... --json`, fail honestly on `CLI_UNAVAILABLE`/`TIMEOUT`/`CLI_ERROR`,
never fabricate success) for repo registration. M2 extends that same
pattern to the orchestration surface in a sibling adapter — not a new
engine.

## Division of responsibility

- **Orca (native, via CLI)**: creates the Run, tasks, dispatches workers to
  terminals/worktrees, tracks worker/terminal resource state, blocks a task
  on a gate, and can trigger the whole cycle on a schedule.
- **TSF (`tsf/domain/keep-going.mjs`, this wave)**: the *governance* layer
  Orca has no opinion on — the immutable original goal, acceptance
  criteria, gap analysis that never trusts a worker's own "done" claim,
  conflict-aware wave batching by declared file scope, retry/stall
  budgets, and the run-level ACTIVE/NEEDS_YOU/PAUSED/STALLED/COMPLETE/
  BLOCKED state machine with hash-chained checkpoints and a summary
  generator. **Correction (wave 7, post independent review):** this is a
  distinct state machine at the overnight-Run level, one level above
  `mission-state.mjs`/`coordinator.mjs`'s per-wave Mission lifecycle
  (`DRAFT`/`PLANNING`/`READY`/`ACTIVE`/`REVIEW`/...) — it does not import
  or literally compose that module today. "One Mission per wave" below
  describes the intended future wiring for the autonomous wave-dispatch
  loop (not yet built), not code that exists now. The original wording
  here overclaimed composition that hadn't been implemented; corrected
  after an independent code-review pass caught the discrepancy against
  `tsf/domain/keep-going.mjs`'s actual imports.
- **Adapter (next wave, not yet built)**: `tsf/adapters/orca-orchestration-bridge.mjs`
  maps a TSF wave plan into `orchestration task-create` + `dispatch`/
  `worker-start` calls, and maps `worker-list`/`task-list`/`gate-list`
  facts back into the shapes `keep-going.mjs` and `mission-state.mjs`
  consume (`detectStall` heartbeats, `registerWorkerResult` capsules).
  Deferred to a later loop iteration so live dispatch (real worktrees, real
  compute) is a deliberate, separately-tested step, not folded into a pure
  unit-tested domain change.

## What this wave implemented

`tsf/domain/keep-going.mjs` + `tsf/test/keep-going.test.mjs` (15/15 GREEN,
full suite 102/102 GREEN, no regressions):

- `createOvernightRun` / `replaceGoal` — immutable goal unless
  `authorizedBy: 'TIM'`.
- `compareStateToGoal` — gap analysis; only accepts criteria the caller
  marks `verifiedSatisfied` (independently verified), decides
  `CONTINUE` / `STOP_COMPLETE` / `STOP_BLOCKED` / `STOP_BUDGET_EXHAUSTED`.
- `planWave` — conflict-aware batching by declared file scope, capped at
  `budget.maxConcurrentWorkers`, reports which pairs were serialized and
  why.
- `recordWave` — idempotent by `(plan, result)` digest: no duplicate
  settled work on replay.
- `recordTaskAttempt` — bounded retry budget, throws
  `TSF_RETRY_BUDGET_EXCEEDED` past the limit.
- `detectStall` — flags worker heartbeats older than
  `budget.stallThresholdMs`.
- `transitionRun` + `pauseRun`/`resumeRun`/`markStalled`/`completeRun`/
  `blockRun` — explicit run-level state machine (`PAUSED` doubles as
  "Ready to Resume": a run only ever pauses at a safe boundary, so sitting
  in `PAUSED` already means resumable).
- `raiseNeedsYou`/`resolveNeedsYou` — blocks the run until every open
  question is resolved, then returns to `ACTIVE`.
- `checkpointRun` — hash-chained durable checkpoints after each phase.
- `summarizeRun` — concise morning/return summary (state, goal, waves
  completed, open Needs You, last checkpoint).

## Deferred to later loop iterations

1. `orca-orchestration-bridge.mjs` adapter wiring real `orchestration`/
   `automations` CLI calls.
2. `mapOrcaFacts` extension in `tsf/adapters/orca-runtime.mjs` to project
   `worker-list`/`task-list`/`gate-list` facts into the shapes above.
3. A bounded fixture/dogfood mission proving multiple waves, one revision,
   pause/resume, independent verification, and a concise summary end to
   end against a real (low-risk, non-NWR/HouseOS/EasyLife) Orca Run —
   extending `tsf/fixtures/long-autonomous-runtime-v1` rather than
   replacing it.
4. UI: project-level "Keep Going / Overnight" controls in `tsf/ui`
   (Start/Pause/Resume, goal/budget/constraints form, live phase/gap/
   worker/retry/verifier/Needs-You/Ready-for-Adoption display) backed by a
   `tsf/server` projection of `keep-going.mjs` run state.
5. Capability ledger update for the relevant `MSN-*`/`WRK-*` rows —
   batched at milestone completion rather than every wave, to avoid churn.

## Wave 15: the autonomous wave-dispatch loop

`tsf/server/keep-going-dispatch-loop.mjs` (`tickKeepGoingRun`) closes the
long-standing gap noted above (waves 1, 6, 8, 11): a UI-started run
previously sat at 0 waves forever because nothing drove `planWave`/
`recordWave` against live Orca workers. One `tickKeepGoingRun` call performs
exactly one bounded, idempotent step for one project's run:

- **No run, or run not `ACTIVE`**: `NOOP` (never touches a paused/blocked/
  complete run).
- **No wave currently out** (`run.inFlightWave` is `null`): plans the next
  wave (`planWave`) against caller-supplied candidate work items, lazily
  creates the Orca orchestration Run on first dispatch
  (`createOrchestrationRun`), then `createOrchestrationTask` +
  `dispatchOrchestrationTask` per work item (the real
  `orca-orchestration-bridge.mjs` calls wave 11 proved against the live CLI),
  and records the wave as in flight (`dispatchWave`, a new domain function —
  does **not** append to `run.waves` yet, so a crash between dispatch and
  settle leaves the run re-checkable rather than losing or double-counting
  the wave). A mid-wave dispatch failure records only the items actually
  dispatched (trimmed plan), never silently orphaning a real Orca task with
  no TSF-side record.
- **A wave is out** (`run.inFlightWave` set): polls `orchestration
  task-list` (not `worker-list` — wave 11's dogfood found `worker-list` only
  tracks `worker-start`-launched workers, not tasks dispatched into a
  pre-existing terminal) for each dispatched task's status. Still pending →
  `WAVE_STILL_IN_FLIGHT`, no state change. All terminal → records a
  `recordTaskAttempt` per outcome (keyed by the work item id, not the Orca
  task id, since a retry creates a new Orca task for the same logical work
  item), settles the wave (`settleInFlightWave`, clears `inFlightWave`), and
  checkpoints.

**Deliberately not done by this loop, disclosed rather than glossed over:**

1. **No independent verification.** Orca reporting a task `completed` is
   the worker's own claim. This loop never marks an acceptance criterion
   `verifiedSatisfied` from that alone — doing so would be exactly the
   "worker self-report treated as done" the charter forbids (Section F).
   `projectKeepGoingRun`'s gap analysis still honestly passes
   `verifiedSatisfied: []` until a real independent verifier pass exists;
   wiring one in is separate future work.
2. **No candidate-work-item generation.** Deciding *what* work items exist
   for the current gap is a planning judgment, still supplied by the
   caller (today: an operator or planner session) — this loop refuses to
   plan a wave when none are given rather than fabricating one.
3. **No registered recurring trigger.** `automations create --trigger
   cron|rrule|preset` (the native primitive named at wave 1) is the
   intended way to fire `tickKeepGoingRun` unattended, but registering a
   standing, always-firing local automation is a separate decision with
   its own interval/safety tradeoffs (how often, what stop conditions, what
   happens if Orca is closed) — not made by this wave. Today the function
   is only reachable by direct call (proven by
   `tsf/test/keep-going-dispatch-loop.test.mjs`'s dependency-injected
   orchestration fakes); an HTTP "run now" route and/or the automation
   registration itself are the next deferred step.

## Wave 15 follow-up: independent review findings

A forked code-review pass (effort `high`) on wave 15's diff returned 6
findings, addressed the same session:

1. **Fixed** -- a freshly-created real Orca orchestration Run leaked (never
   persisted into `run.orchestrationRunId`) when the first `task-create` in
   a wave failed, so every retrying tick created another orphaned Run.
   `dispatchStep` now tracks whether the Run was freshly created this tick
   and persists it even on a total dispatch failure.
2. **Disclosed, not newly fixed** -- the `expectedRevision` check on
   `tickKeepGoingRun` only protects against a caller acting on an
   already-stale read; it cannot protect against a concurrent write landing
   on the same in-memory run mid-tick (several awaited CLI round-trips are
   held across one `run` object, and the eventual `dispatchWave`/
   `settleInFlightWave` calls pass that run's own revision, which trivially
   matches itself). This is the same still-open per-request atomic
   read-check-write gap already disclosed for `data-store.mjs` (wave 8
   finding 4, wave 11 findings 1/6) -- corrected the misleading comment
   rather than re-solving an already-deferred architectural item.
3. **Fixed** -- a wave whose task status never reaches a terminal state
   (cancelled, hung) previously left `WAVE_STILL_IN_FLIGHT` forever with no
   escalation. `settleStep` now escalates to `STALLED` (via the existing
   `markStalled`) once the wave has been in flight longer than
   `budget.stallThresholdMs`, using the wave's own `dispatchedAt` wall-clock
   timestamp rather than the still-unavailable per-worker heartbeat (wave
   11 finding 4's limitation stands unchanged).
4. **Fixed** -- exceeding a work item's retry budget only produced a
   reported action; nothing stopped the same item from being re-dispatched
   and re-breaching the budget every tick. `settleStep` now raises a real
   `NEEDS_YOU` question (via `raiseNeedsYou`) instead, so the run stops and
   an operator sees it.
5. **Disclosed, deliberately deferred** -- `planWave`'s conflict-aware
   batching intends independent items to run in parallel, but `dispatchStep`
   still dispatches every item in a batch sequentially, costing wall-clock
   latency (not correctness). Documented in-code; not fixed this pass since
   correct concurrent partial-failure handling needs more care than the
   current sequential-with-early-return shape.
6. **Fixed** -- `dispatchWave`/`settleInFlightWave` checked their own
   invariant (no wave in flight / a wave in flight) before
   `assertExpectedRevision`, so a stale-revision caller got
   `TSF_WAVE_ALREADY_IN_FLIGHT`/`TSF_NO_IN_FLIGHT_WAVE` instead of
   `TSF_STALE_REVISION`, unlike every other mutation in the module.
   Reordered to check revision first.

157/157 full suite GREEN after fixes, oxlint/oxfmt clean.

## Wave 16: concurrency hardening (the tick's own mid-flight race)

Wave 15b's finding 2 disclosed a real limitation rather than fixing it: the
`expectedRevision` check on `tickKeepGoingRun` only compared a run's
revision to itself, so it could not detect a state change landing on the
same in-memory run while the tick's real Orca CLI round-trips were still
in flight. Tim directed a bounded hardening wave on exactly this, before
any further live dogfood.

**Smallest safe concurrency model chosen:** a claim/commit lock built on
one small synchronous compare-and-swap primitive, not a broad
`data-store.mjs` rewrite.

- `tsf/server/keep-going-run-store.mjs` (new, ~30 lines): `withKeepGoingRun`
  wraps `data-store.mjs`'s `loadState()`/`saveState()` -- both synchronous
  `fs` calls -- around one pure `mutateFn`. Because there is no `await`
  between the load and the save, Node's single-threaded event loop cannot
  interleave any other request's code into that window; this is what
  actually provides atomicity, not the revision check alone.
- `tsf/domain/keep-going.mjs` gains `tickLock` (`{ kind, claimedAt }` or
  `null`) on the run, plus `claimTick`/`releaseTick`. A tick claims the
  lock via one CAS *before* doing any real CLI work (preventing two ticks
  from both starting real duplicate dispatch -- a plain "check revision
  once at the end" cannot prevent that, since by the time either tick
  reaches its own end-of-tick check both may already have created real,
  duplicate Orca tasks), then commits its actual mutation plus
  `releaseTick` via a second CAS keyed on the revision the claim produced.
  A lock older than `TICK_LOCK_TIMEOUT_MS` (2 minutes, generous against the
  bridge's 15s CLI timeout) is treated as abandoned so a crashed tick
  cannot permanently wedge a run.
- `transitionRun` itself rejects any external transition (operator pause/
  resume/markStalled/raiseNeedsYou) while a live tick lock is held
  (`TSF_TICK_IN_PROGRESS`), so a pause request racing an in-flight tick is
  cleanly rejected -- not silently dropped, not silently overwritten by the
  tick's eventual commit -- and simply succeeds once retried after the
  (short-lived) lock clears. A `tickInternal` flag lets the tick's *own*
  internal escalations (`markStalled`, the retry-budget `NEEDS_YOU`) pass
  through the same lock they are themselves releasing, without being
  rejected by it.
- `tsf/server/keep-going-dispatch-loop.mjs` was restructured from a pure
  `opState`-in/`opState`-out function into one that owns its own claim and
  commit against an injectable `store` (defaulting to the real one,
  faked in unit tests, real-store-backed in the adversarial concurrency
  tests) -- a pure function handed a stale snapshot can never enforce
  atomicity across its own awaits by construction, so this was a necessary
  restructuring, not scope creep.
- A commit that loses the CAS race (its claimed revision no longer
  matches -- the lock was recovered as abandoned by another tick) reports
  a `*_LOST_LOCK` result honestly, surfacing any real
  `orchestrationRunId`/`dispatchRecords` it created for a future
  reconciliation pass, rather than silently discarding them or retrying
  unboundedly. Disclosed, not solved: it does not automatically re-adopt
  those orphaned resources onto the winning tick's run (that risks
  clobbering the winner's own reference) -- a known, bounded limitation of
  this pass, consistent with the program's "disclose, don't fabricate"
  discipline.

**What this deliberately does not touch:** the pre-existing HTTP routes for
start/pause/resume (`keep-going-http-routes.mjs`) still capture `opState`
before `await readBody(req)` (wave 11 finding 1) rather than routing
through `keep-going-run-store.mjs`. The adversarial tests below prove pause
correctly rejects while locked using the *same* store primitive a hardened
route would use, but wiring the actual HTTP routes to it is the necessary
next step before the tick is ever exposed over HTTP -- recorded as a
follow-up, not done in this bounded wave.

**Adversarial tests added**, all GREEN:

- `tsf/test/keep-going.test.mjs`: `claimTick`/`releaseTick` lifecycle,
  ACTIVE-only + revision-first checks, abandoned-lock recovery,
  `transitionRun`'s lock rejection for pause/markStalled/raiseNeedsYou and
  its `tickInternal` bypass.
- `tsf/test/keep-going-dispatch-loop.test.mjs`: rewritten for the new
  `(projectId, candidateWorkItems, clock, { orchestration, store })`
  signature (a fake in-memory store), plus a same-process two-overlapping-
  ticks test proving the second is rejected before touching orchestration
  at all.
- `tsf/test/keep-going-dispatch-loop-concurrency.test.mjs` (new): the real
  synchronous `data-store.mjs`-backed adversarial suite Tim required --
  two DISPATCH ticks racing, two SETTLE ticks racing an already-in-flight
  wave, a pause arriving mid-tick (rejected, then verified to still
  succeed once the lock clears, and that a full tick completes unaffected
  by the rejected pause attempt), and a tick that loses its lock to
  abandonment-recovery *after* creating real Orca resources -- proving the
  stale commit fails loudly and the winner's persisted state is never
  corrupted.

168/168 full suite GREEN, oxlint/oxfmt clean.

## Correction: `curly` lint is enforced on staged files

Earlier in this wave, `tsf/domain/*.mjs` (including already-adopted files
like `mission-state.mjs` and `coordinator.mjs`) was found to violate the
repo's `curly: error` oxlint rule with single-line guard clauses. That is
real and pre-existing — those files were never re-linted after the rule
was configured, since `pnpm lint`'s `oxlint` step only ran repo-wide, and
`husky`'s pre-commit `lint-staged` hook only lints files staged in a given
commit. It is not, however, an unenforced rule: attempting to commit
`keep-going.mjs` with the same single-line style was correctly rejected by
that pre-commit hook. `keep-going.mjs` now uses braces on every guard
clause and passes `oxlint`/`oxfmt --check` cleanly. The pre-existing
sibling files remain non-compliant until they are next touched; that gap is
recorded as advisory `LINT-CURLY-001` in program state for whoever decides
to reformat them, not something this wave changed.
