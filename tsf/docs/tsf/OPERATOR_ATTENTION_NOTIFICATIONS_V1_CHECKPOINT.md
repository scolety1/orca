# TSF — Operator Attention + Proactive Notifications V1 — Durable Checkpoint

Owner directive: close the remaining operator-attention gaps so Tim does not
need to manually visit projects/sessions to discover something needs him,
finished, failed, is waiting on resources, or is ready for adoption.
Explicit: reconcile before build (do not create a second truth store if
existing durable states can be projected into a unified view); do not touch
NWR; do not enable autonomous self-improvement adoption; do not activate
Cleanup V1 real authority; no deploy; no spend.

## Baseline

- Canonical `tsf/main` SHA: `286067155a525ffc1ff12a55ec781838e32b2b83`
  (includes the Native Self-Improvement Controlled Live Pilot V1's own
  adopted work -- 195/195 real detector tests pass, 0 real findings, the
  new read-only `command-self-improvement-bridge.mjs`)
- Working tree: clean
- Worktree: `operator-attention-notifications-v1`
  (`tsf/feature/operator-attention-notifications-v1`), `node_modules`
  junctioned at both repo root (827 entries) and `tsf/ui/` (141 entries --
  `tsf/ui` has its own separate `node_modules`, same pattern as every
  prior mission this engagement)

## Hard constraints (verbatim, must be preserved)

Do not touch NWR. Do not enable autonomous self-improvement adoption. Do
not activate Cleanup V1 real authority. Do not deploy. Do not spend money.
Do not create a noisy polling architecture if event-driven/durable
mechanisms already exist. Do not create a second attention-truth store if
existing durable states can be projected into a unified view. Do not
create notification clutter for informational low-value events (every
worker completion, every retry, every minor state change, routine test
passes are explicitly NOT notify-worthy). Do not infer urgency from
session age alone. Sleep is not a reason for an item to appear in the
attention view by itself. Do not create a new top-level UI subsystem
unless genuinely necessary -- reconcile existing HQ/Work/Projects/Command
Dock surfaces first.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 (Attention-State Inventory) | DONE | Real read-only sweep, see reconciliation below |
| 2 (Fleet-Wide Aggregation) | DONE | Wave 1 adopted at `5bde77ec8e`, 42/42 new + 49/49 regression independently re-verified by coordinator |
| 3 (Command) | DONE | Wave 2 adopted at `7ee0958850`, independently re-verified |
| 4 (Operator UI) | DONE | Wave 2 adopted; 2 disclosed bounded residual gaps, see adoption record |
| 5 (Notification Contract) | DONE | `attention-notification-event.mjs` + store + reconciler adopted at `5bde77ec8e`; `attachDueAttentionNotices` wiring into `http-server.mjs` is Wave 2's job |
| 6 (Delivery Capability) | DONE (design) | See locked verdict below; UI polling delivery wired in Wave 2 |
| 7 (Restart/Duplicate Safety) | DONE | 5 required proofs in `attention-status-reconciler.test.mjs`, independently re-run by coordinator |
| 8 (Dogfood) | DONE | Coordinator-run, real seeded durable state, see below |

## Wave 1 adoption record

