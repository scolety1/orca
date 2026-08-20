# TSF Daily Driver + Autonomy Program V1

Persistent program charter. Machine-readable state lives at
[`tsf/programs/daily-driver-autonomy-v1/state.json`](../../tsf/programs/daily-driver-autonomy-v1/state.json)
and is the source of truth for status; this file is the narrative anchor.
**Reread the state file at the start of every milestone.** Do not rely on
conversational memory across sessions.

## Anti-drift anchor

> The owner wants to be able to leave the computer for long periods while TSF
> continues useful, bounded engineering work without drifting from the
> original goal.

This program preserves that goal, executes seven milestones sequentially,
delegates implementation to Orca/Codex workers, independently verifies work,
checkpoints durable state, and continues until all authorized milestones are
complete, a genuine architectural blocker exists, provider/resource budget
requires a durable pause, or a real `TIM_REQUIRED` decision is reached.

## Governing architecture (permanent)

- **TSF** = project intelligence / planner / governance / portfolio / Health
  / autonomy / operator UX.
- **Orca** = execution runtime / worktrees / terminals / sessions / agents /
  browser / orchestration primitives.
- Claude and Codex are providers behind stable TSF roles (`PLANNER_DEEP`,
  `PLANNER_BALANCED`, `WORKER_CHEAP`, `WORKER_BALANCED`, `WORKER_DEEP`,
  `VERIFIER_INDEPENDENT`).
- Implementation hierarchy: existing Orca-native capability → Orca
  supported CLI/API/plugin seam → TSF overlay module → narrow adapter →
  Orca core modification only if absolutely unavoidable.
- **Target Orca core delta across the whole program: 0.**
- Do **not** become `TSF → Zenith → Command Center → Smithers → OpenWeft →
  Orca`. Instead: `TSF intelligence → Orca execution`, harvesting useful
  mechanisms from external projects as documented concepts, not vendored
  runtimes.

## Baseline preflight (Section B) — result: GREEN

Confirmed 2026-08-19:

- `tsf/main` at `C:\TSF_ORCA` is exactly the expected adopted HEAD
  `de105fb4632d7e8a297d824963f931dcd4eb858e` (`feat(tsf): add project
  onboarding v1`).
- This program's working worktree (`scolety1/tsf-autonomy-program-v1` at
  `C:\Users\codex-agent\orca\workspaces\TSF_ORCA\tsf-autonomy-program-v1`)
  branches from that same commit with a clean tree.
- `C:\TSF_V1` exists and remains read-only/reference-only per
  `docs/tsf/FOUNDATION_IDENTITY.md`; not mutated by this program.
- No unrelated real repository is being actively mutated. Prior pilot
  evidence under `tsf/pilots/` targets low-risk local Idea Incubator repos
  only (`colety-labs-sales-engine`, `weird-talent-marketplace`,
  `shopify-catalog-qa`) — none of NWR/HouseOS/EasyLife/Nytheria.
- Existing long-run/autonomy evidence already exists at
  `docs/tsf/TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_RUN_V1.md` +
  `tsf/fixtures/long-autonomous-runtime-v1/`: a fixture-level GREEN proof of
  a persistent planner, real Orca dispatch across four workers, independent
  verification (including false-success rejection), interruption/recovery,
  Work Set new-dispatch gating, and browser proof. It uses a **synthetic
  offline mission board**, not a real project, and has no UI or
  cross-restart durable checkpoint yet. Milestone 2 extends this loop; it
  does not rebuild it.
- Existing capability migration ledger:
  `tsf/migration/capability-migration.v1.json` (111 capabilities tracked;
  `MSN-009/010/011` — Keep Going, pause/resume, bounded retry — are already
  `NEW_TSF_OVERLAY` at fixture-domain level).
- Existing Orca orchestration integration is intentionally thin:
  `tsf/adapters/orca-runtime.mjs` (33 lines) and
  `tsf/adapters/orca-cli-bridge.mjs` (127 lines) project Orca facts into TSF
  state and shape dispatches; they do not duplicate orchestration. Any M2
  work must extend these adapters, not create a parallel engine.

No baseline ambiguity was found, so `TIM_REQUIRED_BASELINE_RECONCILIATION`
was not triggered.

## The seven upgrades

See `state.json` → `originalGoal.sevenUpgrades` for the authoritative list
and `state.json` → `milestones[]` for full acceptance criteria per
milestone. Summary:

| # | Milestone | Status |
|---|---|---|
| M1 | Project Onboarding V1 | `ACCEPTED_PRE_EXISTING` (adopted at `de105fb46` before this program started) |
| M2 | Keep Going / Overnight V1 | `IN_PROGRESS` (wave 9, evening sprint 2026-08-19) — **current, highest priority** |
| M3 | Chat → Dispatch + Live Work Feed | `NOT_STARTED` |
| M4 | Run Journal + Recovery | `NOT_STARTED` |
| M5 | Capacity-Aware Routing | `NOT_STARTED` |
| M6 | Desktop TSF | `NOT_STARTED` |
| M7 | Project Memory V2 | `NOT_STARTED` |

M1 was verified present at the expected baseline HEAD per program Section B
("Verify it, mark it completed in program state, and do not rebuild it")
rather than independently re-verified from scratch by this program.

## Execution discipline

- One milestone actively mutates TSF at a time; bounded tasks within a
  milestone may run in parallel across non-conflicting files/components.
- After every milestone: package an exact immutable candidate, run an
  independent verifier, run full relevant tests, get browser/runtime proof
  where relevant, update `state.json`, then either locally adopt (Section H
  checklist, all 14 conditions) or stop.
- Zenith-style gap loop at the end of every wave: *"What remains between the
  current verified state and the original milestone acceptance criteria?"*
  A worker claiming "done," one passing happy-path test, or code merely
  compiling/rendering is never sufficient to stop.
