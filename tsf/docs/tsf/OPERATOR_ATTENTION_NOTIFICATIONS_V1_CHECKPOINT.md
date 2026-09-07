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
| 2 (Fleet-Wide Aggregation) | IN_PROGRESS | Design locked, Wave 1 dispatched |
| 3 (Command) | NOT_STARTED | Wave 2 |
| 4 (Operator UI) | NOT_STARTED | Wave 2/3 |
| 5 (Notification Contract) | IN_PROGRESS | Design locked, Wave 1 dispatched (extends completion-watch's own real precedent) |
| 6 (Delivery Capability) | NOT_STARTED | Reconciliation below already determines the honest answer |
| 7 (Restart/Duplicate Safety) | IN_PROGRESS | Required as part of Wave 1's own test proof |
| 8 (Dogfood) | NOT_STARTED | Final wave, coordinator-run |

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

## Next intended action

Dispatch Wave 1 (domain + server layer only: Phase 2 aggregator, Phase 5
event contract + store + reconciler, Phase 7 restart/dedup tests). Wave 2
covers Phase 3 (Command) + Phase 4 (UI) once Wave 1 is adopted. Phase 8
(dogfood) run by the coordinator directly at the end, same discipline as
the Controlled Live Pilot's own Phase 1 sweep.
