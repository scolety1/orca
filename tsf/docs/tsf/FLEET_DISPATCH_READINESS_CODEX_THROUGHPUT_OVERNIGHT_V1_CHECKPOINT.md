# TSF — Fleet Dispatch Readiness + Explicit Command Adoption + Codex Throughput Overnight V1 — Durable Checkpoint

Owner directive: build a real, explicit-owner-authorized Command adoption
execution path (never autonomous), fix WorldForge's real base-ref dispatch
gap, adopt Nytheria's existing verified candidate and start its next real
overnight run, register EasyLife with Orca and run a real bounded upgrade,
complete the real Codex-utilization audit, fix the generic stalled-run
lifecycle gap, and prove multi-project scheduling + a final live Command
dogfood. Zero Tim relay; NWR stays untouched and held.

## Baseline

- Canonical `tsf/main` SHA at mission start: `537999e24caf73288eb2bbb69a8f7b91e76cc78a`
  (Multi-Project Command Orchestration Overnight V1, GREEN — NWR held,
  WorldForge/EasyLife dispatch gaps first discovered there)
- Host memory at mission start: as low as ~0.61GB free (worse than any
  reading this entire session) — real, severe EMERGENCY tier. TSF-platform
  build dispatches (Agent-tool subagents) proceeded regardless, matching
  this whole session's own established precedent that this class of
  operation is materially lighter-weight than a real external Keep-Going
  worker spawn; real heavyweight external dispatch is gated fresh at each
  actual dispatch point, never forced.

## Hard constraints (verbatim, must be preserved)

Do not touch NWR (no modification, no waking workers, no running its
tests, no inspecting the sealed 2025 holdout, never release its hold
unless Tim explicitly says the external work is done). Do not deploy/
publish anything. Do not spend money, enter credentials. Do not enable
Cleanup V1 real authority. Do not enable autonomous self-improvement
adoption — `EXPLICIT_OWNER_COMMAND_ADOPTION` (this mission's own new
capability) and `AUTONOMOUS_SELF_IMPROVEMENT_ADOPTION` (the existing,
disabled gate) must remain structurally separate, zero shared trigger.
Do not invent `main`/rewrite a repo/rename branches/guess a `work/*`
branch lexically to satisfy Orca. Do not build a second scheduler, a
second adoption engine, or a second Command system. No process-kill-by-
executable-name. Fail closed on ambiguity everywhere.

## Phase status

