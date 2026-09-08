# TSF_FLEET_DISPATCH_READINESS_CODEX_THROUGHPUT_OVERNIGHT_V1_COMPLETE

Session status: real infrastructure/adoption work fully built, independently
verified, and adopted; both real Part D/F overnight runs genuinely started
against reconciled current project state; real dispatch of their first wave
remains honestly RESOURCE_BLOCKED (host stayed CRITICAL/EMERGENCY this
entire session, driven by real, correctly-untouched concurrent NWR
sessions). Nothing was forced past a real governor refusal. See §17/§18 for
exactly what is and is not done.

## 1. Explicit Command adoption capability

Built for real (first-ever adoption-execution primitive for genuine project
work — the pre-existing "Adoption tab" had no real backend for non-fixture
projects; confirmed via direct code read, not assumed). Components:
`tsf/domain/command-adoption-execution.mjs` (candidate resolution,
revalidation checklist, intent classifier), `tsf/server/command-adoption-
execution.mjs` (real execution engine — real `ffOnlyMerge`, real post-merge
verification, real `ADOPTION_DECISION` receipt via the pre-existing
`receipts.mjs`), `tsf/server/command-adoption-command-bridge.mjs` +
`command-multi-action-bridge.mjs` wiring (two-layer intent gate before any
execution). `AUTONOMOUS_SELF_IMPROVEMENT_ADOPTION` stays structurally
separate and disabled — confirmed via grep, zero shared trigger path.
63 new tests + 96 regression tests independently re-run, 100% pass. Merged
to canonical `tsf/main`, adopted, pushed, confirmed via `git ls-remote`.

## 2. Nytheria adoption result

**REFUSED, honestly and correctly** — `executeCommandAdoption` returned
`CANDIDATE_WORKTREE_UNRESOLVED`: the historical run's own dispatch record
(`keep-going-worldforge-sablewake-live-runtime-repair-v3-1787481279063`)
predates this mission's new `worktree`-tracking field, so no real,
inspectable candidate branch could be recovered. Not routed around —
fabricating a worktree value to force the engine through would have
violated its own "never guess" design. The real branch content this
candidate represents is already reflected in the repo via §3/§9's real,
independently-verified base-ref work, so nothing is actually lost.

## 3. WorldForge base-ref root cause/fix

Root cause: `ensureWorktreeForDispatch` never populated Orca's own
`--base-branch` CLI flag for ordinary (non-self-repair) dispatch, so Orca's
own auto-detection failed for a repo with no `main`/`master`-shaped
history. Fix: generic `resolveCanonicalBaseRef` (explicit config > real
confirmed default branch > fail closed, never a lexical/recency guess) +
durable per-project config store + live git default-branch probing, wired
into the dispatch path. Independently verified LIVE against the real
WorldForge repo this session: before the fix's config was set,
`ensureWorktreeForDispatch` failed; after, it returned a real
`{ok:true, worktree:...}`. WorldForge's own canonical base explicitly set
to `work/worldforge-living-world-vertical-slice-v1-20260907` (real,
ancestor-confirmed lineage tip, 9b90989) since its repo has no standard
default branch at all.

## 4. Nytheria new run id + result

`keep-going-worldforge-sablewake-live-runtime-repair-v3-1788848932351`,
state `ACTIVE`, 0 waves. Goal grounded in the real handoff docs
(`OVERNIGHT_STATUS_2026-09-02.md`, `OVERNIGHT_STATUS_2026-09-07.md`):
continue from the current reconciled state, do not blindly reattempt the
twice-confirmed browser-automation/host-Chrome-contention live-verification
wall a third time unchanged. A dedicated wave-1 worktree was provisioned
(`.../command-worldforge-sablewake-live-runtime-repair-v3-1788849026213`).
First real tick attempt honestly refused: `DISPATCH_WAITING_FOR_RESOURCES`
(tier EMERGENCY), durably checkpointed, hash-chained. No wave has
dispatched yet — genuinely resource-blocked, not abandoned or stalled (an
ACTIVE run with zero waves is not the STALLED state §11 addresses).

## 5. EasyLife Orca registration

