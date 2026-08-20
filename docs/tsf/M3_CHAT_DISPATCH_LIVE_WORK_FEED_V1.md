# M3 — Chat → Dispatch + Live Work Feed (design v1)

## Why this doc exists

M2 built the real dispatch/supervision engine (`tickKeepGoingRun`, the orchestration
bridge, stall/retry recovery, checkpoints) but the only way to drive it is a raw
"Run now" form requiring an explicit work item id/scope/worktree/agent. Planner
Chat (`chat-responder.mjs` + `live-planner.mjs`) is a real, working conversational
interface — including a genuine live LLM call, project-context capsules, and
session affinity — but it has **zero dispatch capability**. Its own fallback text
says so explicitly: _"I can't dispatch a live Orca worker from this chat yet —
that path (Wave 5 Run/task/dispatch integration) is still pending."_ M3 closes
that gap: chat becomes the front door to M2's dispatch engine, and a Live Work
Feed shows what M2 is actually doing without Tim ever opening an Orca terminal.

## What already exists (reuse, don't rebuild)

- **`tsf/server/chat-responder.mjs`** — deterministic `classifyIntent`/
  `classifyDecision`, a `TIM_REQUIRED_PATTERNS` list already covering push/
  merge/deploy/publish/production, pay/credentials, delete-repo, and adopt/
  approve. This is the authority gate M3 must extend, never bypass.
