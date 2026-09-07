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
| 1 (Attention-State Inventory) | IN_PROGRESS | Dispatched real read-only Explore sweep across all 11 named categories + cross-cutting/UI/notification search |
| 2 (Fleet-Wide Aggregation) | NOT_STARTED | |
| 3 (Command) | NOT_STARTED | |
| 4 (Operator UI) | NOT_STARTED | |
| 5 (Notification Contract) | NOT_STARTED | |
| 6 (Delivery Capability) | NOT_STARTED | |
| 7 (Restart/Duplicate Safety) | NOT_STARTED | |
| 8 (Dogfood) | NOT_STARTED | |

## Next intended action

Await Phase 1 inventory result, reconcile against it (REUSE/EXTEND/NEW/
REJECT discipline, same as every prior mission this engagement), then
design the smallest generic read model per Phase 2's own instruction
before writing any code.
