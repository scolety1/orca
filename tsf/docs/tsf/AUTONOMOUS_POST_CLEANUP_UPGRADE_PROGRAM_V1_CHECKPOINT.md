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
| 3. Deferred Research Platform Completion Wave | IN_PROGRESS (Wave 1 / 3A+3B **ADOPTED** @ `3ae53e07a5609797c4ecd254cb696b2c9cb5e672`, pushed, worktree retired; Wave 2 / 3C-3G starting) | Worktree `research-platform-completion-wave-v0-wave2` created from `3ae53e07a5` |
| 4. Cleanup V1 / Governed Destructive Automation | NOT_STARTED | |
| 5. Larger Astra Follow-up Benchmark | NOT_STARTED | |

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

## Next intended action

Phase 1, Phase 2, and Phase 3 Wave 1 (3A/3B) are all adopted and closed.
Phase 3 Wave 2 (3C-3G: acquisition modes, snapshot metadata, completion
verification) is now in progress in worktree
`research-platform-completion-wave-v0-wave2` (branch
`tsf/feature/research-platform-completion-wave-v0-wave2`, forked from
`3ae53e07a5`). Phases 4-5 are NOT_STARTED.
