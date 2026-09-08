# TSF — Multi-Project Command + Real Fleet Orchestration Overnight V1 — Durable Checkpoint

Owner directive: make TSF Command a real multi-project conversational
control surface (referential continuity across projects, multi-action
decomposition from one message, per-action authority, global context that
survives auto-targeting), then use it to execute three real owner
intentions: hold NWR (external AI actively working it), adopt+continue
Nytheria/WorldForge, reconcile+upgrade EasyLife/EasyWorkouts toward a
working logging flow. Zero Tim relay; genuine owner gates only.

## Baseline

- Canonical `tsf/main` SHA: `e4a5580665987b2a363fbaea067201af64119b9c`
  (independently re-confirmed this session via full ancestry proof against
  an earlier, superseded SHA -- see "Canonical Main Drift Reconciliation"
  exchange immediately prior to this mission; fork/tsf/main identical,
  confirmed via live `ls-remote`)
- Multi-Project Fleet Throughput Dogfood mission: paused mid-Phase-1
  (read-only audit only, zero code changes made) when this mission's
  owner message arrived. No file-level race exists. Treated as
  superseded/absorbed by this mission's own Part F (same core resource/
  throughput questions, now in the context of the 3 real projects this
  mission actually acts on) -- not resumed as a separate parallel effort.
- Worktree: `multi-project-command-orchestration-overnight-v1`
  (`tsf/feature/multi-project-command-orchestration-overnight-v1`),
  `node_modules` junctioned at repo root and `tsf/ui/`.
