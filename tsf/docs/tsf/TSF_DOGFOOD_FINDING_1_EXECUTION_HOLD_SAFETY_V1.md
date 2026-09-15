# TSF Dogfood Finding 1 — Execution Hold Safety V1

Real, narrowly-authorized safety fix for `TSF_REAL_OWNER_UI_DOGFOOD_ROUND_1`
Finding 1 (2026-09-15), discovered reading `niners-war-room`'s own Planner
Chat history: repeated attempts to have TSF release the real NWR execution
hold and take over autonomous ownership, each declined only because they
got misrouted to a Dataset-Research-only planner role — never because
anything actually checked the hold.

## What was verified vs. what was actually fixed

**Already correct, verified by reading the code (not assumed):**

- `tickKeepGoingRun` (`server/keep-going-dispatch-loop.mjs`) — the one real
  choke point every heavyweight-worker dispatch caller funnels through —
  already checked the hold before dispatching a wave, gated once at the
  lowest shared boundary per an earlier, unrelated hardening pass.
- `chat-dispatch-bridge.mjs`'s `planAndDispatchFromChat` and
  `chat-http-routes.mjs`'s `dispatchFromChat` both already checked the hold
  early, before any real side effect (worktree provisioning, live planner
  call).
- `RELEASE_HOLD`'s own chat trigger (`domain/command-act-model.mjs`) is a
  narrow, specific regex (`is being handled by another AI/agent/process`,
  `leave it alone`, `hold off`) — a generic "continue"/"take over" message
  can never match it and accidentally release a hold.
- `live-planner.mjs`'s conversational fallback (what most of the real NWR
  incident's messages actually hit, confirmed via `classifyIntent` — they
  all classify `GENERAL`) invokes its CLI with `--tools ""`: zero ability
  to edit/run/adopt/merge/push/deploy, pure text generation. Structurally
  incapable of executing anything, regardless of what it says or which
  role it identifies as.
- `keep-going-fleet-driver.mjs`'s autonomous heartbeat already has its own
  hold checks before both its settle and continuation-dispatch paths.
- Self-improvement repair adoption/dispatch (`self-improvement-adoption.mjs`,
  `self-improvement-repair-cycle.mjs`) already check the hold.

**The real gap, found by tracing every real caller down to the domain
layer:** `startKeepGoingRun`, `resumeKeepGoingRun`, and
`abandonKeepGoingStalledWave` (`server/keep-going-controller.mjs`) had NO
hold awareness at all. All three make a run ACTIVE (tickable) again —
real, if administrative, project-mutating state — exactly what the hold's
own meaning ("must not begin or resume execution") forbids, even though
the *next* tick would always have been refused. Confirmed live-reachable,
not theoretical: `chat-http-routes.mjs`'s `classifyRunActionVerb`
recognizes plain phrases like "Resume work." and "Continue the overnight
product advance." as `RESUME`, routing through the canonical
`action-executor.mjs` into `command-run-action-bridge.mjs`'s
`resumeProjectRun` — a real, ordinary-language path to
`resumeKeepGoingRun`. A held project's paused run genuinely resumed end to
end over the real `/api/chat` route before this fix (proven via mutation
testing against the new regression suite, not assumed).

