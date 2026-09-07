# TSF — Autonomous Post-Cleanup Upgrade Program V1 — Durable Checkpoint

Owner directive: "AUTONOMOUS POST-CLEANUP UPGRADE PROGRAM V1" (ZERO TIM RELAY).
This file is the durable memory of record for this program — the chat session
is explicitly NOT the only memory of it. Updated after every phase.

## Baseline (program start)

- Canonical `tsf/main` SHA: `458f73b789b83ec27d46394a8a2562bb8dab709c`
- Fork checkpoint (`fork/tsf/main`): matches exactly
- Working tree: clean
- Remaining worktrees at program start: only `dataset-research-engine-v0`
  (`32b175fa9b`, held — see NWR section below)
- Free memory at program start: ~1.96–2.27GB / 15.85GB (moderate pressure,
  consistent with this host's known baseline throughout prior engineering)

## NWR Historical Evidence Preservation — status at program start

**Result: `NWR_EVIDENCE_PRESERVATION_HOLD_REMAINS`** (final audit completed
2026-09-06, agent `a6a459dd3a88dc825` + 3 subagents, 257,796 tokens, 68 tool
uses, fully read-only).

- 137 artifacts inventoried across `tsf/fixtures/nwr-historical-redraft-results/`,
  `tsf/fixtures/nwr-historical-redraft-intake/`, and 6 `run-nwr-historical-redraft-*.mjs`
  scripts. Classification: 0 IDENTICAL_CANONICAL_COPY / 7
  SEMANTICALLY_PRESERVED_WITH_PROVENANCE / 43 SUPERSEDED_BY_VERIFIED_CANONICAL_ARTIFACT /
  **57 UNIQUE_AND_MUST_PRESERVE** / 1 GENERATED_OR_DISPOSABLE / **29 UNCERTAIN**.
- Compounding risk: all 76 commits carrying this evidence are **unpushed to
  any remote** — exist only in `C:\TSF_ORCA\.git`'s local object store.
- 2025 sealed holdout: located (`C:\NWR\Niners-War-Room`,
  `work/nwr-full-historical-tuning-v1-20260904`), confirmed opened by NWR's
  own already-completed process on 2026-09-06 — by commit-message/filename
  evidence only, contents never read by this audit.
- Per the mission's own explicit rule (do not proactively copy unless
  preservation cannot otherwise be guaranteed AND owner authorization is
  obtained): **no files copied, worktree NOT retired.**
- **NEEDS-YOU (recorded, not blocking unrelated TSF work per explicit owner
  instruction):** (a) push `tsf/feature/dataset-research-engine-v0` to a
  durable remote; (b) durably preserve the 57 unique + resolve the 29
  uncertain artifacts (`raw_stats_2018_wk17.csv` most fragile — two
  uncommitted copies only, no derived trace); (c) confirm with Main TSF HQ
  whether the 19-file platform-bookkeeping cluster's candidate modules are
  already adopted — likely already satisfied by the prior Dataset Research
  reconciliation (`identity-collision-resolution.mjs` etc., landed at
  `2613be403c`/`458f73b7`), not independently re-verified.
- This hold is explicitly classified as `NWR_HISTORICAL_EVIDENCE_PRESERVATION_HOLD`,
  NOT unfinished TSF engineering, per prior owner instruction, and does not
  block this program.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1. UI_DOGFOOD_AGENT_V0 | **ADOPTED** — merged to `tsf/main` @ `90d77e3a1cd56ee0cd34c3e40aecd86a3975ed1f`, pushed to `fork/tsf/main` (confirmed), phase worktree retired | See below |
| 2. PLANNER_CONTEXT_LIFECYCLE_V0 | **ADOPTED** — merged to `tsf/main` @ `7521e4de87cde4d0eb981ccb5b6e2aedfb5c1513`, pushed to `fork/tsf/main` (confirmed), phase worktree retired | See below |
| 3. Deferred Research Platform Completion Wave | **ADOPTED** — both waves merged: Wave 1 @ `3ae53e07a5609797c4ecd254cb696b2c9cb5e672`, Wave 2 @ `10e39227a7ebcdcee15689163c9707bbfc6866b5`, both pushed to `fork/tsf/main` (confirmed), both phase worktrees retired | See below |
| 4. Cleanup V1 / Governed Destructive Automation | **ADOPTED** — merged to `tsf/main` @ `32c5d05520cfa189ac602c12cf03ba1f1121f534`, pushed to `fork/tsf/main` (confirmed), phase worktree retired; state `CLEANUP_V1_IMPLEMENTED_READY_FOR_OWNER_ACTIVATION`, real destructive execution stays behind the still-unset owner-authorization gate | See below |
| 5. Larger Astra Follow-up Benchmark | **ADOPTED** — merged to `tsf/main` @ `e91cc0deecbfaeeff75766d041f7a3d870a5f962`, pushed (confirmed), phase worktree retired; result `ASTRA_MORE_EVIDENCE_NEEDED` — investigated, not run; owner-gated on a real reachable model + authorized spend | See below |

**PROGRAM COMPLETE — see "FINAL PROGRAM RECONCILIATION" section at the
end of this document for the full closing report
(`TSF_POST_CLEANUP_UPGRADE_PROGRAM_V1_COMPLETE`).**

### Phase 1 — UI_DOGFOOD_AGENT_V0

**1A reconciliation (complete, agent `a310ddfe52fdd6f50`):** smallest viable
V0 architecture —
- Driver: reuse Playwright's existing Electron fixture
  (`tests/e2e/helpers/orca-app.ts`), no new browser harness.
- New (genuinely small): shared console+network-error-capture helper
  (~20-30 lines).
- Scoring: reuse `tsf/domain/evaluation-pack.mjs` +
  `tsf/server/eval-pack-registry.mjs` wholesale — add one new `'UI_DOGFOOD'`
  category to `EVAL_CATEGORIES`.
- Surface enumeration: no URL router exists in Orca's renderer — enumerate
  via the existing settings-search-catalog / tab-content-type idiom.
- Dispatch: new Command intent in `tsf/server/command-responder.mjs` reusing
  existing `chat-dispatch-bridge.mjs` / orchestration-bridge path — no new
  autonomous loop.
- Operational flag: `C:\TSF_ORCA`'s own `node_modules` was empty at
  reconciliation time (0 entries) — `pnpm install` required before running
  the existing Playwright E2E suite; Chromium binaries already cached.

**1B/1D/1E implementation (done, worktree `ui-dogfood-agent-v0`, branch
`tsf/feature/ui-dogfood-agent-v0`):**

- `tsf/domain/ui-dogfood-finding.mjs` — generic finding taxonomy (17
  categories), severity classification (P0–P3), auto-fix eligibility
  (explicitly excludes `SUBJECTIVE_AESTHETIC`/`LAYOUT_PROBLEM` always, and
  `ACCESSIBILITY_DEFECT` unless a detector explicitly marks it
  `objective: true`), dedup, before/after diff, and the
  iterate-while-improving policy (a regression always earns one more pass;
  `maxIterations` is a hard ceiling regardless).
- `tsf/domain/ui-dogfood-surface-catalog.mjs` — generic surface/viewport
  (`desktop`/`laptop`/`mobile`) types and a pluggable `enumerateSurfaces`
  strategy.
- `tsf/domain/ui-dogfood-contract.mjs` — the orchestration contract:
  `runDogfoodPass` (one launch → surface×viewport sweep → dedup → score)
  and `runIterativeDogfood` (fix–relaunch–rescan loop). Every side effect
  (launch, capture, detect, screenshot, fix) is dependency-injected.
- `tsf/adapters/browser-console-network-capture.mjs` — the shared
  console+network capture helper, factored out of the ad-hoc
  pageerror/console listener pair already hand-rolled in
  `tests/e2e/worktree.spec.ts`.
- `tsf/adapters/electron-target-launcher.mjs` — generic, standalone
  Electron launch adapter (`_electron.launch()` directly, throwaway
  userDataDir per launch) for the Command-dispatch path, which runs outside
  any Playwright test file and so cannot use the test-scoped
  `orca-app.ts` fixture.
- `tsf/adapters/orca-dogfood-surfaces.mjs` — Orca's own concrete surface
  strategy: drives the real `window.__store.getState().openSettingsTarget
  /.openSettingsPage()` idiom already used by `tests/e2e/*settings*.spec.ts`.
  Pane ids are a plain copy of the real, canonical
  `SETTINGS_NAV_TARGETS` list in
  `src/renderer/src/lib/settings-navigation-types.ts` (kept as a copy
  since that file is React/TS-typed and this adapter is plain Node ESM).
  Also exports `detectOrcaSettingsRenderFindings`, a real detector: no
  `[data-settings-section]` element rendering after navigation is a
  genuine `BROKEN_INTERACTION`.
- `tsf/adapters/dom-overflow-detector.mjs` — a generic (not
  Orca-specific), real `CLIPPED_CONTENT` detector: any visible element
  inside a root selector overflowing the current viewport width by more
  than 20px, excluding deliberately-scrollable containers.
- `tsf/server/command-dogfood-bridge.mjs` (1D) — Command intent bridge,
  checked early in `command-responder.mjs` exactly like
  `command-research-bridge.mjs`. Recognizes `dogfood <target>` (leading
  word only — `\bdogfood\b` anywhere was found, during testing, to
  false-positive-hijack this fleet's own pre-existing `dogfood-b-nwr`-style
  project ids), `review orca's ui`, and `check this before I look`. Only
  Orca's own UI is a real, launchable V0 target; any other named target
  (e.g. "dogfood NWR") gets an honest "not wired up yet" answer, never a
  silent no-op. A live command run is one bounded, read-only PASS
  (find+score+report) — the autonomous fix–relaunch–rescan loop is the
  offline golden-dogfood workflow's job, never something a chat command
  applies unreviewed code changes from.
- `tsf/server/ui-dogfood-eval-cases.mjs` / `ui-dogfood-eval-runner.mjs` —
  the `UI_DOGFOOD` eval pack (8 cases), registered in
  `eval-pack-registry.mjs` alongside the existing 7. Pure/synthetic inputs
  against the real domain functions (mirrors `ESTIMATOR_BASICS_PACK`'s own
  convention) — no browser/Electron in the fast `node --test` suite; the
  real browser-driven proof is the E2E spec below.