- Host memory at mission start: ~1.42GB free -- real, live EMERGENCY tier
  (`criticalAtLeastBytes` floor is 1.5GB). TSF platform build work (Agent-
  tool dispatch to `claude` subagents building/testing TSF's own code) is
  the same class of operation used successfully throughout this entire
  session on this same contended host -- proceeding. Real heavyweight
  external LLM-CLI worker dispatch (an actual Keep Going run against
  Nytheria/EasyLife) is gated on the Resource Pressure Governor's real,
  live reading at the moment of that specific dispatch -- checked fresh
  each time, never forced.

## Pre-build real investigation findings (coordinator, direct, before any dispatch)

1. **NWR**: real repo `C:\NWR\Niners-War-Room`, remote
   `github.com/scolety1/Niners-War-Room.git`, 875 commits,
   **559 sibling worktrees** (`worktreeSiblingCount: 559`) -- strong,
   real corroboration of "another AI/process is actively working it."
   Its own TSF keepGoingRun here is `state: PAUSED` (last touched Sep 2).
   Alias `nwr`/`niners war room` -> `niners-war-room` already exists
   (`tsf/domain/project-aliases.mjs`).

2. **Nytheria / WorldForge**: real local-only repo (no remote) at
   `C:\Users\codex-agent\Documents\Worldforge-Sablewake-Live-Runtime-Repair-V3`.
   Aliases `nytheria`/`worldforge` -> `worldforge-sablewake-live-runtime-repair-v3`
   already exist. Its keepGoingRun (`state: COMPLETE`) genuinely maps to
   live feed `READY_FOR_ADOPTION` (`live-work-feed.mjs` line ~51-54,
   confirmed both by reading the code and by the real live HQ screenshot
   captured during the desktop-UI-rebuild task earlier this session:
   "Worldforge-Sablewake-Live-Runtime-Repair-V3 -- run reached COMPLETE
   via independently-verified acceptance criteria -- HEALTHY").
   Worktree confirmed clean. **Real, load-bearing finding**: a NEWER
   branch, `work/worldforge-living-world-vertical-slice-v1-20260902`
   (Sept 2), is a clean, linear, ancestor-confirmed *descendant* of the
   verified `work/worldforge-sablewake-live-runtime-repair-v3-20260814`
   branch (merge-base = the verified branch's own tip commit,
   `75da07f`) -- 14+ additional real commits of further, already-done
   work (game-loop resilience fix, interior-movement bug investigation/
   fix, tab-visibility finding), with its own "final status for
   tonight's session -- stopping rationale" doc. This is real prior
   progress beyond the verified checkpoint and must inform Part C2's
   real base, not be ignored.
   **CRITICAL, mission-shaping finding**: `tsf/server/chat-responder.mjs`
   (~line 552) hard-codes an explicit refusal for adoption specifically:
   *"That's a consequential decision (money, credentials, push/merge/
   deploy/publish, or adoption authority) -- chat has no tools and can't
   act on it, no matter how you phrase it. Make that call on the real
   surface for it instead: the Adoption tab..."* -- confirmed via direct
   code reading, not inference: **there is no automated adoption
   execution path anywhere in TSF for a project-level candidate,
   structurally, by design** (mirrors the self-improvement adoption
   gate's own never-bypass precedent this whole engagement, but here
   there isn't even a flag to check -- the code path simply does not
   exist). This mission's own explicit "this is the adoption
   authorization, do not ask Tim again" instruction cannot be honored by
   automated action regardless of how explicit the authorization is --
   the constraint is architectural, not a missing confirmation. See
   Part C's own resolution below.

3. **EasyLife / EasyWorkouts**: real, single, unambiguous onboarded
   project `easylifehq-github-io`, repo `C:\Dev\easylifehq.github.io`
   (two remotes: public `easylifehq/easylifehq.github.io.git`, private
   `scolety1/easylife-product-private.git` -- same repo, two push
   targets, not two competing codebases -- confirmed via the repo's own
   README describing the deploy-root/`app-vNext` split, not a genuine
   identity ambiguity). Editable source lives in `app-vNext/` (React +
   Firebase + react-router-dom, `npm run dev`/`build`/`test`/
   `test:emulator` -- the emulator script uses a `demo-` prefixed
   project id, the real convention for "local Firestore emulator only,
   no real cloud credentials needed"). **EasyWorkouts already exists as
   a real, substantial, already-built feature**
   (`app-vNext/src/features/easyworkout/`: Context, Layout, Dashboard/
   Log/Routines/ExerciseInsight/SessionReview routes, a real domain
   layer -- `workoutDraftLifecycle`, `workoutGoals`,
   `workoutHistoryTools`, `workoutStatistics` -- and a real Firestore
   persistence layer -- `workoutExercises`, `workoutGoals`,
   `workoutRoutines`, `workoutSessionIdentity`, `workoutSessions`) --
   REUSE and repair, never rebuild from scratch, per Part D2's own
   instruction. Repo currently `dirty: true` (one unstaged change to the
   deployed-root `index.html`, unrelated to `app-vNext` source). No
   alias exists for `easylife`/`easyworkouts` -> `easylifehq-github-io`
   yet -- a real, small, additive gap.

## Hard constraints (verbatim, must be preserved)

Do not touch NWR (no modification, no contact/wake of NWR agents, no
inspection of the 2025 sealed holdout). Do not kill external NWR
processes. Do not deploy/publish Nytheria or EasyLife. Do not enable
Cleanup V1 real destructive authority. Do not enable autonomous self-
improvement adoption. Do not create a second Command system. Do not make
global Command project-blind after auto-targeting. Do not force push, do
not rewrite history, do not reset away unique commits (canonical-drift
reconciliation constraint, still binding). Genuine owner gates only: new
paid spend, credentials/login/2FA, production deploy/publish, destructive
ops against protected state, major irreversible creative/product
direction, unresolved project identity with multiple plausible repos,
authority expansion beyond this mission's own prompt -- **and, per the
architectural finding above, real project-level adoption itself, which
has no automated execution path in this system regardless of
authorization phrasing.**

## Phase status

| Part | Status | Notes |
|---|---|---|
| A1 (Reconcile before build) | DONE | Adopted at `7d62613993`, independently re-verified |
| A2-A6 (Multi-project Command build) | DONE | 74+126 tests re-verified, 1 real gap found/fixed by coordinator (worktree-before-hold-check) |
| B (Durable project hold) | DONE | Both real admission choke points now covered |
| NWR hold applied | IN_PROGRESS | Applying for real now that B is adopted |
| C1 (Nytheria existing adoption) | BLOCKED (architectural) | No automated adoption path exists anywhere in TSF -- reported honestly, not routed around |
| C2 (Nytheria next overnight run) | DONE | Real branch `work/worldforge-living-world-vertical-slice-v1-20260907` (commit `9b90989`), continued from the real Sept-2 descendant, independently re-verified by coordinator (ancestry, clean tree, honest commit content) |
| D1-D4 (EasyLife/EasyWorkouts) | DONE | Real logging flow proven working (UI + Firestore-emulator layers both), no bugs found so no fixes needed, independently re-verified by coordinator (real origin/main sync, real incident history, ports cleaned up) |
| E (Golden dogfood) | NOT_STARTED | |
| F (resource/provider behavior) | NOT_STARTED | Absorbs the paused Throughput Dogfood mission's own questions |
| G (self-improvement tie-in) | NOT_STARTED | Passive -- only if a genuine eligible finding emerges naturally |

## Part A/B adoption record (coordinator independent review)

Read every new domain/server file in full (`project-execution-hold.mjs`,
`project-execution-hold-store.mjs`, `command-referent-resolution.mjs`,
`command-multi-action-decomposition.mjs`, `command-multi-action-bridge.mjs`)
plus the wiring diffs. Manually traced the mission's own literal 3-project
example ("NWR is being handled by another AI, leave it alone. Nytheria
looks good, adopt that run and keep going overnight. EasyLife needs
serious work -- get EasyWorkouts up...") through `decomposeMultiAction`
by hand and confirmed it produces exactly the 4 actions the mission's own
spec names. Confirmed `reportAdoptionCandidate` is genuinely report-only
(never executes an adoption) and `applyExternalWorkHold` genuinely
persists durably before the response ever claims it did.

**Real gap found and fixed by the coordinator**: `chat-dispatch-bridge.mjs`'s
own Part B hold check sits inside `planAndDispatchFromChat`, but
`chat-http-routes.mjs`'s own `dispatchFromChat` (the single-project chat
route, not the new multi-action bridge) calls `ensureWorktreeForDispatch`
-- a real `orca worktree create` side effect -- BEFORE ever reaching that
check. A held project's direct, single-project chat dispatch would still
create a real worktree before being refused. Fixed with the same check at
the true first side-effect point, defense-in-depth; a real, end-to-end
regression test proves no worktree/Keep Going run is created for a held
project (not just that the message is refused). Commit `7d62613993`.

**Real, unrelated, pre-existing bug found and precisely diagnosed (NOT
fixed -- out of this mission's scope, not introduced by this build)**:
`tsf/test/http-chat-live.test.mjs`'s "POST /api/chat returns a genuine
live response for a real project" test fails 100% deterministically (not
flaky, confirmed via 3 repeated runs) because `attachDueAttentionNotices`
unconditionally prepends any due global notice to the NEXT chat response
regardless of scope -- the `tsf-ui-capability-check` fixture project's own
baked-in `READY_FOR_ADOPTION` state is eligible on a fresh state file's
very first reconcile, so it gets prepended to whatever chat response
follows, breaking this test's `^`-anchored regex. Independently confirmed
this is NOT introduced by this mission's own work: reproduced identically
on the much older Operator Attention + Notifications V1 baseline
(`75db5ab59b`, a disposable worktree, removed after the check) --
present since that mission first wired `attachDueAttentionNotices` in.
This corrects an earlier mischaracterization across this engagement's own
regression sweeps (this exact test name was repeatedly bucketed as "host-
contention timing flakiness" without re-diagnosing its actual failure
content each time -- it is real, deterministic, and unrelated). Left
unfixed as genuinely out of scope for this mission; a real, bounded,
eligible candidate for a future self-improvement finding or small
dedicated fix.

Full regression: 74 new Part A/B tests + 126 across the required command-
layer regression set, all independently re-run by the coordinator, zero
failures beyond the one confirmed-pre-existing item above. `npx oxlint`
clean on every new/touched file.

## Next intended action

Part A/B adopted. Apply the real NWR hold. Part C2/D already independently
verified complete (see table). Part E (dogfood against the real owner
instruction), Part F (resource/provider report), final report.
