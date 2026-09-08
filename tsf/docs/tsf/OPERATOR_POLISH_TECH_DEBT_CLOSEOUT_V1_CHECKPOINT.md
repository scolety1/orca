# TSF — Operator Polish + Technical Debt Closeout V1 — Durable Checkpoint

Owner directive: close the small, concrete gaps disclosed by the Operator
Attention + Proactive Notifications V1 program and leave the operator
surface clean. Explicit: do not start another large platform subsystem.

## Baseline

- Canonical `tsf/main` SHA: `75db5ab59bf22cc7187aba8ef69560d6c1f25b6d`
  (Operator Attention + Proactive Notifications V1, fully adopted --
  Waves 1/2 + Phase 8 dogfood, `GREEN`)
- Working tree: clean
- Worktree: `operator-polish-techdebt-closeout-v1`
  (`tsf/feature/operator-polish-techdebt-closeout-v1`), `node_modules`
  junctioned at repo root (827 entries) and `tsf/ui/` (141 entries)

## Hard constraints (verbatim, must be preserved)

Do not touch NWR. Do not activate Cleanup V1. Do not enable autonomous
self-improvement adoption. Do not deploy. Do not add a new top-level
navigation area. Do not add an external notification vendor. Do not
create another attention/notification truth store. Phase 2 (http-server
split): zero route behavior change, zero authority change, no second
router framework, existing tests remain green. Phase 3 (Orca-core):
read-only inspection first, reconcile before build; if a safe existing
primitive exists, integrate the minimum adapter; if it needs new
Orca-core product work, do NOT build a parallel TSF notification system
-- produce a bounded requirement packet instead; no external paid
notification service.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 (Planner Needs-You UI) | NOT_STARTED | |
| 2 (http-server split) | NOT_STARTED | |
| 3 (Orca-core notification reconciliation) | NOT_STARTED | Read-only investigation first |
| 4 (Attention UX dogfood) | NOT_STARTED | Depends on 1-3 landing |
| 5 (Self-improvement observability) | NOT_STARTED | |

## Next intended action

Dispatch Phase 3's read-only Orca-core investigation and Wave A (Phase 1
UI + Phase 5 Command observability) in parallel -- independent of each
other. Phase 2 (http-server split) as its own wave once the composition
is reconciled. Phase 4 (dogfood) last, after 1-3 land.
