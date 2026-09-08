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
| A (Explicit Command adoption engine) | DONE | Wave 1, `a1e1e9ca81`, independently re-verified (63 new + 96 regression tests, all 5 required negative/positive golden proofs, boundary confirmed) |
| C (Canonical base-ref resolution) | DONE | Same wave — generic resolver + durable per-project config store |
| E (EasyLife Orca registration, mechanism) | DONE (mechanism only) | `registerOrcaRepo` confirmed real/callable; real registration of `easylifehq-github-io` itself not yet performed |
| H (Stalled-run lifecycle) | DONE | Adopted separately at `e2fdc96ddd`, real startup recovery scan, reuses `abandonAndReconcileStalledWave` verbatim |
| B (Adopt Nytheria's verified candidate) | NOT_STARTED | Depends on A; will be performed directly by the coordinator given real repo stakes |
| C2 (WorldForge canonical base set) | NOT_STARTED | Real evidence already gathered (prior mission): correct value is the real, ancestor-confirmed lineage tip |
| D (Nytheria next overnight run) | NOT_STARTED | |
| E2 (EasyLife real registration) | NOT_STARTED | |
| F (EasyLife upgrade run) | NOT_STARTED | |
| G (Codex utilization audit) | NOT_STARTED | Must use real D/F workloads, not manufactured tasks |
| I (Scheduler dogfood) | NOT_STARTED | |
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

Merge/push Wave 1. Then, given real repo stakes, the coordinator performs
Part C2 (set WorldForge's real canonical base) and Part B (real adoption)
directly rather than delegating — using the now-adopted engine for real,
for the first time, against real data. Then Parts D/E2/F dispatched with
full context. Part G measured from the real D/F workloads as they run,
not manufactured. Parts I/J last.