Coordinator independently verified before merging (not trusting the
implementing agent's own report): read `fleet-attention-status.mjs`,
`attention-notification-event.mjs`, `attention-status-reconciler.mjs`,
`attention-notification-event-store.mjs` in full; cross-checked every real
field-name assumption against the actual source (`raisedAt` on
PROJECT/RESEARCH needsYou entries, `at` on PLANNER entries,
`buildResourcePressureState`'s real `observedAt`/`admission` fields,
`readAllResearchMissions`/`readAllPlannerMissionRecords`/`projectsById`
all confirmed to exist with the exact names used) -- zero fabricated
imports or field names found. Re-ran all 42 new tests (42/42) and 49
regression tests across `fleet-work-status`/`work-feed-summary`/
`command-research-completion-watch`/`self-improvement-finding-store`
(49/49) myself. `npx oxlint` clean on every touched/new file. Merged
`--ff-only` into canonical `tsf/main` at `5bde77ec8e`, pushed to
`fork/tsf/main`.

## Phase 1: reconciliation (REUSE/EXTEND/NEW/REJECT)

Full inventory evidence omitted here (captured in the dispatched agent's
own report, not re-transcribed) -- decisions only:

- **`fleetNeedsYouStatus`** (`tsf/domain/fleet-work-status.mjs`) is the
  ONE existing cross-cutting attention aggregator (PROJECT/RESEARCH/
  PLANNER `needsYou[]` only). REUSE verbatim as one input, do not modify
  its narrow contract.
- **`summarizeWorkFromRuns`** (`tsf/domain/work-feed-summary.mjs`) already
  buckets `needsYou/stalled/blocked/readyForAdoption/recentlyCompleted`
  for projects+research. REUSE its output as further inputs (stalled ->
  FAILED_REQUIRES_ATTENTION, blocked -> BLOCKED_EXTERNAL, readyForAdoption
  and recentlyCompleted feed directly).
- **Self-improvement findings** (`NEEDS_OWNER`/`READY_FOR_ADOPTION`) are
  READ (via `readAllFindings`) but currently invisible to every fleet-wide
  surface (only reachable via chat through
  `command-self-improvement-bridge.mjs`). REUSE the store, EXTEND
  visibility into the new aggregator. Split by transition reason (already
  established in that bridge): `AUTOFIX_ELIGIBILITY_CLASSIFIED` ->
  NEEDS_OWNER, `REPAIR_RETRY_BUDGET_EXCEEDED` -> FAILED_REQUIRES_ATTENTION
  (a real repair was attempted and genuinely failed, distinct from "never
  attempted, needs a human call").
- **Resource pressure**: NO durable per-mission "waiting" signal exists
  anywhere (disclosed gap, confirmed in two independent places in the
  codebase's own comments). REJECT fabricating a per-mission wait list.
  Honest scope: surface ONE host-wide `WAITING_FOR_RESOURCES` item only
  when the live tier is CRITICAL/EMERGENCY, sourced directly from
  `buildResourcePressureState`, never a synthetic per-mission entry.
- **Cleanup V1 quarantine `requiresOwnerReview`**: real gap (no aggregate
  scanner exists), but Cleanup V1 real destructive authority is disabled
  for this whole engagement and this mission's own DO NOT list forbids
  activating it -- REJECT building a quarantine-directory scanner this
  pass; out of bounded scope, would touch Cleanup V1 surface for a
  authority level that stays off regardless.
- **Provider failures**: not a durable category anywhere (only transient
  call-result reason codes, absorbed into whichever run/mission checkpoint
  recorded the failure). REJECT inventing a new durable ledger for this;
  a Keep Going run's own STALLED/DISPATCH_FAILED checkpoint already
  becomes visible via the FAILED_REQUIRES_ATTENTION mapping above -- that
  IS the real, existing signal.
- **UI Dogfood findings**: ephemeral, per-chat-turn only, never durable.
  REJECT surfacing these in the durable attention view as-is (nothing
  durable to project). Left as documented, disclosed scope (matches the
  Controlled Live Pilot's own finding that `recordFindingDetection` has
  no production caller yet -- a real, separate, future wiring gap, not
  this mission's to close).
- **Notification delivery**: `tsf/domain/completion-watch.mjs` +
  `tsf/server/completion-watch-reconciler.mjs` is the ONE existing
  precedent for "durable event -> delivered on Tim's next chat turn,"
  and its own header states plainly TSF has no push channel (no OS/SSE/
  webhook). Orca-core's real `Notification(...)` pipeline exists
  (`src/main/...`) but is outside TSF's own worktree boundary (TSF's own
  docs: "must never write to Orca-core directly") and even its existing
  terminal-completion title-propagation from TSF has a disclosed,
  unfixed gap (`tsf/docs/reference/bug-07-orca-core-notification-
  followup.md`, status "proposal, not implemented"). EXTEND
  completion-watch's exact PENDING/FIRED_UNSEEN/DELIVERED shape and
  chat-attach mechanism generically (new module, not a modified one --
  a completion-watch is "please tell me when X finishes," opt-in per
  target; the new concept is "X just transitioned into a notify-worthy
  state," automatic and fleet-wide -- different enough to warrant its own
  domain module, same reused delivery mechanism). REJECT inventing a
  second delivery pipeline; REJECT claiming true OS-level push exists.

## Phase 5/6 design (locked before Wave 1 dispatch)

- New domain module `tsf/domain/attention-notification-event.mjs`:
  content-addressed `eventId` (mirrors `self-improvement-finding.mjs`'s
  `findingIdFor` -- sha256 of `{category, sourceKind, sourceId,
  transitionSignature}`), 2-state lifecycle `UNSEEN -> DELIVERED`
  (simpler than completion-watch's 3-state: detection here IS the firing,
  there is no "pending future watch" phase).
- New server store `tsf/server/attention-notification-event-store.mjs`:
  CAS store mirroring `completion-watch-store.mjs` exactly (same
  `cross-process-file-lock.mjs` + `data-store.mjs` opState pattern, new
  `attentionNotificationEvents` key), registered in
  `research-schema-versioning.mjs` as
  `TSF_ATTENTION_NOTIFICATION_EVENT_V1`.
- New reconciler `tsf/server/attention-status-reconciler.mjs`: calls
  Phase 2's `buildFleetAttentionItems` fresh each time (lazy, on every
  chat turn -- no new background scheduler, matching completion-watch-
  reconciler.mjs's own stated principle), creates a durable UNSEEN event
  for each qualifying item whose content-addressed id was not already
  recorded (this is what makes restart/duplicate-cycle re-observation
  safe -- re-seeing the same live item is a true no-op, not a re-fire).
  Notify-worthy transitions only (per the mission's own list): NEEDS_OWNER
  newly created, READY_FOR_ADOPTION newly reached, FAILED_REQUIRES_
  ATTENTION newly reached, COMPLETED_RECENTLY for a real Keep Going run or
  ResearchMission reaching COMPLETE (not legacy static-adoption
  entries -- those are operator-driven, Tim already knows), and
  WAITING_FOR_RESOURCES onset (tier enters CRITICAL/EMERGENCY). Resource-
  wait "clears" notification is explicitly OUT of this pass's scope
  (would need a durable previous-tier tracker this codebase does not have
  yet) -- the live Phase 2 aggregator still stops showing the item once
  healthy, which is the honest, bounded behavior; only the proactive
  *notification* of the recovery is deferred.
- `attachDueAttentionNotices` mirrors `attachDueCompletionNotices` exactly
  and is wired at the SAME `http-server.mjs` call sites, alongside (not
  replacing) the existing one.
- **Phase 6 verdict (locked)**: `EVENT_GENERATION_GREEN` -- durable,
  deduped, restart-safe notification events, generated automatically.
  Two real delivery mechanisms TSF owns end-to-end: (1) chat-attached
  notice on Tim's next message (extends the proven completion-watch
  pattern), (2) in-app polling-driven UI indicator (the existing
  `GlobalRunStatusIndicator`/`HQPage` pattern, extended to read the new
  aggregator). True OS-level push while Orca is closed/backgrounded is
  `DELIVERY_CHANNEL_EXTERNAL_GATE` -- owned by Orca-core, outside TSF's
  boundary, not wired this pass.

## Wave 2 design (locked before dispatch)

- **HTTP**: new `GET /api/attention` route (`tsf/server/attention-http-
  routes.mjs`, mirrors `resource-pressure-governor-http-routes.mjs`'s
  `handleXxxRoute(parts, req, res, ctx, helpers)` shape, registered in
  `http-server.mjs` alongside the other route handlers), returning
  `{ ok: true, items: buildFleetAttentionItems(...) }` built from real
  server-side reads (same real-deps pattern `attention-status-
  reconciler.mjs`'s `gatherRealDeps` already established -- reuse it, do
  not re-derive).
- **Command, "What needs me?"**: surgical extension, not a new intent --
  `command-responder.mjs`'s existing `NEEDS_YOU_QUERY` handler
  (~line 539) swaps its data source from bare `fleetNeedsYouStatus(...)`
  to `buildFleetAttentionItems(...).filter(i => i.category ===
  'NEEDS_OWNER')`, a strict superset (adds self-improvement eligibility-
  declined findings). Text/deep-link shape stays compatible.
- **Command, "What is ready for adoption?"**: surgical extension of
  `command-self-improvement-bridge.mjs`'s existing
  `SELF_IMPROVEMENT_READY_FOR_ADOPTION` handler only -- swap its data
  source from `readAllFindings()`-filtered to
  `buildFleetAttentionItems(...).filter(i => i.category ===
  'READY_FOR_ADOPTION')` (self-improvement findings are already one input
  to that bucket, so this is a superset covering project-level adoption
  candidates too). Do not touch the other 5 intents in that file, do not
  rename it -- this is a one-function-body change.
- **Command, 4 new questions**: NEW `tsf/server/command-fleet-attention-
  bridge.mjs` (mirrors `command-self-improvement-bridge.mjs`'s shape
  exactly), covering only what nothing existing already answers:
  "What finished?" (COMPLETED_RECENTLY), "What is waiting on resources?"
  (WAITING_FOR_RESOURCES), "What failed today?" (FAILED_REQUIRES_ATTENTION,
  bounded to items whose `changedAt` falls within the current day --
  real bound, not a fabricated one), "Did anything change while I was
  gone?" (calls `drainDueAttentionNotifications` on demand rather than
  waiting for the next unrelated chat turn -- same underlying mechanism,
  explicit query). Wired into `command-responder.mjs` at the same early
  message-shaped-bridge layer, checked so it never shadows the two
  surgical extensions above (their own bridges/handlers are checked
  first in the existing call order).
- **Notification delivery wiring**: `attachDueAttentionNotices` (already
  built, Wave 1) gets wired into `http-server.mjs` at the SAME `POST
  /api/chat` call sites `attachDueCompletionNotices` already uses,
  alongside it (both run, neither replaces the other).
- **UI**: extend the existing global indicator
  (`GlobalRunStatusIndicator.tsx`) and Home's needs-you tile
  (`home-needs-you-items.ts`/`HQPage.tsx`) to also read `GET /api/attention`
  and merge in items `buildGlobalRunStatusItems` structurally cannot
  produce (self-improvement/resource-pressure items have no
  `liveWorkFeed`) -- same trigger button, same dialog, extended content;
  no new top-level subsystem. Real deep links via each item's own
  `deepLink` field. Must follow `docs/STYLEGUIDE.md` tokens exactly and be
  validated via the `$electron` skill + Playwright CDP per `AGENTS.md`
  (never computer-use for this).

## Wave 2 adoption record

Coordinator independently verified before merging: read every diff in
full (`attention-http-routes.mjs`, `command-fleet-attention-bridge.mjs`,
the surgical `NEEDS_YOU_QUERY`/`SELF_IMPROVEMENT_READY_FOR_ADOPTION`
extensions, `http-server.mjs`'s wiring, and every touched UI file --
`global-run-status.ts`, `GlobalRunStatusIndicator.tsx`,
`home-needs-you-items.ts`, `HQPage.tsx`, `work-feed-lookup.ts`, `types.ts`,
`api.ts`, `use-api.ts`). Re-ran every new/touched test file myself: 16
new server tests + 73 across the surgically-extended command files + 42
Wave 1 regression (all still pass after the reconciler's small
`gatherRealDeps`/`gatherRealFleetAttentionInputs` split) + full `tsf/test`
suite (2747/2754 -- the 6 failures reproduced identically in files this
wave never touched; 2 re-run in full isolation, `operator-state-
adversarial.test.mjs` 9/9 and `command-adversarial-corpus.test.mjs` 37/37,
confirming shared-host timing contention, not a regression, consistent
with 15 concurrent peer sessions observed on this box at verification
time). UI: `tsc -b --noEmit` clean, `npm test` 113/113.

Verified the `use-api.ts` `reload` identity-instability fix is genuinely
pre-existing (checked out Wave 1's own baseline `HQPage.tsx` and confirmed
its `reloadAll` useCallback already composed `reloadPortfolio`/`reloadWork`
the same way before Wave 2 touched anything) -- not introduced by this
wave, correctly disclosed rather than silently folded in.

**Coordinator fix during review**: `command-self-improvement-bridge.mjs`'s
`SELF_IMPROVEMENT_READY_FOR_ADOPTION` response caption previously claimed
"adoption gate is closed" for every listed item, but now also lists
project-level Keep Going adoption candidates, which are never subject to
the self-improvement adoption gate (a separate, unrelated authority) --
overclaiming why nothing was auto-merged. Reworded to attribute each kind
correctly; updated the 2 test assertions that matched the old literal
string; re-verified 7/7 still pass.

**Disclosed, bounded residual gaps** (not blocking, honestly documented
rather than silently left implicit):
1. A Planner Context Lifecycle `needsYou` item is a real `NEEDS_OWNER`
   attention item (visible via Command's "what needs me?", now correctly
   extended) but is NOT yet merged into `GlobalRunStatusIndicator`/HQ's
   Needs You tile -- `selectExtraAttentionItems`/
   `buildSelfImprovementNeedsYouItems` only cover self-improvement findings
   and resource pressure (the coordinator's own Wave 2 design spec did not
   name planner items as a UI target). Low severity: planner missions are
   an internal surface, and the item is not invisible -- only absent from
   the one UI surface, still answerable via chat.
2. `http-server.mjs` was already 11 lines over the 600-line `max-lines`
   budget before this mission (611 lines, confirmed via isolated lint of
   the pre-Wave-2 commit); Wave 2's 5-line wiring addition brings it to
   616. Per `AGENTS.md`, no disable/bump was added (correct) -- the
   underlying file deserves a real split, out of this mission's scope.

Merged `--ff-only` into canonical `tsf/main`, pushed to `fork/tsf/main`.

## Phase 8: dogfood (coordinator-run directly)

Ran a disposable Node script (mirroring the Controlled Live Pilot's own
Phase 1 direct-execution discipline; the codex-blind-probe.mjs pattern
used earlier this engagement) against an isolated `TSF_UI_STATE_FILE`,
using ONLY real domain constructors and real store writes -- never
hand-typed durable records:

- Seeded 3 real self-improvement findings via `createFinding`/
  `transitionFinding`/`applyAutofixEligibility` + `withFinding`: one
  `NEEDS_OWNER` (eligibility-declined, low confidence), one
  `NEEDS_OWNER`/`REPAIR_RETRY_BUDGET_EXCEEDED` (a real failed repair
  attempt), one `READY_FOR_ADOPTION` (full FIX_MISSION_CREATED ->
  FIX_IN_PROGRESS -> READY_FOR_ADOPTION path).
- Seeded one real `ResearchMission` reaching `COMPLETE` via
  `createResearchMission`/`completeResearchMission` +
  `withResearchMission` -- the currently-reachable `COMPLETED_RECENTLY`
  source (a Keep Going run's own `COMPLETED` feed state is a pre-existing,
  disclosed, not-yet-reachable path per `work-feed-summary.mjs`'s own
  header -- not fabricated here to force a result).
- Called `buildFleetAttentionItems(gatherRealDeps(clock))` (the real
  `GET /api/attention` path) -- all 4 seeded categories present with
  correct `deepLink`s; also picked up a genuinely pre-existing real
  project's own `READY_FOR_ADOPTION` candidate already in this
  environment's project catalog (not seeded by this script), confirming
  the aggregator reads real, unmediated production state, not only what
  this dogfood pass injected.
- Called the real `handleAttentionRoute` HTTP handler directly -> 200,
  `{ ok: true, items: [...6 items] }`.
- Called `respondSelfImprovementCommand`/`respondFleetAttentionCommand`
  with NO injected deps (real store reads) for "what is ready for
  adoption?" / "what finished?" / "what failed today?" -- each answer
  correctly named the real seeded record.
- `reconcileFleetAttentionItems` twice: first call registered 5 new
  events (the 5 notify-worthy categories), second call against
  unchanged state registered exactly 0 -- dedup confirmed against real
  persisted state, not a mocked store.
- "Did anything change while I was gone?" drained the 5 real notices
  once, then honestly reported "Nothing changed while you were away." on
  a second call -- no duplicate delivery.
- Cleaned up: disposable script deleted, isolated state file removed,
  `git status` confirmed clean.

**Honest scope note**: `WAITING_FOR_RESOURCES` was validated via Wave
1/2's own deps-injected test suites (real domain logic, injected tier),
not a live-induced CRITICAL host-memory event -- deliberately not forced
on this shared, already-contended host (would risk destabilizing the 15
other concurrent peer sessions observed on this box). The mechanism is
identical either way (same `buildFleetAttentionItems`/`transitionSignatureFor`
code path, tier-driven, no special-cased branch for tests vs. production).

## Next intended action

None remaining for this mission. Final report delivered to the user.