- **`tsf/server/live-planner.mjs`** — `invokeLivePlanner` (real, live,
  zero-tool `--tools ""` conversational planner call with session affinity)
  and `invokeLiveStructuredAnalysis` (one-shot, JSON-schema-validated
  structured output — already used by onboarding's direction analysis). M3's
  "have the planner create a bounded implementation plan" reuses
  `invokeLiveStructuredAnalysis`, not a new provider-invocation path.
- **`tsf/contracts/plan-capsule.schema.v1.json`** (`TSF_PLAN_CAPSULE_V1`) — an
  already-designed, already-validated schema for exactly a bounded mission
  plan (objective, allowedScope, constraints, prohibitedActions,
  acceptanceCriteria, requiredTests, stopConditions). Reused as the planner's
  structured-output schema for M3, not reinvented. (`tsf/domain/coordinator.mjs`
  and the fixture-level dogfood system already consume this shape, but that
  consumer is fixture/simulation-only — M3's consumer is the real M2 engine.)
- **`tsf/server/keep-going-controller.mjs` / `keep-going-dispatch-loop.mjs` /
  `keep-going-http-routes.mjs`** — the real, adopted M2 engine: `startKeepGoingRun`,
  `tickKeepGoingRun` (dispatch/settle), `abandonAndReconcileStalledWave`,
  retry budget, stall watchdog, checkpoints, `needsYou`. M3 dispatches through
  this, never a second worker loop.
- **UI**: `KeepGoingPanel` and `PlannerChatPanel` are already both mounted on
  `ProjectDetailPage.tsx`, side by side, with zero integration today.

## What does not exist yet (M3's actual work)

1. Chat has no notion of "go ahead and do it" as a dispatch-worthy intent —
   today `FIX_REQUEST`/`CRITIQUE` only offer to _talk about_ drafting a
   mission (`respondCritiqueOrFix`), they never act.
2. Nothing bridges a produced plan-capsule into a Keep Going run's
   `candidateWorkItems` shape (`{id, scope, spec, worktree|workerTerminal,
agent}`).
3. Nothing maps a live Keep Going run's real state into the 9 Live Work Feed
   states Tim specified.
4. No UI Live Work Feed component exists — only `KeepGoingPanel`'s existing
   (already-real, non-fabricated) display.
5. "What is it doing?" (`STATUS`/`NEXT_ACTION` intents) currently answers from
   the _old_ `mission`/`health`/`candidate`/`release` project shape, which has
   no relationship to a project's live Keep Going run.

## Architecture: the Chat Dispatch Bridge

A new module, `tsf/server/chat-dispatch-bridge.mjs`, sits between chat and M2.
It is the **only** new code path that turns a chat message into a real Orca
dispatch — everything downstream of it is unmodified M2.

```
chat message
  → classifyIntent/classifyDecision (existing, extended)
  → TIM_REQUIRED? → refuse deterministically (existing, unchanged, first)
  → DISPATCH-worthy intent + AUTO_DECIDE/RECOMMEND_AND_PROCEED?
      → invokeLiveStructuredAnalysis(plan-capsule schema) using the SAME
        project-context capsule chat already builds
      → planCapsule → candidateWorkItems (pure mapping, new)
      → keepGoingRunFor(project) exists and ACTIVE?
          yes → tickKeepGoingRun(projectId, candidateWorkItems, clock)
          no  → startKeepGoingRun(...) then tickKeepGoingRun(...)
          STALLED → do NOT silently tick (unchanged M2 behavior: tick would
                     NOOP) → surface "stalled, use Abandon stalled wave" the
                     same way the UI already does, not a new recovery path
      → chat response describes what was actually created (task/dispatch ids,
        or the honest reason nothing was, e.g. TIM_REQUIRED / already
        in-flight / stalled)
  → STATUS/NEXT_ACTION intents on a project WITH a live Keep Going run answer
    from projectLiveWorkFeedState(run), not the old mission/candidate shape
  → Needs You: an open needsYou entry is surfaced in the chat response text
    AND in the Live Work Feed, sourced from run.needsYou — never invented
```

### Authority gate (unchanged, extended only in vocabulary)

`classifyDecision`'s `TIM_REQUIRED_PATTERNS` already catches push/merge/
deploy/publish/production, pay/credentials, delete-repo, adopt/approve. M3
adds no new bypass: dispatch only ever happens for `AUTO_DECIDE` (bounded,
reversible, in-scope) or `RECOMMEND_AND_PROCEED` (after the existing
confirm-and-proceed turn), and the plan-capsule's own `prohibitedActions`
field is populated from the SAME forbidden-action list
(`adoption; push/merge; deploy/publication; credentials; money/paid
services; destructive operations; major product-direction decisions`) so a
misbehaving planner call cannot ask for a work item that does any of those —
`chat-dispatch-bridge.mjs` also hard-validates the returned plan-capsule
against `prohibitedActions`-implying content (not just trusting the LLM to
have obeyed its own prompt) before ever calling into Keep Going.

### Live Work Feed state mapping (`tsf/domain/live-work-feed.mjs`, pure, new)

`projectLiveWorkFeedState(run)` derives one of the 9 states from real M2
fields only — no fabrication:

| Feed state         | Derived from                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLANNING           | no Keep Going run yet, or run just started (`waves.length === 0`, no `inFlightWave`)                                                                                              |
| WORKING            | `inFlightWave` present, most recent checkpoint phase `WAVE_DISPATCHED`/`WAVE_DISPATCHED_PARTIAL`                                                                                  |
| WAITING            | `inFlightWave` present, tick claimed but no dispatch yet (`tickLock` active, kind `DISPATCH`)                                                                                     |
| VERIFYING          | a wave settled (`WAVE_SETTLED*`) but `compareStateToGoal`'s gap has unresolved criteria still pending independent verification                                                    |
| STALLED            | `run.state === 'STALLED'`                                                                                                                                                         |
| NEEDS_YOU          | `run.state === 'NEEDS_YOU'` or any open (`!resolvedAt`) `needsYou` entry                                                                                                          |
| REVISION           | a new work item was ticked after a prior wave already reached verified-satisfied for some criteria (a correction cycle)                                                           |
| READY_FOR_ADOPTION | `compareStateToGoal(run, ...).decision === 'STOP_COMPLETE'` and `run.state === 'COMPLETE'` but adoption itself has not yet happened (mirrors `KeepGoingRunView.readyForAdoption`) |
| COMPLETED          | `run.state === 'COMPLETE'` and already adopted (out of this project's scope until an adoption record exists)                                                                      |

This function is pure and unit-testable exactly like `compareStateToGoal`
itself — no I/O, no fabrication, every branch traceable to a real field.

### UI: Live Work Feed component

A new `tsf/ui/src/components/keep-going/LiveWorkFeed.tsx`, reading the same
`KeepGoingRunView` the existing panel already fetches (no new endpoint
needed for the state itself) plus `openNeedsYou` — rendered as a compact
timeline/status strip above or beside `PlannerChatPanel`, with a
"drill down / Open in Orca" affordance (deep link using the run's
`orchestrationRunId`, matching what the independent-verifier read-only CLI
calls throughout M2 already prove is inspectable) for raw technical detail.
Tim should not need this for normal use.

## Fixture / dogfood proof plan

Per Tim's explicit instruction: a safe fixture project, not NWR/HouseOS/
EasyLife/Worldforge. `tsf-ui-capability-check` (already used throughout M2's
own HTTP tests and manual acceptance) is the natural choice — low-risk,
already fenced, already has an established recovery history.

Primary proof: type a natural-language request in that fixture project's
chat ("build a bounded doc-file addition" or similar low-risk, read/write-once
task) → confirm a real plan-capsule was produced → confirm a real Keep Going
run/task/dispatch was created (independent read-only Orca CLI verification,
same discipline as every M2 wave) → confirm the Live Work Feed shows real,
non-fabricated states as the wave progresses → confirm independent
verification occurs before `READY_FOR_ADOPTION` is claimed.

Also prove (per Tim's checklist): follow-up "what is it doing?" returns real
state; a worker question surfaces as Needs You; a revision request via chat
produces a bounded follow-up wave; switching the selected project shows only
that project's own run (never another project's); a stalled/failed worker
reuses `abandonAndReconcileStalledWave`, not a new path; no duplicate
dispatch (inherits `tickKeepGoingRun`'s existing tick-lock/stale-routing
guards, unmodified); authority interception still refuses TIM_REQUIRED
phrasing before any dispatch is attempted.

## Rollout waves (bounded, tested, reviewed — matching M2's own discipline)

1. **This wave**: design doc (this file) + `tsf/domain/live-work-feed.mjs`
   (pure state-mapping) + chat intent-classification extension, both with
   unit tests. No HTTP/UI wiring yet.
2. Plan-capsule → candidateWorkItems mapping (pure, tested) +
   `chat-dispatch-bridge.mjs`'s core function (stub/fake-store tested,
   matching M2's own established test methodology — no live orca CLI calls
   in unit tests).
3. HTTP wiring: extend `POST /api/chat` to call the bridge for dispatch-worthy
   messages; keep every existing chat behavior (STATUS/HEALTH/etc. on
   projects without a live run) unchanged.
4. UI: `LiveWorkFeed.tsx`, wired into `ProjectDetailPage.tsx` alongside the
   existing panels.
5. Independent review of waves 2-4 together (matching M2's per-change review
   discipline).
6. Live fixture dogfood proof (the primary proof above) + all "also prove"
   items, with read-only independent verification throughout.
7. Independent review of the live proof's evidence.
8. Package as immutable candidate, fresh independent verifier, local
   ff-only adoption if every Section H condition holds — same procedure M2
   just went through.

Orca core delta remains 0 throughout (TSF-only files). No mutation of NWR,
HouseOS, EasyLife, Worldforge, or any other real repo for M3 proof.
