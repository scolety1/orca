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
