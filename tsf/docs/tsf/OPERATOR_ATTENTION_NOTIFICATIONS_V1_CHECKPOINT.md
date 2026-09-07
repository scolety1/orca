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
| 3 (Command) | IN_PROGRESS | Wave 2 dispatched |
| 4 (Operator UI) | IN_PROGRESS | Wave 2 dispatched |
| 5 (Notification Contract) | DONE | `attention-notification-event.mjs` + store + reconciler adopted at `5bde77ec8e`; `attachDueAttentionNotices` wiring into `http-server.mjs` is Wave 2's job |
| 6 (Delivery Capability) | DONE (design) | See locked verdict below; UI polling delivery wired in Wave 2 |
| 7 (Restart/Duplicate Safety) | DONE | 5 required proofs in `attention-status-reconciler.test.mjs`, independently re-run by coordinator |
| 8 (Dogfood) | NOT_STARTED | Final wave, coordinator-run |

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

## Next intended action

Wave 1 adopted. Wave 2 (Command + HTTP route + UI) dispatched per the
design above. Phase 8 (dogfood) run by the coordinator directly at the
end, same discipline as the Controlled Live Pilot's own Phase 1 sweep.
