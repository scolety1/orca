# TSF Orca Second Real Project Pilot V1

## Verdict

`YELLOW_TSF_ORCA_SECOND_REAL_PROJECT_PILOT_PARTIAL`

The second pilot safely generalized the Orca planner, isolated-worker, compact-handoff, candidate-binding, independent-verifier, and Stable-protection paths to a materially different React/Vite marketplace repository. It did not reach GREEN: a test-only worker and independent verifier proved that the selected user-visible outcome is impossible under the accepted deterministic matcher because opaque local Talent IDs receive no concept membership. The exact candidate is preserved but rejected from adoption, the source checkout remains unchanged, browser acceptance was not run, and Phase 2 did not begin.

## 1. Target and starting identity

- Project: Weird Talent Marketplace
- Project ID: `weird-talent-marketplace`
- Source: `C:\Users\codex-agent\Documents\ChatGPT\Idea Incubator\weird-talent-marketplace`
- Branch: `codex/semantic-challenger-shootout-20260812`
- Stable HEAD: `ef0e232888b0fe1689ab7433e3f1333807d3b00d`
- Stable tree: `669dc8c4492bee2b264f9a8f90952e3bf05c7f99`
- Starting and ending source status: clean, with no active Git operation
- Baseline gates: format/lint/typecheck, 58/58 tests, and production build PASS

The source checkout never moved. It remains Stable at the same HEAD/tree after the pilot.

## 2. Suitability and project discovery

The repository was a suitable second pilot: clean, local/testable, synthetic-only, non-bookable, and materially different from the server/storage-heavy Sales Engine. Current code and documentation showed a React/Vite frontend, deterministic Matching V2/M3, localStorage state, explicit moderation and abstention boundaries, and no need for real users, production access, hosted models, contact, booking, or payment.

The planner inspected README/HQ, architecture and matching/data documentation, recent history, package/test configuration, UI/state/storage/domain code, evaluation reports, fixtures, and tests. It selected a bounded supply-side mission from current evidence rather than stale history.

## 3. Selected mission and planner

Mission: **Local Synthetic Talent Card Authoring and Deterministic Request Preview**.

The slice was useful because the existing product had a request-side demonstration but no browser-local supply-side authoring loop. It was bounded into three ordered tasks: typed local storage/state, accessible authoring/directory/detail UI, and test-only flow verification. It explicitly excluded matcher changes, semantic activation, real users/data, accounts/backend, contact/booking/payment, deployment, publication, and adoption.

- Usage Mode: `BALANCED`
- Role: `PLANNER_BALANCED`
- Provider/agent/model: OpenAI / Codex / `gpt-5.6-sol`, medium
- Run: `run_7e8a8de60da9`
- Task/dispatch: `task_2a4feb579d08` / `ctx_76c31474f86d`
- Session: `term_d815122f-dfdc-4709-abc5-daa2b1c55da2`
- Planner commit: `93cdb0fe973bae24f398af443ef19e9f2479b772`
- Planner artifact SHA-256: `cb4a6f81f15311bf4bbdbea7d1cfeaeabb784dd8f14d2739884f6d8631215388`
- Compact contracts: three schema-valid `TSF_PLAN_CAPSULE_V1` objects

The preferred Claude planner mapping was unavailable; the configured Codex path was used. Provider diversity is not claimed.

## 4. Orca workers and isolation

### Local Talent foundation

- Task/dispatch: `task_d468ef7ecb73` / `ctx_055c5efbcf00`
- Session: `term_f5f8c85d-0e79-4012-952b-1533d3a02777`
- Commit/tree: `eb26db1ea2a03a0ea499e07b5bc95c821a66c7da` / `d0a3c2e5fe95098778de1cf878c2077542b59913`
- Integrated commit: `7a41e11cfa3ac4b103d1172ad54ac0c6e178f723`
- Gates: 18 focused repository tests, lint, typecheck, 73 full tests, build, Prettier, diff check, and seed counts 30/50/30 PASS

### Talent authoring and preview UI

- Task/dispatch: `task_1fbb8d5281a2` / `ctx_22eca1cded20`
- Session: `term_df5d2950-238f-4040-9b11-fbb73a3526f1`
- Commit/tree: `f7ebf9c79eaf444076a3b6158fe4a0a9f1ce1ae3` / `600f5d57b6f3511354bc4b562457ac2251333cf9`
- Integrated candidate: `148ef43730fd876c90adbeaf82f93e0b3c8a3e86`
- Gates: format, lint, typecheck, 73 full tests, matching evaluation, build, and diff check PASS

The holdout command reported changed frozen evidence on Windows. Normalized working content exactly matched the Git blob, proving a CRLF byte-comparison false-positive rather than candidate semantic drift.

### Test-only flow verification

- Task/dispatch: `task_b012fe267698` / `ctx_30f7f2d477d0`
- Session: `term_2dcba5bd-08a4-4a72-b67a-909f5b28b25d`
- Evidence commit/tree: `96a18f2e6b97aedda07935aa38b1de945583611b` / `89a2cad6a6aef63c9da48b97c28155743bdcfb95`
- Disposition: preserved on its isolated branch and **not integrated**

This worker obeyed the stop condition: it added tests only, found one genuine failing invariant, and did not repair product code or weaken the assertion.

## 5. Candidate and changed paths

- Branch/worktree: `tsf-pilot-2-integration` / `C:\Users\codex-agent\orca\workspaces\weird-talent-marketplace\tsf-pilot-2-integration`
- HEAD: `148ef43730fd876c90adbeaf82f93e0b3c8a3e86`
- Tree: `600f5d57b6f3511354bc4b562457ac2251333cf9`
- Status: clean
- Adoption readiness: false

