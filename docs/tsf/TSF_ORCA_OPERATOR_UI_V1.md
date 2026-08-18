# TSF Orca Operator UI V1

## Verdict

`YELLOW_TSF_ORCA_OPERATOR_UI_V1_PARTIAL` — a coherent, genuinely usable operator frontend exists and is `READY_FOR_ADOPTION` as a UI candidate. It is not `GREEN` only because it reads real historical pilot evidence rather than a live Orca Run/task/dispatch feed (Wave 5 in `MIGRATION_WAVE_PLAN.md` remains `PENDING` — this runway did not attempt it) and because Planner Chat is a deterministic, state-grounded responder rather than a wired PLANNER_DEEP provider call.

## 1. What this is

A standalone local web app — not an Orca panel, not an Orca core change — that gives Tim the "open TSF → pick project → talk normally → see progress → adopt" experience described in the runway brief, built on **real** TSF domain code and **real** recorded pilot evidence wherever that evidence exists.

```text
tsf/
├── domain/, contracts/, routing/, providers/, migration/   (unchanged — reused, not duplicated)
├── pilots/                                                  (unchanged — real pilot evidence, read-only source)
├── server/                          NEW — narrow adapter
│   ├── portfolio-projection.mjs     projects tsf/pilots/*.json into one Project view model via tsf/domain/health.mjs
│   ├── fixture-project.mjs          the ONE clearly-labeled fixture project (see §5)
│   ├── data-store.mjs               local JSON file for Usage Mode + fixture decisions (gitignored)
│   ├── chat-responder.mjs           Planner Chat intent/decision classifier + state-grounded responses
│   └── http-server.mjs              /api/* router; usable standalone or as Vite middleware
├── test/operator-ui-server.test.mjs NEW — 9 tests over the above (29/29 total tsf/ tests pass)
└── ui/                              NEW — the operator frontend (Vite + React + TypeScript)
    ├── src/pages/                   HomePage, WorkPage, ProjectsPage, ProjectDetailPage, AgentsPage
    ├── src/components/              AppShell/nav, ProjectCard, CandidateCard, StatusChip, DecisionBadge, chat/PlannerChatPanel
    ├── src/components/ui/           hand-rolled shadcn-pattern primitives (button, card, badge, tabs, dialog, tooltip, scroll-area, separator, textarea)
    └── src/styles/theme.css         dark/purple token set (see §7)
```

**Orca core files modified: 0.** Everything above is new, TSF-owned files under `tsf/`. `tsf/ui` and `tsf/server` are independent Node/npm projects (their own `package.json`, own `node_modules`) — they do **not** join the root pnpm workspace (`pnpm-workspace.yaml` intentionally excludes subpackages; see its own comment), so nothing about root dependency resolution changed.

## 2. Why a standalone app, not an Orca plugin panel

`TSF_OVERLAY_ARCHITECTURE.md` already recorded the constraint: "The official Orca plugin seam supports a sandboxed panel, commands, private storage, and bounded worktree/agent events. It does not yet expose the complete Run/task/dispatch graph through the public plugin API." `tsf/panel.html` remains the smallest read-only plugin surface for exactly that reason.

