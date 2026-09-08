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
| A1 (Reconcile before build) | IN_PROGRESS | Dispatching |
| A2-A6 (Multi-project Command build) | NOT_STARTED | |
| B (Durable project hold) | NOT_STARTED | Folded into the same wave as A |
| NWR hold applied | NOT_STARTED | Depends on B landing |
| C1 (Nytheria existing adoption) | BLOCKED (architectural) | No automated adoption path exists anywhere in TSF -- see finding above. Will report as a genuine, real, hardcoded gate, not attempt to route around it (no direct git-level workaround on the real repo either). |
| C2 (Nytheria next overnight run) | NOT_STARTED | Real base-branch reconciliation needed given the Sept-2 descendant branch finding above |
| D1-D4 (EasyLife/EasyWorkouts) | NOT_STARTED | |
| E (Golden dogfood) | NOT_STARTED | |
| F (resource/provider behavior) | NOT_STARTED | Absorbs the paused Throughput Dogfood mission's own questions |
| G (self-improvement tie-in) | NOT_STARTED | Passive -- only if a genuine eligible finding emerges naturally |

## Next intended action

Dispatch Part A1 (reconciliation) + A2-A6 (build) + Part B (durable hold)
as one cohesive wave -- deep session familiarity with command-responder.mjs/
command-scope-classifier.mjs/chat-dispatch-bridge.mjs/project-name-resolver.mjs/
fleet-attention-status.mjs already established this whole engagement,
informing a precise spec. Apply the NWR hold for real once that lands.
Then Part C2 (informed by the real branch-ancestry finding), Part D (real
EasyWorkouts repair), Part E (dogfood), Part F (resource report), final
report.