Candidate paths:

- `src/App.tsx`
- `src/components/Layout.tsx`
- `src/components/Primitives.tsx`
- `src/data/seed.ts`
- `src/domain/types.ts`
- `src/pages/TalentCardFormPage.tsx`
- `src/pages/TalentDetailPage.tsx`
- `src/pages/TalentsPage.tsx`
- `src/state/MarketplaceContext.tsx`
- `src/storage/talentCardRepository.test.ts`
- `src/storage/talentCardRepository.ts`
- `src/styles.css`

The test-evidence commit's three test paths are not part of this candidate.

## 6. Independent verifier

- Role: `VERIFIER_INDEPENDENT`
- Provider/agent/model: OpenAI / Codex / `gpt-5.6-sol`, high
- Task/dispatch/message: `task_a8f0468b41fc` / `ctx_126f78f7c5b1` / `msg_47daa3cf8434`
- Session: `term_f15ad309-0593-4fd1-bb2e-2c01239f4d51`
- Worktree: `tsf-pilot-2-verifier`
- Files modified: none

The verifier revalidated the exact candidate HEAD/tree and clean worktree; inspected the baseline-to-candidate scope and unintegrated test-evidence commit; ran 42 focused tests, lint, no-emit typechecks, a temp-directory Vite build, and diff checks; and independently reproduced the matching result.

The exact finding is:

- opaque local Talent ID concept score: `0`;
- maximum lexical capability: `45`;
- Strong capability threshold: `55`;
- exact allowed/open announcer control: capability `22`, final score `38`, tier `Weak`.

The intended Strong/Excellent local-card preview therefore cannot occur without changing matcher/product architecture. That change was outside the planner capsule and was an explicit stop condition.

Verifier verdict: `BLOCKED_ARCHITECTURAL_CONFLICT`.

## 7. Browser, release, and adoption

Browser QA was not run. A proven non-browser invariant had already blocked the candidate, so browser acceptance could not establish Testing PASS and proceeding would have violated the stop condition.

The UI worker briefly started a loopback Vite server and Codex browser before a queued coordinator correction. Those processes were stopped and no evidence from that attempt was accepted.

- Stable: unchanged at `ef0e232...`
- Upgrade: preserved candidate `148ef437...`
- Testing: `BLOCKED_ARCHITECTURAL_CONFLICT`
- Published: unchanged
- Adoption: `NOT_READY`; no gate opened and no adoption occurred
- Push/PR/merge/deploy/publish: none
- Final receipt hash: `4e9e9866d60f88d880b8760e1c31446ceef193c19bd2ca3ce854e974dfd16d55`

## 8. Metrics and friction

- Wall time from Run creation to verifier stop: about 53.45 minutes
- Tim interruptions: 0
- Planner episodes: 1
- Implementation workers: 3
- Implementation worker retries: 0
- Verifier findings: 1
- Verifier correction cycles: 0
- Browser QA: not run
- Manual human copy/paste: 0
- Runtime recovery events: 0
- Provider telemetry: not exposed
- Orca core files modified: 0

Operator friction:

- Orca's first native planner launcher attempted an unacceptable blanket bypass and was replaced with the TSF safe provider launcher before agent work began.
- The planner briefly traversed outside the target and encountered NWR access denial before correction; it made no external changes.
- Sandboxed workers could not always attach to Orca's Windows named pipe; coordinator-attested exact commits/results preserved durable task truth.
- One verifier task was initially bound to the failed test task as a success dependency and was replaced with a correctly independent verifier task.
- Windows CRLF normalization caused a false-positive locked-holdout byte comparison.
- The UI worker briefly used a non-accepted browser path and was stopped.

## 9. TSF/Orca capability feedback

Proven again on a materially different repository:

- read-only project admission and profile discovery;
- a single-project Active Fleet/Work Set boundary;
- persistent planner and task-affine workers;
- provider-neutral roles and Balanced routing;
- compact plan/result capsules;
- Orca-native worktrees, sessions, task/dispatch facts, and candidate identity;
- independent verification and false-success rejection;
- Stable/Upgrade/Testing/Published separation;
- explicit human adoption authority;
- lightweight hash-chained receipts.

Newly exposed gaps:

- a planner-selected user-visible outcome needs an earlier feasibility probe against matcher invariants;
- work-item dependency semantics need an explicit `runs-after-settled`/verification relationship, not only successful completion;
- locked-evidence hashing must normalize or pin Windows line endings;
- the safe provider launcher should be the first-class Orca dispatch path;
- discovery roots should be enforced so planner searches cannot wander outside the selected project;
- worker browser ownership needs a stronger runtime gate.

No capability state changed. Evidence strengthened existing classifications and the 111-capability counts remain 12 upstream native, 4 reused, 6 adapted, 24 new overlay, 51 pending, 12 reference-only, and 2 rejected.

## 10. Phase gate and next decision

Phase 1 is not GREEN, so Phase 2 did not run. No onboarding inventory, Active Fleet expansion, Work Set expansion, real-usage backlog, or cross-project capability implementation wave was created. Sales Engine remained read-only at its adopted identity; NWR, HouseOS, EasyLife, and every other real project remained excluded from mutation.

Tim's next decision is whether to authorize a separate bounded Weird Talent matcher-capability design mission that decides how locally authored cards obtain safe concept evidence while preserving deterministic scoring, moderation, abstention, and synthetic/non-bookable boundaries. The current candidate should not be adopted as-is.