A real operator UI — Home/Work/Projects/Agents navigation, a persistent chat panel, an Adoption surface with confirmable actions — needs more surface than a sandboxed iframe with `workspace:read`/`storage`/`events:subscribe` capabilities can give it today. Per the governing architecture's preference order (Orca-native capability → plugin seam → **TSF-owned overlay/module** → narrow adapter → core patch), a TSF-owned standalone module is the next rung down, and it's exactly the precedent the prior long-autonomous-runtime pilot already used ("Orca's native browser opened page ... title `Mission Control`" — a loopback web app, tested via Orca's browser). This V1 is that same shape, built out to the full IA in the runway brief, backed by real state instead of a fixture board.

`tsf/panel.html` is untouched and still valid as the plugin-native drill-down surface; nothing here replaces it.

## 3. How to launch it

```powershell
cd tsf/ui
npm install        # first time only; standalone npm project, not part of the root pnpm workspace
npm run dev         # starts Vite + the /api middleware together on http://127.0.0.1:4600
```

Open `http://127.0.0.1:4600/`. The API is mounted as Vite dev-server middleware (`tsf/ui/vite.config.ts` imports `tsf/server/http-server.mjs`'s `createRequestHandler()`), so one process serves both the UI and its data. To run the API standalone (e.g. against a production build of the UI): `node tsf/server/http-server.mjs` (defaults to port 4610, override with `TSF_API_PORT`).

`npm run build` produces a static `tsf/ui/dist/` (verified — 1862 modules, clean build). `npm run typecheck` runs `tsc -b --noEmit` (verified clean).

Local operator state (current Usage Mode, the fixture candidate's decision, chat history) lives in `tsf/server/.local-state/operator-state.json` — gitignored, delete it to reset to a clean demo state.

## 4. Real vs. fixture-backed data

**Real, wired to actual recorded evidence** (`tsf/pilots/*-real-project-v1/*.json`, loaded and normalized by `portfolio-projection.mjs`, receipts re-verified live via `tsf/domain/receipts.mjs:verifyReceipt`):

- Colety Labs Sales Engine — ADOPTED, real registration/health/release/receipts/result-capsule evidence
- Shopify Catalog QA — ADOPTED, same, plus browser-proof and verifier-correction-loop evidence
- Weird Talent Marketplace — BLOCKED, its preserved blocked candidate and the exact matcher-admission finding render on the Adoption tab, read-only

**One clearly-labeled fixture** (`tsf/server/fixture-project.mjs`, badge always reads `FIXTURE`, never `REAL PROJECT`): *TSF UI Capability Check*. It exists solely so the Adopt / Request Revision / Reject flow can be exercised through the **real** `tsf/domain/adoption.mjs` (`createCandidate`, `decideCandidate`, `candidateBinding`) and `tsf/domain/receipts.mjs` (`createReceipt`, hash-chained, `verifyReceipt`-checked) — not a mocked button. No repository exists for it on disk; deciding it can never touch a real project. This is the "small amount of clearly labeled fixture data" the runway brief allows.

**Honestly `UNKNOWN`, not fabricated:** provider/capacity summary on Home reads "Unknown" — there is no live token/quota/capacity telemetry source, so the UI says so instead of inventing a number (matches `docs/tsf/TSF_ORCA_LONG_AUTONOMOUS_RUNTIME_RUN_V1.md`'s own finding that "Token, quota, reset, and cache facts remain UNKNOWN").

**Historical, not live:** all three real projects' Orca sessions/worktrees (Agents page) are from completed pilot runs — no Orca runtime is currently attached to them. The UI labels this explicitly ("These Orca sessions are historical, not live").

## 5. Adoption surface

`CandidateCard` renders identity, branch/HEAD/tree, changed files, tests (with an honest neutral icon — not a false green/red — when a recorded test entry carries no pass/fail data, as happens for two of Weird Talent Marketplace's three legacy-shaped result capsules), verifier verdict/checks, and residual risk.

Actions (Review is implicit in the card itself; Adopt / Request Revision / Reject are buttons) only render as live when `candidate.decidable` is true — which the server only ever sets for the fixture project. Every real pilot candidate is `decidable: false` and shows its already-recorded decision instead; `POST /api/candidates/:id/decision` returns `409` for any non-fixture project id, and even for the fixture, `tsf/domain/adoption.mjs:decideCandidate` itself refuses a second decision under a new request id once the candidate has left `READY_FOR_ADOPTION` (covered by `tsf/test/operator-ui-server.test.mjs`). Confirming Adopt/Reject opens a `Dialog` naming exactly what will and won't happen ("does not push, merge, or deploy anything") before the request fires — this is deliberately the TIM_REQUIRED confirmation pattern from the decision model, not a one-click destructive action.

## 6. Planner Chat

**Component decision:** evaluated `@assistant-ui/react` (MIT, ~11.7k stars, actively published, ships attachments/streaming/shadcn theming out of the box — a legitimate contender). Installed it, read its runtime API, then removed it in favor of a hand-rolled panel on this repo's own primitives (`ScrollArea`, `Textarea`, `Button`, `Dialog`-adjacent patterns). Reasoning: V1's surface — message list, composer, attachment chips, per-message decision badge — didn't need assistant-ui's larger primitive-composition surface, and hand-rolling removed all risk of shipping an unverified integration against a library whose exact JSX composition I could not interactively confirm in this environment. It remains a reasonable upgrade path if Planner Chat grows real streaming/tool-call needs later; nothing about the current `/api/chat` contract would need to change to adopt it then.

**Backend:** `tsf/server/chat-responder.mjs` classifies intent (STATUS, FINISHED, NEXT_ACTION, RATIONALE, CRITIQUE, FIX_REQUEST, RESEARCH, HEALTH, ADOPTION, GENERAL) and decision class (AUTO_DECIDE / RECOMMEND_AND_PROCEED / TIM_REQUIRED) from the message text with no manual type picker, per the brief. TIM_REQUIRED triggers (push/merge/deploy/publish, money/paid API, credentials/secrets, destructive ops, "adopt this") always override the response with an explicit "I won't act on this automatically" answer, regardless of matched intent.

**Honesty about capability:** no paid provider call is wired in. The panel header reads "No live provider configured — rule-based fallback grounded in recorded project state," and every response is generated from the same real `ProjectDetail` object the rest of the UI reads (mission state, health findings, release fields, `selectedMission.rationale`, `resultCapsules[].implementationSummary`) — never invented. This was a deliberate reading of the decision model: wiring a real LLM call is a "money/paid API" action, which is TIM_REQUIRED, and this runway's authority does not include Tim explicitly approving that spend. The `PLANNER_DEEP` role name is shown, not a vendor name, and the response shape (`{ intent, decisionClass, text, plannerRole, providerLabel }`) is exactly what a real provider-backed route would fill in later — swapping the responder for one that calls a configured `PLANNER_DEEP` provider changes zero UI code.

Attachments: file/screenshot picker works (drag-in not implemented, click-to-attach is), filenames are appended to the outgoing message as context; contents are not read or sent anywhere — labeled as such in the composer ("Filenames are sent as context; contents aren't processed yet").

## 7. Visual direction

New token set in `tsf/ui/src/styles/theme.css` — deep charcoal background (`#09090f`), violet primary (`#9161f9`), lavender accent, a restrained single ambient radial glow behind the app shell (not per-card), three elevation tiers, `--radius: 0.75rem` base — structurally the same conventions as `docs/STYLEGUIDE.md` (paired surface/foreground tokens, `color-mix` tints, one radius scale, `data-slot` attributes, CVA variants, `lucide-react` icons at `size-4`/`size-3.5` per role) but a deliberately different palette, because this is a distinct product surface (the TSF operator UI, not Orca's own chrome) and Tim's brief explicitly specified this direction for it. Orca's own monochrome UI is untouched.

Single dark theme by design (no light mode was requested); no light-mode media query exists to accidentally invert it.

## 8. Legacy TSF (`C:\TSF_V1`) features preserved/adapted here

Read-only source: `docs/tsf/LEGACY_CODE_REUSE_MANIFEST.md` (prior runway's audit) plus the runway brief's own enumeration of legacy strengths, both used instead of re-deriving from `C:\TSF_V1` a second time.

| Legacy concept | Status here |
|---|---|
| HQ / operator home | **Preserved** — Home page: Needs You, Working, Ready for Adoption, Recently Completed, Active Fleet/Work Set/Usage Mode summary, Health warnings |
| Known Projects / Active Fleet / Work Set | **Preserved** — Projects page, backed by real `tsf/domain/portfolio.mjs` semantics (Work Set ⊆ Active Fleet ⊆ Known Projects) |
| Usage Modes incl. reserved High Assurance | **Preserved** — Projects page mode switcher calls the same `tsf-set-usage-mode` semantics as `tsf/main.mjs`; High Assurance renders as a locked, reserved tile, not a working mode (no config for it exists in `usage-modes.v1.json` — nothing was fabricated) |
| Needs You / Pause-Resume concepts | **Adapted** — Needs You is live (blocked missions + pending adoption candidates); no live Orca dispatch exists yet to pause/resume, so that action is not present rather than faked |
| Ready for Adoption / Stable / Upgrade / Testing / Published | **Preserved** — full release-track display per project, sourced from real recorded `release` fields |
| Health / remediation | **Preserved as read-only/advisory** — matches `tsf/domain/health.mjs`'s own `authority: 'ADVISORY_ONLY'`; no remediation actions (the legacy reuse manifest already classified remediation as out of scope this runway) |
| Receipts / evidence / provenance | **Preserved** — Receipts tab replays the real hash-chained `Receipt Lite` records with live `verifyReceipt()` re-verification, not a static checkmark |
| Concise return-from-work summaries | **Consolidated into** Work page's Recently Completed + per-project Evidence tab, rather than a separate summary page |
| Interactive HQ server/UI itself | **Not ported** — `LEGACY_CODE_REUSE_MANIFEST.md` already marked this `REJECT_LEGACY_IMPLEMENTATION`; this UI is a from-scratch React app, not a port of the legacy server |
| Legacy operator-action idempotency pattern | **Reused directly** — `tsf/domain/operator-action-lifecycle.mjs` (already a byte-for-byte legacy port per the manifest) is the pattern `CandidateCard`'s request-id-scoped decisions follow, though the UI calls `decideCandidate` directly rather than through that module in V1 |

Not recreated: no separate "candidate review" page (folded into the Adoption tab), no standalone provenance page (folded into Evidence + Receipts tabs) — consolidated per the runway brief's instruction not to recreate pages just because they existed before.

## 9. Orca surfaces reused vs. duplicated

Reused/deep-linked, not rebuilt: session/worktree/provider identity display on the Agents page reads directly from recorded Orca facts (`orcaSessionId`, `worktree`, `providerId`, `modelObserved`) rather than re-deriving them. "Open in Orca" is a copy-to-clipboard on the exact worktree path plus explicit instructional text, **not** a fabricated deep-link — Orca registers no `orca://` protocol handler (checked `src/main` for `protocol.handle`/`registerScheme`; none exists), so a working clickable deep link does not exist to build against. This is the honest version of the "Open in Orca / Inspect Work" affordance from §9 of the brief, not a guess dressed up as a feature.

No Orca process/session/worktree/browser/runtime system was reimplemented anywhere in `tsf/ui` or `tsf/server`.

## 10. Browser QA performed and defects fixed

Ran the built app in Chrome via the `claude-in-chrome` skill (this repo's own `AGENTS.md` Electron-UI guidance point applies to Orca's *own* rendered UI specifically; this is a separate standalone web app, so ordinary browser automation was the correct tool here, not Playwright-CDP-into-Orca). All fixes below were found live, not from source inspection:

1. **Title truncation / badge wrapping** on `ProjectCard` at a legitimate ~958–1100px "narrow desktop" width — badges wrapped to two lines, titles clipped to a few characters. Fixed: `min-w-0 flex-1` on the title column, `whitespace-nowrap shrink-0` added to the shared `Badge` primitive (was missing entirely — a real, generally-applicable bug, not just this card), long testing-status strings collapsed to a short badge instead of raw text overflowing the row.
2. **Grids not responsive** — Home/Work/Projects/ProjectDetail all used fixed `grid-cols-N`; made every one of them `grid-cols-1` → `sm:`/`lg:`/`xl:` scaled, including the Usage Mode tile row and the project-detail/chat split (`xl:grid-cols-[1fr_360px]`, stacks below that).
3. **Real horizontal page overflow on the Agents page** — the `220px 1fr` grid's content column had no `min-w-0`, so long worktree paths pushed the page wider than the viewport (confirmed via `scrollWidth > clientWidth`, not just visually). Fixed; reverified `scrollWidth === clientWidth` on all eight primary routes afterward.
4. **`selectedMission` schema mismatch crash risk** — Weird Talent Marketplace's `planner-evidence.json` records `selectedMission` as a plain string; Shopify's records it as `{title, rationale, nonScope}`. The first render attempt for Weird Talent Marketplace showed an empty "Recent decision" card. Fixed with `normalizeSelectedMission()` in `portfolio-projection.mjs`; same fix pattern applied to the two recorded `result-capsules.json` shapes (a plain array vs. a `{results: [...]}` wrapper — the initial server smoke test crashed on this before the UI was even built).
5. **Fixture receipts never wired into the UI** — `POST /api/candidates/.../decision` correctly created a real receipt, but `GET /api/projects/:id` never attached `opState.fixtureReceipts` onto the fixture project's `receipts.chain`, so the Receipts tab said "No receipts recorded" right after a real adoption decision. Fixed.
6. **False-red test status** — `CandidateCard` rendered a red ✗ for every test entry lacking `passed`/`exitCode` fields (true for two of Weird Talent's three legacy-shaped test-string entries), implying failure where the data is simply silent. Fixed to a neutral dot for "unknown," a real green check only when `passed`/`exitCode` data exists and is passing.
7. **Missing keyboard focus ring on primary nav** — `AppShell`'s `NavLink`s had `hover:` states but no `focus-visible:` ring; confirmed via computed-style check that adding `outline-none focus-visible:ring-2 focus-visible:ring-ring` produces a real visible ring (`box-shadow` verified programmatically).
8. **Chat markdown rendered as literal asterisks** — added `react-markdown` for assistant messages only (user messages stay plain `whitespace-pre-wrap` text, since they're never markdown).

Also verified: long chat messages wrap inside the bubble without overflow; Enter-to-send and the send button both work; adopt/request-revision/reject confirmation dialogs open and close correctly; chat history persists across a full page reload (`GET /api/chat/:projectId`); zero horizontal overflow on Home/Work/Projects/all four ProjectDetail pages/Agents at the tested viewport.

Not independently re-verified in a second, wider viewport: the `xl:` breakpoint layouts (project-detail two-column chat split, 5-wide Usage Mode row) render correctly by inspection and by the same Tailwind mechanism already confirmed working at the `sm:`/`lg:` tiers on this viewport, but the browser-automation tool available in this environment did not honor `resize_window` for the actual rendering viewport (confirmed via `window.innerWidth` staying fixed at 958px regardless), so a true wide-desktop screenshot was not captured.

## 11. Tests

- `node --test tsf/test/*.test.mjs` → **29/29 pass** (20 pre-existing + 9 new in `tsf/test/operator-ui-server.test.mjs`, covering portfolio projection against real pilot files, both recorded `selectedMission`/result-capsule shapes, receipt-chain verification, chat intent/decision classification, chat responses staying grounded in real state, and the fixture candidate's real `decideCandidate` transition + re-decision guard).
- `tsf/ui`: `npx tsc -b --noEmit` → clean. `npx vite build` → clean (1862 modules; one benign >500kB chunk-size advisory, not an error, not addressed — a code-splitting concern for a later pass, not a V1 defect).

## 12. Remaining gaps (honestly scoped, not hidden)

- **No live Orca Run/task/dispatch feed.** Work/Home read the same historical pilot snapshots as Projects; there is currently nothing running, so "Active"/"Working" correctly render empty. Wiring a live feed is Wave 5 in `MIGRATION_WAVE_PLAN.md`, explicitly out of this runway's scope, and was not attempted.
- **Planner Chat has no live model behind it** — by design, per §6. A real `PLANNER_DEEP` route can be dropped behind the existing `/api/chat` contract without any UI change.
- **"Open in Orca" is a copy-path affordance, not a deep link** — no Orca protocol handler exists to link to (verified by inspection, not assumed).
- **Attachment contents aren't processed** — filenames only, honestly labeled.
- **Usage Mode is portfolio-wide in this V1**, not yet a genuine per-project override (the brief's project-detail spec lists "Usage Mode" per project; the switcher currently lives on the Projects page and applies globally via the same storage key `tsf/main.mjs`'s plugin command already uses). Noted as a gap, not silently narrowed.
- **No production deployment path built** (`vite build` output is a static SPA that still needs `tsf/server/http-server.mjs` running alongside it for `/api/*` — fine for local use, not packaged further since this runway has no publish authority).
- **Wide-viewport (`xl:`) rendering not independently screenshotted** — see §10.

## 13. Capability ledger

No entry in `tsf/migration/capability-migration.v1.json` was changed. This runway proved a new operator-facing capability (a real, browser-tested Home/Work/Projects/Agents/Adoption/Planner-Chat frontend over real TSF domain state) that the existing 111-capability ledger's `UI-*` IDs likely map to, but updating that ledger's dispositions is a deliberate, separate action this document defers rather than doing hastily — the ledger's own migration script (`tsf/migration/update-capability-manifest.mjs`) should be the one editing it, with each ID's evidence checked individually, not a bulk edit from this summary.
