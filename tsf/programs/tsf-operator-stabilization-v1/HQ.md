# TSF Operator Stabilization HQ

**Mission ID:** `tsf-operator-stabilization-v1`
**Project:** TSF_ORCA
**Worktree:** `C:/Users/codex-agent/orca/workspaces/TSF_ORCA/tsf-operator-stabilization-v1`
**Branch:** `tsf-operator-stabilization-v1`
**Base:** `tsf/main` @ `2613be403cd12ed27f2953e9fade6521ebb0fb79` (clean, current-accepted at mission creation)
**Created:** 2026-09-03
**Phase:** `WAVE_1_READY_FOR_ADOPTION` — first bounded implementation wave complete. 6 bugs (BUG-08, 11, 12, 13, 14, 16) are READY_FOR_ADOPTION: self-verified, live-verified against the real running app, and independently verified (2-3 separate agent-context rounds each for BUG-08/BUG-14, whose fixes had real defects the first independent pass caught -- fixed and re-verified clean). **Ledger correction (2026-09-03):** BUG-08's original title bundled negation-classification correctness (done, verified) with scoped one-time approval consumption (never started) -- marking the whole bug READY_FOR_ADOPTION was status inflation against ACCEPT-07's full criterion. Split: BUG-08 now covers classification correctness only (READY_FOR_ADOPTION, accurate); the approval-consumption mechanism is BUG-17 (REPORTED, not started, tracked as wave-2+ work). Nothing ADOPTED, merged, or pushed -- stopped here per this mission's own operating rule.

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

## Wave 1 (2026-09-03): canonical state + P0 operator-control + authorization negation

Scope: BUG-14 (canonical state -- root), BUG-11 (non-interactive CONTINUE), BUG-12 (deep-link to exact run), BUG-13 (Planner Chat blindness), BUG-16 (Flight Recorder/Evidence gap), BUG-08 (authorization negation -- the real, reproduced `and`-clause-splitting gap; the fuller scoped-approval-consumption ask is deliberately deferred to a following wave, disclosed in bug-ledger.json's BUG-08 entry).

Deliberately deferred to the next wave (not started): BUG-15 (full stall-recovery UX: heartbeat/worker/provider display -- worker/provider identity is a genuine, disclosed pre-existing gap, not yet wired to any live orchestration binding), BUG-05 (Health Repair surface -- separate investigation needed), BUG-01/02/03/06/07/09/10 (P1, out of this wave's P0 scope), a persistent always-visible global state indicator (BUG-14's own remaining gap), and a real chat-triggered Resume/Retry/Replan/Abandon action (chat can *describe* the exact recovery control now, per BUG-13's fix; *triggering* it from chat is new dispatch-bridge-shaped surface area not yet built).

All 6 bugs: reproduced first (failing test or live repro before the fix), fixed, unit-tested (target module + wiring layer), full suite re-run clean (986/988 server tests pass -- the 1 failure is `keep-going-autonomy-proof.test.mjs`, a pre-existing timing flake confirmed via isolated reruns before AND after this wave's changes, unrelated; 43/43 ui tests, `tsc -b --noEmit` clean, `vite build` clean), then live-verified against the real running standalone server + built UI in a real Chrome tab using the safe local FIXTURE project (real Keep Going run started/paused, cross-checked consistent across Keep Going/Flight Recorder/Planner Chat, including one genuine live Claude Code/Sonnet 5 planner call proving BUG-13's capsule grounding end to end) -- zero console errors throughout. Full detail per bug in bug-ledger.json.

Independent verification (separate agent context each round, per the provider-split rule below): 3 rounds total. Round 1 cleared BUG-11/12/13/16 outright and found 2 real defects: BUG-08's own `and`-fix had introduced a new false-negative on future-tense directive fragments ("...and will deploy after that"), and BUG-14's HomePage.tsx had a genuine untested React key collision (a project can appear in both `work.blocked` and `work.needsYou` at once). Both fixed; round 2 (fresh agent context) confirmed both fixes correct and, while re-checking BUG-08, found a THIRD real pre-existing gap unrelated to the "and" fix: `PROHIBITION_MARKERS` had no idiom awareness, so "whether ... or not"/"no matter" (meaning "regardless") were misread as real negations. Fixed; round 3 (fresh agent context) confirmed that fix too, plus a final full-suite sanity check on the whole wave. All 6 bugs are now READY_FOR_ADOPTION -- see bug-ledger.json per-bug for full detail. This 3-round pattern is itself the strongest evidence yet in this mission for HQ's own provider-split rule: self-review alone would have shipped 2 real classification defects.

Zero Orca-core delta: every change is inside tsf/. `tsf/ui` node_modules/dist were installed/built locally to run typecheck/build verification -- both gitignored, no tracked-file impact.

## Operating rules

- Fresh isolated worktrees for implementation, based on current accepted `tsf/main`.
- Reproduce each bug before fixing it.
- Independent verification (separate identity/context) before READY_FOR_ADOPTION.
- Zero Orca-core delta.
- Stop candidates at READY_FOR_ADOPTION — never auto-merge/push/deploy/adopt, never restart live TSF, never mutate NWR.
- Routine technical decisions made autonomously. NEEDS_YOU surfaced only for genuinely consequential authority, unrecoverable ambiguity, or governed adoption.