| Part | Status | Notes |
|---|---|---|
| A (Explicit Command adoption engine) | DONE | Wave 1, merged to canonical `89d058747914d4239e33d740ae42330a6e36ac11`, independently re-verified (63 new + 96 regression tests, all 5 required negative/positive golden proofs, boundary confirmed) |
| C (Canonical base-ref resolution) | DONE | Same wave — generic resolver + durable per-project config store; independently re-verified live against real WorldForge AND real EasyLife repos (below) |
| E (EasyLife Orca registration, mechanism) | DONE | mechanism + real registration both done — see E2 |
| H (Stalled-run lifecycle) | DONE | Adopted separately at `e2fdc96ddd`, real startup recovery scan, reuses `abandonAndReconcileStalledWave` verbatim |
| B (Adopt Nytheria's verified candidate) | REFUSED (honest, correct) | `executeCommandAdoption` correctly returned `CANDIDATE_WORKTREE_UNRESOLVED`: the historical run's dispatch record predates Wave 1's `worktree` field, so no real candidate branch could be recovered. Not routed around (would require fabricating data). The real branch content is already reflected in the repo via C2 below regardless. |
| C2 (WorldForge canonical base set) | DONE | Explicit config set to `work/worldforge-living-world-vertical-slice-v1-20260907` (ancestor-confirmed lineage tip); repo root checked out there (tip `9b90989`); Part C's fix independently verified live: `ensureWorktreeForDispatch` now returns `{ok:true, worktree:...}` where it previously failed with "Could not resolve a default base ref" |
| D (Nytheria next overnight run) | STARTED, RESOURCE_BLOCKED | Real run `keep-going-worldforge-sablewake-live-runtime-repair-v3-1788848932351` created (ACTIVE). Goal grounded in real handoff docs (OVERNIGHT_STATUS_2026-09-02/07.md): don't reattempt the twice-confirmed browser-automation/host-Chrome-contention live-verification wall a third time unchanged. Wave 1 worktree provisioned. First real tick honestly refused: `DISPATCH_WAITING_FOR_RESOURCES`, tier EMERGENCY, durably checkpointed. Not forced. |
| E2 (EasyLife real registration) | DONE | `registerOrcaRepo` called for real against `C:\Dev\easylifehq.github.io` — registered (Orca repo id `8c4ea1e6-...`). Found + fixed a real stale-pointer bug along the way: local `main` was stuck at `c8e0d7d2` while `origin/main` had moved to `e48b7a57` (post wave-10-revert-incident reconciliation, already present on a same-SHA local branch `codex/easyworkouts-reconciliation-20260908`); fast-forwarded local `main` to `origin/main` (confirmed clean ancestor first, no force). Full chain re-verified live: alias resolution (pre-existing), registration, canonical base (`main` → `REPO_STANDARD_DEFAULT` → correct current tip), real worktree creation via Orca CLI, all working end-to-end. Project-context-capsule load deferred to real dispatch (F) since it's coupled to actual planner/worker execution. |
| F (EasyLife upgrade run) | STARTED, RESOURCE_BLOCKED | Real run `keep-going-easylifehq-github-io-1788849147560` created (ACTIVE) — EasyLife's first-ever Keep Going run. Goal scoped to EasyWorkout per mission intent, grounded in real CHANGELOG.md (current version 3.6.0); Wave 1 defined as a real discovery/dogfood pass (UI_DOGFOOD_AGENT_V0 bridge honestly confirmed Orca-self-only today — `command-dogfood-bridge.mjs`'s own header — so wave 1 uses direct hands-on dogfood instead), not blind feature-building. First real tick honestly refused: `DISPATCH_WAITING_FOR_RESOURCES`, tier EMERGENCY, durably checkpointed. Not forced. |
| G (Codex utilization audit) | IN_PROGRESS | Real evidence so far: two genuine, eligible Keep Going runs (D, F) both correctly, honestly RESOURCE_BLOCKED at real EMERGENCY tier by the same shared gate — concrete `RESOURCE_BLOCKED` classification data, not manufactured. Host memory observed this session ranged ~1.51–1.84GB free (CRITICAL) down to EMERGENCY at actual dispatch instants, driven by real concurrent NWR sessions (`ListAgents`: `nwr-draft-upgrade-hq-ee` busy, two `niners-war-room-*` waiting) sharing this 16GB host. Full routing/throughput measurement still needs a real dispatch to actually happen. |
| I (Scheduler dogfood) | IN_PROGRESS | Partial real evidence: NWR held/untouched, Nytheria and EasyLife both queued with equal, honest treatment (neither's real resource-gate answer was biased toward the other) — no starvation observed yet, but no real dispatch has succeeded yet either, so throughput-level starvation can't be assessed until resources clear. |
| J (Final live Command dogfood) | NOT_STARTED | |

## Wave 1 adoption record (Parts A/C/E mechanism)

Coordinator independent review before merging: read `command-adoption-
execution.mjs` (domain + server) in full, `git-identity.mjs`'s real git
primitives (confirmed argv-based `spawn`, never `shell: true`, confirmed
`merge --ff-only` never forces/rebases, confirmed real post-merge
verification never trusts the merge call's own reported success alone),
`project-canonical-base.mjs`/resolver (confirmed fails closed on both "no
resolvable base" and "stale configured base," never silently falls back
to a guess), the Command-wiring diff (confirmed a real two-layer gate --
`decomposeMultiAction`'s broad `ADOPT_CANDIDATE_REPORT` match still routes
through a SECOND, narrower `classifyAdoptionCommandIntent` check before
anything executes). Traced the real `worktree` field threaded through
`keep-going-dispatch-loop.mjs`'s dispatch records back to its true origin
(`plan-capsule-mapping.mjs`'s pre-existing `planCapsuleToCandidateWorkItem`
— confirmed this is real, already-populated data, not a fabricated new
field). Independently re-ran all 63 new tests + 96 regression tests
myself (100% pass), `npx oxlint` clean, and independently grepped for the
self-improvement adoption boundary (zero references outside disclaiming
comments, confirmed myself, not just trusted the agent's own claim).

## Next intended action

Merge/push Wave 1 — DONE. Part C2/B performed directly by the coordinator
— DONE (B honestly refused, not forced). Part E2 performed directly —
DONE (registration + a real stale-`main`-pointer bug found and fixed
along the way). Parts D and F both real-started with real, evidence-
grounded goals and a provisioned wave-1 worktree each; both correctly,
honestly resource-blocked at their first real tick (EMERGENCY tier) and
left ACTIVE (not abandoned) rather than forced or silently dropped.

Remaining: retry D/F's ticks as host memory allows (do not force past a
real REFUSE); once at least one wave actually dispatches, capture real
routing/throughput evidence for G; then I (fuller multi-wave scheduler
dogfood) and J (final live Command dogfood using the mission's own exact
example message) last. If host memory stays EMERGENCY/CRITICAL for the
remainder of this session, G/I get reported honestly as
RESOURCE_BLOCKED-limited rather than fabricated, per the mission's own
explicit instruction that a resource wait must be measured and reported
honestly either way — this is itself real G3 evidence (two genuine
overnight-run-eligible workloads produced zero forced dispatches under
sustained real EMERGENCY pressure this session).

Real worktrees provisioned and left in place for their run's own wave 1
(not throwaway — reused when a real tick succeeds):
- `C:/Users/codex-agent/orca/workspaces/Worldforge-Sablewake-Live-Runtime-Repair-V3/command-worldforge-sablewake-live-runtime-repair-v3-1788849026213`
- `C:/Users/codex-agent/orca/workspaces/easylifehq.github.io/command-easylifehq-github-io-1788849157432`
