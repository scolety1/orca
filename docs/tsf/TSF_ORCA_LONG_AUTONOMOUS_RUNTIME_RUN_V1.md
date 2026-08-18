# TSF Orca Long Autonomous Runtime Run V1

## Verdict

`GREEN_TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_V1_PROVEN`

The successor proved a persistent TSF planner coordinating real Orca sessions, dispatches, isolated worktrees, independent verification, native browser inspection, bounded recovery, explicit fixture adoption, and protected release tracks. No real project, remote, deployment, publication, or Orca-core modification was involved.

## 1–4. Repository identity, commits, and duration

1. Starting successor HEAD: `c0a38e437a2cc93cdb028f2ea751206ba2c63bf0` on `tsf/main`.
2. Ending implementation-and-evidence HEAD before the final documentation commit: `8fce8b29b` (`test: prove long autonomous Orca runtime flow`). The exact final documentation HEAD is reported in the terminal handoff because a Git commit cannot truthfully contain its own hash.
3. Successor milestone commits created in this runway:
   - `4fd77dece05a29743dc0cb791dc057fdeea505a4 feat: gate new dispatches by work set`
   - `8fce8b29b test: prove long autonomous Orca runtime flow`
   - The documentation commit is listed in the terminal handoff.
4. Measured fixture runtime: 19:41–20:19 MDT for baseline through planner synthesis (about 38 minutes); bounded audit, durable evidence, regression, and cleanup extended the runway to about 50 minutes.

Upstream remains `stablyai/orca` v1.4.184 at `2307f2ebbe1c1e737c0b12d920bb0a208332db2c`. The upstream ancestor is preserved.

## 5–10. Planner, workers, worktrees, tasks, and retries

5. Planner: `PLANNER_DEEP`, resolved to `CODEX_SAFE / gpt-5.6-sol / high` because the preferred Claude executable was unavailable. Native Orca terminal/session `term_e449ba52-8676-4f80-8fe3-defedc5534ad`, Run `run_e1297c4e9d73`, worktree `tsf-longrun-planner`. The one session persisted across decomposition, continuation, and synthesis; it did not implement ordinary product code.
6. Worker identities:
   - Normalization: `WORKER_CHEAP`, Economy, Codex/gpt-5.6-sol low, session `term_73b1d795-50b8-4bdb-add2-95559b70b9a4`, dispatch `ctx_616de647afab`, commit `4a92b9970860cea52b623b43e5c19cd62471f24f`.
   - Filtering: `WORKER_BALANCED`, Balanced, Codex/gpt-5.6-sol medium, session `term_0402ec03-258d-462a-b153-ef3e93d97cbc`, dispatch `ctx_e9d124ac4c48`, commit `0f5512e2e2bfbffdf9e8e2644a50efcee589b3d5`.
   - Health summary: `WORKER_BALANCED`, Balanced, Codex/gpt-5.6-sol medium, session `term_057b7d55-39f4-48f5-a09e-9cffc9254f1a`, dispatch `ctx_8ec4fc858e2e`, commit `fc13ae8f66c0c4b096f198019232279e23d8c1f6`.
   - Integration: `WORKER_DEEP`, Maximum, Codex/gpt-5.6-sol high, session `term_3fb32c86-cc0c-42d4-9e50-0b95500fddbe`, dispatch `ctx_7642c9ec777c`, commit `98affbde5c59f9758e204dd7cd0a3dca9264f0e4`.
7. Four real implementation workers completed, satisfying the minimum of three. Peak parallel implementation workers: three.
8. Separate Orca worktrees were used for planner, normalization, filtering, health summary, integration, deterministic verification, and deep verification under `C:\Users\codex-agent\orca\workspaces\TSF_ORCA_LONG_RUN_FIXTURE`.
9. Four planner-owned work items completed: three independent pure modules and one integrated, loopback-only offline mission board. All four native dispatches settled successfully.
10. Bounded corrections: normalization, filtering, and integration each initially claimed completion before an exact commit existed. Independent Git evidence rejected those false-success states and routed one commit-only correction to the same owner. No new implementation worker was fabricated. Initial worktree-mismatch dispatch attempts were rejected by Orca before dispatch creation and retried with exact worktree selectors.

