# TSF Operator Stabilization HQ

**Mission ID:** `tsf-operator-stabilization-v1`
**Project:** TSF_ORCA
**Worktree:** `C:/Users/codex-agent/orca/workspaces/TSF_ORCA/tsf-operator-stabilization-v1`
**Branch:** `tsf-operator-stabilization-v1`
**Base:** `tsf/main` @ `2613be403cd12ed27f2953e9fade6521ebb0fb79` (clean, current-accepted at mission creation)
**Created:** 2026-09-03
**Phase:** `RECONCILED` — mission scaffolded, bug ledger seeded, no implementation started yet.

This file is the durable next-session startup source for this mission, matching this repo's own established PROJECT_HQ.md / M-wave-doc convention. Any session picking up this worktree should read this file and `bug-ledger.json` first.

## Charter

Orca owns execution; TSF owns intent and consequences. This mission owns **TSF product stabilization only**. It does **not** own Dataset Research Engine development and does **not** own Niners War Room — those are independently owned by other TSF_ORCA missions/chats using other worktrees, and this mission must never modify, pause, clean, reset, merge, or otherwise interfere with either lane.

## Provider split (conserve capacity, don't self-verify)

- **Claude / PLANNER_DEEP** — planning, decomposition, supervision, reconciliation, gap analysis (this session's own role).
- **Codex** — bounded implementation workers where appropriate.
- **Independent verifier** — substantive verification before READY_FOR_ADOPTION (a separate identity/context from whichever provider implemented the fix, per this repo's own established convention — see `tsf/programs/daily-driver-autonomy-v1/state.json`'s wave 12/16b findings on why SELF-verification misses real defects).
- **Orca** — durable execution/runtime.

## Reconciliation findings (2026-09-03)

- `tsf/main` was clean at `2613be403c` when this worktree was cut.
- **A real, prior stalled repair run already exists covering much of this exact ground — preserved as evidence, not touched:**
  - Keep Going run `keep-going-tsf-orca-1787691592122` (project `tsf-orca`), created 2026-08-25, most recent activity 2026-09-03T01:23:55Z.
  - **State: `STALLED`** — last checkpoint `WAVE_STALLED silent for 1822185ms` (~30 min silent at last observation).
  - Its own independent verification pass (2026-09-03T00:53:25Z) found **8 unsatisfied acceptance criteria** against its original goal (the same bug list: Health Repair nav bug, Projects nav-position bug, composer too small, Planner Chat can't initiate governed work, plus test/build/lint/verifier/zero-delta/READY_FOR_ADOPTION gates) — i.e. as of that check, nothing in it was yet acceptable.
  - Its worktree, `C:/Users/codex-agent/orca/workspaces/TSF_ORCA/command-tsf-orca-1788395222325`, is **dirty (uncommitted)** and contains partial, unverified work touching several of the same bugs this mission now owns: `tsf/ui/src/lib/chat-composer-height.ts(+test)`, `tsf/ui/src/lib/projects-navigation-state.ts(+test)`, `tsf/ui/src/lib/health-repair-activity.ts(+test)`, plus modified `chat-responder.mjs`, `data-store.mjs`, `http-server.mjs`, `PlannerChatPanel.tsx`, `ProjectHealthRepairCard.tsx`, `HealthRepairCenterPage.tsx`, `ProjectsPage.tsx`.
  - **Disposition: left exactly as found.** Not reset, not cleaned, not merged, not reused. Future waves of this mission may *read* it for reference/salvage candidates, but must independently reproduce and verify anything before relying on it — it already failed one independent verification pass.
- Other worktrees present and explicitly out of scope for this mission (each belongs to a different lane/mission): `tsf-command-authority-repair-v1` (this session's own prior, separate Command Authority repair, already at READY_FOR_ADOPTION, untouched by this mission), `tsf-command-workflow-repair-v1`, `tsf-parallel-improvement-v1`, `tsf-autonomy-program-v1`, `featherstar`, `nixie`.

## Golden-path acceptance (the real bar — passing unit/integration tests alone does not stabilize TSF)

Tracked as `ACCEPT-*` entries in `bug-ledger.json`:
1. User requests a new governed mission through Planner Chat.
2. TSF creates a separate isolated mission/worktree.
3. Exact mission appears globally as RUNNING.
4. User navigates elsewhere and returns without losing context.
5. A test mission can enter STALLED and be recovered through the UI/Planner.
6. Planner Chat reports the exact same canonical state as Flight Recorder/Work.
7. Needs You authorization is requested only when appropriate, understands negation, and consumes scoped approval once.
8. Finished work reaches READY_FOR_ADOPTION clearly.
9. Post-adoption live smoke tests verify the actual operator workflow.

## Bug ledger states

`REPORTED → REPRODUCED → FIXING → VERIFYING → READY_FOR_ADOPTION → ADOPTED → LIVE_VERIFIED`

Nothing is marked DONE before live verification after adoption. See `bug-ledger.json` for the live table.

## Priority order

**P0:** one canonical durable runtime state shared by Planner Chat/Work/Keep Going/Flight Recorder/Home/Fleet/notifications; reliable stall/recovery controls; authorization/negation correctness; global execution visibility.
**Then:** mission-creation UX; navigation/context preservation; Needs You / Ready for Review workflow; notifications; forms/composer polish; jargon reduction.

## Operating rules

- Fresh isolated worktrees for implementation, based on current accepted `tsf/main`.
- Reproduce each bug before fixing it.
- Independent verification (separate identity/context) before READY_FOR_ADOPTION.
- Zero Orca-core delta.
- Stop candidates at READY_FOR_ADOPTION — never auto-merge/push/deploy/adopt, never restart live TSF, never mutate NWR.
- Routine technical decisions made autonomously. NEEDS_YOU surfaced only for genuinely consequential authority, unrecoverable ambiguity, or governed adoption.