- Conflict-aware work waves: estimate file/component overlap before
  parallel dispatch; prefer two independent workers over five workers
  editing the same subsystem.
- Windows heavy-install/build concurrency defaults to 1; implementation
  worker concurrency defaults to 2 (3 only when demonstrably
  non-conflicting and host resources are healthy).

## Provider capacity policy (Section G)

Base rule: near a provider's usage limit, prefer cheaper/healthier providers
and generally hold off on starting new `WORKER_*` dispatch on the
constrained one (this is what paused live Codex dispatch through M2 waves
1-2). `state.json` → `providerCapacityStatus` is re-checked live
(`orca account list --json`) before any dispatch decision — never assumed
stale.

**Amendment 2026-08-19 — `EXPIRING_CAPACITY` utilization rule.** The owner
prefers using available provider capacity rather than leaving substantial
capacity unused ahead of a known reset. When a provider is near a known
reset (its account status reports a `resetsAt`/reset window) with
meaningful capacity still remaining:

- Treat the remaining capacity as **expiring inventory**, not something to
  conserve past the reset.
- Preferentially assign it small, bounded, independently useful tasks —
  focused implementation, tests, verifier passes, documentation
  reconciliation, bounded research, fixture work, or isolated repairs.
- Choose only tasks that can reasonably finish and checkpoint before
  exhaustion or reset, whichever comes first.
- Do **not** start a large critical-path task likely to be stranded
  mid-flight merely to consume capacity, and never manufacture busywork
  just to spend tokens — if no useful bounded work exists, leave the
  capacity unused.
- Keep a small safety reserve sufficient to finish, fence, and checkpoint
  whatever is currently in flight.
- As the reset approaches, progressively shrink the size of newly assigned
  tasks.
- Once usable capacity is effectively exhausted, checkpoint normally and
  wait for reset or switch providers — do not force further dispatch.
- Immediately after reset, reassess live capacity and restore the normal
  worker budget/concurrency for that provider.

Machine-readable form: `state.json` → `capacityPolicy.expiringCapacityRule`.
Future Overnight runs must consult it automatically before every dispatch
decision near a known reset, not just at the wave this was written.

## Local adoption pre-authorization (Section H)

For `TSF_ORCA` only, a completed milestone may be locally adopted into
`tsf/main` via `git merge --ff-only` **without asking again** only if every
condition in program Section H holds (immutable candidate, ff-only ancestor,
independent verifier GREEN, acceptance criteria pass, full test/typecheck/
build/diff gates pass, no unrelated dirty files, Orca core delta 0, no paid
dependency, no credentials, no push/PR/deploy/publish, within already-
approved architecture, previous HEAD recorded for rollback, adoption receipt
recorded). Any failed condition returns `TIM_REQUIRED` or the relevant
blocker instead of auto-adopting.

## Hard stop conditions (Section I)

Stop and report rather than push through if: Orca core modification looks
necessary; a real project repo would need mutation for TSF proof; canonical
source becomes ambiguous; destructive cleanup looks necessary; unexplained
dirty files appear; another orchestration foundation looks necessary;
provider auth becomes uncertain; test failures can't be confidently
attributed; a verifier finds a genuine architecture/safety flaw; Windows
process/resource state becomes unsafe; credentials/money/production/
publication would be required; a genuine product preference decision is
needed from Tim.

## Source harvest ledger

To be created at `docs/tsf/SOURCE_HARVEST_LEDGER_V1.md` alongside M2
implementation (Zenith/Command Center/Smithers concepts feed M2 directly;
OpenWeft feeds conflict-aware batching; Hindsight is evaluated later as
`OPTIONAL_MEMORY_BACKEND` for M7 only). Concepts are adapted into native TSF
code using existing Orca primitives — no runtime vendoring — per program
Section D.

## Evening sprint 2026-08-19 (Section see `state.json` → `executionWindow`)

Tim set a hard operator-return time of 11:20 PM local (coincides with the
Codex weekly reset) and asked for continued autonomous work toward M2
completion, with RETURN_HANDOFF triggering at ~11:05 PM. Waves 4-9 that
evening delivered: a domain+adapter-level dogfood fixture proving the
Keep Going loop end to end; the server controller + 4 HTTP routes; a
browser-proven UI (Start/Pause/Resume, goal/Usage-Mode/budget/
constraints/stop-conditions form, live phase/gap/worker/retry/verifier/
NeedsYou/ReadyForAdoption display); the program's first live Codex
dispatch (wave 3, via the new `EXPIRING_CAPACITY` policy — see
`state.json` → `capacityPolicy.expiringCapacityRule`); and two
independent code-review passes (the first fully completed, all 6
findings addressed; the second partial after its coordinator hit a
Claude session-usage limit, 1 of 8 finder-angle sub-agents finished and
returned 4 more findings, 2 fixed, 2 documented as legitimate but
too-large-for-the-window architectural gaps). Full detail, including an
honest scope note on what M2 still needs (an autonomous wave-dispatch
loop and a combined live-Orca dogfood mission), is in `state.json` →
`milestones[M2].waves[]`.

## Next safe action

See `state.json` → `nextSafeAction` for the machine-readable current
value. As of the wave-9 checkpoint: the autonomous wave-dispatch loop
(so a UI-started run actually progresses through waves on its own) is
the largest remaining M2 gap, deliberately not attempted during the
evening sprint (it needs an async job-execution architecture this
program judged too large a new surface to safely land and verify before
the cutoff). The combined live-Orca dogfood mission is blocked until
Codex's weekly reset, which coincides with the hard cutoff itself, so it
cannot happen before Tim returns regardless of remaining time tonight.