A second, structural gap compounded it: even after adding the hold-aware
gate to `keep-going-controller.mjs`, three separate call sites
(`keep-going-http-routes.mjs`'s `mutateThroughStore`,
`command-run-action-bridge.mjs`'s own duplicate of the same helper, and
`keep-going-dispatch-loop.mjs`'s `abandonAndReconcileStalledWave`) each
built a deliberately minimal "fake opState" containing only
`keepGoingRuns` — so the new gate would have silently seen
`projectExecutionHolds` as `undefined` and never fired for any real
request. All three now thread a fresh `readProjectExecutionHold` read
through.

## Fix

`server/keep-going-controller.mjs`: a new `assertProjectNotHeld(opState,
projectId, verb)` helper, called at the top of `startKeepGoingRun` and
(after existence checks) `resumeKeepGoingRun`/`abandonKeepGoingStalledWave`.
Reads `opState.projectExecutionHolds[projectId]` directly (no new I/O) —
every caller that passes a real opState is protected automatically.
`pauseKeepGoingRun` is deliberately **not** gated: pausing only ever
reduces activity, never begins or resumes it, so a hold must never block
it (verified with a dedicated regression test).

Four call sites fixed to thread a real, fresh hold read into their own
"fake opState": `keep-going-http-routes.mjs`'s `mutateThroughStore`,
`command-run-action-bridge.mjs`'s own copy of it (Command's "continue
it"/"resume that" follow-up path — the one that mattered for the real,
reachable "Resume work." scenario), `keep-going-dispatch-loop.mjs`'s
`abandonAndReconcileStalledWave`, and `chat-dispatch-bridge.mjs`'s
`ensureActiveRun` (currently redundant with that function's own earlier
hold check, kept anyway so `startKeepGoingRun`'s own gate is never a
silent no-op if this call site is ever reached a different way).

`abandonAndReconcileStalledWave` and two small placement-collision
helpers (`normalizePlacementPath`/`placementsCollide`) moved to their own
files (`keep-going-stalled-wave-abandon.mjs`,
`keep-going-placement-collision.mjs`) — unchanged logic, purely to stay
under `keep-going-dispatch-loop.mjs`'s own pre-existing max-lines cap
after adding its share of the fix. Zero import-path changes for any
existing caller (re-exported where needed).

## Proof

- `test/keep-going-controller-execution-hold.test.mjs` — domain-level:
  start/resume/abandon refuse a held project, pause never does, a
  `RELEASED` (not `ACTIVE`) hold never blocks anything. Mutation-tested:
  fails against the original code.
- `test/keep-going-http-routes-execution-hold.test.mjs` — the same over
  the real HTTP layer (proves the plumbing fix, not just the domain
  function). Mutation-tested.
- `test/chat-generic-continue-hold-safety.test.mjs` — the actual
  historical-reproduction scenario: the exact phrases from the finding
  ("Take over this project and continue the work.", "Continue the
  overnight product advance.", "Resume work.", etc.) sent to a real held
  project's per-project chat over real HTTP. Mutation-tested against the
  real `/api/chat` route — 3 of the 5 phrases genuinely resumed the held
  project's run before this fix; all 5 are refused/inert after it, the
  hold stays byte-identical throughout.
- Full targeted regression (405 tests: keep-going controller/HTTP routes,
  fleet driver, self-improvement adoption/repair, research mission driver,
  Command multi-action/bare-imperative/dogfood/follow-up, chat-dispatch-
  bridge, project-execution-hold store) — 0 failures.
- Full suite regression (~3579 tests across 6 batches) — every failure
  isolate-reproduced clean; all are the same pre-existing, already-
  documented resource-contention-sensitive tests this session's own prior
  missions already recorded (STALE ACTION RACE timing test, the real
  autonomy-proof test's own 140s stall threshold, and transient
  child-process contention under heavy concurrent batch load) — none in
  any file this fix touched.

## What was deliberately NOT done

- No change to `live-planner.mjs`'s prompt-building to make the live
  planner's own generated text proactively mention an active hold. The
  mission's own safety model treats the execution/dispatch layer as "the
  true backstop" regardless of the interpretation layer's wording — that
  backstop is now solid and proven. Making the LLM's own prose
  hold-aware would mean touching a complex, "adversarially-hardened"
  prompt surface shared by every planner conversation, for a
  communication-quality improvement, not a safety fix. Left as a real,
  disclosed, bounded follow-up if the owner wants it — not attempted
  under a "narrowly-authorized... bounded" mission.
- No UI/redesign work. No real project touched — every mutation in this
  session's own verification ran against disposable fixtures/an isolated
  state file.

## Real NWR state

Read-only throughout. The real `niners-war-room` execution hold was
independently reconfirmed intact before and after this work.
