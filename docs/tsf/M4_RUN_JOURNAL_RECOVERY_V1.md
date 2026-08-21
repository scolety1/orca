# M4 — Run Journal + Recovery

## North star

A Keep Going run must survive a real process restart (TSF server crash/
redeploy, not just an in-memory pause) with zero repeated work, a durable
record of what actually happened, and an honest recovery summary Tim can
read afterward — without inventing a second persistence mechanism next to
M2's own run-store.

## What M2 already provides (do not reinvent)

- `tsf/domain/keep-going.mjs`'s `checkpoints[]`: a hash-chained
  (`previousHash`/`hash`) audit trail, one entry per meaningful phase
  transition (`RUN_STARTED`, `WAVE_DISPATCHED`, `WAVE_SETTLED`,
  `WAVE_STALLED`, `RETRY_BUDGET_NEEDS_YOU`, `RUN_RESUMED`, `DISPATCH_FAILED`,
  ...), each carrying `phase`/`note`/`evidence`/`waveCount`/`state`/`at`.
- `transitions[]`: a lighter `{from, to, reason, evidence, at}` log for
  every state-machine move (pause/resume/stall/etc.).
- `originalGoal`, `acceptanceCriteria`, `needsYou[]`, `retryCounts`,
  `waves[]` (settled) vs `inFlightWave` (in-progress) are all part of the
  ONE persisted run object — `tsf/server/keep-going-run-store.mjs`'s
  `readKeepGoingRun`/`withKeepGoingRun` already give atomic, file-backed
  durability via `cross-process-file-lock.mjs`. A fresh process reading
  this file already sees the exact same run shape a live process would.
- `tickKeepGoingRun` already never repeats a settled wave: it only ever
  acts on `inFlightWave` (settle) or dispatches a genuinely new wave when
  none is in flight — there is no "replay settled work" code path to guard
  against; the state machine structurally can't reach it.

Given this, M4 is real but narrower than "build a run journal from
scratch" — it is:

1. **Closing 3 specific, concrete gaps** (below), not building a new
   persistence layer.
2. **Proving** the whole thing survives an actual process restart, per
   M4's own explicit acceptance criterion — not just reasoning about it.

## Gap 1 — CORRECTED, not actually a gap

Original framing (below, struck through in spirit, kept for the record):
~~`checkpointRun`'s `evidence` field stores only task/dispatch IDs, so
task outputs are never durably persisted.~~ On closer inspection (before
implementing anything): `settleInFlightWave` already persists the FULL
`waveResult` — including `outcomes: [{workItemId, scope, taskId,
dispatchId, outcome, rawStatus}, ...]`, computed once in
`keep-going-dispatch-loop.mjs`'s `settleStep` and passed straight through
— onto `run.waves[]` (`{digest, wavePlan, waveResult, recordedAt}`). Task
outputs ARE already durably, compactly persisted; `checkpointRun`'s own
`evidence` field being bare task IDs is correct as designed — it's a
lightweight audit-trail POINTER into the fuller `run.waves[]` history, not
meant to duplicate it. No fix needed here. Recorded honestly rather than
building an unnecessary/redundant change to satisfy a gap that turned out
not to exist.

## Gap 2 — CORRECTED, not actually a gap

Original framing: ~~pause/resume never call checkpointRun.~~ On closer
inspection of the CONTROLLER layer (not just the bare domain functions
this doc originally checked): `keep-going-controller.mjs`'s
`pauseKeepGoingRun`/`resumeKeepGoingRun` already call `pauseRun`/
`resumeRun` and then immediately `checkpointRun` (phases
`OPERATOR_PAUSED`/`RUN_RESUMED`) -- this was itself a real M2 wave 11
review finding, already fixed there. No gap here either. Second honest
correction before implementing anything unnecessary: this design doc's
first draft under-read the codebase by stopping at the bare domain
functions instead of following the call chain into the controller that
actually wraps them.

## Gap 3 — no recovery summary surface after restart

Nothing today greets Tim (via chat or the Live Work Feed) with "here is
what happened while this was paused/the server was down." `summarizeRun`
exists but is a flat snapshot, not a "what changed since you last looked"
diff. Fix: a small, additive function comparing the run's last-seen
checkpoint (client-cached) against the current one, surfaced as a single
chat-answerable "what happened?" query — reusing `chat-responder.mjs`'s
existing live-run-grounding pattern from M3, not inventing a new answer
path.

## Required real proof (per Tim's own standing "no worker self-report,
no untested claim" discipline)

An actual process restart, not a simulated one: start a real Keep Going
run against the safe scratch/fixture project, dispatch a real wave, kill
the TSF server process (`taskkill`/SIGKILL, not a graceful shutdown),
restart it pointed at the same state file, and confirm from a fresh
process: the run resumes with the exact same revision/checkpoints/
needsYou, does not redispatch the in-flight wave, and (once it settles)
correctly reports the compact outcome from Gap 1 and a resume summary
from Gap 3.

## Explicitly out of scope for M4

- Any change to M2's core state machine transitions or its file-locking
  primitive — this milestone only adds fields/call-sites, per the
  program's Orca-core-delta-0 and "reuse, don't reinvent" discipline.
- A second persistence backend (e.g. SQLite) — the existing JSON+lock
  store already satisfies the durability requirement; M4 does not need to
  replace it.