## 11–15. Recovery, verification, browser, affinity, and handoffs

11. Interruption/recovery: the health worker was intentionally interrupted mid-turn while its worktree was clean. The same Orca terminal, provider conversation, mission, and worktree resumed; no duplicate was created. Integration completion attachment also recovered by restoring the canonical `ORCA_USER_DATA_PATH`; its candidate was preserved.
12. Verification: an independent deterministic pass reran all three component suites (6/6 each). A separate deep verifier session `term_9a56c7f4-aa55-414d-94b9-a36b66025c38`, dispatch `ctx_ea81ed4a3b07`, attested the exact integration commit/tree, exact changed paths, retained dependency blobs, clean independent worktree, loopback-only assets, and 22/22 tests. Claude was unavailable, so provider diversity was not claimed; session/process/worktree independence was proven.
13. Browser/UI: Orca's native browser opened page `a9151cba-7ef4-46b1-9a08-f2200fd2c6c1` at `127.0.0.1:43128`, title `Mission Control`, with no load error or external asset. It displayed M-1 through M-4 and health 4/3/1/1. Owner=navigator, state=active, priority=high produced only M-1 and health 1/1/0/0. One snapshot RPC disconnected transiently; runtime stayed ready and the next native snapshot succeeded.
14. Session affinity: GREEN. Planner identity stayed sticky for the planning episode; each worker and verifier stayed sticky within its task; provider/model changes occurred only at role/task boundaries. No cache-saving claim is made because telemetry was unavailable.
15. Compact handoffs: GREEN. Every worker received a validated `TSF_PLAN_CAPSULE_V1` and returned an admitted `TSF_RESULT_CAPSULE_V1`. The planner exchanged decisions, constraints, identities, tests, and results—not transcripts. The validator caught and rejected an initially abbreviated capsule shape before dispatch.

## 16–21. Governance, adoption, receipts, and Health

16. Usage Modes: Economy selected cheap/low-effort normalization; Balanced selected medium workers for filtering and health; Maximum selected the deep integration worker and deep independent verification. Modes governed role/effort, parallelism, retry budget, and verification depth, not command-level permission choreography.
17. Active Fleet/Work Set: the fixture was registered as a Known Project, admitted to Active Fleet and Work Set, then removed from Work Set. Removal blocked new dispatch while retaining Active Fleet membership and allowing three already-running bounded workers to settle. Explicit reentry restored new-dispatch admission. The gate is now a tested TSF-overlay function.
18. Release tracks: Stable and Published stayed at fixture baseline `d1420fee6034e8ba3e1f3ab8fb64749ddb1802cf` / tree `865b4bf06ff673b976027f324647c21360cd59f6`. Upgrade bound exact candidate `98affbde5c59f9758e204dd7cd0a3dca9264f0e4` / tree `e8c2ba1c7a211c632ada460e2805a8cf53a3691b`. Testing bound that candidate, passed, and made Upgrade `READY_FOR_PROMOTION`. No promotion, merge, or publication occurred.
19. Adoption: planner synthesis reached `READY_FOR_ADOPTION`. Existing fixture-only authority then explicitly adopted the exact verified candidate. Worker completion alone did not change project/release state. Mission and candidate are `ADOPTED`; Stable remains unchanged.
20. Evidence: durable planner output, continuation, synthesis, four result capsules, verifier result, browser proof, Work Set gate proof, capacity observations, upstream readiness, state, and morning summary are under `tsf/fixtures/long-autonomous-runtime-v1/`. The four-record Receipt Lite chain—mission created, candidate finished, verifier result, adoption decision—validates cryptographically.
21. Health: `HEALTHY`, no findings, advisory-only. Morning summary records what advanced, worker/provider identities, recovery, Work Set, tests, release safety, and recommended next action. After process cleanup no mission session is intentionally active, so another serialized heavy local task may run.

