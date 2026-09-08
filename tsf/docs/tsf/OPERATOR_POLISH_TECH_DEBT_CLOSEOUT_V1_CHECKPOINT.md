# TSF — Operator Polish + Technical Debt Closeout V1 — Durable Checkpoint

Owner directive: close the small, concrete gaps disclosed by the Operator
Attention + Proactive Notifications V1 program and leave the operator
surface clean. Explicit: do not start another large platform subsystem.

## Baseline

- Canonical `tsf/main` SHA: `75db5ab59bf22cc7187aba8ef69560d6c1f25b6d`
  (Operator Attention + Proactive Notifications V1, fully adopted --
  Waves 1/2 + Phase 8 dogfood, `GREEN`)
- Working tree: clean
- Worktree: `operator-polish-techdebt-closeout-v1`
  (`tsf/feature/operator-polish-techdebt-closeout-v1`), `node_modules`
  junctioned at repo root (827 entries) and `tsf/ui/` (141 entries)

## Hard constraints (verbatim, must be preserved)

Do not touch NWR. Do not activate Cleanup V1. Do not enable autonomous
self-improvement adoption. Do not deploy. Do not add a new top-level
navigation area. Do not add an external notification vendor. Do not
create another attention/notification truth store. Phase 2 (http-server
split): zero route behavior change, zero authority change, no second
router framework, existing tests remain green. Phase 3 (Orca-core):
read-only inspection first, reconcile before build; if a safe existing
primitive exists, integrate the minimum adapter; if it needs new
Orca-core product work, do NOT build a parallel TSF notification system
-- produce a bounded requirement packet instead; no external paid
notification service.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1 (Planner Needs-You UI) | DONE | Wave A adopted at `66d29e238e`, independently re-verified (93+119 tests) |
| 2 (http-server split) | DONE | Wave B adopted at `7fa1ffd1e7` -- 875->488 lines, chat-http-routes.mjs extracted, max-lines violation resolved, equivalence independently re-proven (208+2763 tests) |
| 3 (Orca-core notification reconciliation) | DONE | `ORCA_CORE_GAP` -- requirement packet at `816a007904`, no code change (correct per its own verdict) |
| 4 (Attention UX dogfood) | DONE | Real-browser dogfood at `eee38845c3`, see below |
| 5 (Self-improvement observability) | DONE | Wave A adopted at `66d29e238e`, Command phrasing broadened, no new intents |

## Phase 4: Attention UX dogfood (real browser, real seeded state)

Seeded real durable state into an isolated `TSF_UI_STATE_FILE` via real
domain constructors + real store writes only (`createFinding`/
`transitionFinding`/`applyAutofixEligibility`/`withFinding`,
`createOvernightRun`/`completeRun`/`withKeepGoingRun`,
`createPlannerMissionCheckpoint`/`raisePlannerNeedsYou`/
`mutateCheckpoint`, `createResearchMission`/`completeResearchMission`/
`withResearchMission` with the real `buildNflQb2001Specification`
fixture) -- never hand-typed durable records. Ran the real `tsf/server`
API mounted as Vite dev-server middleware (`tsf/ui`'s own local dev
path, `npm run dev` on port 4600) against that state, and drove a real
Chromium session with the `playwright` package directly (the `$electron`
skill named in `AGENTS.md` is not installed in this environment; this is
genuine Playwright/CDP automation against the real rendered page, the
same substance the skill would have driven).

All 8 named states confirmed rendering for real, at both 1440x900 and a
375px narrow viewport: global indicator mixed content, HQ Needs You tile
(self-improvement + Planner both render, per Wave A), READY_FOR_ADOPTION
(both a self-improvement finding and a project-level Keep Going run),
WAITING_FOR_RESOURCES (via genuinely live, unmodified
`collectHostMemoryEvidence()` -- this host was already at real CRITICAL
memory pressure, 2.54GB/16GB available, from real concurrent session
load, so no monkey-patch/env-override was needed or used), the
FAILED_REQUIRES_ATTENTION failure state, Planner needsYou, a recently-
completed ResearchMission, and a genuinely clean/unseeded state
(separate isolated state file, empty-state copy confirmed honest).

One real, objective defect found and fixed:
`GlobalRunStatusIndicator`'s badge count/dialog silently dropped a
`PROJECT_ADOPTION_CANDIDATE`-sourced `READY_FOR_ADOPTION` item (the
legacy adoption-candidate path, which has no Keep Going run and
therefore no `liveWorkFeed`) -- `selectExtraAttentionItems`
(`tsf/ui/src/lib/global-run-status.ts`) only merged
self-improvement/planner/resource-pressure items, on the mistaken
premise that every other category already reaches the indicator via a
real `liveWorkFeed`. Fixed by also merging
`PROJECT_ADOPTION_CANDIDATE`-sourced items; verified live (badge
6 -> 7, dialog gained the missing item, no duplicates); regression test
added. Commit `eee38845c3`.

Command/UI agreement: `respondCommand` for "what needs me?" and "what's
ready for adoption?" named the exact same real items the UI showed (2
NEEDS_OWNER items matching the indicator's own NEEDS_OWNER-badged
cards; all 3 READY_FOR_ADOPTION items matching the dialog exactly).
Stale-notification check: `drainDueAttentionNotifications` delivered
real notices once (triggered incidentally by an earlier "did anything
change while I was gone?" phrasing probe), a second drain returned 0
new notices, and the live aggregator (`buildFleetAttentionItems` via
`gatherRealDeps`, the same real path `GET /api/attention` uses) showed
the identical 9 items before and after -- delivered notifications never
suppressed still-actionable live items.

Disclosed, out-of-scope finding (not fixed, per this mission's own "no
redesign" boundary): `AppShell.tsx`'s sidebar has zero responsive/
narrow-viewport handling anywhere (no breakpoint classes, no media
queries; `docs/STYLEGUIDE.md` defines no breakpoint either) -- at 375px
the sidebar does not collapse/relocate, squeezing `main` to ~151px and
visually clipping badges on HQ's Needs You cards (reachable only by
scrolling `main` sideways, not truly invisible, but a real narrow-width
degradation). This is a pre-existing, whole-app-chrome gap affecting
every page, not something introduced by or scoped to Attention UX --
building a responsive/collapsible sidebar would be a navigation
redesign, explicitly out of this mission's scope. The attention-specific
components themselves (the global indicator's own Dialog, its cards)
degrade correctly at 375px with no clipping or overflow of their own.

Full suites re-run clean after the fix: server `node --test
tsf/test/*.test.mjs` 2763 tests, 2755 pass, 7 fail (all pre-existing/
environmental -- 4 caused by this host's own real, live CRITICAL memory
pressure gating real dispatch in unrelated Keep Going tests, 2 confirmed
via `git stash` to fail identically with this phase's change removed,
1 in the same pre-existing classifier area); UI `npm test` 120/120 pass
(was 119, +1 new regression test); UI `npm run typecheck` clean;
`npx oxlint` clean on both touched files. Worktree left clean of every
disposable seed/driver script and isolated state file used for this
pass; not merged to main, not pushed.

## Next intended action

None remaining for this mission's Phase 4. All five phases are DONE.
