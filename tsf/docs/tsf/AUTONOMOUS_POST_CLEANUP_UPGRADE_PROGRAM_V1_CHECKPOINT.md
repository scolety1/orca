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
| 1. UI_DOGFOOD_AGENT_V0 | IMPLEMENTED (V0 adopted in feature worktree, not yet merged to `tsf/main`) | See below |
| 2. PLANNER_CONTEXT_LIFECYCLE_V0 | NOT_STARTED | |
| 3. Deferred Research Platform Completion Wave | NOT_STARTED | |
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

## Next intended action

Phase 1 (`UI_DOGFOOD_AGENT_V0`) V0 is implemented and verified in worktree
`ui-dogfood-agent-v0` (branch `tsf/feature/ui-dogfood-agent-v0`). Not yet
merged to `tsf/main` — merge/adoption is an owner decision outside this
worktree's scope. Phase 2 (`PLANNER_CONTEXT_LIFECYCLE_V0`) is next.
