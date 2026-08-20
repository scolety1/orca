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

## Gap 1 — task/wave outputs are IDs, not compact content

`checkpointRun`'s `evidence` field stores only task/dispatch IDs (strings).
A resumed/rehydrated run (or a human reading the Live Work Feed after
restart) has no compact record of what a settled wave's outcome actually
was — outcomes live only in `settleInFlightWave`'s transient return value,
never persisted onto the run itself beyond the checkpoint's bare IDs.
Fix: persist a compact `{workItemId, outcome, rawStatus}` summary (already
computed in `settleStep`, currently discarded after settlement) onto the
checkpoint or a new small `waveOutcomes[]` run field — no new schema
version, an additive field.

## Gap 2 — no checkpoint before pause/provider-capacity pause

`pauseRun`/`resumeRun` (`keep-going.mjs:193-196`) call `transitionRun`
only — no `checkpointRun` call. M4's own acceptance criterion explicitly
names "checkpoint before provider/resource pause." Fix: have the pause
route/controller call `checkpointRun` (phase `RUN_PAUSED`, note recording
the reason) immediately before transitioning to PAUSED, mirroring the
pattern already used for `DISPATCH_FAILED`/`WAVE_STALLED`.

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