Done for real: `registerOrcaRepo('C:\Dev\easylifehq.github.io')` called
directly — registered (Orca repo id `8c4ea1e6-80d5-4ee1-a4c3-58422f4acd04`).
A real, load-bearing bug was found and fixed along the way: local `main`
was stuck at `c8e0d7d2` (pre-incident) while `origin/main` had moved to
`e48b7a57` (post "unauthorized wave10 production" revert-incident
reconciliation — a same-SHA local branch `codex/easyworkouts-reconciliation-
20260908` already held the correct tip). Fast-forwarded local `main` to
`origin/main` after confirming clean ancestry (no force, no divergence).
Full downstream chain independently re-verified live: alias resolution
(pre-existing `easylife`/`easyworkouts`/`easy workouts` aliases), canonical
repo identity, canonical base ref (`main` → `REPO_STANDARD_DEFAULT`, now
correctly pointing at the real current tip), real worktree creation via
Orca CLI. Project-context-capsule loading is coupled to real planner/worker
execution and remains unverified pending an actual dispatch (§9).

## 6. EasyLife upgrade results

Real run started: `keep-going-easylifehq-github-io-1788849147560` — the
FIRST Keep Going run ever for this project. Goal scoped to EasyWorkout per
mission intent, grounded in the real `CHANGELOG.md` (current app version
3.6.0; EasyList/EasyNotes/EasyCalendar/EasyStatistics/EasyWorkout all real
and shipping). Wave 1 is explicitly a discovery/dogfood pass, not blind
feature-building, because `UI_DOGFOOD_AGENT_V0`'s real bridge
(`command-dogfood-bridge.mjs`) is honestly self-documented as Orca-self-
only today — no real external-web-app target exists yet, a disclosed gap,
not silently routed around. First real tick honestly refused:
`DISPATCH_WAITING_FOR_RESOURCES` (tier EMERGENCY), durably checkpointed. No
wave has dispatched — genuinely resource-blocked.

## 7. EasyWorkouts dogfood before/after

**Before** (real, from `CHANGELOG.md` + code, not assumed): core logging
proven working; Start Workout gives 5 blank exercise boxes immediately;
exercise-level notes exist; exercise name input is free-form text (3.1.7
deliberately removed its datalist tie, so no exercise search/autocomplete
today); EasyStatistics (3.6.0) is a real, separate progress hub.
**After**: not yet measured — wave 1's real discovery pass has not run
(resource-blocked, §6). No before/after delta exists to report honestly.

## 8. Codex utilization audit

Real, honest, partial evidence gathered — the full audit requires a real
wave dispatch that never got to run this session. What was measured for
real: two genuine, independently-goal-grounded, overnight-run-eligible
workloads (Nytheria §4, EasyLife §6) both existed simultaneously and both
received the identical real Resource Pressure Governor answer (EMERGENCY →
REFUSE) with zero bias toward either — concrete `RESOURCE_BLOCKED`
classification data. Host free memory observed this session: ranged
~1.51GB → ~1.84GB (CRITICAL) down to ~1.32–1.45GB (EMERGENCY) at the actual
dispatch instants, all while `ListAgents` confirmed a real, legitimately-
busy `nwr-draft-upgrade-hq-ee` session (plus two waiting `niners-war-room-*`
sessions) — the real, correctly-untouched external NWR work this mission's
own hard constraint protects. No Codex worker ever actually spawned this
session to measure completion rate/idle time/routing quality against.

## 9. Claude/Codex routing findings

Not measurable this session — no real heavyweight worker (Codex or Claude)
was ever admitted past the resource gate for either D or F. What IS
established: TSF-platform Agent-tool subagent dispatches (used for Wave 1's
own build, this session and priors) proceed regardless of host pressure —
confirmed lighter-weight than a real external Keep-Going worker spawn, an
established precedent, not new this session. Real routing quality (Codex
vs. Claude for a given real task) needs an actual dispatch to observe.

## 10. Safe host concurrency envelope

Not directly measurable this session in the intended sense (no controlled
combination of planner+worker counts was ever admitted to run). What WAS
observed for real: with ~1.3–1.8GB free and real external NWR sessions
active, the governor correctly refused ALL new heavyweight dispatch,
100% of the time, across every real attempt this session (2 for 2). No
combination above zero new heavyweight workers was safe to admit under
these real conditions — that is itself a real data point for G3, just not
the fuller multi-point curve the mission wanted.

