# TSF Keep Going Autonomy V1

Built during the governed-adoption-review round that followed the initial
Command/Workflow + Safe Update Manager candidate. That review's own real
reconciliation of NWR, WorldForge, and Landing Page (three real, live
projects) surfaced three real gaps this document covers: no honest way to
reconcile a settled-but-unverified run, an update-safety check that
couldn't distinguish live execution from stale idle state, and no
autonomous driver at all -- a UI-started Keep Going run only ever advanced
when a human or chat request explicitly ticked it.

## 1. Settled-run reconciliation (`domain/settled-run-reconciliation.mjs`,
   `server/settled-run-reconciler.mjs`)

The smallest correct mechanism for a run that is ACTIVE, has at least one
recorded wave, and has nothing currently executing it
(`live-work-feed.mjs`'s `isRunExecuting`). Never fabricates
`verifiedSatisfied` -- the only path to `COMPLETE` is a real, structured
verdict file a real dispatched verification task wrote, read back off
disk. Reused, unmodified existing primitives throughout: `tickKeepGoingRun`
for the one new dispatched work item (a verification-only wave), and
`checkpointRun`/`completeRun`/`raiseNeedsYou`/`recordTaskAttempt` for every
state transition -- no new schema, no new scheduler.

Decision table (`decideReconciliationAction`):

| Real evidence | Action |
|---|---|
| Real commits exist in the worktree after the run's last checkpoint, not yet captured | `CAPTURE_LATE_COMMITS` -- a real checkpoint records the exact SHAs |
| No verdict file exists yet | `DISPATCH_VERIFICATION` -- a real verification-only wave is dispatched |
| Verdict confirms every criterion | `COMPLETE` -- the real `completeRun` transition |
| Verdict finds a real gap | `NEEDS_DECISION` -- checkpoints the finding; escalates to `NEEDS_YOU` only once the run's own real retry budget is exhausted |

## 2. VERIFYING/update-safety semantics fix (`domain/live-work-feed.mjs`,
   `domain/update-safety.mjs`)

Real finding, confirmed against live production evidence (NWR, WorldForge,
Landing Page all sat at `VERIFYING` for ~2 days with zero live process):
`VERIFYING`/`REVISION`/the `PAUSED` flavor of `WAITING` are, by
construction, only ever reachable when neither `inFlightWave` nor
`tickLock` is set -- they can never describe genuinely-executing work.
`update-safety.mjs`'s `classifyUpdateSafety` previously keyed off the
label string; it now keys off `isRunExecuting(run)` (exposed as
`fleetWorkStatus(...).executing`), the one real, unambiguous fact. A
settled, unowned run no longer falsely blocks an update forever; a real
in-flight wave (implementation or verification -- both are real wave
dispatches) still blocks correctly.

## 3. The autonomous driver (`server/keep-going-fleet-driver.mjs`,
   `server/keep-going-fleet-driver-bootstrap.mjs`)

The "future scheduled automation" `keep-going-dispatch-loop.mjs`'s own
header comment already named as a known gap. A bounded, in-process
interval (`TSF_KEEP_GOING_FLEET_DRIVER=1`, real production default;
opt-in, never set for a test-spawned server) that periodically discovers
every ACTIVE Keep Going run and advances it using only the existing real
primitives:

- A wave in flight -> settle it (`tickKeepGoingRun`).
- Settled, unowned, waves exist -> reconcile it (Stage 1 above). A real
  gap found (not yet retry-exhausted) -> the driver additionally
  dispatches a real CONTINUATION wave, mechanically built from the run's
  own already-declared goal/constraints/stop conditions and the real
  gap evidence Stage 1's own verification task produced -- never new
  judgment invented by this driver.
- No wave ever dispatched (still `PLANNING`) -> skipped; planning a run's
  first wave stays Command/chat's job, not this driver's (disclosed scope
  boundary, matching `keep-going-dispatch-loop.mjs`'s own).

Fleet-wide concurrency is bounded (`DEFAULT_MAX_CONCURRENT_TICKS = 2`,
distinct from a single run's own `budget.maxConcurrentWorkers`) so a large
fleet never dispatches everything in the same instant. No new locking: the
CAS-safe claim/commit `tickKeepGoingRun` already provides is exactly what
prevents a real duplicate dispatch, including across a restart -- a fresh
process re-discovering ACTIVE runs from the same durable, file-locked
store simply resumes where the durable state left off.

## 4. Real, isolated end-to-end proof
   (`test/keep-going-autonomy-proof.test.mjs`)

Drives a real spawned `activate()`/`startStandaloneServer` process (stub
Orca CLI, real git repos, real HTTP) through: Start -> one real initial
dispatch (standing in for what Command/chat already does synchronously
today) -> from that point on, **zero further test-initiated ticks** ->
the real driver autonomously settles, dispatches real verification,
reacts to a real seeded gap, dispatches a real continuation, and
autonomously completes the run -- while a **real backend restart mid-wave**
is survived and a **second, concurrently-failing project** independently
escalates to `NEEDS_YOU` without ever blocking the first. Verified stable
across repeated real runs.

### Real finding surfaced while building this proof

Killing the server while its own driver happens to hold this run's
domain-level tick lock (`claimTick`, `keep-going.mjs`) for a SETTLE --
a real, rare race, since the driver ticks on its own every
`intervalMs` -- leaves that lock unreleased. `TICK_LOCK_TIMEOUT_MS`
(`keep-going.mjs`, already 2 minutes, predating this work) is how long the
domain layer waits before treating an unreleased lock as abandoned. This
is a genuine, pre-existing safety property (never trust a lock you can't
prove is dead) -- not a bug this driver introduced -- but the driver's
frequent background ticking makes the race meaningfully more reachable
than the old, purely-manual-tick world did. Recorded here as a real,
disclosed operational characteristic worth a future look (e.g.
proactively fencing an owned tick lock on graceful shutdown), not silently
fixed as part of this pass.
