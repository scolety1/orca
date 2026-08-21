# M5 — Capacity-Aware Routing

## North star

Dispatch decisions (which role resolves to which provider, how much
concurrency to run, whether to pause) should be grounded in real,
currently-observed provider capacity — never fabricated, never silently
guessed — and should degrade safely (fewer/cheaper workers, a checkpoint
and pause) rather than starting work that capacity can't finish.

## What already exists (do not reinvent)

- `tsf/domain/routing.mjs`'s `resolveRole`/`resolveUsageMode`: already
  produce a `{requested, observed, fallbackProfile, selectionAssurance}`
  shape. `requested` (preferred profile/provider/agent/modelClass/
  effortClass) is always shown separately from `observed` (the actual
  provider/agent/model once a real call returns) — **M5's own acceptance
  criterion "shows requested role separately from effective
  provider/model" is already fully implemented.** `selectionAssurance`
  (`OBSERVED`/`RECOMMENDED_ONLY`) already distinguishes a call that
  actually happened from a plan that hasn't executed yet.
- `live-planner.mjs`'s `invokeLivePlanner`/`invokeLiveStructuredAnalysis`
  already retry the preferred role's agent, then fall back to
  `fallbackProfile` on `PROVIDER_FAILURE` — provider switching on failure
  already exists as a mechanism, just not gated on a capacity signal yet.
- M4's `checkpointRun`/`recentCheckpointTrail` already give a durable,
  restart-safe checkpoint/history mechanism — "checkpoints safely on low
  capacity" is a new CALL SITE into this existing machinery, not a new
  persistence mechanism.
- `orca account list --json` is a real, already-proven-reliable capacity
  signal (used manually, by hand, throughout this entire session's own
  live dogfood proofs in M3/M4) — the exact real data source this
  milestone needs to read programmatically; nothing needs to be invented
  to query it.

Given this, M5 is genuinely narrower than "everything" (though its own
`gaps` field correctly said "everything -- not started" for the CODE,
since zero of it existed yet): the requested-vs-effective display and the
provider-switch-on-failure mechanism are done; what's missing is turning
manual capacity checks into a real, programmatic signal the dispatch path
actually reads.

## The real gap — no code reads capacity signals at all

Confirmed by search: no file under `tsf/domain`, `tsf/server`, or
`tsf/adapters` calls `orca account list` or parses a rate-limit/capacity
structure. Every capacity check this entire program has ever performed
(waves throughout M2/M3/M4) was a manual shell invocation by the
operating agent, never application code. This is the one real, substantial
gap M5 needs to close.

## Design

1. **A real capacity adapter** (`tsf/adapters/orca-capacity-bridge.mjs`,
   mirroring `orca-orchestration-bridge.mjs`'s own spawn-and-fail-honestly
   pattern): wraps `orca account list --json`, returns a structured
   `{ok, claude: {sessionUsedPercent, weeklyUsedPercent, status}, codex:
   {weeklyUsedPercent, status}, ...}` or `{ok:false, reason}` on any
   failure — never fabricates a percentage it didn't observe.
2. **A pure capacity-policy function** (`tsf/domain/capacity-policy.mjs`):
   given a capacity snapshot and a requested role/usage mode, decides
   `{action: 'PROCEED'|'DOWNGRADE_WORKER'|'REDUCE_CONCURRENCY'|
   'PAUSE_AND_CHECKPOINT', reason}` — pure, testable, no I/O. Reports
   `UNKNOWN` (not a guessed value) when the adapter call failed, per the
   acceptance criterion's own wording.
3. **One real call site**: `keep-going-dispatch-loop.mjs`'s `dispatchStep`
   checks capacity once per tick (reusing the adapter/policy above)
   before dispatching a new wave; on `PAUSE_AND_CHECKPOINT`, calls the
   EXISTING `checkpointRun`+`pauseRun` path (M4/M2), not a new one.
   `REDUCE_CONCURRENCY`/`DOWNGRADE_WORKER` adjust the wave plan's own
   `maxConcurrentWorkers`/role choice, already parameters this loop reads.
4. **Mission-boundary provider switching**: `dispatchStep` only ever
   resolves a role once per wave (already true structurally — a wave's
   role choice is fixed for its own dispatch), so "switches at mission
   boundaries, not mid-session" needs no new code, only the capacity
   check itself happening at that existing per-wave boundary.

## Required real proof

A real, live `orca account list --json` call feeding a genuine
capacity-policy decision — not a fabricated/mocked capacity number — for
at least one PROCEED case and one degraded case (forcing a degraded case
honestly, e.g. by temporarily treating a real observed high-usage value
as the input, not by inventing a fake response shape).

## Explicitly out of scope for M5

- Any new persistence mechanism for capacity history — a live-queried
  snapshot per decision point is sufficient; M4's checkpoint trail is the
  durable record of WHEN a pause happened, not raw capacity telemetry.
- Automatically resuming a paused run when capacity recovers without an
  explicit trigger (a scheduled recheck) — recorded as a disclosed,
  reasonable scope boundary unless the acceptance criteria demand
  otherwise on closer implementation.