## 22–27. Migration, routing, upstream safety, and gaps

22. Newly evidence-backed migration coverage: Work Set new-dispatch gating/reentry (PRJ-007); persistent planner and real coordination/verification (WRK-001/003/006); automatic continuation and bounded-stop semantics (MSN-009/010/011); false-success rejection and governed local candidates (GIT-010/012); candidate runtime attestation (REL-007); Orca-native browser Test Session coverage (LEG-004).
23. Bounded legacy audit classified five files. No file was copied in this follow-up. Daily Operator and validation-repair behavior are `PORT_LOGIC_ONLY`; Active Fleet/Usage Mode tests are `PORT_TEST_ONLY`; local commit finalization is `ORCA_ALREADY_BETTER`; Health remediation is `REFERENCE_PATTERN_ONLY`. Provenance and reasons are in `LEGACY_CODE_REUSE_MANIFEST.md`.
24. Provider failover: role mappings remain provider-neutral. Claude unavailable was observed explicitly; `PLANNER_DEEP` and `VERIFIER_INDEPENDENT` used the configured safe Codex fallback at mission boundaries. No active session was silently rerouted.
25. Capacity/usage: provider availability, peak worker parallelism, sticky identities, and serialized heavy operations are recorded. Token, quota, reset, and cache facts remain `UNKNOWN`; no credential scraping or invented accounting was used.
26. Orca core files modified: **0**. All runway changes are TSF-owned overlay, fixture, test, migration, or documentation files. No upstream update was attempted.
27. The 111-capability ledger now totals: 12 `UPSTREAM_NATIVE`, 4 `REUSED_LEGACY_CODE`, 6 `ADAPTED_LEGACY_CODE`, 24 `NEW_TSF_OVERLAY`, 51 `PENDING`, 12 `REFERENCE_ONLY`, 2 `REJECTED`. Remaining CRITICAL gaps are PRJ-003/004/010, WRK-002/005, CTX-007, MSN-001/003/004/006, GIT-003/007, AUT-001/002/005/006, UI-002/008/010/011, RSC-001/005, and REL-001/004/006. They remain explicit; none was silently dropped.

## 28–30. Cleanup, isolation, and pilot readiness

28. Processes started: one Orca v1.4.184 runtime, persistent planner, four implementation workers, two verifier sessions, one loopback fixture server, and one Orca browser page. All mission-specific terminals, the browser page/server, and the Orca runtime are stopped during final cleanup; exact cleanup verification is included in the terminal handoff.
29. Real repositories touched: none. HouseOS, NWR, EasyLife, Idea Incubator, and all other real product repositories were excluded. `C:\TSF_V1` remained read-only and unchanged. `C:\TSF_NEXT` was inspected only and not reset, cleaned, adopted, or modified.
30. Pilot decision: the successor is technically ready for Tim to authorize a carefully selected first real-project pilot, but authorization is still required. Recommended first pilot constraints: low-consequence local repository, exact component/root binding, clean baseline, no publication, one bounded mission, independent verification, and explicit adoption. This runway did not onboard any real project.

## Final acceptance evidence

- Fixture baseline: 1/1 tests.
- Component workers: 6/6, 6/6, and 6/6.
- Integration candidate: 22/22 tests plus loopback smoke.
- Independent deep verifier: 22/22 tests and exact Git/path/browser checks.
- TSF overlay: 20/20 tests before final documentation; rerun in terminal handoff.
- Stable and Published: unchanged.
- Receipt chain: valid.
- `git diff --check`: clean before final documentation; rerun in terminal handoff.
- Push/PR/merge/deploy/publish: none.