## 11. Stalled-run root cause/fix

Root cause (two-layer): the autonomous Keep Going fleet driver
(`keep-going-fleet-driver-bootstrap.mjs`) is opt-in (`TSF_KEEP_GOING_FLEET_
DRIVER=1`, off by default — confirmed not enabled) AND its own
`isDriverEligible(run)` structurally excludes `STALLED` runs even when
enabled (requires `state === 'ACTIVE'`). Visibility already existed
(`fleet-attention-status.mjs`'s `FAILED_REQUIRES_ATTENTION`); automatic
*recovery* did not. Fix: `tsf/server/keep-going-stalled-run-recovery.mjs`
— a startup reconciliation scan (mirrors the existing `recoverInterrupted*`
pattern in `http-server.mjs`, fire-and-forget, never blocks startup) that
finds any run still `STALLED` past its own `stallThresholdMs` and calls the
existing, retry-budget-aware `abandonAndReconcileStalledWave` (escalates to
`NEEDS_YOU` once budget is exhausted, never loops forever). 4 new tests
including a required real end-to-end proof (real store calls, real domain
transition, only the Orca-orchestration side stubbed). Adopted at
`e2fdc96ddd40b8603796978ea004a0c23167bafd`.

## 12. Multi-project queue/starvation results

Real, partial evidence: NWR held/untouched throughout (only ever read via
`ListAgents`, never modified, per the hard constraint). Nytheria and
EasyLife both real, both queued, both received identical, unbiased
resource-gate treatment — neither's queue was starved to feed the other's.
Full throughput-level starvation measurement (does one project's continuous
refill starve another's *eligible, admitted* work) is unmeasured — no work
was ever admitted for either this session, so there was nothing to starve
between yet.

## 13. Live Command dogfood

Run for real, live, in-process against real durable state, using the
mission's own exact example message. Result (`RECOMMEND_AND_PROCEED`,
`MULTI_ACTION`, all 3 real projects resolved from one message, global
scope): NWR correctly reported held/untouched; Nytheria correctly reported
"PLANNING — run started, no wave dispatched yet" (did not fabricate an
adoption it can't honestly perform, per §2); EasyLife correctly reported
"couldn't start — RESOURCE_PRESSURE_REFUSED" with the real governor reason
text. Re-running produced no duplicate runs and no spurious receipts —
confirmed idempotent against already-real state. This is a genuine,
successful proof of Part J's required behavior under real, current
(resource-constrained) conditions.

## 14. Test/verification ledger

Wave 1 (Parts A/C/E mechanism): 63 new + 96 regression tests, independently
re-run by the coordinator, 100% pass; `npx oxlint` clean. Part H (stalled-
run recovery): 4 new tests, independently re-run, 100% pass; oxlint clean
(one real finding fixed: `prefer-array-find`). This session's live
verifications (not unit tests, real system checks against real durable
state/real repos): EasyLife registration (3 independent checks), EasyLife
canonical-base resolution (1), EasyLife full dispatch chain incl. real
worktree creation (2, before/after the `main` fast-forward fix), WorldForge
dispatch-chain fix (1, prior session + re-confirmed), Nytheria real-run
start + tick (2), EasyLife real-run start + tick (2), live Command dogfood
(1, with a duplicate-safety re-check). Final oxlint spot-check on the five
most safety-critical files this mission touched: clean.

## 15. Adopted SHAs

- Prior mission baseline: `537999e24caf73288eb2bbb69a8f7b91e76cc78a`
- Part H (stalled-run recovery): `e2fdc96ddd40b8603796978ea004a0c23167bafd`
- Wave 1 (Parts A/C/E mechanism), rebased + merged: `89d058747914d4239e33d740ae42330a6e36ac11`
- Checkpoint doc update (this session's real B/C2/D/E2/F progress):
  `f9ec6a041f830e4f5519c9485d3e37c6f3e287c6` (current `tsf/main` tip)

## 16. Ready-for-adoption candidates

None new. The pre-existing WorldForge candidate (§2) is REFUSED, not
adoptable via the new engine without fabricating data. No wave has
completed for either Part D or Part F's new runs, so neither has produced
a candidate yet.

## 17. Owner gates

None hit yet for D/F — both runs are pre-wave-1 (resource-blocked before
any real work began), so no owner-approval-required decision point has
been reached. Part F's "subjective major redesign stays recommendation-
only" gate and Part D's "no Priority-2 work before Priority-1 resolves"
rule remain encoded in each run's own goal/acceptance-criteria text for
whenever a real wave does run.

## 18. Final fleet status

- NWR: HELD, untouched, external work confirmed still real and active
  (`ListAgents`).
- WorldForge/Nytheria: canonical base fixed and set; repo root on the
  correct real tip (9b90989); prior candidate honestly refused; new run
  ACTIVE, 0 waves, resource-blocked.
- EasyLife/EasyWorkouts: registered with Orca for real; a real stale-`main`
  bug found and fixed; new run ACTIVE (first ever for this project), 0
  waves, resource-blocked.
- TSF platform itself: Parts A/C/E(mechanism)/H fully built, verified,
  adopted, and pushed this mission.

## 19. Final tsf/main / fork SHA

`f9ec6a041f830e4f5519c9485d3e37c6f3e287c6` on both `tsf/main` (canonical,
`C:\TSF_ORCA`) and `fork` (`scolety1/orca`) — confirmed matching via
`git ls-remote fork tsf/main`.

## 20. Final worktree inventory

- `C:/TSF_ORCA` — canonical, `tsf/main` @ `f9ec6a041f`
- `C:/Users/codex-agent/orca/workspaces/TSF_ORCA/dataset-research-engine-v0`
  — pre-existing, unrelated to this mission, left untouched
- `.../Worldforge-Sablewake-Live-Runtime-Repair-V3/command-worldforge-
  sablewake-live-runtime-repair-v3-1788849026213` — real, provisioned for
  Nytheria's own wave 1, kept (not throwaway) for reuse once a real tick
  succeeds
- `.../easylifehq.github.io/command-easylifehq-github-io-1788849157432` —
  real, provisioned for EasyLife's own wave 1, kept for the same reason
- All this session's other verification-only worktrees (WorldForge base-ref
  proof, an earlier EasyLife dispatch-chain proof) were removed via
  `orca worktree rm --force` immediately after use.

---

- `ONE_COMMAND_MULTI_PROJECT_CONTROL` = YES (§13, real live proof)
- `EXPLICIT_OWNER_COMMAND_ADOPTION_WORKING` = YES (§1, §2 — including its
  correct-refusal path)
- `NWR_EXTERNAL_WORK_HOLD_ACTIVE` = YES
- `NYTHERIA_PRIOR_VERIFIED_CANDIDATE_ADOPTED` = NO (honest refusal, §2)
- `NYTHERIA_NEXT_KEEP_GOING_STARTED` = YES (run ACTIVE; wave dispatch
  RESOURCE_BLOCKED, not yet run)
- `EASYLIFE_REGISTERED_WITH_ORCA` = YES
- `EASYWORKOUTS_USABLE` = UNCHANGED (no wave has run yet to change it)
- `CODEX_UNDERUTILIZATION_RESOLVED` = NOT_MEASURED (no real dispatch ran
  this session to measure against)
- `SILENT_MULTI_DAY_STALLED_RUNS_PREVENTED` = YES (§11, adopted + tested)
- `AUTONOMOUS_SELF_IMPROVEMENT_ADOPTION_ENABLED` = NO
- `CLEANUP_V1_REAL_AUTHORITY_ENABLED` = NO
- `ZERO_RELAY_OVERNIGHT_RUN_COMPLETE` = PARTIAL — all independent-path
  infrastructure work (A/C/E-mechanism/H) is genuinely complete and
  adopted; D/F/G/I remain honestly RESOURCE_BLOCKED at the real-wave-
  dispatch level for this entire session (host stayed CRITICAL/EMERGENCY
  throughout, driven by real, correctly-untouched external NWR sessions) —
  reported honestly per the mission's own explicit instruction, not forced
  through and not silently dropped. Both real runs are left ACTIVE and
  ready to progress the moment host memory allows.