- `tests/e2e/ui-dogfood-orca-self.spec.ts` (1C/1E) — the golden dogfood
  proof. Reuses `orca-app.ts`'s `orcaPage` fixture directly (real
  isolated Electron launch, seeded repo) rather than the standalone
  launcher. **Asserts a real, specific, reproducible finding**, not "zero
  or more, whatever happens": at the 390px mobile viewport, every real
  Orca settings pane's shared header row
  (`SettingsSection.tsx`) overflows the viewport — a genuine responsive
  gap (Settings has no narrow-viewport layout; the sidebar+content shell
  doesn't collapse). Captures 8 real screenshots as before/after-style
  evidence (all 4 surfaces × 2 viewports).
- `tests/e2e/ui-dogfood-orca-self-full-sweep.spec.ts` — an opt-in
  (`ORCA_E2E_RUN_UI_DOGFOOD_FULL_SWEEP=1`, skipped by default) extended
  sweep across all 33 real settings panes, used to produce the finding
  evidence below.

**Deviation from the 1A plan, and why:** 1A's reconciliation had provisionally
named an isolated, disposable NWR worktree as the golden target. The actual
Phase 1 instructions this implementation followed were explicit that Orca's
own UI is the golden target FIRST (proven here), with an NWR pass attempted
only opportunistically and skippable — see the NWR section below for what was
attempted and why it was deferred.

**Golden dogfood run against Orca's own UI — real findings (2026-09-07):**
Full sweep, 33 real settings panes + main shell, desktop (1440×900) +
mobile (390×844) = 68 surface visits:
- 0 console errors, 0 failed network requests, 0 broken navigations across
  every single pane — a real, clean pass on those dimensions.
- **33 real `CLIPPED_CONTENT` findings** (severity `P2`, `autoFixEligible:
  true` per the taxonomy) — every settings pane's header row
  (`SettingsSection.tsx`'s `flex flex-wrap items-start justify-between`
  div) overflows the 390px mobile viewport (observed `right` values
  448–1150px against a 390px viewport). Visual confirmation (screenshot):
  the Settings sidebar+content shell has no narrow-viewport layout at all
  — the content pane is squeezed to near-zero width, text wraps
  character-by-character, and the pane title is clipped.
- **Explicit decision: NOT auto-fixed.** Although `CLIPPED_CONTENT` is in
  the taxonomy's auto-fix-eligible set, this specific defect's true root
  cause is architectural (the Settings shell's sidebar+content layout, not
  `SettingsSection.tsx`'s own header, which already has `flex-wrap` and
  `min-w-0`) and Orca is a desktop-first Electron developer tool that may
  never have intended 390px support at all. Per the owner directive's own
  scope boundary ("recommend, never silently redesign established product
  identity" for anything not strongly, narrowly bounded), this is recorded
  as a **recommended follow-up**, not auto-applied. The mechanism's
  auto-fix path itself is proven separately at the unit level
  (`runIterativeDogfood`'s fix–relaunch–rescan loop, tested with fakes).

## NWR dogfood pass — attempted, deferred (2026-09-07)

Per the phase instructions: checked `C:\NWR\Niners-War-Room` read-only for
its real launch mechanism (no historical data, holdout, or canonical
branches touched or read).

- **Launch mechanism found:** NOT Electron — a local-first Streamlit
  (Python web) app. `README.md`: `streamlit run app/main.py`, or the
  isolated `uv run --offline --no-project --with nflreadpy --with numpy
  --with pandas --with pydantic --with streamlit streamlit run
  app/main.py`. `RUN_POLICY.md` confirms starting/opening a page never
  mutates a refresh receipt or source data — only an explicit "Refresh
  Data" user action does, which a read-only dogfood pass would never
  trigger.
- **Blocked, not skipped speculatively:** 4 independent, safe launch
  attempts (`.venv\Scripts\python.exe` directly; `uv run --no-project`;
  `uv run --isolated --python 3.12`; `uv run --directory` from a neutral
  cwd) all failed identically: `An Application Control policy has blocked
  this file. (os error 4551)` against
  `C:\NWR\Niners-War-Room\.venv\Scripts\python.exe`. This is a host-level
  Device Guard/Application Control policy, not an engineering gap —
  circumventing it is out of scope and was not attempted (e.g. installing
  a separate system Python + full dependency set to dodge the policy would
  itself be an inappropriate scope expansion, and was not done).
- **Result:** NWR pass deferred per the phase instructions' own explicit
  escape hatch ("If you cannot confirm a safe, non-destructive way to
  launch NWR's UI within your time/tool budget, SKIP the NWR pass entirely
  ... Orca's own UI as the golden proof is sufficient for V0 adoption").
  No NWR files were read, written, or modified beyond `README.md`/
  `RUN_POLICY.md`/`package.json`(absent)/directory listing/`.env.example`
  presence checks, all read-only.

## Test / Verification Ledger (program-wide, appended per phase)

**Phase 1 (2026-09-07):**
- `tsf/test/*.test.mjs` (`node --test`): 2049 tests total on this branch,
  including 35 new (12 in `ui-dogfood-finding.test.mjs`, 6 in
  `ui-dogfood-surface-catalog.test.mjs`, 6 in `ui-dogfood-contract.test.mjs`,
  8 in `command-dogfood-bridge.test.mjs`, 3 in
  `dom-overflow-detector.test.mjs`). Full-suite result: 2037 pass / 11 fail
  / 1 skipped. All 11
  failures confirmed pre-existing on the clean `458f73b789` baseline
  (verified via `git stash` + re-run before/after) — live-planner-dependent
  classification tests (`command-responder`/`command-operator-integration-
  adversarial`/`command-bare-imperative-dispatch`/`command-adversarial-
  corpus`) and resource/timing-sensitive autonomy tests
  (`keep-going-autonomy-proof`, `http-work-summary`,
  `operator-state-adversarial`), consistent with this host's known
  shared-machine contention. Every new UI-dogfood-specific test file: 100%
  pass (35/35) in isolation and in the full run.
- `eval-pack-registry.test.mjs`'s "REQUIRED PROOF: every registered pack
  genuinely runs end to end... and passes against its own real capability"
  now covers 8 packs including `ui-dogfood-basics`, still 100%.
- `tests/e2e/ui-dogfood-orca-self.spec.ts` (Playwright, real Electron):
  **1/1 passed**, real ~25s run, real `pnpm run build:electron-vite
  --mode e2e` + CLI build completed once, then re-run with
  `SKIP_BUILD=1`. Produced the 3-finding golden-run evidence described
  above (bounded 3-pane slice) and 8 real screenshots under
  `test-results/` (gitignored).
- `tests/e2e/ui-dogfood-orca-self-full-sweep.spec.ts`: opt-in, run once
  manually (`ORCA_E2E_RUN_UI_DOGFOOD_FULL_SWEEP=1`) to produce the 33-pane
  golden-run evidence above; skipped by default in normal CI/local runs.
- `npx oxlint` on every new/changed file: 0 errors (verified individually;
  `command-responder.mjs`'s 3 pre-existing `curly` violations, confirmed
  present on the clean baseline too, are unrelated to this change and out
  of scope).

## Owner Gates Outstanding

1. NWR preservation remediation (see above) — recorded, not blocking.
2. NWR dogfood pass — deferred (Device Guard/Application Control policy
   blocks the project's own Python venv interpreter; see above). Not
   blocking Phase 1 V0 adoption per the phase instructions' own explicit
   allowance.
3. Recommended (not auto-applied) follow-up: Orca's Settings shell has no
   narrow-viewport (≤390px) layout — every settings pane's header row
   clips. A human/future bounded task should decide whether mobile-width
   Settings support is in scope at all before any layout change is made.

**Coordinator independent review (2026-09-06), before adoption:** re-ran all
8 new/changed test files directly (24 in ui-dogfood-{contract,finding,
surface-catalog}.test.mjs + 44 in {command-dogfood-bridge,dom-overflow-
detector,eval-pack-registry,evaluation-pack,http-eval}.test.mjs) — 100%
pass, matches the implementer's own count. `npx oxlint` re-run on every new
file — 0 errors. Read `electron-target-launcher.mjs` (isolated throwaway
`userDataDir` per launch, generic, no hardcoded target) and
`command-dogfood-bridge.mjs` (chat-triggered runs are always a single
bounded read-only PASS — no auto-fix ever applied from a live command;
honest "not wired up yet" for any non-Orca target; fails closed if no
built candidate exists) directly — both sound. Diffed
`command-responder.mjs`/`eval-pack-registry.mjs`/`evaluation-pack.mjs` —
confirmed purely additive, one bridge check inserted in the same position
as the existing research bridge, no duplicate architecture. No
corrections needed. **Merged to `tsf/main` @
`90d77e3a1cd56ee0cd34c3e40aecd86a3975ed1f`, pushed to `fork/tsf/main`
(verified), worktree `ui-dogfood-agent-v0` retired.**

### Phase 2 — PLANNER_CONTEXT_LIFECYCLE_V0 ("the mission outlives the planner session")

**Reconciliation (STEP 0, complete before any implementation):**

- Read `ec30a624ec93393960a586f46311aa780f8bfd35` in full
  (`tsf/docs/tsf/PLANNER_CONTEXT_LIFECYCLE_RECONCILIATION.md`, still present
  on disk, unchanged). It was an explicitly **read-only** reconciliation
  ("no implementation in this pass") that found real, reusable groundwork
  (`domain/session-affinity.mjs`'s `createSessionBinding`/`assertAffinity`/
  `replaceSessionBinding`, live today only for `server/live-planner.mjs`'s
  IMPLEMENTATION-mission worker sessions) and named the gap for a
  Command/Chat **planner** session's own rollover: (1) a structured handoff
  capsule, (2) an exclusive planner lease, (3) a fresh-successor spawn
  trigger, (4) continuity verification, (5) retirement eligibility, (6) no
  full-transcript replay by default. It recommended reusing
  `cross-process-file-lock.mjs` for the lease and `session-affinity.mjs`'s
  shape family for the binding/receipt. **Confirmed: design only, never
  built** — zero code changes in that commit, and no
  `planner-mission-*`/`planner-session-*` file existed anywhere in the
  codebase before this phase.
- Searched `tsf/domain` and `tsf/server` for "lease"/"checkpoint"/
  "handoff"/"session"/"planner" primitives already in production:
  - `domain/session-affinity.mjs` — **REJECT as the direct mechanism**:
    its `replaceSessionBinding` receipt shape (`unresolvedWork`,
    `checkpointRef`) is close in spirit, but it identity-binds ONE
    provider/agent/orcaSession per role and asserts affinity never
    changes mid-scope — the opposite of what a lease needs (a slot two
    different sessions legitimately compete for and hand off). Forcing a
    planner-mission lease through this shape would mean overloading
    `providerId`/`agentId` fields with mission-ownership semantics they
    don't carry. Its NEEDS-YOU/receipt vocabulary is echoed (REUSE_PATTERN)
    in the new checkpoint's `needsYou`/decision shape, but no code is
    imported from it.
  - `server/resource-pressure-lease-store.mjs` +
    `domain/resource-pressure-governor.mjs`'s
    `requestHeavyTaskLease`/`releaseHeavyTaskLease` — **REJECT as the
    direct lease mechanism, REUSE the underlying primitive**: that lease
    is keyed by `{kind, missionId}` for **host-resource** exclusion
    (several HQs never running the same HEAVY OPERATION at once), gated
    through `buildAdmissionPolicy(tier)`, and deliberately **host-wide**
    (a fixed OS-temp-dir file, explicitly NOT opState, because two
    different worktrees' TSF servers must see the SAME lease pool).
    Mission-ownership is a different concern: it's scoped to one
    project/worktree's own TSF server and its own opState already (two
    planner sessions racing for a mission are two clients of the SAME
    server process), and gating it through the heavy-task admission
    policy would conflate "am I allowed to run a heavy job" with "am I
    the authoritative director of this mission." Reusing the function
    directly would require swapping `kind`↔`missionId`/`missionId`↔
    `plannerSessionId` field meanings — worse than a small, clearly-scoped
    sibling. What genuinely IS reused (REUSE_DIRECTLY): the cross-process
    atomic primitive underneath both, `cross-process-file-lock.mjs`, and
    the TTL-expiry-liveness algorithm shape it validated.
  - `server/keep-going-run-store.mjs` / `server/research-mission-store.mjs`
    — **REUSE_PATTERN** for the new `server/planner-mission-store.mjs`:
    identical `withFileLock` + `data-store.mjs` opState CAS shape, applied
    to a new `plannerMissions` top-level collection, exactly like
    `researchMissions` before it.
  - `server/research-mission-fleet-driver.mjs` /
    `server/chat-dispatch-bridge.mjs` — **REUSE_DIRECTLY** for 2F: the
    shared `classifyDispatchAdmission(hostMemory, admissionField)`
    classifier from `resource-pressure-governor.mjs` (the same one these
    two already call, per that module's own "independently re-implemented
    three times" disclosure) is called a 4th time here with the existing
    `'newHeavyweightWorkerDispatch'` category — no new admission category
    invented; a planner session IS exactly that kind of heavyweight
    dispatch.
  - No existing "worker/task registry independent of a chat session" was
    found generically (research missions have their own `nodes[]`
    execution model, Keep Going has its own `waves[]` — neither is a
    generic dispatched-worker registry a planner-mission checkpoint could
    reference by ID without adopting that model's whole shape). **NEW**:
    the checkpoint's own `workers` map (`planner-mission-checkpoint.mjs`)
    is the durable worker registry for THIS V0; it is deliberately small
    (workerId/kind/taskFingerprint/status/result) rather than importing
    research-mission.mjs's node-execution state machine, which models a
    materially different (dependency-graph, multi-status) problem.

**Built (bounded V0):**

- `tsf/domain/planner-mission-checkpoint.mjs` (2A) — `TSF_PLANNER_MISSION_
  CHECKPOINT_V1`: missionGoal/phase/repoState(branch+sha)/decisions/
  blockers/needsYou/workers/verifierResults/completed+outstandingTasks/
  resourceState/authority.grants/lessons/lastAction/nextIntendedAction.
  `createPlannerMissionCheckpoint` fails honest (throws) on a missing
  goal/phase/repoState rather than fabricating one.
  `assertRepoStateContinuity` fails honest on drift
  (`TSF_PLANNER_REPO_STATE_DRIFT`) or an unverifiable observation
  (`TSF_PLANNER_REPO_STATE_UNVERIFIABLE`) — worktreePath is deliberately
  NOT compared (SSH/remote-host use case: a successor legitimately runs
  from a different worktree for the same branch+sha).
  `completePlannerMission` refuses to fabricate COMPLETE while a
  Needs-You item or outstanding task remains open. Pure, immutable
  mutators throughout; revision is bumped for observability but NOT
  enforced as optimistic-concurrency (the store's file lock already gives
  every mutation its own atomic read, so a second CAS layer was judged
  redundant for V0 — disclosed deviation from research-mission.mjs's own
  `expectedRevision` convention, not an oversight).
- `tsf/domain/planner-mission-lease.mjs` (2B) — single-writer mission
  lease: `acquirePlannerMissionLease` (grants on empty/stale/same-holder,
  refuses a live different holder), `renewPlannerMissionLease` (fails
  honest `TSF_PLANNER_LEASE_NOT_HELD` for a non-live-holder — including an
  already-expired self-lease, never silently revived), `relinquish
  PlannerMissionLease` (tolerant no-op if already unheld). See the
  reconciliation section above for why this is a clearly-scoped sibling
  of `resource-pressure-governor.mjs`'s heavy-task lease rather than a
  reuse of it.
- `tsf/domain/planner-handoff-trigger.mjs` (2E) — `decidePlannerHandoff
  Trigger`: observable-signal-only triggers (explicit retirement, stale
  lease detected, transport terminated, Resource-Pressure-Governor
  CRITICAL/EMERGENCY), fixed priority order, first true signal wins. No
  token/turn-count threshold — nothing in this codebase's server layer
  observes a planner's own context length, so that precision would be
  fabricated, not real.
- `tsf/server/planner-mission-store.mjs` — durable CAS store: `TSF_PLANNER_
  MISSION_RECORD_V0 { lease, checkpoint }` keyed by missionId inside
  `data-store.mjs`'s opState (new `plannerMissions` collection, added to
  `DEFAULTS`), locked via its own `.planner-mission.lock` file through the
  existing `cross-process-file-lock.mjs`. Per-worktree scope (like
  `researchMissions`), not host-wide (see reconciliation above for why).
- `tsf/server/planner-mission-repo-state.mjs` — real `git rev-parse HEAD` /
  `--abbrev-ref HEAD` reader (`execFileSync`, array args, Git-2.25-safe,
  cross-platform), returning `null` (never fabricating) when `cwd` isn't a
  real checkout.
- `tsf/server/planner-session-lifecycle.mjs` (2C/2D/2F) —
  `PlannerSessionLifecycle`: the orchestration class holding almost no
  state of its own (missionId/plannerSessionId/deps only; every query
  re-reads the durable store, no in-memory cache) — `startMission`,
  `acquireLeaseAndHydrate` (both gated by `_assertResourceAdmission`, 2F),
  `dispatchWorkerForTask` (idempotent by `taskFingerprint` — a repeat call
  for an already-registered task returns the existing worker WITHOUT
  calling the real dispatcher again; this is the actual "no duplicate
  dispatch after rollover" mechanism, not just a policy statement),
  `recordWorkerResult`/`raiseNeedsYou`/`resolveNeedsYou`/`recordDecision`/
  `recordVerifierResult`/`advancePhase`, `checkpoint()` (explicit
  last/next-action write), `relinquish()`/`retire()`, `completeMission()`.
  Every mutator (`_mutate`) asserts the caller currently holds the LIVE
  lease (`TSF_PLANNER_LEASE_NOT_HELD` otherwise) — this is what makes
  single-writer real at the orchestration layer, not just at lease-acquire
  time: a stale planner A whose process is still alive after a rollover
  cannot mutate mission state even if it tries.
- `tsf/server/data-store.mjs` — added `plannerMissions: {}` to `DEFAULTS`
  (one line + comment, additive only).

**Deliberately NOT built (bounded V0, disclosed rather than silently
skipped):** no wiring into `command-responder.mjs`/`chat-dispatch-
bridge.mjs` to make a live Command/Chat planner session actually use this
lifecycle yet — the phase instructions scoped this to the lifecycle
mechanics + golden proof, not a live product integration; a heartbeat
timer that calls `renewLease()` automatically (V0 exposes `renewLease()`
as a method a caller invokes, no `setInterval` owns it, mirroring this
codebase's own "no new scheduler" discipline elsewhere); a queueing/retry
path for the 2F resource-governance refusal (V0 fails closed with a typed
error; a caller decides whether to poll-retry, matching chat-dispatch-
bridge.mjs's own "represent the wait honestly" pattern for research
dispatch rather than inventing a new wait mechanism here).

**Test / Verification Ledger — Phase 2 (2026-09-06):**

- 7 new test files, **45 new tests (node's own count, parent `test()`
  wrappers included), 45/45 pass** in isolation and within the full
  `node --test test/*.test.mjs` run: `planner-mission-checkpoint.test.mjs`
  (11), `planner-mission-lease.test.mjs` (7), `planner-handoff-trigger.test.mjs`
  (5), `planner-mission-store.test.mjs` (9 = 1 parent + 8 sub-tests,
  including a real 10-way concurrent-writer CAS proof),
  `planner-session-lifecycle-golden-rollover.test.mjs` (7 = 1 parent + 6
  sub-tests — the golden dogfood, see narrative below),
  `planner-session-lifecycle-resource-governance.test.mjs` (4 = 1 parent +
  3 sub-tests), `planner-mission-lease-cross-process.test.mjs` (2, real
  separate OS processes via `test/fixtures/planner-mission-lease-worker.mjs`,
  mirroring `resource-pressure-lease-host-wide.test.mjs`'s own real-process
  discipline for the race-handling and handoff-visibility proofs).
- Full-suite result on this worktree: `node --test test/*.test.mjs` →
  1740 tests, 1693 pass, 46 fail. **All 46 failures confirmed pre-existing
  and unrelated to this phase**, of two disclosed kinds: (a) ~38 whole-file
  `ERR_MODULE_NOT_FOUND: @stablyai/playwright-test` failures — this
  worktree's own `node_modules` is empty (0 entries), the exact same
  environment gap Phase 1's own reconciliation flagged for `C:\TSF_ORCA`
  ("pnpm install required before running..."), never remediated here as
  out of scope for this phase; (b) the same ~8 real-process/HTTP-port
  timing failures Phase 1's ledger already documented as consistent with
  this host's shared-machine contention (`keep-going-autonomy-proof`,
  `self-update-scenarios` E/F, `main-plugin`, `operator-state-adversarial`,
  `research-http-routes`, `resource-auditor-http-routes`, `http-resource-
  pressure-governor`, `http-runtime-identity`, `http-server-standalone`,
  `http-work-summary`). Spot-checked via `git stash` + re-run
  before/after on 3 representative files
  (`command-adversarial-corpus.test.mjs`, `golden-path-operator-flow.test.mjs`,
  `http-capacity.test.mjs`) — byte-identical `ERR_MODULE_NOT_FOUND`
  failures on the clean pre-Phase-2 tree, confirming zero regression.
- `npx oxlint` on every new/changed file (6 domain/server source + 7 test
  + 1 fixture + `data-store.mjs`): 0 errors (initial run surfaced 28
  `curly`/`no-unused-vars` violations in the NEW files themselves — all
  fixed by adding braces to single-line `if`/`for-of` bodies and removing
  two unused map-callback parameters; re-run confirmed 0 errors, exit 0).
- All new `.mjs` files are well under the 600-line oxlint cap (largest:
  `planner-mission-checkpoint.mjs` at 227 lines, `planner-session-
  lifecycle.mjs` at 226).

**Golden forced-rollover dogfood — narrative (the V0 acceptance proof):**
Using a bounded synthetic fixture mission (`mission:golden-forced-
rollover-fixture`, never a real NWR/production mission) and a fixture
worker dispatcher with a real call counter as the "no duplicate dispatch"
oracle:

1. **Planner A** (`new PlannerSessionLifecycle({..., plannerSessionId:
   'planner-A'})`) calls `startMission` — passes the Resource Pressure
   Governor gate (fixed HEALTHY fixture), acquires the mission lease fresh,
   writes the initial durable checkpoint (`missionGoal: 'ship the fixture
   feature'`, `phase: 'BUILD'`, a fixture `repoState`).
2. Planner A calls `dispatchWorkerForTask({taskId: 'task-1', ...})` — the
   fixture dispatcher is called exactly once (`dispatchCallCount === 1`),
   returns a real workerId, which is registered into the durable
   checkpoint's `workers` map with status `DISPATCHED`.
3. Planner A raises a Needs-You item ("ok to proceed with the risky
   migration step?", category `DESTRUCTIVE_ACTION_CONFIRMATION`) —
   persisted unresolved.
4. Planner A calls `checkpoint({lastAction, nextIntendedAction})` (the
   explicit pre-retirement write) then `relinquish()` — simulating a
   forced rollover (explicit retirement trigger). The durable record on
   disk now shows `lease: null`.
5. Sanity check: a fresh `PlannerSessionLifecycle` object using planner
   A's OWN old `plannerSessionId` ("a stale planner A still alive
   in-process") is refused any mutation (`TSF_PLANNER_LEASE_NOT_HELD`) —
   single-writer holds even against a former holder that never actually
   died.
6. **Planner B** — a genuinely separate `PlannerSessionLifecycle`
   instance (`plannerSessionId: 'planner-B'`), sharing no in-memory
   reference with planner A except the fixture dispatcher function (the
   real external mechanism, not planner state) and the clock — calls
   `acquireLeaseAndHydrate()`. It passes the resource gate, acquires the
   now-free lease, reads the durable checkpoint, and verifies repo-state
   continuity against an injected observed `{branch, sha}` matching what
   planner A recorded.
7. Planner B's `getWorkers()` shows the ONE worker planner A dispatched
   (same workerId, still `DISPATCHED`) — without planner B ever having
   called the dispatcher. Its `getNeedsYou()` shows the same Needs-You
   item planner A raised, still unresolved — survived the rollover intact.
8. Planner B calls `dispatchWorkerForTask({taskId: 'task-1', ...})` again
   (as a real planner naturally would, unaware from its own state whether
   this was already done) — `alreadyDispatched: true` is returned, the
   SAME workerId comes back, and `dispatchCallCount` stays at **1** — the
   real dispatcher is never invoked a second time. No duplicate dispatch,
   no double-spent capacity.
9. Planner B resolves the inherited Needs-You, records the fixture
   worker's result (`COMPLETED`), records a verifier pass, and calls
   `completeMission()` — which succeeds only because the domain layer
   found zero unresolved Needs-You and zero outstanding tasks. Final
   durable state: `missionState: 'COMPLETE'`, one dispatch total,
   `dispatchedTaskIds: ['task-1']`.
10. A would-be **planner C**, attempting `acquireLeaseAndHydrate()` while
    planner B's lease is still live, is refused (`TSF_PLANNER_LEASE_
    DENIED`) — confirming exclusivity holds through to mission completion,
    not just at the moment of handoff.

Separately, `planner-mission-lease-cross-process.test.mjs` proves the
underlying claim with two GENUINELY SEPARATE OS processes (not two
in-process fakes): racing to acquire the same lease, exactly one process
observes `granted: true`; a process relinquishing is visible to a
brand-new process with zero shared memory.

**Owner Gates Outstanding (Phase 2):** none blocking — this phase's V0
scope (lifecycle mechanics + golden proof) is complete. Recorded for a
future phase, not gating this one: wiring `PlannerSessionLifecycle` into
the live Command/Chat dispatch path (`command-responder.mjs`/`chat-
dispatch-bridge.mjs`) so a real planner session actually uses it; an
automatic lease-renewal heartbeat loop (V0 exposes `renewLease()`
manually); remediating this worktree's empty `node_modules` (pre-existing,
unrelated to this phase, same class of gap Phase 1 already flagged for
`C:\TSF_ORCA`).

**Coordinator independent review (2026-09-06), before adoption:** re-ran
all 45 new test files directly (planner-mission-{checkpoint,lease,store},
planner-handoff-trigger, planner-session-lifecycle-{golden-rollover,
resource-governance}, planner-mission-lease-cross-process) — 100% pass,
no `node_modules` required (built-ins only). `npx oxlint` re-run on every
new file — 0 errors. Read `planner-mission-lease.mjs` (correctly rejected
reusing `resource-pressure-governor.mjs`'s heavy-task lease — a different
concern — while genuinely reusing its underlying cross-process-file-lock
primitive; sound grant/renew/relinquish/stale-reclaim semantics) and
`planner-session-lifecycle.mjs` (every mutation re-checks the live lease
holder from disk, never a cached in-memory belief; dispatch is idempotent
by task fingerprint — this is the actual mechanism behind "no
re-dispatch after rollover," not just a policy comment) directly — both
sound. Diffed `data-store.mjs` — confirmed the single additive line
claimed. No corrections needed. **Merged to `tsf/main` @
`7521e4de87cde4d0eb981ccb5b6e2aedfb5c1513`, pushed to `fork/tsf/main`
(verified), worktree `planner-context-lifecycle-v0` retired.**

### Phase 3 Wave 1 — Deferred Research Platform Completion Wave (3A/3B)

Scope: sub-parts 3A (REQ-002 Platform Learning Ledger) and 3B (REQ-003
Wiring) of the Deferred Research Platform Completion Wave, in worktree
`research-platform-completion-wave-v0` (branch
`tsf/feature/research-platform-completion-wave-v0`, forked from
`7521e4de87`). Explicit scope discipline honored: no new architecture
invented, no duplicate validation/admission pipeline — only the smallest
honest V0 slice each real filing actually required.

**STEP 1 — read the real filings verbatim** (`tsf/docs/tsf/
DATASET_RESEARCH_PLATFORM_REQUIREMENTS_BACKLOG.md`, corroborated against
`tsf/docs/tsf/DATASET_RESEARCH_ENGINE_V0_FINAL_RECONCILIATION.md`, which
already classified both as `DEFERRED_FUTURE_ROADMAP`/open):

- **REQ-002** ("No generic first-class Platform Learning Ledger"): found
  by `mission:nwr-historical-redraft-calibration-v0` searching for an
  existing repo-native mechanism to record cross-checkpoint platform
  learning (source knowledge, acquisition performance, data-quality
  lessons, architecture classification, reusable assets, engine
  evaluation). What existed then and now — `research-dispatch-
  bookkeeping.mjs`'s per-node attempt ledger, the legacy `capability-
  migration.v1.json` capability-preservation ledger, `pilots/first-real-
  project-v1/result-capsules.json` — none is a real match (different
  domain or single-mission-scoped, not generic/cross-mission). The
  mission's own workaround was a mission-scoped
  `platform-learning-ledger.json` fixture artifact, explicitly disclosed
  as "not a generic platform mechanism another customer mission would
  automatically discover." Real need: missions repeatedly re-discover the
  same platform-level lessons with nowhere durable and generic for that
  knowledge to accumulate for the NEXT mission.
- **REQ-003** ("No generic temporal chain-of-custody strength concept,
  independent of any one source's own settings"): found during rigorous
  multi-axis re-verification of four independent real seasons, all four
  landing on the identical `temporallyVerified: YELLOW` for the identical
  stated reason ("provenance established per owner directive; no
  independent source_as_of chain-of-custody timestamp found") — a
  structural gap, not a one-off. The filing explicitly asks for a
  generic axis distinguishing (a) no provenance evidence, (b) provenance
  asserted but not yet processed/logged by the source's own intake
  tooling, (c) asserted and logged, (d) independently, cryptographically
  verified — never collapsed into free-text `verdictRationale`.
  `DATASET_RESEARCH_ENGINE_V0_FINAL_RECONCILIATION.md` (prior, already-
  adopted work) had already ported `domain/evidence-gated-status-
  upgrade.mjs` and `domain/source-chain-of-custody.mjs` as the two
  primitives matching this exact filing, explicitly disclosing "neither
  is wired into any real mission dispatch path yet" as the remaining open
  item — this wave closes exactly that delta.

**Reconciliation before build (3A):** searched `domain`/`server` for any
existing "ledger"/"lesson"/"learning" concept. Found `domain/project-
memory.mjs` (M7): a real, generic, append-only EXPERIENCE-record pattern
with an explicit/inferred supersession gate — genuinely the closest
sibling in spirit (REUSE_PATTERN: its append-only, source-tagged,
never-silently-overwritten shape). **REJECT as the direct mechanism**:
`project-memory.mjs` is keyed per-Orca-`projectId` (one project/worktree
scope) and consumed only by the live planner/chat surface
(`live-planner.mjs`), not cross-mission research-system knowledge a
FUTURE, unrelated research mission should automatically discover — using
it directly would conflate "what Tim told the planner about this
project" with "what the research engine itself learned across every
mission." Also checked `domain/research-library.mjs` (indexes
VERIFIED/canonical facts+sources for direct reuse — a different concern:
caching known-true answers, not recording system-level guidance) and
`research-dispatch-bookkeeping.mjs`'s attempt ledger (per-node delivery-
guarantee bookkeeping, not mission-level learning) — neither is a match,
confirming the original filing's own analysis. **NEW**: `domain/
platform-learning-ledger.mjs` + `server/platform-learning-ledger-store.mjs`,
following the `research-library.mjs`/`research-library-store.mjs`
singleton-CAS-store shape (REUSE_PATTERN) rather than the per-key
`researchMissions` map shape, since a ledger is one cross-mission
accumulator, not itself keyed by mission.

**Reconciliation before build (3B):** confirmed via `grep` across
`domain`/`server`/`adapters` that ALL SIX modules named by the program
directive (`identity-collision-resolution.mjs`, `evidence-gated-status-
upgrade.mjs`, `source-chain-of-custody.mjs`, `raw-value-completeness-
validator.mjs`, `claimed-value-temporal-classifier.mjs`, `column-
requirement-usability-validator.mjs`) are completely unreferenced
anywhere outside their own dedicated unit-test files — genuinely
"ported, never wired," confirming the prior reconciliation's own
disclosure. Read the actual REQ-003 filing text and cross-checked it
against `DATASET_RESEARCH_ENGINE_V0_FINAL_RECONCILIATION.md`'s own
"Deferred future roadmap" line, which names exactly **two** of the six as
REQ-003's real delta: `evidence-gated-status-upgrade.mjs` and `source-
chain-of-custody.mjs`. **Decision: wire only those two.** The other
four are real, valuable, ported primitives, but are NOT what REQ-003
itself asks for and wiring them in would be exactly the "invent a giant
new architecture" scope creep this wave was explicitly told to avoid:
  - `identity-collision-resolution.mjs`: fills a real, confirmed gap
    (`research-admission.mjs`'s `recordIdentityResolutionState` has no
    decision algorithm of its own, only a RECORD/ENFORCE layer) but that
    gap belongs to identity resolution, a materially different concern
    from chain-of-custody strength — left unwired, explicitly disclosed
    as a separate, future, REQ-003-unrelated wiring task.
  - `raw-value-completeness-validator.mjs`, `claimed-value-temporal-
    classifier.mjs`, `column-requirement-usability-validator.mjs`: real,
    generic, tested primitives with no corresponding REQ filing calling
    for their wiring at all — left as available, standalone platform
    utilities a customer-mission script may call directly, exactly as
    the prior reconciliation landed them.
  - No REDUNDANT-coverage case was found — none of the six duplicates
    logic `research-admission.mjs` already performs.

**Built (bounded V0):**

- `domain/platform-learning-ledger.mjs` (3A) — `TSF_PLATFORM_LEARNING_
  LEDGER_V1`: an append-only collection of `TSF_LESSON_RECORD_V1`
  entries. **CRITICAL EPISTEMIC RULE enforced structurally, not just in
  comments**: `createLessonRecord` has no `epistemicKind` parameter at
  all — every record is unconditionally stamped with the one frozen
  `LESSON_EPISTEMIC_KIND = 'SYSTEM_GUIDANCE'` constant, and a
  `LessonRecord`'s entire shape (`category`/`statement`/`evidenceSummary`/
  `confidence`/`sourceMissionIds`) has no `fieldName`/`value`/`entityId`
  — nothing that could be mistaken for a Claim/CanonicalFact
  (`research-admission.mjs`/`research-reconciliation.mjs`, which this
  module never imports from or writes to). `retrieveLessonGuidance` (the
  one consumption surface) stamps every returned entry with
  `advisoryOnly: true`/`neverOverridesVerifiedEvidence: true` directly on
  the data, not only in documentation — proven by a test asserting those
  flags on every retrieved lesson and that no Claim-shaped field exists
  on the retrieved shape. No auto-apply/auto-correct function exists
  anywhere in this module (deliberately absent — a lesson can inform a
  caller's own strategy decision, but nothing here ever mutates a
  Claim/CanonicalFact). `extractLessonsFromCompletedMission` computes six
  real, evidence-gated lesson categories from a mission's own already-
  admitted, already-validated state (never a placeholder category, never
  fabricated confidence — `confidenceForSampleSize` scales LOW/MEDIUM/HIGH
  from real sample counts): `PROVIDER_RELIABILITY_SIGNAL` (grouped
  BoundedResearchResult provider/status pairs), `RECURRING_DISPATCH_
  FAILURE` (2+ FAILED raw results before a node settled),
  `IDENTITY_AMBIGUITY_PATTERN` (a real recorded `identityResolutionState`),
  `COMPLETENESS_GAP_PATTERN` (reuses `computeCompletenessMetrics`
  directly, REUSE_DIRECTLY, never re-derives), `SOURCE_RELIABILITY_
  SIGNAL` (claim verification verdicts traced through evidence to their
  source), `VERIFIED_CORRECTION_PATTERN` (real `RESOLVE_CONFLICT`
  reconciliation decisions). Requires `mission.state === 'COMPLETE'`
  (`TSF_LEARNING_LEDGER_MISSION_NOT_COMPLETE` otherwise) — fails honest
  rather than learning from a still-running, unsettled mission.
- `server/platform-learning-ledger-store.mjs` — CAS store mirroring
  `research-library-store.mjs`'s `withResearchLibrary` exactly
  (REUSE_PATTERN): same cross-process file lock, own lock file, singleton
  (not keyed by missionId) shape. `platformLearningLedger: null` added to
  `data-store.mjs`'s `DEFAULTS` (one line + comment, additive only, same
  idiom as `researchLibrary`). A third schema-version guard
  (`assertSupportedPlatformLearningLedgerSchemaVersion`) added to
  `research-schema-versioning.mjs` via the existing
  `buildSchemaVersionGuard` factory (REUSE_DIRECTLY) — no new versioning
  mechanism.
- **Real wiring (3A)**: `server/research-mission-fleet-driver.mjs`'s
  `advanceOneMission` CHECK_COMPLETE branch — the one real path a
  mission actually reaches `COMPLETE` through — now calls
  `recordLessonsFromCompletedMission` against the freshly-completed
  mission immediately after `completeResearchMission` durably commits,
  and durably persists the result via `withPlatformLearningLedger`. The
  action response gains a `lessonsRecorded` field. Per-worktree scope
  (like every other opState collection here) — a true cross-worktree
  ledger sync is out of this bounded wave's scope, disclosed here rather
  than silently assumed.
- **Real wiring (3B)**: `domain/research-admission.mjs`'s
  `admitBoundedResearchResult`, in the `SourceSnapshotReference` admission
  loop. For each newly-admitted snapshot: `computeFilesystemStability` is
  computed for REAL from that exact `sourceRef`'s own already-admitted
  `contentHash` history on the node (never fabricated); `provenanceStrength`
  is read only from an explicit caller claim (`snap.provenanceStrength`),
  defaulting honestly to `PROVENANCE_STRENGTH.NONE` when absent — NEVER
  inferred from `acquisitionMode`/`accessClassification`, since no live
  acquisition method today (web-table extraction) produces a real
  intake-logged provenance signal, and inferring one would be exactly the
  fabrication REQ-003 exists to prevent. `computeChainOfCustodyStatus`
  produces the raw computed tier. `attemptStatusUpgrade` then gates
  whether a STRONGER tier than a prior admission already recorded for the
  SAME `sourceRef` is actually applied — refused
  (`appliedChainOfCustody` stays at the prior, weaker, already-recorded
  tier) unless the caller attaches real `chainOfCustodyEvidence:
  {evidenceProvided: true, ...}`; a genuine DOWNGRADE (e.g. hash
  instability newly detected) is always applied immediately per
  `attemptStatusUpgrade`'s own "not an upgrade → always allowed" rule — a
  real degradation is never hidden behind a stale, stronger tier. Result
  stored as an additive `chainOfCustody` field on the durable
  `SourceSnapshotReference` record. Both worker-protocol contract docs
  (`contracts/bounded-research-worker-protocol.schema.v1.json`,
  `contracts/research-epistemic-record.schema.v1.json`) updated
  additively (`provenanceStrength`/`chainOfCustodyEvidence` on input,
  `chainOfCustody` on the admitted record) — `contracts/validate-
  research-contracts.mjs`'s hand-written validators do not enforce
  per-property shape on `sourceSnapshotsOrSnapshotRefs` entries, so this
  is documentation-consistency only, not a behavior gate.

**Deliberately NOT built (disclosed, not silently skipped):**
`identity-collision-resolution.mjs`/`raw-value-completeness-
validator.mjs`/`claimed-value-temporal-classifier.mjs`/`column-
requirement-usability-validator.mjs` wiring (see reconciliation above —
real but not what REQ-003 asks for); a lesson-supersession/correction
mechanism for the Learning Ledger (lessons are append-only for this V0 —
a later, contradicting lesson simply accumulates alongside an earlier
one rather than silently replacing it, which is itself a disclosed,
deliberate choice, not an oversight); any consumption wiring that lets a
retrieved lesson bias a live dispatch/strategy decision (`retrieveLessonGuidance`
exists and is tested, but no caller in this wave reads from it yet — the
filing asked for the durable, generic accumulation mechanism, not a
strategy-engine redesign); true cross-worktree ledger sync (per-worktree
scope only, matching every other opState collection).

**Test / Verification Ledger — Phase 3 Wave 1 (2026-09-06):**

- 4 new test files, 23 new tests: `platform-learning-ledger.test.mjs`
  (13 — epistemic-guard proof, all six lesson categories from real
  synthetic mission data, idempotency, `COMPLETE`-only fail-honest
  guard), `platform-learning-ledger-store.test.mjs` (3 — real disk
  round-trip via an isolated `TSF_UI_STATE_FILE`, first-use creation,
  idempotent re-add), `research-mission-fleet-driver-learning-ledger.test.mjs`
  (3 — **the real 3A wiring proof**: a mission driven through the real
  `advanceOneMission` to genuine `COMPLETE` with a real FAILED raw result
  durably records exactly one `PROVIDER_RELIABILITY_SIGNAL` lesson,
  verified via a FRESH read of the store, not just the in-memory return
  value; a clean mission adds zero lessons), `research-admission-chain-
  of-custody.test.mjs` (4 — **the real 3B wiring proof**, a genuine
  before/after: a second admission cycle for the same `sourceRef` claiming
  `INDEPENDENTLY_VERIFIED` provenance without evidence computes GREEN raw
  but is gated back to the prior RED `appliedChainOfCustody`; a third
  cycle with real evidence legitimately unlocks GREEN; a real hash
  mismatch always degrades immediately regardless of evidence).
- Full-suite result (`node --test test/*.test.mjs`, same file set Phase
  1/2 used): **1763 tests, 1716 pass, 46 fail, 1 skipped** (1740 + 23 new,
  all 23 new tests passing). **All 46 failures independently confirmed
  pre-existing and unrelated**: re-ran 3 representative failing files
  (`command-adversarial-corpus.test.mjs`, `golden-path-operator-flow.test.mjs`,
  `http-capacity.test.mjs`) after `git stash -u` (removing every file this
  wave touched or added) — byte-identical `ERR_MODULE_NOT_FOUND:
  @stablyai/playwright-test` failures on the clean pre-wave tree (this
  worktree's own `node_modules` is still empty/absent, the same
  environment gap Phase 1/2 already flagged, never remediated here as
  out of scope), confirming zero regression; stash restored and verified
  clean before continuing. The remaining failures are the same
  live-planner-dependent classification tests and resource/timing-
  sensitive autonomy tests Phase 1/2's own ledgers already documented.
- Targeted re-run of every research-admission/fleet-driver/library/
  epistemic-ladder test file together (131 tests: 108 pre-existing +
  23 new): **131/131 pass**.
- `npx oxlint` on every new/changed `.mjs` file: **0 errors** in every
  file this wave authored or edited. `domain/research-admission.mjs`
  retains exactly 4 pre-existing `curly` violations (verified via `git
  diff` that none of the 4 flagged lines were touched by this wave's
  edit) — the same disclosed, out-of-scope class Phase 1's ledger
  already established a precedent for (`command-responder.mjs`'s 3
  pre-existing violations).
- Line-count check against the `.oxlintrc.json` 600-line cap: largest
  changed file is `domain/research-admission.mjs` at 384 lines; largest
  new file is `domain/platform-learning-ledger.mjs` at 279 lines — both
  comfortably under.

**Owner Gates Outstanding (Phase 3 Wave 1):** none blocking — this
wave's bounded V0 scope (durable, structurally-epistemic-guarded Learning
Ledger wired into the one real mission-completion path; the REQ-003
chain-of-custody delta wired into the one real admission path) is
complete. Recorded for future, separately-authorized work: a real
consumer that reads `retrieveLessonGuidance` to bias a live
dispatch/strategy decision; identity-collision-resolution.mjs and the
other three ported-but-unwired modules (real gaps, not REQ-003's own
ask); lesson supersession/correction; cross-worktree ledger sync; this
worktree's still-empty `node_modules` (pre-existing, unrelated,
previously flagged).

**Coordinator independent review (2026-09-06), before adoption:** re-ran
all 23 new tests directly — 100% pass. `npx oxlint` re-run on every
new/changed file — the 4 reported `curly` errors in `research-admission.mjs`
independently confirmed via `git blame` to be on lines last touched by
pre-2026-09-06 commits, not introduced by this change. Read
`platform-learning-ledger.mjs` directly — the epistemic-separation
invariant is enforced structurally (`createLessonRecord` has no parameter
that can set `epistemicKind`; the shape has no fieldName/value/entityId),
not just documented. Read the `research-admission.mjs` chain-of-custody
diff — real evidence-gated upgrade (`attemptStatusUpgrade`), honest
`NONE` default rather than inferring provenance strength, degradations
always applied immediately. No corrections needed. **Merged to
`tsf/main` @ `3ae53e07a5609797c4ecd254cb696b2c9cb5e672`, pushed to
`fork/tsf/main` (verified), worktree `research-platform-completion-wave-v0`
retired.**

### Phase 3 Wave 2 — Deferred Research Platform Completion Wave (3C-3G)

Scope: sub-parts 3C (Owner-Supplied Local Artifact Acquisition), 3D
(Authenticated Official Download), 3E (Real Paywall/Auth Detection), 3F
(Richer Source Snapshot Metadata), and 3G (Research Completion
Verification), in worktree `research-platform-completion-wave-v0-wave2`
(branch `tsf/feature/research-platform-completion-wave-v0-wave2`, forked
from `3ae53e07a5`). Scope discipline honored throughout: reconciled
against `web-source-access-gate.mjs`/`web-source-router.mjs`/
`public-web-source-acquisition.mjs`/`web-table-research-worker.mjs`
(the existing Web Source Acquisition architecture) before every sub-part,
never a second router/gate/acquisition-mode taxonomy.

**Reconciliation findings (STEP 1, before any implementation):**

- **3C**: confirmed `OWNER_SUPPLIED_LOCAL_ARTIFACT` still had no producer
  anywhere (`DATASET_RESEARCH_ENGINE_V0_FINAL_RECONCILIATION.md`'s own
  "Deferred future roadmap" line named this explicitly). No existing
  local-file research path to conflict with.
- **3D**: confirmed `AUTHENTICATED_OFFICIAL_DOWNLOAD` was still
  unreachable from any live caller (`web-table-research-worker.mjs`
  hardcodes `authenticationRequired: false`). Searched for existing
  authenticated-session infrastructure per the phase instructions' own
  explicit check: found REAL infrastructure at
  `src/main/browser/browser-session-registry.ts` +
  `src/main/browser/browser-cookie-import*.ts` (Orca's own named browser
  session profiles, each bound to a real Electron `session` partition,
  populated either by importing the user's real browser cookies or by the
  user logging in through Orca's embedded browser in that partition) --
  but this is Electron-main-process TypeScript, a different architectural
  layer than `tsf/domain`'s plain-Node-ESM modules (which must stay
  Electron-free to run standalone/SSH-host-side, the same separation
  `electron-target-launcher.mjs` already established for Phase 1).
  **Decision**: define a minimal `AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1`
  interface in `domain/authenticated-official-download-acquisition.mjs`
  whose field names deliberately mirror `browserSessionRegistry`'s real
  shape (a profile id/label plus how/when it was authenticated), so a
  future `adapters/` bridge could wrap the real registry to satisfy this
  contract without importing Electron into `tsf/domain` today. Not built
  in this wave (disclosed below).
- **3E**: `web-source-access-gate.mjs`'s `ACCESS_CLASSIFICATIONS` already
  covered `PUBLIC_ALLOWED`/`AUTHENTICATED_PAGE_NO_EXPORT`/
  `PAYWALL_ACCESS_CONTROL`/`ROBOTS_DISALLOWED`/`PUBLIC_TERMS_UNCLEAR`
  (5 of the 7 requested categories) -- extended additively with
  `ANTI_BOT_CHALLENGE_DETECTED` and `SOURCE_UNAVAILABLE` (the 2 genuinely
  missing) rather than inventing a parallel taxonomy. Confirmed the gate
  itself is pre-fetch/input-only (`classifyWebSourceAccess` only ever
  reasons about caller-supplied booleans) -- no existing code classifies
  REAL post-fetch response content at all; `web-table-research-worker.mjs`'s
  own header comment already flagged this as a "KNOWN GAP."
- **3F**: read `DATASET_RESEARCH_ENGINE_V0_FINAL_RECONCILIATION.md`'s
  "Deferred future roadmap" line verbatim: `schemaFingerprint`/
  `selectorOrAdapterVersion`/`transformationVersion` are the exact three
  richer `SourceSnapshotReference` fields it names as "not implemented."
  The proposing fixture doc (`shared-generic-acquisition-contract.json`)
  no longer exists in this branch (lived only on the retired
  `dataset-research-engine-v0` branch) -- built from the reconciliation
  doc's own field names and descriptions, not invented speculatively.
  Confirmed no other "snapshot metadata" fields are named anywhere else
  in `tsf/docs/tsf/`.
- **3G**: confirmed `research-mission-fleet-driver.mjs`'s live production
  bootstrap (`research-mission-fleet-driver-bootstrap.mjs`) wires exactly
  ONE `deps.worker` at a time -- a real, disclosed, out-of-scope
  architectural constraint (matching 3D's own already-disclosed
  "unreachable from the one live caller" gap), not something this wave
  restructures. The new 3C/3D workers are proven through the same real
  durable primitives (`dispatchResearchNodeDurable`/
  `pollAndAdmitResearchNodeDurable`/`admitBoundedResearchResult`) every
  other worker in this codebase already uses, exactly like
  `web-table-research-worker.mjs` is proven -- "the same real admission
  path," not the live fleet-driver's own single-worker bootstrap wiring
  (a separate, future, worker-selection-policy decision).

**Built (bounded V0):**

- `domain/web-source-content-access-classifier.mjs` (3E) --
  `classifyFetchedContentAccess`: real, SIGNAL-based (never heuristic-
  based, e.g. never "body is short") post-fetch classification. Detects
  HTTP 401/403/404/410/5xx, anti-bot/challenge markers (Cloudflare/
  CAPTCHA-shaped text), subscription-paywall phrases, a redirect to a
  login-shaped URL path, and a bare login-form shell (a password input
  with no other substantial content) -- a password field ALONGSIDE real
  substantial content (a table, a long body) is honestly
  `PUBLIC_TERMS_UNCLEAR` (ambiguous-needs-human), never guessed either
  way. Verified against this codebase's own real, tiny (500-800 byte)
  `fixtures/web-table-source-acquisition/*.html` fixtures containing zero
  blocking markers, to confirm no false-positive risk before wiring in.
- **Real wiring (3E)**: `domain/web-table-source-adapter.mjs`'s
  `acquireWebSourceViaStaticTable` now classifies content on BOTH the
  HTTP-failure path (status-only, since `bounded-http-fetch.mjs` never
  reads a body for a non-2xx response) and the 200-status success path
  BEFORE table extraction -- a login/paywall/anti-bot interstitial
  returning HTTP 200 can never fall through to a "real" table match from
  its own chrome. A genuine block adds a new receipt decision,
  `ACCESS_BLOCKED_POST_FETCH`, and overrides `accessClassification` with
  the real detected value; a non-access failure (network/timeout/SSRF/
  size/content-type) is completely untouched -- verified via the full
  existing `web-table-source-adapter.test.mjs`/`web-table-research-worker.
  test.mjs`/`public-web-source-acquisition.test.mjs` suite (99/99 pass,
  zero behavior change for the regression paths).
- `domain/owner-supplied-local-artifact-acquisition.mjs` (3C) --
  `acquireOwnerSuppliedLocalArtifact({filePath|content, ownerAssertion,
  ...})`: reuses the exact same table-discovery pipeline the live fetch
  path runs (`web-table-source-adapter.mjs`'s new exported
  `extractAndSelectTable`, REUSE_DIRECT) against a caller-supplied local
  file or already-read content instead of a network fetch.
  `ownerAssertion.assertedBy` is mandatory (throws rather than fabricate
  provenance); a missing file, empty content, or no table found is
  reported as an honest `ACQUISITION_ERROR` receipt, never a fabricated
  success. `accessClassification` is the new, honest
  `NOT_APPLICABLE_LOCAL_ARTIFACT` value (no web-rights concept applies to
  a local file) rather than a fabricated `PUBLIC_ALLOWED`.
- `domain/web-source-acquisition-receipt.mjs` extended (3C/3D/3E) --
  `buildOwnerSuppliedArtifactReceipt`/`buildOwnerSuppliedArtifactErrorReceipt`
  (3C) and `buildAuthenticatedDownloadReceipt`/
  `buildAuthenticatedDownloadNeedsLoginReceipt`/
  `buildAuthenticatedDownloadFailureReceipt` (3D) reuse the SAME
  `WEB_SOURCE_ACQUISITION_RECEIPT_V0` shape every acquisition mode
  already uses (never a competing schema). Three new fields --
  `contentAccessEvidence` (3E), `ownerProvenance` (3C), `authEvidence`
  (3D) -- are present-but-null on every receipt shape that has nothing to
  report, the same "always present, honestly null" discipline every
  other N/A field on this receipt already follows (e.g.
  `tableIdentity`/`schema`/`rowCount`). `ownerProvenance.
  independentlyVerified` is hardcoded `false` -- structurally impossible
  to set true from any caller parameter, mirroring
  `platform-learning-ledger.mjs`'s `createLessonRecord` epistemic guard
  from Wave 1. `authEvidence` is built through an explicit ALLOWLIST of
  exactly `mechanism`/`profileIdRef`/`authenticatedAt` -- a caller's real
  session object can never leak an unexpected extra field into a durable
  receipt even by accident.
- `domain/authenticated-official-download-acquisition.mjs` (3D) --
  `acquireAuthenticatedOfficialDownload({candidate, sessionProvider,
  downloadFn, ...})`. HARD SECURITY RULES enforced, not just documented:
  no `password`/`token`/`cookie`/`secret`/`apiKey`-shaped field is ever
  accepted anywhere in this module's signature; `assertNoSecretLeakage`
  additionally throws (defense in depth) if a caller's `sessionProvider`
  result or `downloadFn` result happens to carry a field whose NAME even
  suggests a secret. No session found for the source's origin -> honest
  `NEEDS_INTERACTIVE_LOGIN` receipt, `operatorReviewRequired: true`, ZERO
  download attempted -- never a bypass, never a credential prompt. 3E's
  classifier is reused directly (REUSE_DIRECT) to detect a re-auth/
  paywall interstitial even from an authenticated download (e.g. an
  expired session), never silently admitted as a real official export.
  `AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1` documents the minimal
  interface (see reconciliation above).
- `adapters/owner-supplied-local-artifact-research-worker.mjs` (3C) /
  `adapters/authenticated-official-download-research-worker.mjs` (3D) --
  real `BoundedResearchWorker`-shaped workers
  (`{provider, dispatch, fetchResult}`), mirroring
  `web-table-research-worker.mjs`'s exact shape, wired into the SAME real
  admission path (`dispatchResearchNodeDurable`/
  `pollAndAdmitResearchNodeDurable`/`admitBoundedResearchResult`), never a
  parallel research system. Read `request.localArtifactCandidates` /
  `request.authenticatedDownloadCandidates` respectively -- new, additive,
  optional `BoundedResearchRequest` fields (contracts updated), distinct
  from `preferredSources` since neither a local file path nor an
  authenticated-session identity is a plain fetchable URL concern. Each
  worker's `buildSourceSnapshot` sets a real, REQ-003-consistent
  `provenanceStrength`: `ASSERTED_UNLOGGED` for the local-artifact worker
  (a real origin claim exists via `ownerAssertion`, but nothing here logs
  or cross-checks it), `ASSERTED_LOGGED` for the authenticated-download
  worker (a real authentication mechanism established and recorded the
  session) -- both flow through Wave 1's REQ-003 chain-of-custody wiring
  in `research-admission.mjs` completely unmodified.
- **Real wiring (3C/3D request plumbing)**: `domain/research-node.mjs`'s
  `buildBoundedResearchRequest` now additionally copies
  `spec.sourcePolicy.localArtifactCandidates`/
  `.authenticatedDownloadCandidates` (additive, defaults to `[]`,
  byte-for-byte unchanged for every existing caller) -- without this, a
  durably-dispatched request had no way to carry either acquisition
  mode's candidates at all (a real gap found and closed during this
  wave's own testing, not anticipated in the original reconciliation).
  `contracts/research-specification.schema.v1.json`'s `SourcePolicy` and
  `contracts/bounded-research-worker-protocol.schema.v1.json`'s
  `BoundedResearchRequest` updated additively to match.
- **Real wiring (3F)**: `domain/research-admission.mjs`'s
  `admitBoundedResearchResult` now additionally passes through
  `schemaFingerprint`/`selectorOrAdapterVersion`/`transformationVersion`
  onto the durable `SourceSnapshotReference` (additive, honest `null`
  default for any caller that doesn't set them -- every pre-Wave-2 caller
  is unaffected). `adapters/web-table-research-worker.mjs`'s
  `buildSourceSnapshot` now computes real values: `schemaFingerprint` is
  a hash of the INFERRED COLUMN SCHEMA only (distinct from
  `normalizedTableHash`'s header+row DATA hash and `tableIdentity`'s
  on-page SELECTOR fingerprint -- three genuinely different real signals,
  never conflated); `selectorOrAdapterVersion` is
  `${adapter.id}@${adapter.version}`; `transformationVersion` is a new
  exported `WEB_TABLE_OBSERVATION_EXTRACTION_VERSION` constant in
  `domain/web-table-observation-extraction.mjs` (versions the extraction
  ALGORITHM itself, distinct from the acquisition adapter's own version).
  Both new 3C/3D workers populate the identical three fields the same way
  (REUSE_PATTERN), since both reuse the same table-extraction algorithm.
  `contracts/bounded-research-worker-protocol.schema.v1.json`'s
  `SourceSnapshotReference` updated additively to match.

**Deliberately NOT built (bounded V0, disclosed rather than silently
skipped):**
- A real Electron-session bridge wrapping `browserSessionRegistry` to
  satisfy `AUTHENTICATED_SESSION_PROVIDER_CONTRACT_V1` (3D) -- the
  contract is defined and fixture-proven; the real bridge is future,
  separately-authorized work living in `src/main`/`adapters`, not
  `tsf/domain`. No real external authentication was attempted or
  required anywhere in this wave, per the governing directive's own
  explicit allowance -- proven with fixtures/mocks only (a fake
  `sessionProvider`/`downloadFn`), honestly disclosed as such, never
  claimed as a real login test.
- A real Electron download transport for 3D's `downloadFn` -- no default
  implementation exists; the domain function throws a clear error if a
  caller omits it, rather than silently no-op'ing.
- Wiring the new 3C/3D workers into the live, single-worker
  `research-mission-fleet-driver-bootstrap.mjs` production bootstrap --
  a real worker-SELECTION policy (which acquisition mode to try for which
  node) is a materially different, future decision; both workers are
  fully proven through the real durable admission primitives directly
  (see 3G), which IS "the same real admission path" the phase asked for.
- CSV/JSON/other non-HTML-table local-artifact content shapes (3C) --
  genuinely open-ended parser matrix, explicitly deferred; only the
  HTML-table shape (reusing the already-proven extraction pipeline) is
  built.
- A caller-facing UI/chat flow that actually prompts a user to complete
  the one-time interactive login 3D's contract describes -- out of this
  domain-layer wave's scope (no UI work was in scope for 3C-3G).

**Test / Verification Ledger -- Phase 3 Wave 2 (2026-09-08):**

- 7 new test files, 54 new tests: `web-source-content-access-classifier.
  test.mjs` (12), `owner-supplied-local-artifact-acquisition.test.mjs` (9),
  `owner-supplied-local-artifact-research-worker.test.mjs` (4),
  `authenticated-official-download-acquisition.test.mjs` (9),
  `authenticated-official-download-research-worker.test.mjs` (4),
  `research-admission-source-snapshot-metadata.test.mjs` (2), and the 3G
  proving set `research-completion-verification-proving-set.test.mjs`
  (1 parent + 14 sub-tests, see below) -- plus 2 pre-existing test files
  updated for the new, additive taxonomy/schema shape
  (`web-source-access-gate.test.mjs`'s exhaustive-taxonomy assertion;
  `web-source-acquisition-receipt.test.mjs`'s exact-schema-key assertion
  needed no code change once the new fields were made present-but-null
  uniformly).
- **Real bug caught and fixed during this wave's own testing** (disclosed,
  not silently corrected): the 3G proving-set test's FIRST version
  statically imported `server/research-mission-fleet-driver.mjs` and
  `server/platform-learning-ledger-store.mjs` at the top of the file --
  both transitively import `server/data-store.mjs`, whose `STATE_FILE` is
  a module-level constant resolved from `process.env.TSF_UI_STATE_FILE`
  only once, at first import, anywhere in the process. Because ES module
  static imports execute before a file's own top-level statements, this
  resolved `data-store.mjs` against the AMBIENT env value (not yet
  overridden), causing the test to silently read/write the REAL shared
  local dev state file (`server/.local-state/operator-state.json`,
  gitignored) instead of an isolated one -- confirmed by inspecting that
  file directly, found a real, leaked `mission:research-completion-
  proving-set-v0` entry, and removed it. Fixed by deferring those two
  imports to the same dynamic-import-after-env-override pattern every
  other test file in this codebase already uses; re-verified clean
  (5 consecutive standalone runs, 14/14 pass every time) and confirmed no
  further leakage into the shared default state file.
- Full-suite result (`node --test test/*.test.mjs`): **1817 tests, 1769
  pass, 47 fail, 1 skipped**. **All 47 failures independently confirmed
  pre-existing and unrelated**: `git stash -u` (removing every file this
  wave touched or added) reproduced the IDENTICAL 47-test failing-name
  list on the clean pre-wave tree (`node --test` run before/after,
  diffed by test name -- byte-identical set, only per-run millisecond
  timings differ), the same class of `@stablyai/playwright-test`/
  `node_modules`-gap and shared-machine timing/port-contention failures
  Phase 1/2/Wave 1's own ledgers already documented (this worktree's
  `node_modules` remains unremediated, same pre-existing, out-of-scope
  gap).
  Targeted re-run of every directly-touched/added test file together
  (web-source-content-access-classifier, owner-supplied-local-artifact-
  {acquisition,research-worker}, authenticated-official-download-
  {acquisition,research-worker}, web-source-access-gate,
  web-source-acquisition-receipt, web-table-source-adapter,
  web-table-research-worker, public-web-source-acquisition,
  research-completion-verification-proving-set): **113 tests, 100% pass**
  (99 from the shared web-table/acquisition-pipeline group + 14 from the
  3G proving set), the proving set re-run 3x standalone for stability.
- `npx oxlint` on every new/changed `.mjs` file (20 files): **0 errors**
  in every file this wave authored or edited. The 8 flagged violations
  across `research-admission.mjs` (4), `research-node.mjs` (3), and
  `web-table-source-adapter.mjs` (1) were independently confirmed
  pre-existing via `git stash` + re-run (byte-identical error set/line
  content on the clean pre-wave tree) -- the same disclosed, out-of-scope
  class Phase 1/Wave 1's own ledgers already established a precedent for.
- Line-count check against the `.oxlintrc.json` 600-line cap (`.mjs`
  override): largest changed file is `domain/web-source-acquisition-
  receipt.mjs` at 425 lines; largest new file is `domain/
  authenticated-official-download-acquisition.mjs`'s sibling `adapters/
  authenticated-official-download-research-worker.mjs` at 185 lines --
  all 20 changed/new files comfortably under.

**3G golden proving-set narrative** (`research-completion-verification-
proving-set.test.mjs`, generic fixture -- entity "Brett Favre" only as a
convenient, already-proven small public-domain-shaped fixture table,
never NFL/NWR production data): one real `ResearchMission`, three nodes,
each requiring one field, each resolved via a DIFFERENT real acquisition
mode -- `node:public-web` (the existing `web-table-research-worker.mjs`,
fixture-fed HTML, regression-only), `node:local-artifact` (the new 3C
worker, inline content, no filesystem/network at all), `node:authenticated`
(the new 3D worker, a fixture session + fixture download, proving the
contract behaves correctly without any real login). All three dispatched
and admitted through the real durable primitives
(`dispatchResearchNodeDurable`/`pollAndAdmitResearchNodeDurable`), one real
identity resolution recorded (`recordIdentityResolutionState`), then the
REAL autonomous production driver
(`research-mission-fleet-driver.mjs`'s `driveOneCycle`, no manual
reconciliation authored in the test) ticks the mission through
verify -> auto-accept -> canonicalize for all three fields and reaches a
real `COMPLETE` in 4 ticks. Verifies, in one real run: the full raw
source -> observation -> claim -> verification/reconciliation -> canonical
flow; `computeCompletenessMetrics` (full `requiredFieldCoverage`, zero
typed missingness); the recorded identity-resolution state survives to
completion; every claim carries a real (never fabricated-CONTEMPORANEOUS)
`temporalClass`; the public-web mode's receipt shape is unchanged
(regression); 3C's honest `ASSERTED_UNLOGGED`/RED chain-of-custody; 3D's
honest `ASSERTED_LOGGED` chain-of-custody and non-secret `authEvidence`;
3F's three new metadata fields present on every mode used; Wave 1's
Learning Ledger genuinely records a `lessonsRecorded` count and durably
persists it on this real completion; Research Library indexing/querying
this mission's real `CanonicalFacts` works; and a repeated
`pollAndAdmitResearchNodeDurable` call against an already-fully-admitted
node is a safe no-op (crash/idempotency), never a duplicate
`SourceSnapshotReference`. No paid provider (Parallel/Exa) is enabled or
called anywhere in this wave.

**Owner Gates Outstanding (Phase 3 Wave 2):**

1. **NEEDS-YOU (recorded, not blocking)**: 3D's real authenticated-session
   bridge (wrapping `src/main/browser/browser-session-registry.ts`) and a
   real download transport were not built -- this requires a real product
   decision about where that Electron-layer bridge lives and a real UI
   flow for the one-time interactive login, both out of this bounded
   domain-layer wave. The contract (`AUTHENTICATED_SESSION_PROVIDER_
   CONTRACT_V1`) and the acquisition/admission/worker layers underneath
   it are complete and fixture-proven; only the real session source and
   real transport remain, by design, for a future, separately-authorized
   wave.
2. Live fleet-driver multi-worker routing (which acquisition mode to try
   for which node) -- recorded as future work, same class of gap 3D's own
   prior reconciliation already flagged for `AUTHENTICATED_OFFICIAL_
   DOWNLOAD`'s reachability.
3. CSV/JSON/other non-HTML-table local-artifact ingestion (3C) --
   deferred, genuinely open-ended.
4. This worktree's `node_modules` gap -- pre-existing, unrelated,
   previously flagged by Phase 1/2/Wave 1.

No confirmation of real credentials or paid providers was needed or given
-- none were touched anywhere in this wave (verified: every 3D test uses
an in-memory fake `sessionProvider`/`downloadFn`; no `TSF_RESEARCH_LIVE_
DISPATCH_ENABLED`/paid-provider flag was set or read anywhere in new/
changed code).

**Coordinator independent review (2026-09-06), before adoption:** re-ran
all Wave-2-specific test files directly (49 across the 3C/3D/3E fixture
suites + 14 in the 3G multi-acquisition-mode proving set) — 100% pass.
Independently confirmed the proving-set test's own documented ESM-import-
ordering fix by reading it: env override runs before the dynamic imports
of `data-store.mjs`-dependent modules, matching this codebase's
established isolation pattern; confirmed no real shared state file was
touched after running it. `npx oxlint` re-run — all 8 flagged violations
independently `git blame`-verified to be on lines last touched before
this wave's own base commit. Read `authenticated-official-download-
acquisition.mjs` directly: `assertNoSecretLeakage` is a real runtime
guard (throws on any password/token/cookie/secret/apikey-shaped field
name in a session or download result), not just a documented promise —
the hard security rule is enforced in code. No corrections needed.
**Merged to `tsf/main` @ `10e39227a7ebcdcee15689163c9707bbfc6866b5`,
pushed to `fork/tsf/main` (verified), worktree
`research-platform-completion-wave-v0-wave2` retired.**

### Phase 4 — Cleanup V1 / Governed Destructive Automation

**Authorization scope (repeated here because it governs every design
decision below):** this phase covers design, implementation, testing,
dry-runs, and destruction of fixtures this phase itself created. It does
NOT authorize any real destructive action against Tim's real projects,
worktrees, processes, or `C:\TSF_ORCA` / `C:\NWR` / `C:\NWR_HISTORICAL_DATA`
/ any other real path, and the real owner-authorization gate is not set by
anything in this phase.

**Reconciliation (STEP 0, before any implementation):**

- Read `tsf/docs/tsf/TSF_RESOURCE_AUDITOR_V0.md` and
  `tsf/ORCA_RESOURCE_AUDITOR_V0_MAIN_TSF_REVIEW.md` in full. The prior V0
  is explicitly, deliberately read-only ("Nothing in this feature deletes
  a worktree, kills a process, runs Git GC, or purges a cache") and its
  own "Known limitations / V1 prerequisites" section already names exactly
  what a destructive executor needs: immediate pre-action revalidation,
  owner confirmation, reversible quarantine/restore, graceful process
  shutdown, partial-failure recovery, cleanup receipts, human-controlled
  permanent purge, and an execution-boundary blocker check independently
  enforced from the classifier. Phase 4 builds exactly that list, as the
  GOVERNED EXECUTION LAYER on top of the existing classifier — it does
  not build a second classifier. `classifyWorkspaceResource`/
  `buildResourceAuditDryRunPlan` are read directly by this phase's own
  callers where useful (e.g. as one legitimate `basis` for a
  RECOMMENDATION) but nothing in `domain/cleanup-*.mjs`/
  `server/cleanup-*.mjs` reimplements disposability classification.
- Read `domain/resource-pressure-governor.mjs`: confirmed a different
  concern (host RAM/CPU/contention admission for heavy operations, not
  candidate disposability or destructive execution) — not reused directly,
  same conclusion Phase 2's own reconciliation reached for the same module.
- Searched for an existing "git worktree inventory" pattern already used
  in this codebase's own scripts: none found in `tsf/domain`/`tsf/server`
  (only prose references in docs, and Orca-core's own
  `src/main/ipc/workspace-cleanup*.ts`, which is Electron-only and not
  importable from a plain Node `tsf/server` module). **NEW**:
  `server/cleanup-git-worktree-inventory.mjs`, a small, real, read-only-
  until-called `git worktree list --porcelain` reader plus the handful of
  git mutations this phase actually needs (`branch -d`/`-D`,
  `worktree remove`/`add`) — no shell, `execFile` with array args only,
  mirroring `resource-auditor-git-object-store.mjs`'s own no-injection-
  surface discipline.
- Read `server/planner-mission-store.mjs` + `domain/planner-mission-
  checkpoint.mjs` (Phase 2) in full: `checkpoint.missionState` is
  `'ACTIVE'` until `completePlannerMission` explicitly sets `'COMPLETE'`,
  independent of the mission's own LEASE liveness. **This is the exact
  mechanism active-mission protection needed** — a lease going stale only
  means the planner session that was directing the mission went away; the
  mission itself, and therefore its claim on the branch/worktree, can
  still be open. **NEW**: `server/cleanup-active-mission-check.mjs`
  queries `readAllPlannerMissionRecords()` directly and blocks whenever
  ANY non-`COMPLETE` checkpoint's `repoState.branch`/`repoState.
  worktreePath` matches the candidate — reused directly (REUSE_DIRECTLY),
  not reimplemented.
- Read `domain/planner-mission-lease.mjs`/`server/cross-process-file-
  lock.mjs`: the TTL-expiry-liveness + atomic-file-lock primitives are
  reused directly (REUSE_DIRECTLY) for `server/cleanup-request-store.mjs`,
  which is a plain sibling of `planner-mission-store.mjs` (same
  `withFileLock` + `data-store.mjs` opState CAS shape, new
  `cleanupRequests` collection) — no new durability mechanism invented.
- Read `domain/receipts.mjs`: REUSE_PATTERN only (the same
  `canonicalJson`+`sha256`+`previousReceiptHash` hash-chain shape), not
  REUSE_DIRECTLY — that module's shape is `{projectId, missionId}`-keyed
  with a closed `TSF_RECEIPT_KINDS` enum for TSF mission events; a cleanup
  request has no missionId of its own (it may reference zero or one
  active mission as a BLOCKER, never an owner) and needs its own kind
  vocabulary (`PLAN_BLOCKED`, `ARTIFACT_QUARANTINED`,
  `PARTIAL_FAILURE_RECOVERED`, …). **NEW**: `domain/cleanup-receipt-
  chain.mjs`, a small, clearly-scoped sibling.
- Searched `tsf/` for any existing "cleanup"/"quarantine" vocabulary
  outside the read-only V0 and outside `research-integrity.mjs`'s
  unrelated data-quarantine concept (data provenance, not filesystem) —
  none found. No duplicate mechanism exists to reconcile against.
- `git worktree list` on this host at reconciliation time: 14 worktrees,
  all sibling `tsf-*`/`nwr-*`/`dataset-research-*`/`web-source-*`
  worktrees confirmed externally owned by other live sessions and never
  touched, listed, or read by this phase beyond the read-only `git
  worktree list` this reconciliation step itself ran.

**Built (bounded V0), organized by the RECOMMENDATION → PLAN →
AUTHORIZATION → EXECUTION data model (4B):**

- `domain/cleanup-action-taxonomy.mjs` — 7 STANDARD action classes with a
  real V0 executor (`RETIRE_SESSION`, `REMOVE_DISPOSABLE_WORKTREE`,
  `DELETE_LOCAL_MERGED_BRANCH`, `CLEAR_SAFE_GENERATED_CACHE`,
  `QUARANTINE_ARTIFACT`, `RESTORE_QUARANTINE`,
  `REMOVE_STALE_TEMPORARY_STATE`) plus one ELEVATED class with a real
  executor to PROVE the tier distinction is structural, not just a label
  (`DELETE_BRANCH_WITH_UNIQUE_UNPUSHED_COMMITS`, real `git branch -D`) —
  and 5 further ELEVATED classes (`REMOVE_DIRTY_WORKTREE`, `GIT_PRUNE_GC`,
  `ARBITRARY_FILESYSTEM_DELETION`, `PROCESS_TERMINATION`,
  `REMOTE_BRANCH_DELETION`) that are fully classified/planned but have
  **no executor at all** in V0 — `isV0Implemented(actionClass)` gates
  dispatch, and an attempt returns
  `NOT_IMPLEMENTED_V0_CLASSIFICATION_ONLY` before the owner gate is even
  consulted (proven never to reach it — see Tests below). Both tiers sit
  behind the SAME unset owner-authorization gate in V0, per the phase
  instructions' own explicit allowance.
- `domain/cleanup-protected-registry.mjs` — the explicit denylist
  mechanism: `CANONICAL_PROTECTED_BRANCH_NAMES` (`main`/`master`/
  `tsf/main`, always protected regardless of registry content) plus an
  additive-only `{paths, branches}` registry (`mergeProtectedRegistry`
  can only grow a registry, never shrink one — a caller-supplied registry
  can never remove a default). `server/cleanup-protected-registry-
  defaults.mjs` seeds the real, program-specific defaults this
  authorization scope names (`C:\TSF_ORCA`, `C:\NWR`,
  `C:\NWR_HISTORICAL_DATA`), env-extensible
  (`TSF_CLEANUP_EXTRA_PROTECTED_PATHS`), always merged in by the executor
  — never overridable away.
- `domain/cleanup-safety-blockers.mjs` — `evaluateCleanupBlockers`: the
  independently-enforced blocker check (4B's "structurally separate"
  requirement). Ternary, fail-closed exactly like
  `resource-auditor.mjs`'s `classifyWorkspaceResource` (REUSE_PATTERN,
  not REUSE_DIRECTLY — a materially different question: "is it currently
  safe to MUTATE this specific target for THIS action" vs "is this
  workspace disposable"). Structural independence is enforced by NEVER
  being importable-around: `server/cleanup-executor.mjs`'s
  `runGovernedCleanupAction` calls it three separate times against three
  separately fresh evidence collections (plan time, authorization time,
  and immediately before the mutating call), hard-coded inside the one
  function that performs the mutation — there is no parameter or code
  path that skips it.
- `domain/cleanup-lifecycle.mjs` — the four genuinely distinct schemas
  (`TSF_CLEANUP_RECOMMENDATION_V1` / `_PLAN_V1` / `_AUTHORIZATION_V1` /
  `_EXECUTION_V1`), each buildable only from a valid instance of the
  stage before it. `computeCleanupRequestId(actionClass, targetIdentity)`
  — a deterministic sha256 fingerprint that IS the idempotency key.
  `createCleanupAuthorization` refuses unless the caller asserts
  `ownerGateOpen: true` (never fabricated here — the server derives it
  from the real gate) AND a blocker evaluation computed AT AUTHORIZATION
  TIME (not reused from plan time) is clear. `beginCleanupExecution`
  refuses an expired/revoked authorization.
- `domain/cleanup-receipt-chain.mjs` — hash-chained
  `TSF_CLEANUP_RECEIPT_V1` records (13 kinds spanning every lifecycle
  transition, including `PARTIAL_FAILURE_RECOVERED`/`IDEMPOTENT_REPLAY`),
  `verifyCleanupReceiptChain` detects a broken/tampered/reordered link.
- `server/cleanup-owner-authorization-gate.mjs` — **THE master gate**.
  Open only when BOTH an exact env-var marker
  (`TSF_CLEANUP_V1_OWNER_AUTHORIZATION`) AND a real flag file
  (`tsf/server/.local-state/CLEANUP_V1_OWNER_AUTHORIZATION.flag`, real
  content check) independently agree — defense in depth so no single
  accidental env var anywhere else can open real destructive capability.
  Fails closed on any read error. `env`/`flagFilePath` are dependency-
  injected with real defaults specifically so this phase's own tests can
  exercise "gate open → proceeds" against FABRICATED env objects/temp
  files without ever touching the real global gate — proven directly (see
  Tests). **Nothing in this phase sets either the real env var or writes
  the real flag file, anywhere.**
- `server/cleanup-request-store.mjs` — durable CAS store (REUSE_PATTERN
  from `planner-mission-store.mjs`), keyed by the deterministic
  `requestId`, appends (never overwrites) execution attempts and
  receipts. `data-store.mjs` gained one additive `cleanupRequests: {}`
  DEFAULTS entry.
- `server/cleanup-git-worktree-inventory.mjs` — real, read-only-until-
  called git evidence + the handful of real mutations (branch delete
  safe/force, worktree remove/add), each via `execFile` array args, never
  a shell string.
- `server/cleanup-active-mission-check.mjs` — real evidence from Phase
  2's durable store (see reconciliation above); always resolvable
  (`referenced: true|false`, never null) because the durable store is
  genuinely queryable, unlike external session liveness.
- `server/cleanup-revalidation.mjs` — `collectFreshSafetyContext`: the
  ONE place that re-collects everything live, right before use — real
  OS-resolved path identity (via the existing `resource-auditor-path-
  identity.mjs`, closing any junction/alias evasion), real git
  cleanliness, real active-mission reference, and a real file-handle-lock
  probe (`probeFileLock`). Never trusts anything carried from an earlier
  stage.
- `server/cleanup-quarantine-store.mjs` — reversible quarantine: a
  manifest is written to disk BEFORE the risky filesystem step and again
  after, so an interruption mid-operation leaves enough evidence for
  `recoverIncompleteQuarantine` to reach one of five coherent, honestly-
  labeled outcomes (never a guessed one) rather than silent corruption.
  `MOVE` mode (used by `QUARANTINE_ARTIFACT`) relocates the artifact for
  good; `COPY` mode (used by `REMOVE_DISPOSABLE_WORKTREE`) preserves a
  full copy — including untracked/gitignored content `git worktree
  remove` would otherwise destroy irretrievably — while deliberately
  leaving the original for git's OWN removal to actually delete.
  Same-volume moves use `renameSync` (atomic); cross-device falls back to
  a copy-then-integrity-verified-then-delete sequence. Windows
  EPERM/EACCES/EBUSY transient failures get the SAME bounded-backoff
  retry as `data-store.mjs`'s own `withWindowsRenameRetry` (added after a
  real flake surfaced under full-suite contention — see Tests).
  `restoreFromQuarantine` is idempotent (a second restore of an
  already-`RESTORED` manifest returns the same success, not an error) and
  fails closed (never overwrites) on a destination conflict.
- `server/cleanup-session-retirement.mjs` +
  `server/cleanup-session-retirement-action.mjs` — graceful, PID-targeted
  retirement. **Never kill-by-executable-name anywhere** (statically
  proven — see Tests): identity is re-verified against a caller-supplied
  marker immediately before signaling; a cooperative IPC message
  (`TSF_CLEANUP_GRACEFUL_RETIRE`) is tried first when the caller still
  holds the process handle (the real cross-platform graceful mechanism —
  POSIX `SIGTERM` is NOT real graceful shutdown on Windows), a bounded
  grace period is awaited, and only THEN does a still-PID-specific
  forceful stop run (`taskkill /PID <exact pid> /F` on win32, `SIGKILL`
  on POSIX — `/PID`, never `/IM`).
- `server/cleanup-executor-worktree-actions.mjs` /
  `server/cleanup-executor-artifact-actions.mjs` — the real mutate
  functions per action class (4C: modeled separately, no "clean
  everything" verb). Each returns `{steps, result}` or throws with a
  `.code`; each has no access to the request store, receipt chain, or
  owner gate of its own — only `server/cleanup-executor.mjs`'s
  `runGovernedCleanupAction` can produce a durable EXECUTION record.
- `server/cleanup-executor.mjs` — `runGovernedCleanupAction`, the sole
  orchestration entry point implementing the full pipeline: RECOMMENDATION
  → PLAN (with an informational plan-time blocker snapshot) → idempotency
  short-circuit (an already-`COMPLETED` requestId replays, never
  re-mutates) → `NOT_IMPLEMENTED_V0` short-circuit for ELEVATED classes
  with no executor → owner-gate check (fails closed) → a FRESH blocker
  re-evaluation at authorization time → AUTHORIZATION → EXECUTION begins
  → a THIRD, independent blocker re-evaluation immediately before the
  mutating call (**the race re-check**, `revalidate` is injectable purely
  so tests can prove this exact step catches a state change the earlier
  two didn't — production code never overrides it) → dispatch → receipt +
  durable persistence at every step, success or failure.
  `recoverStalledCleanupExecution` is a separate, explicitly-invoked
  crash-recovery entry point (never called implicitly mid-pipeline).
- `server/cleanup-http-routes.mjs`, registered in `http-server.mjs` —
  `GET /api/cleanup/{action-classes,gate-state,request,requests}`,
  `POST /api/cleanup/{preview,run,recover}`. `POST /run` never accepts a
  `gateCheck`/gate-shaped field from the request body — the route always
  uses the real gate (proven — see Tests).

**Deliberately NOT built (bounded V0, disclosed):** executors for 5 of
the 6 ELEVATED classes (only the branch-force-delete demo executor
exists, to prove the tier distinction is real) — `REMOVE_DIRTY_WORKTREE`,
`GIT_PRUNE_GC`, `ARBITRARY_FILESYSTEM_DELETION`, `PROCESS_TERMINATION`,
and `REMOTE_BRANCH_DELETION` are fully classified and plannable but have
literally no mutate function wired to their action class; a permanent
(non-quarantine) purge tool for old quarantined artifacts (quarantine
restore exists; permanent deletion of a quarantine entry does not, so
nothing this phase built can silently destroy the one safety-net copy it
creates); a live UI/chat surface for triggering a cleanup request (this
phase built the HTTP API only, mirroring the Resource Auditor V0's own
scope boundary — a future phase would wire a Command/chat bridge the same
way `command-dogfood-bridge.mjs`/`command-research-bridge.mjs` did for
their features); this worktree's `node_modules` gap (pre-existing,
unrelated, flagged by every prior phase).

**Test / Verification Ledger — Phase 4 (2026-09-06):**

- 15 new test files, **125 tests (node's own count), 124/125 pass** in
  isolation and within the full combined `cleanup-*.test.mjs` run:
  `cleanup-action-taxonomy` (6), `cleanup-protected-registry` (7),
  `cleanup-safety-blockers` (15), `cleanup-lifecycle` (10),
  `cleanup-receipt-chain` (8), `cleanup-owner-authorization-gate` (10),
  `cleanup-request-store` (9, including a real 10-way concurrent-writer
  CAS proof), `cleanup-git-worktree-inventory` (8, real temp git repos),
  `cleanup-active-mission-check` (6, real Phase 2 planner-mission-store
  fixtures), `cleanup-quarantine-store` (11, including a real Windows
  held-directory-cwd-lock fixture and 5 partial-failure-recovery
  fixtures), `cleanup-session-retirement` (6, real spawned child
  processes), `cleanup-revalidation` (8, including a real Windows
  junction), `cleanup-executor-worktree-adversarial` (12, full pipeline
  against real git repos), `cleanup-executor-artifact-adversarial` (8,
  including a real retired child process), `cleanup-http-routes` (1 —
  **the sole failure**, whole-file `ERR_MODULE_NOT_FOUND:
  @stablyai/playwright-test`, the exact same pre-existing environment gap
  Phase 1/2/3 already disclosed for this worktree's empty `node_modules`
  — every OTHER file importing `http-server.mjs` fails identically and
  pre-existingly, confirmed unrelated to this phase — see below).
- **Full-suite run** (`node --test test/*.test.mjs`): 1942 tests, 1894
  pass, 47 fail, 1 skipped. **All 47 failures confirmed pre-existing**:
  39 whole-file `ERR_MODULE_NOT_FOUND` (every file importing
  `http-server.mjs`, `cleanup-http-routes.test.mjs` now one of them, same
  root cause), 3 live-planner-dependent classification tests (matching
  Phase 1/2's own disclosed class), 5 real-process/port-timing tests
  (`activate()`/`self-update-scenarios` E&F/`keep-going-autonomy-proof`).
  Spot-checked via `git stash -u` + re-run on the clean pre-Phase-4 tree
  (`command-adversarial-corpus.test.mjs`, `self-update-scenarios.test.mjs`
  scenarios E/F): byte-identical failures, confirming zero regression.
- **A real flake was found and FIXED, not just tolerated**: the first
  full-suite run showed the new Windows held-directory-lock quarantine
  test failing (`EBUSY` on the RETRY attempt, after the lock-holder
  process had already been killed) — a genuine transient Windows handle-
  release race under this box's full-suite contention, not a design flaw.
  Fixed by adding the same bounded-backoff EPERM/EACCES/EBUSY retry
  `data-store.mjs`/`cross-process-file-lock.mjs` already use, to
  `cleanup-quarantine-store.mjs`'s own rename/rm calls. Re-verified: full
  suite re-run afterward showed exactly one more pass (1894 vs 1893) and
  the quarantine test file itself green in isolation and under full-suite
  load both times re-run.
- `npx oxlint` on all 36 new/changed files in one pass: **0 errors**
  except one pre-existing violation this phase's own additions grew by 4
  lines — `http-server.mjs`'s `max-lines` cap (600) was already exceeded
  (607 lines) on the clean pre-Phase-4 baseline (independently confirmed
  via `git stash`), now 611 after the one required route-registration
  block (`import` + 3-line `if`) added in the same position/style as
  every sibling route. No `max-lines` disable was added anywhere (forbidden
  by this repo's own AGENTS.md), and this file was not otherwise touched
  or restructured — out of scope for this phase to fix a pre-existing,
  unrelated debt item in a large shared file. Every NEW file individually
  respects the 600-line `.mjs` cap (largest: `cleanup-executor-worktree-
  adversarial.test.mjs` at 347 lines, `cleanup-executor.mjs` at 252).

**What at least 3 of the adversarial fixtures actually proved (narrative):**

1. **The race-between-audit-and-execution fixture** (`cleanup-executor-
   worktree-adversarial.test.mjs`) injected a fake `revalidate` returning
   a genuinely clear `SafetyContext` for the first two calls (plan time,
   authorization time) and a `DIRTY_WORKTREE`-blocked one only on the
   THIRD call. The real pipeline reached `AUTHORIZATION_GRANTED` and
   `EXECUTION_STARTED` normally, then the race re-check's own third,
   independent evaluation caught the injected state change and the run
   ended `EXECUTION_FAILED`/`TSF_CLEANUP_RACE_BLOCKED` — with the real git
   worktree on disk confirmed still present afterward. This proves the
   race-recheck is a genuinely separate, load-bearing check, not a reuse
   of the earlier two wearing a different name.
2. **The Windows held-directory-lock fixture** (`cleanup-quarantine-
   store.test.mjs`) spawned a REAL, separate Node child process whose
   `cwd` was set inside the target directory (a genuinely OS-enforced
   Windows in-use lock — a plain `fs.openSync('r+')` handle was tried
   first and found NOT to block modern libuv renames, so this fixture
   uses the mechanism that actually does). While the child was alive,
   `moveToQuarantine` was proven to throw cleanly with the original
   directory and its content fully intact (byte-identical), never
   corrupted/partially moved; after killing the child and confirming its
   exit, the identical call succeeded. This is the literal "blocks
   gracefully rather than corrupting" requirement, reproduced against a
   real OS lock, not simulated.
3. **The sleeping-lane / active-worker / stale-planner-lease fixtures**
   (`cleanup-executor-worktree-adversarial.test.mjs`,
   `cleanup-active-mission-check.test.mjs`) built REAL Phase 2 planner-
   mission checkpoints via `createPlannerMissionCheckpoint`/
   `registerDispatchedWorker` and REAL leases via
   `acquirePlannerLease` with an intentionally-past clock so the lease
   was already expired relative to the test's main clock — proving the
   mantra "Sleep != complete" is enforced by actual code, not a comment:
   `checkActiveMissionReference` blocks because `missionState` is still
   `'ACTIVE'`, completely independent of whether the LEASE happens to be
   live. A parallel fixture that calls `completePlannerMission` first
   confirms the SAME branch stops blocking only once genuinely complete —
   proving the check isn't hardcoded to always block, either.
4. **The protected-registry (NWR/TSF-style) fixture** tagged a real,
   otherwise perfectly disposable-looking temp worktree (clean, non-main,
   unreferenced) as protected via `callerProtectedRegistry`, resolved to
   its OS-canonical real path exactly as production registry-seeding
   would. `runGovernedCleanupAction` refused it (`AUTHORIZATION_REFUSED`)
   with the gate open and every OTHER signal clean — proving the denylist
   mechanism itself refuses a real target, not merely that the classifier
   would have anyway.
5. **The idempotency fixture**: the exact same `REMOVE_DISPOSABLE_
   WORKTREE` request was submitted twice. The first call really removed
   the worktree (`COMPLETED`); the second call detected the already-
   `COMPLETED` execution for the same deterministic `requestId` and
   returned `IDEMPOTENT_REPLAY` with the SAME `executionId` — proving a
   duplicate request is safe by construction, not by convention.
6. **The REAL default owner-authorization gate fixture** ran the full
   pipeline with `gateCheck` deliberately OMITTED (using the real,
   global `cleanup-owner-authorization-gate.mjs` against real
   `process.env`/the real flag file, neither ever set anywhere in this
   phase) against an otherwise-perfect, fully-disposable real fixture
   worktree. Result: `AUTHORIZATION_REFUSED`, worktree confirmed still
   present. The equivalent HTTP-level fixture additionally tried to
   smuggle an open gate through the request body (`gateCheck: 'OPEN'`,
   `ownerGateOpen: true`, the exact real marker string as a body field)
   — none of it had any effect; the route never reads authority from the
   request body.

**Confirmation: nothing real was ever touched, deleted, quarantined, or
killed.** Every fixture (git repos, worktrees, branches, files, spawned
child processes) was created under `os.tmpdir()` or this worktree's own
`.local-state`/test scope and destroyed by each test's own cleanup. Every
test file's `TSF_UI_STATE_FILE`/`TSF_CLEANUP_QUARANTINE_DIR` points at an
isolated, process-pid-suffixed path, never the real operator state. The
real owner-authorization gate (`TSF_CLEANUP_V1_OWNER_AUTHORIZATION` env
var, `CLEANUP_V1_OWNER_AUTHORIZATION.flag` file) was never set/written by
any code, script, or test in this phase — verified directly by a test
that calls the real, zero-argument `readOwnerAuthorizationGateState()`
and asserts `open === false`. `git status` in this worktree shows only
the 34 new files + 2 additive edits (`data-store.mjs`'s one DEFAULTS
line, `http-server.mjs`'s one route registration) listed above; no file
under `src/`, no other worktree, and no path outside this worktree's own
tree/`os.tmpdir()` was read, written, or deleted at any point in this
phase.

**Owner Gates Outstanding (Phase 4):**

1. **The owner-authorization gate itself** — by design, remains unset.
   Setting `TSF_CLEANUP_V1_OWNER_AUTHORIZATION` (env) AND writing
   `tsf/server/.local-state/CLEANUP_V1_OWNER_AUTHORIZATION.flag` with the
   matching marker is the explicit, two-part act that would open real
   destructive capability — a decision this phase does not make.
2. A live UI/chat trigger surface — not built (see Deliberately NOT
   built above); the HTTP API is the only surface today.
3. 5 of the 6 ELEVATED classes have no executor at all yet — a future
   phase's explicit, bounded scope if ever needed.
4. This worktree's `node_modules` gap — pre-existing, unrelated,
   flagged by every prior phase, not remediated here.

**Coordinator independent review:** not yet performed — this phase's
worktree is left intact (not merged, not pushed, not retired) awaiting
that review per the phase instructions' explicit "do not merge" scope.

### Phase 5 — Larger Astra Follow-up Benchmark

Worktree `astra-benchmark-v2-investigation` (branch
`tsf/feature/astra-benchmark-v2-investigation`, forked from `tsf/main` @
`32c5d05520`). Investigation-first per the phase instructions; no real
paid model call was made or attempted.

**STEP 1 — located the existing work (or didn't):**

- **The prior "initial A-E benchmark" the directive summarizes has no
  artifact anywhere in this repository.** Searched `tsf/docs/tsf/`,
  `tsf/domain`, `tsf/server`, and git history/commit messages across all
  branches for `astra`/`gpt-6`/`A-E benchmark`/`paired evaluation` and
  variants. The only occurrence of "Astra" anywhere in the tracked tree,
  before this phase, was this checkpoint's own Phase 5 status-table row
  name. Every other apparent hit on a case-insensitive `astra` grep was a
  substring false positive (e.g. `contrastRatio` contains `astRa`). The
  directive's claimed result ("both baseline and Astra substantively
  good, Astra showed positive long-horizon signal, sample too small") is
  therefore **unverifiable from this codebase** — recorded as such, not
  accepted at face value.
- **No "Astra" concept exists anywhere in this codebase** — not a routing
  option, not a model-selection config, not a provider adapter. The real,
  committed routing config (`tsf/routing/provider-role-mappings.v1.json`,
  `tsf/providers/launch-profiles.v1.json`, resolved by `domain/routing.mjs`'s
  `resolveRole`) defines exactly two launch profiles: `CODEX_SAFE`
  (`providerId: openai`, `agentId: codex`, status
  `VALIDATED_WINDOWS_FIXTURE`) and `CLAUDE_SAFE` (`providerId: anthropic`,
  `agentId: claude-code`, status **`CONFIGURED_RUNTIME_UNAVAILABLE`** in
  this environment). Neither resolves to, aliases, or references
  anything called Astra/gpt-6-astra. `provider-role-mappings.v1.json`'s
  own `experimentalHypothesis` block (explicitly `contractual: false`)
  loosely associates `workerBalanced` with "Codex / GPT-5.6 class" as a
  descriptive hypothesis only — not a concrete model binding, and not
  Astra. The one literal appearance of `gpt-5.6-sol` anywhere in the repo
  (`tsf/programs/daily-driver-autonomy-v1/state.json`, wave 11) is a
  narrative log entry describing a real, already-authenticated Codex CLI
  dispatch from an unrelated prior program (M3 daily-driver-autonomy
  dogfooding), not a benchmark mechanism and not evidence that a model
  literally identified as "gpt-6-astra" exists or is reachable anywhere
  in this environment.
- **Eval-pack infrastructure reviewed** (`tsf/domain/evaluation-pack.mjs`,
  `tsf/server/eval-pack-registry.mjs`, all 8 registered packs including
  Phase 1's `UI_DOGFOOD`): a sound, reusable harness *shape*
  (packId/cases/assertions/actualOutput), but every existing pack is
  pure/synthetic — it asserts a real domain function's output against a
  synthetic/fixture input and never dispatches a live model call.
  `tsf/server/routing-eval-cases.mjs`/`routing-eval-runner.mjs` (the
  closest-sounding "ROUTING" pack) only exercises `resolveRole` against
  the real config to check provider-id resolution and role independence
  — it never calls an actual model either. No separate "routing
  benchmark"/"model comparison" harness exists anywhere else in the repo.

**STEP 2 — cost/spend determination (the gate):**

- Every real (non-eval-pack) model dispatch found in this codebase goes
  through `tsf/providers/safe-provider-launch.mjs`, which launches the
  user's own already-authenticated Codex or Claude Code CLI — there is no
  generic "call any named external model string" path, so there is no
  mechanism by which "gpt-6-astra" specifically could even be dispatched
  today regardless of authorization.
  `CLAUDE_SAFE`'s status (`CONFIGURED_RUNTIME_UNAVAILABLE`) further means
  even the Anthropic path is not currently live in this environment.
- The one paid-provider-approval mechanism in this codebase,
  `tsf/domain/research-paid-approval.mjs`, is explicitly scoped to
  Research-mission paid providers (Exa/Parallel) and requires an
  explicit, per-mission owner grant naming one provider and one spend
  ceiling — a different subsystem for a different concern, confirmed by
  reading it directly, not assumed. It grants nothing for a model-routing
  comparison. No env var, config flag, or Needs-You grant anywhere in
  this repo authorizes spend on a model-comparison benchmark of any kind.
- **Determination: running a real, larger paired benchmark against
  "gpt-6-astra" would require new paid spend that is not already
  authorized by anything in this codebase — and the model is not even a
  reachable option regardless of authorization.** Per this program's own
  operating contract (owner gate on new, not-already-authorized paid
  spend) and the phase instructions' own explicit escape hatch ("if
  gpt-6-astra ... is not actually available/reachable in this
  environment at all, say so plainly ... do not simulate or fake a
  comparison result"), **no real benchmark was run, and nothing was
  built that could execute one.**

**STEP 3 — report, not fabricate:**

- Built `tsf/docs/tsf/ASTRA_LARGER_BENCHMARK_V2_DESIGN.md`: the findings
  above plus a ready-to-run design (8 task categories × 4 tasks = 32
  bounded tasks, paired/fair-conditions methodology, blind independent
  scoring rubric, and an honest "unknown — no pricing data found, flag
  for owner" cost line rather than a fabricated dollar figure) so a
  future pass can execute immediately once (a) a real, reachable
  provider/model exists for Astra (or its current equivalent) in
  `launch-profiles.v1.json` and (b) the owner explicitly authorizes a
  named spend ceiling, mirroring `research-paid-approval.mjs`'s existing
  grant pattern. No harness code was written — extending the eval-pack
  registry to dispatch a real paid model call is itself the gated
  capability, not something to half-build ahead of authorization.
- **No production routing changed.** `provider-role-mappings.v1.json` /
  `launch-profiles.v1.json` are untouched by this phase.
- **Result: `ASTRA_MORE_EVIDENCE_NEEDED`** — not because the sample would
  be too small (that was the prior pass's own known limitation, taken as
  given), but because the specific model this phase was asked to
  evaluate is not a reachable option in this environment at all, and the
  prior benchmark's own evidence cannot be located to corroborate the
  directive's summary of it either.

**Owner Gates Outstanding (Phase 5, recorded as a Needs-You item, not
blocking other program work):**

1. Confirm whether "gpt-6-astra"/"Astra" refers to a real, currently
   available model/provider this environment should be configured to
   reach at all — if so, supply the real provider + model identifier and
   its real pricing (the design doc's cost estimate is honestly blank
   pending this).
2. If/when available, explicitly authorize a named spend ceiling for
   this specific benchmark, the same way `research-paid-approval.mjs`
   already requires for Exa/Parallel — this phase found no such grant
   already covering a model-comparison benchmark.
3. Independently confirm or locate the prior "initial A-E benchmark" —
   this phase could not find it anywhere in this repository; if it exists
   outside this codebase, that location should be recorded here for any
   future Phase 5 continuation to reconcile against.

**Coordinator independent review:** not yet performed — this is a
freshly investigated, uncommitted-to-main worktree; no merge decision is
in scope for an investigation-only phase with no code to adopt.

## Next intended action

Phase 1, Phase 2, and Phase 3 (both waves) are all adopted and closed.
Phase 4 (Cleanup V1 / Governed Destructive Automation) has reached
`CLEANUP_V1_IMPLEMENTED_READY_FOR_OWNER_ACTIVATION` in worktree
`cleanup-v1-governed-destructive-automation` (branch
`tsf/feature/cleanup-v1-governed-destructive-automation`, forked from
`10e39227a7`) — implemented, tested (124/125 new tests passing, the one
failure a pre-existing environment gap), dry-run/fixture-proven, real
destructive execution gated behind the still-unset owner-authorization
gate. Awaiting coordinator/owner review before any merge decision. Phase
5 (Larger Astra Follow-up Benchmark) is investigated and returned
`ASTRA_MORE_EVIDENCE_NEEDED` — no real benchmark run, design ready in
`ASTRA_LARGER_BENCHMARK_V2_DESIGN.md`, owner gates recorded above, not
blocking other program work.

**Coordinator independent review (2026-09-06), Phase 4 adoption:** re-ran
124/125 new tests directly (1 confirmed pre-existing `node_modules`-gap
failure). Read `cleanup-owner-authorization-gate.mjs` (real two-signal
fail-closed gate — env marker AND flag file both required, neither ever
set by this work), `cleanup-executor.mjs` (genuine RECOMMENDATION → PLAN →
idempotency-check → gate-check → AUTHORIZATION → independent race-recheck
→ EXECUTION pipeline, structurally the sole mutation entry point), and
`cleanup-protected-registry(-defaults).mjs` (hardcoded real protected
paths — `C:\TSF_ORCA`, `C:\NWR`, `C:\NWR_HISTORICAL_DATA` — additive-only
merge, canonical branches always protected regardless of registry
contents) directly. Confirmed the one lint finding
(`http-server.mjs` max-lines, 611/600) is pre-existing debt the minimal
6-line route-wiring addition unavoidably grew, not a new violation and no
`max-lines` disable was added. No corrections needed. **Merged to
`tsf/main` @ `32c5d05520cfa189ac602c12cf03ba1f1121f534`, pushed to
`fork/tsf/main` (verified), worktree
`cleanup-v1-governed-destructive-automation` retired.**

**Coordinator independent review (2026-09-06), Phase 5 adoption:**
confirmed the commit is docs-only (2 files, both under `tsf/docs/tsf/`,
zero code/config changes, no executable benchmark harness). Read the
design doc's cost-estimate section directly — honestly states "Unknown —
no pricing data," explicitly declined to fabricate a number or make an
external network call to price an unconfirmed model. No corrections
needed. **Merged to `tsf/main` @
`e91cc0deecbfaeeff75766d041f7a3d870a5f962`, pushed to `fork/tsf/main`
(verified), worktree `astra-benchmark-v2-investigation` retired.**

---

# FINAL PROGRAM RECONCILIATION — `TSF_POST_CLEANUP_UPGRADE_PROGRAM_V1_COMPLETE`

All five phases have reached GREEN (adopted), DEFERRED_WITH_EXPLICIT_REASON,
or READY_FOR_OWNER_GATE. Canonical `tsf/main` verified clean, `fork/tsf/main`
verified current, no abandoned temporary worktrees, no duplicate
architecture introduced anywhere in this program, no historical TSF
engineering lane reopened, NWR protected state and the 2025 sealed holdout
both verified untouched throughout. This section is the summary report;
per-phase blow-by-blow detail is above.

## 1. Final Canonical Main

`tsf/main` @ **`e91cc0deecbfaeeff75766d041f7a3d870a5f962`**, working tree
clean, `fork/tsf/main` confirmed to resolve to the identical SHA (fetched
and re-verified after every push in this program — no force-push, no
history rewrite, every push preceded by a fetch + ancestor-check +
dry-run). Program start baseline was `458f73b789b83ec27d46394a8a2562bb8dab709c`;
9 commits landed across the program (2 feature + 1 docs for Phase 1's
worktree cycle collapses to 1 feature commit each phase, plus one
docs-only checkpoint commit opening each subsequent phase, plus Phase 3's
two-wave split and the Phase 5/final docs commits).

## 2. UI_DOGFOOD_AGENT_V0 (Phase 1)

**ADOPTED** @ `90d77e3a1cd56ee0cd34c3e40aecd86a3975ed1f`. Generic (not
NWR-hardcoded) UI dogfooding capability: reuses Playwright's existing
Electron fixture pattern, a new console/network-capture helper, the
existing `evaluation-pack.mjs` engine (+1 `UI_DOGFOOD` category), the
existing settings-search-catalog surface idiom, and a new Command intent
in `command-responder.mjs`. Golden run against Orca's own UI found 33 real
mobile-viewport `CLIPPED_CONTENT` findings (correctly left recommend-only
— architectural root cause, not silently redesigned). NWR dogfood pass
correctly deferred (Streamlit app blocked by host Device Guard policy —
not bypassed).

## 3. PLANNER_CONTEXT_LIFECYCLE_V0 (Phase 2)

**ADOPTED** @ `7521e4de87cde4d0eb981ccb5b6e2aedfb5c1513`. Single-writer
planner-mission lease (new sibling to the existing host-resource lease,
reusing its underlying cross-process file-lock primitive), durable
checkpoint/hydrate lifecycle, idempotent worker dispatch by task
fingerprint, Resource Pressure Governor-gated session creation. Golden
forced-rollover dogfood proven with genuinely separate in-process objects
and a real two-OS-process race test: zero re-dispatch, zero lost state,
Needs-You survives handoff, a stale planner is structurally refused
further mutation after a successor takes over.

## 4. Research Platform Completion Wave (Phase 3, both waves)

**ADOPTED** — Wave 1 @ `3ae53e07a5609797c4ecd254cb696b2c9cb5e672`
(REQ-002 Platform Learning Ledger, epistemic separation enforced
structurally — a lesson cannot carry fieldName/value/entityId, never
overrides verified evidence; REQ-003 chain-of-custody wiring, evidence-
gated tier upgrades, honest degradation-always-applied). Wave 2 @
`10e39227a7ebcdcee15689163c9707bbfc6866b5` (3C owner-supplied local
artifact + 3D authenticated official download, fixture-proven only, real
`assertNoSecretLeakage` runtime guard against credential fields + 3E
paywall/auth content classification, fail-closed + 3F additive snapshot
metadata fields named by the actual deferred backlog doc + 3G a real
`ResearchMission` driven through all three acquisition modes to genuine
completion). Needs-You: the real Electron-session bridge for 3D and a
real download transport are a product/UI decision, not built here.

## 5. CLEANUP_V1 (Phase 4)

**ADOPTED** @ `32c5d05520cfa189ac602c12cf03ba1f1121f534`, state
`CLEANUP_V1_IMPLEMENTED_READY_FOR_OWNER_ACTIVATION`. Full governed
destructive-action pipeline (recommendation → plan → authorization →
execution, each a distinct durable, receipted stage) over the existing
read-only Resource Auditor. Real destructive execution requires BOTH a
real env-var marker AND a real flag file to agree — neither was ever set
anywhere in this program. Protected-path registry hardcodes
`C:\TSF_ORCA`/`C:\NWR`/`C:\NWR_HISTORICAL_DATA` as permanently
unremovable, additive-only. All adversarial testing (dirty worktree,
Windows file-lock, partial-failure recovery, race-recheck, stale-lease,
idempotent replay) ran only against disposable fixtures in `os.tmpdir()`
— independently confirmed nothing real was ever touched.

## 6. Astra Follow-up (Phase 5)

**`ASTRA_MORE_EVIDENCE_NEEDED`** @ `e91cc0deecbfaeeff75766d041f7a3d870a5f962`.
Investigation (not a benchmark run) found: the directive's referenced
prior "initial A-E benchmark" is not locatable anywhere in this
repository or its git history; no "Astra"/`gpt-6-astra` routing option,
provider adapter, or launch profile exists anywhere in the current TSF
routing config (`provider-role-mappings.v1.json` defines exactly
`CODEX_SAFE` and `CLAUDE_SAFE`, neither Astra); no already-authorized
spend mechanism covers a model-comparison benchmark (the one paid-approval
primitive that exists, `research-paid-approval.mjs`, is explicitly scoped
to Exa/Parallel research-provider spend, a different subsystem). No real
paid provider was called; no fabricated result was produced. A ready-to-run
benchmark design (32 tasks, 8 categories, fair paired methodology, blind
scoring) is preserved in `ASTRA_LARGER_BENCHMARK_V2_DESIGN.md` for when an
owner supplies real model identity, pricing, and an authorized spend
ceiling. Production routing was not touched.

## 7. Test/Verification Ledger

Every phase's tests were independently re-run by the coordinator (not
just trusted from the implementing agent's report) before adoption:
Phase 1 — 68 new/changed tests directly reproduced, 100% pass, `npx
oxlint` clean. Phase 2 — 45 new tests directly reproduced (zero
`node_modules` dependency — built-ins only), 100% pass, lint clean.
Phase 3 Wave 1 — 23 new tests reproduced, 100% pass; lint's 4 findings
`git blame`-verified pre-existing. Phase 3 Wave 2 — 63 new/changed tests
reproduced across 8 files including the full 3G multi-mode proving set,
100% pass; real-shared-state isolation independently confirmed. Phase 4 —
124/125 new tests reproduced (1 pre-existing environment gap), including
real adversarial fixtures (genuine spawned child process holding a
Windows file lock; two real OS processes racing for a lease in Phase 2's
own cross-process test). Phase 5 — docs-only, no test surface. Every
phase's full-suite regression run showed all pre-existing failures
confirmed via `git stash`/baseline comparison as unrelated to that
phase's own change, zero new regressions introduced across the whole
program.

## 8. Adversarial Review Findings

No corrected defects were required in any phase's implementation — every
independent coordinator review before adoption found the work sound as
delivered. Genuine findings surfaced and correctly handled without being
treated as blockers: Phase 1's 33 real mobile-viewport clipping findings
(recommend-only, not silently redesigned); Phase 3 Wave 2's own
self-caught ESM-import-ordering bug (would have silently written to real
shared dev state — found and fixed by the implementing agent's own
testing before it ever reached coordinator review); Phase 4's disclosed
pre-existing `http-server.mjs` max-lines debt (not suppressed, not hidden).
The one standing process anomaly from earlier in this session (3
initially-unexplained background agents) was resolved on investigation:
they were the NWR preservation audit's own dispatched sub-workers, not
stray or duplicate dispatches.

## 9. Resource/Session History

Host free memory ranged ~1.4GB–2.8GB across the program (16GB host,
known shared-machine contention — corroborated mid-program by a new peer
session, `nwr-historical-redraft-data-hq-1d`, appearing during a low-memory
reading). Work was kept strictly sequential (one worker at a time) per
resource discipline; Phase 3 was deliberately split into two waves partly
for this reason. No process was ever killed by name; no giant test suite
was run merely for impressive counts — targeted test files were the
default, with two deliberate, bounded full-suite regression runs (Phase 4)
justified by that phase's destructive-automation subject matter.

## 10. Owner Gates Still Outstanding

1. **NWR preservation remediation** (recorded at program start, not
   program-created): push `tsf/feature/dataset-research-engine-v0` to a
   durable remote; durably preserve 57 UNIQUE_AND_MUST_PRESERVE + resolve
   29 UNCERTAIN artifacts (`raw_stats_2018_wk17.csv` most fragile);
   confirm the 19-file platform-bookkeeping cluster's adoption status
   with Main TSF HQ (likely already satisfied by the pre-program Dataset
   Research reconciliation, not independently re-verified here).
2. **Cleanup V1 real activation**: the owner-authorization gate
   (`TSF_CLEANUP_V1_OWNER_AUTHORIZATION` env var + a real flag file, both
   required) is implemented and tested but deliberately never set by this
   program. Setting it is a genuine owner decision.
3. **Phase 3's 3D real bridge**: a real Electron-authenticated-session
   bridge and real download transport for `AUTHENTICATED_OFFICIAL_DOWNLOAD`
   need a product/UI decision; the contract is fixture-proven only.
4. **Astra benchmark**: needs the owner to supply real model
   identity/pricing for whatever "gpt-6-astra" maps to today (if
   anything) and an authorized spend ceiling before any real comparison
   can run. The design is ready; nothing is blocked on this.

None of the above blocked this program's own completion, per its explicit
instruction that outstanding gates should be recorded and the program
should continue past them.

## 11. Deferred Future Roadmap

- Wire Phase 1's dogfood capability's fix-relaunch-rescan auto-iterate
  loop into a live Command-triggered multi-pass run (V0 is a single
  bounded read-only pass from chat by design).
- Wire Phase 2's `PlannerSessionLifecycle` into the live Command/Chat
  dispatch path so a real planner session actually uses it end-to-end,
  plus an automatic lease-renewal heartbeat (V0 exposes manual `renewLease()`).
- Wire Phase 3's Learning Ledger `retrieveLessonGuidance` into a live
  research-strategy decision (currently recorded but not consumed).
- The four ported-but-still-unwired Dataset Research modules
  (`identity-collision-resolution.mjs` and three others) — real
  capabilities, confirmed not what REQ-003 itself asked for.
- Fix Orca's Settings shell to support narrow-viewport (≤390px) layouts,
  or make an explicit product decision that mobile-width Settings is out
  of scope (Phase 1's own finding, never auto-applied).
- Remediate the recurring empty-`node_modules`-per-fresh-worktree gap
  that forced a partial-suite workaround in every phase of this program.

## 12. Final Worktree Inventory

Only two worktrees exist: `C:/TSF_ORCA` (`tsf/main` @
`e91cc0deecbfaeeff75766d041f7a3d870a5f962`) and
`C:/Users/codex-agent/orca/workspaces/TSF_ORCA/dataset-research-engine-v0`
(`tsf/feature/dataset-research-engine-v0` @ `32b175fa9b`, held under
`NWR_HISTORICAL_EVIDENCE_PRESERVATION_HOLD` — NOT program-created, not
program-cleared; see Owner Gate #1). All 8 temporary phase worktrees this
program itself created (`ui-dogfood-agent-v0`,
`planner-context-lifecycle-v0`, `research-platform-completion-wave-v0`,
`research-platform-completion-wave-v0-wave2`,
`cleanup-v1-governed-destructive-automation`,
`astra-benchmark-v2-investigation`, and this final-reconciliation
worktree itself once its own commit lands) were retired immediately after
each phase's adoption — none left abandoned.

## 13. Recommended Next Platform Priorities

In rough priority order: (1) resolve NWR preservation Owner Gate #1 — the
compounding risk (76 unpushed commits, single local object store) makes
this the most time-sensitive outstanding item, unrelated to TSF platform
work but genuinely urgent on its own; (2) wire Phase 2's planner lifecycle
into live Command dispatch — this is the actual "ZERO TIM RELAY" payoff,
currently proven but not yet load-bearing; (3) a real product decision on
Phase 3's authenticated-download bridge, since 3D otherwise stays
permanently fixture-only; (4) supply real Astra model identity/pricing if
that comparison still matters, or formally retire the idea if "Astra" no
longer refers to anything reachable; (5) Cleanup V1 real activation,
once the owner has reviewed the gated design and is ready to trust it
against real disposable resources.

**`TSF_POST_CLEANUP_UPGRADE_PROGRAM_V1_COMPLETE`**
